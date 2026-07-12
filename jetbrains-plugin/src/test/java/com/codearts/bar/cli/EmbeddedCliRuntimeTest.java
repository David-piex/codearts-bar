package com.codearts.bar.cli;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.file.StandardOpenOption;
import java.util.Objects;

import static org.junit.jupiter.api.Assertions.*;

class EmbeddedCliRuntimeTest {
    @TempDir Path temp;

    @Test void extractsPackagedCliAtomicallyAndIdempotently() throws Exception {
        Path oldRuntime = temp.resolve("cli-deadbeef");
        Files.createDirectories(oldRuntime);
        Files.writeString(oldRuntime.resolve("obsolete.txt"), "old");
        Path unrelated = temp.resolve("keep-me");
        Files.createDirectories(unrelated);
        Files.writeString(unrelated.resolve("data.txt"), "keep");
        ClassLoader loader = EmbeddedCliRuntime.class.getClassLoader();
        Path first = EmbeddedCliRuntime.materialize(loader, temp);
        EmbeddedCliRuntime.cleanupOldVersionsForTest(temp, first.getParent().getParent());
        assertTrue(Files.isRegularFile(first));
        assertTrue(Files.size(first) > 0);
        Path wasm = first.getParent().getParent().resolve("node_modules/sql.js/dist/sql-wasm.wasm");
        assertTrue(Files.isRegularFile(wasm));
        assertTrue(Files.size(wasm) > 600_000);

        var metadata = EmbeddedCliRuntime.snapshotRuntimeFilesForTest(first.getParent().getParent());
        assertTrue(EmbeddedCliRuntime.metadataUnchangedForTest(first.getParent().getParent(), metadata));

        Files.writeString(first, "corrupted but non-empty");
        assertFalse(EmbeddedCliRuntime.metadataUnchangedForTest(first.getParent().getParent(), metadata));
        Path second = EmbeddedCliRuntime.materialize(loader, temp);
        assertEquals(first, second);
        assertTrue(Files.size(second) > "corrupted but non-empty".length());
        assertNotEquals("corrupted but non-empty", Files.readString(second));
        assertTrue(EmbeddedCliRuntime.metadataUnchangedForTest(second.getParent().getParent(),
                EmbeddedCliRuntime.snapshotRuntimeFilesForTest(second.getParent().getParent())));
        assertFalse(Files.exists(oldRuntime));
        assertTrue(Files.isRegularFile(unrelated.resolve("data.txt")));
        try (var paths = Files.walk(temp)) {
            assertFalse(paths.anyMatch(path -> path.getFileName().toString().endsWith(".tmp")));
        }
    }

    @Test void keepsAnOldRuntimeThatAnotherProcessHasLocked() throws Exception {
        Path oldRuntime = temp.resolve("cli-feedface");
        Files.createDirectories(oldRuntime);
        Files.writeString(oldRuntime.resolve("in-use.txt"), "active");
        Path lockFile = temp.resolve(".locks/cli-feedface.lock");
        Files.createDirectories(lockFile.getParent());
        try (FileChannel channel = FileChannel.open(lockFile,
                StandardOpenOption.CREATE, StandardOpenOption.WRITE);
             FileLock ignored = channel.lock()) {
            Path currentEntry = EmbeddedCliRuntime.materialize(EmbeddedCliRuntime.class.getClassLoader(), temp);
            EmbeddedCliRuntime.cleanupOldVersionsForTest(temp, currentEntry.getParent().getParent());
            assertTrue(Files.isRegularFile(oldRuntime.resolve("in-use.txt")));
        }
    }

