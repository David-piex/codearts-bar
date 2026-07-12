package com.codearts.bar.cli;

import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.intellij.openapi.application.PathManager;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.LinkOption;
import java.nio.channels.FileChannel;
import java.nio.channels.FileLock;
import java.nio.channels.OverlappingFileLockException;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.List;
import java.util.Comparator;
import java.util.Map;
import java.util.LinkedHashMap;

final class EmbeddedCliRuntime {
    private static final String MANIFEST = "CLI_RUNTIME_MANIFEST.json";
    private static volatile Path cachedEntry;
    private static Map<Path, FileStamp> cachedFiles = Map.of();
    private static FileChannel runtimeLockChannel;
    private static FileLock runtimeLock;

    private EmbeddedCliRuntime() {}

    static synchronized Path materialize() throws IOException {
        if (cachedEntry != null && cachedFilesUnchanged()) return cachedEntry;
        ClassLoader loader = EmbeddedCliRuntime.class.getClassLoader();
        Path parent = Path.of(PathManager.getSystemPath(), "codearts-bar");
        Path root = runtimeRoot(loader, parent);
        holdRuntimeLock(root);
        Path entry = materialize(loader, parent, root);
        cleanupOldVersions(root.getParent(), root);
        cachedEntry = entry;
        cachedFiles = snapshotRuntimeFiles(root);
        return cachedEntry;
    }

    static Path materialize(ClassLoader loader, Path parent) throws IOException {
        return materialize(loader, parent, runtimeRoot(loader, parent));
    }

    private static Path runtimeRoot(ClassLoader loader, Path parent) throws IOException {
        JsonObject manifest = readManifest(loader);
        String contentHash = requiredString(manifest, "contentHash");
        if (!contentHash.matches("[0-9a-f]{64}")) throw new IOException("Invalid embedded CLI content hash");
        String version = contentHash.substring(0, 16);
        return parent.resolve("cli-" + version).toAbsolutePath().normalize();
    }

    private static Path materialize(ClassLoader loader, Path parent, Path root) throws IOException {
        JsonObject manifest = readManifest(loader);
        if (Files.isSymbolicLink(parent) || Files.isSymbolicLink(root)) {
            throw new IOException("Embedded CLI runtime directory is a symbolic link");
        }
        Files.createDirectories(root);

        List<String> files = manifestFiles(manifest);
        files.add("node_modules/sql.js/dist/sql-wasm.js");
        files.add("node_modules/sql.js/dist/sql-wasm.wasm");
        JsonObject hashes = manifest.has("hashes") && manifest.get("hashes").isJsonObject()
                ? manifest.getAsJsonObject("hashes") : null;
        if (hashes == null) throw new IOException("Embedded CLI manifest is missing hashes");
        for (String file : files) copyResource(loader, root, file, requiredHash(hashes, file));

        String entryName = requiredString(manifest, "entry");
        Path entry = safeTarget(root, entryName);
        if (!Files.isRegularFile(entry)) throw new IOException("Missing embedded CLI entry: " + entryName);
        return entry;
    }

    private static JsonObject readManifest(ClassLoader loader) throws IOException {
        try (InputStream stream = loader.getResourceAsStream("cli/" + MANIFEST)) {
            if (stream == null) throw new IOException("Missing embedded CLI manifest");
            try {
                return JsonParser.parseString(new String(stream.readAllBytes(), StandardCharsets.UTF_8)).getAsJsonObject();
            } catch (RuntimeException error) {
                throw new IOException("Invalid embedded CLI manifest", error);
            }
        }
    }

    private static List<String> manifestFiles(JsonObject manifest) throws IOException {
        if (!manifest.has("files") || !manifest.get("files").isJsonArray()) {
            throw new IOException("Embedded CLI manifest is missing files");
        }
        JsonArray array = manifest.getAsJsonArray("files");
        List<String> files = new ArrayList<>(array.size() + 3);
        for (var item : array) {
            if (!item.isJsonPrimitive() || !item.getAsJsonPrimitive().isString()) {
                throw new IOException("Embedded CLI manifest contains an invalid file entry");
            }
            files.add(item.getAsString());
        }
        return files;
    }

    private static String requiredString(JsonObject object, String key) throws IOException {
        if (!object.has(key) || !object.get(key).isJsonPrimitive()) {
            throw new IOException("Embedded CLI manifest is missing " + key);
        }
        String value = object.get(key).getAsString();
        if (value.isBlank()) throw new IOException("Embedded CLI manifest has an empty " + key);
        return value;
    }