    @Test void explicitlyReleasesTheProductionRuntimeLockForDynamicUnload() throws Exception {
        Path root = temp.resolve("cli-cafebabe");
        Files.createDirectories(root);
        java.lang.reflect.Method hold = EmbeddedCliRuntime.class.getDeclaredMethod("holdRuntimeLock", Path.class);
        hold.setAccessible(true);
        hold.invoke(null, root);
        Path lockFile = temp.resolve(".locks/cli-cafebabe.lock");
        try (FileChannel contender = FileChannel.open(lockFile, StandardOpenOption.CREATE, StandardOpenOption.WRITE)) {
            assertThrows(java.nio.channels.OverlappingFileLockException.class, contender::tryLock);
            EmbeddedCliRuntime.releaseRuntimeLock();
            try (FileLock acquired = contender.tryLock()) { assertNotNull(acquired); }
        } finally {
            EmbeddedCliRuntime.releaseRuntimeLock();
        }
    }

    @Test void neverInstallsAResourceThatFailsItsManifestHash() throws Exception {
        ClassLoader packaged = EmbeddedCliRuntime.class.getClassLoader();
        ClassLoader corrupted = new ClassLoader(packaged) {
            @Override public InputStream getResourceAsStream(String name) {
                if (name.equals("cli/src/bin.js")) {
                    return new ByteArrayInputStream("corrupted payload".getBytes(java.nio.charset.StandardCharsets.UTF_8));
                }
                return super.getResourceAsStream(name);
            }
        };
        IOException error = assertThrows(IOException.class, () -> EmbeddedCliRuntime.materialize(corrupted, temp));
        assertTrue(error.getMessage().contains("integrity verification"));
        try (var files = Files.walk(temp)) {
            assertFalse(files.anyMatch(path -> path.getFileName().toString().equals("bin.js")));
        }
        try (var files = Files.walk(temp)) {
            assertFalse(files.anyMatch(path -> path.getFileName().toString().endsWith(".tmp")));
        }
    }

    @Test void repairsSameSizeSameTimestampTamperingAfterAnExecutionFailure() throws Exception {
        ClassLoader loader = EmbeddedCliRuntime.class.getClassLoader();
        Path entry = EmbeddedCliRuntime.materialize(loader, temp);
        byte[] original = Files.readAllBytes(entry);
        var modified = Files.getLastModifiedTime(entry);
        var metadata = EmbeddedCliRuntime.snapshotRuntimeFilesForTest(entry.getParent().getParent());
        byte[] tampered = original.clone();
        tampered[Math.min(8, tampered.length - 1)] ^= 1;
        Files.write(entry, tampered);
        Files.setLastModifiedTime(entry, modified);
        assertTrue(EmbeddedCliRuntime.metadataUnchangedForTest(entry.getParent().getParent(), metadata));

        assertTrue(EmbeddedCliRuntime.repairAfterFailureForTest(loader, temp, entry));
        assertArrayEquals(original, Files.readAllBytes(entry));
        assertFalse(EmbeddedCliRuntime.repairAfterFailureForTest(loader, temp, entry));
    }

    @Test void rejectsASymbolicLinkAtTheContentAddressedRuntimeRootWhenSupported() throws Exception {
        JsonObject manifest = JsonParser.parseString(new String(Objects.requireNonNull(
                EmbeddedCliRuntime.class.getClassLoader().getResourceAsStream("cli/CLI_RUNTIME_MANIFEST.json"))
                .readAllBytes(), java.nio.charset.StandardCharsets.UTF_8)).getAsJsonObject();
        String version = manifest.get("contentHash").getAsString().substring(0, 16);
        Path outside = temp.resolve("outside");
        Files.createDirectories(outside);
        Path runtime = temp.resolve("cli-" + version);
        try {
            Files.createSymbolicLink(runtime, outside);
        } catch (UnsupportedOperationException | java.nio.file.FileSystemException denied) {
            org.junit.jupiter.api.Assumptions.assumeTrue(false, "symbolic links unavailable: " + denied.getMessage());
        }
        IOException error = assertThrows(IOException.class,
                () -> EmbeddedCliRuntime.materialize(EmbeddedCliRuntime.class.getClassLoader(), temp));
        assertTrue(error.getMessage().contains("symbolic link"));
        assertFalse(Files.exists(outside.resolve("src/bin.js")));
    }
}