    private static String requiredHash(JsonObject hashes, String file) throws IOException {
        String hash = requiredString(hashes, file);
        if (!hash.matches("[0-9a-f]{64}")) throw new IOException("Invalid embedded CLI resource hash: " + file);
        return hash;
    }

    private static void copyResource(ClassLoader loader, Path root, String file, String expectedHash) throws IOException {
        Path target = safeTarget(root, file);
        ensureNoSymbolicLinks(root, target.getParent());
        if (Files.isRegularFile(target, LinkOption.NOFOLLOW_LINKS) && expectedHash.equals(sha256(target))) return;
        if (Files.isSymbolicLink(target)) Files.delete(target);
        Files.createDirectories(target.getParent());
        ensureNoSymbolicLinks(root, target.getParent());
        try (InputStream input = loader.getResourceAsStream("cli/" + file)) {
            if (input == null) throw new IOException("Missing embedded CLI resource: " + file);
            Path temp = Files.createTempFile(target.getParent(), target.getFileName().toString(), ".tmp");
            try {
                Files.copy(input, temp, StandardCopyOption.REPLACE_EXISTING);
                if (!expectedHash.equals(sha256(temp))) {
                    throw new IOException("Embedded CLI resource failed integrity verification: " + file);
                }
                try {
                    Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
                } catch (AtomicMoveNotSupportedException ignored) {
                    Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING);
                }
                if (!expectedHash.equals(sha256(target))) {
                    Files.deleteIfExists(target);
                    throw new IOException("Embedded CLI resource was corrupted while installing: " + file);
                }
            } finally {
                Files.deleteIfExists(temp);
            }
        }
    }

    private static Path safeTarget(Path root, String file) throws IOException {
        if (file == null || file.isBlank()) throw new IOException("Embedded CLI resource path is empty");
        Path target = root.resolve(file.replace('\\', '/')).normalize();
        if (!target.startsWith(root)) throw new IOException("Embedded CLI resource escapes target directory: " + file);
        return target;
    }

    private static void ensureNoSymbolicLinks(Path root, Path targetParent) throws IOException {
        Path current = root;
        Path relative = root.relativize(targetParent);
        for (Path part : relative) {
            current = current.resolve(part);
            if (Files.isSymbolicLink(current)) throw new IOException("Embedded CLI resource path contains a symbolic link");
        }
    }

    private static String sha256(Path file) throws IOException {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            try (InputStream input = Files.newInputStream(file)) {
                byte[] buffer = new byte[64 * 1024];
                for (int read; (read = input.read(buffer)) >= 0; ) if (read > 0) digest.update(buffer, 0, read);
            }
            return java.util.HexFormat.of().formatHex(digest.digest());
        } catch (NoSuchAlgorithmException impossible) {
            throw new IOException("SHA-256 is unavailable", impossible);
        }
    }

    private static void cleanupOldVersions(Path parent, Path current) {
        if (!Files.isDirectory(parent)) return;
        try (var children = Files.list(parent)) {
            children.filter(Files::isDirectory)
                    .filter(path -> !path.equals(current))
                    .filter(path -> path.getFileName().toString().matches("cli-[0-9a-f]{8,64}"))
                    .forEach(EmbeddedCliRuntime::deleteTreeIfUnlocked);
        } catch (IOException ignored) { }
    }

    private static void holdRuntimeLock(Path root) throws IOException {
        if (runtimeLock != null && runtimeLock.isValid()) return;
        Path lockFile = lockFileFor(root);
        Files.createDirectories(lockFile.getParent());
        runtimeLockChannel = FileChannel.open(lockFile, StandardOpenOption.CREATE, StandardOpenOption.WRITE);
        runtimeLock = runtimeLockChannel.lock();
    }

    private static void deleteTreeIfUnlocked(Path root) {
        Path lockFile = lockFileFor(root);
        try { Files.createDirectories(lockFile.getParent()); }
        catch (IOException ignored) { return; }
        try (FileChannel channel = FileChannel.open(lockFile, StandardOpenOption.CREATE, StandardOpenOption.WRITE)) {
            try (FileLock ignored = channel.tryLock()) {
                if (ignored != null) deleteTreeBestEffort(root);
            } catch (OverlappingFileLockException ignored) { }
        } catch (IOException ignored) { }
    }

    private static Path lockFileFor(Path root) {
        return root.getParent().resolve(".locks").resolve(root.getFileName() + ".lock");
    }

    static void cleanupOldVersionsForTest(Path parent, Path current) {
        cleanupOldVersions(parent.toAbsolutePath().normalize(), current.toAbsolutePath().normalize());
    }

    static synchronized void releaseRuntimeLock() {
        if (runtimeLock != null) {
            try { runtimeLock.release(); } catch (IOException ignored) { }
            runtimeLock = null;
        }
        if (runtimeLockChannel != null) {
            try { runtimeLockChannel.close(); } catch (IOException ignored) { }
            runtimeLockChannel = null;
        }
        cachedEntry = null;
        cachedFiles = Map.of();
    }

    static synchronized boolean repairAfterFailure(List<String> command) {
        if (cachedEntry == null || command == null || command.stream().noneMatch(cachedEntry.toString()::equals)) return false;
        try {
            ClassLoader loader = EmbeddedCliRuntime.class.getClassLoader();
            Path root = cachedEntry.getParent().getParent();
            if (runtimeIsIntact(loader, root)) return false;
            Path entry = materialize(loader, root.getParent(), root);
            cachedEntry = entry;
            cachedFiles = snapshotRuntimeFiles(root);
            return true;
        } catch (IOException ignored) { return false; }
    }

    private static boolean runtimeIsIntact(ClassLoader loader, Path root) throws IOException {
        JsonObject manifest = readManifest(loader);
        JsonObject hashes = manifest.has("hashes") && manifest.get("hashes").isJsonObject()
                ? manifest.getAsJsonObject("hashes") : null;
        if (hashes == null) return false;
        List<String> files = manifestFiles(manifest);
        files.add("node_modules/sql.js/dist/sql-wasm.js");
        files.add("node_modules/sql.js/dist/sql-wasm.wasm");
        for (String file : files) {
            Path target = safeTarget(root, file);
            if (!Files.isRegularFile(target, LinkOption.NOFOLLOW_LINKS)
                    || !requiredHash(hashes, file).equals(sha256(target))) return false;
        }
        return true;
    }

    static boolean repairAfterFailureForTest(ClassLoader loader, Path parent, Path entry) throws IOException {
        Path root = entry.getParent().getParent();
        if (runtimeIsIntact(loader, root)) return false;
        materialize(loader, parent, root);
        return true;
    }

    private static boolean cachedFilesUnchanged() {
        if (cachedFiles.isEmpty()) return false;
        for (Map.Entry<Path, FileStamp> entry : cachedFiles.entrySet()) {
            try {
                if (!entry.getValue().equals(FileStamp.read(entry.getKey()))) return false;
            } catch (IOException ignored) { return false; }
        }
        return true;
    }

    private static Map<Path, FileStamp> snapshotRuntimeFiles(Path root) throws IOException {
        Map<Path, FileStamp> snapshot = new LinkedHashMap<>();
        try (var paths = Files.walk(root)) {
            for (Path path : paths.filter(item -> Files.isRegularFile(item, LinkOption.NOFOLLOW_LINKS)).toList()) {
                snapshot.put(path, FileStamp.read(path));
            }
        }
        return Map.copyOf(snapshot);
    }

    static boolean metadataUnchangedForTest(Path root, Map<Path, FileStamp> snapshot) {
        Map<Path, FileStamp> previous = cachedFiles;
        try {
            cachedFiles = snapshot;
            return cachedFilesUnchanged();
        } finally { cachedFiles = previous; }
    }

    static Map<Path, FileStamp> snapshotRuntimeFilesForTest(Path root) throws IOException {
        return snapshotRuntimeFiles(root);
    }

    record FileStamp(long size, long modifiedAt) {
        static FileStamp read(Path path) throws IOException {
            var attributes = Files.readAttributes(path, java.nio.file.attribute.BasicFileAttributes.class,
                    LinkOption.NOFOLLOW_LINKS);
            if (!attributes.isRegularFile()) throw new IOException("Embedded CLI cache entry is not a regular file");
            return new FileStamp(attributes.size(), attributes.lastModifiedTime().toMillis());
        }
    }

    private static void deleteTreeBestEffort(Path root) {
        try (var paths = Files.walk(root)) {
            paths.sorted(Comparator.reverseOrder()).forEach(path -> {
                try { Files.deleteIfExists(path); } catch (IOException ignored) { }
            });
        } catch (IOException ignored) { }
    }
}
