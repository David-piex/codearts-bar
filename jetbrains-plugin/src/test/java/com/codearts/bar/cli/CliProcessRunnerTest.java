package com.codearts.bar.cli;

import com.google.gson.JsonParser;
import com.codearts.bar.settings.CodeArtsSettings;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.*;

class CliProcessRunnerTest {
    @TempDir Path temp;

    @Test void returnsValidatedQueryDataObject() throws Exception {
        var payload = JsonParser.parseString("{\"ok\":true,\"data\":{\"total\":3}}").getAsJsonObject();
        assertEquals(3, CliProcessRunner.queryData(payload).get("total").getAsInt());
    }

    @Test void rejectsMissingQueryData() {
        IOException error = assertThrows(IOException.class,
                () -> CliProcessRunner.queryData(JsonParser.parseString("{\"ok\":true}").getAsJsonObject()));
        assertTrue(error.getMessage().contains("data"));
    }

    @Test void rejectsNonObjectQueryData() {
        assertThrows(IOException.class,
                () -> CliProcessRunner.queryData(JsonParser.parseString("{\"data\":[]}").getAsJsonObject()));
    }

    @Test void interruptionTerminatesTheRunningCliProcess() throws Exception {
        Path pidFile = temp.resolve("node.pid");
        String node = CliLocator.findOnPath(System.getProperty("os.name", "").startsWith("Windows") ? "node.exe" : "node");
        String script = "require('fs').writeFileSync(process.argv[1],String(process.pid));setTimeout(()=>console.log('{\\\"ok\\\":true}'),30000)";
        var executor = Executors.newSingleThreadExecutor();
        try {
            var task = executor.submit(() -> new CliProcessRunner().execute(new CodeArtsSettings.State(),
                    List.of(node, "-e", script, pidFile.toString())));
            assertTimeoutPreemptively(Duration.ofSeconds(5), () -> {
                while (!Files.isRegularFile(pidFile)) Thread.sleep(20);
            });
            long pid = Long.parseLong(Files.readString(pidFile));
            assertTrue(ProcessHandle.of(pid).map(ProcessHandle::isAlive).orElse(false));

            assertTrue(task.cancel(true));
            executor.shutdown();
            assertTrue(executor.awaitTermination(3, TimeUnit.SECONDS));
            assertTimeoutPreemptively(Duration.ofSeconds(3), () -> {
                while (ProcessHandle.of(pid).map(ProcessHandle::isAlive).orElse(false)) Thread.sleep(20);
            });
        } finally {
            executor.shutdownNow();
        }
    }

    @Test void rejectsMissingDatabaseBeforeStartingCli() {
        CodeArtsSettings.State settings = new CodeArtsSettings.State();
        settings.dbPath = temp.resolve("missing.db").toString();
        IOException error = assertThrows(IOException.class,
                () -> new CliProcessRunner().execute(settings, List.of("does-not-matter")));
        assertTrue(error.getMessage().contains("数据库文件不存在"));
    }

    @Test void explainsMissingNodeExecutable() {
        IOException error = assertThrows(IOException.class,
                () -> new CliProcessRunner().execute(new CodeArtsSettings.State(),
                        List.of(temp.resolve("missing-node/node.exe").toString(), "script.js")));
        assertTrue(error.getMessage().contains("Node.js"));
        assertTrue(error.getMessage().contains("18"));
    }

    @Test void parsesAndEnforcesTheSupportedNodeVersion() throws Exception {
        assertEquals(18, CliProcessRunner.parseNodeMajor("v18.20.8\n"));
        assertEquals(24, CliProcessRunner.parseNodeMajor("24.1.0"));
        assertEquals(0, CliProcessRunner.parseNodeMajor("unknown"));
        assertDoesNotThrow(() -> CliProcessRunner.requireSupportedNodeVersion(18));
        IOException old = assertThrows(IOException.class,
                () -> CliProcessRunner.requireSupportedNodeVersion(16));
        assertTrue(old.getMessage().contains("检测到 16"));
        assertTrue(old.getMessage().contains("18"));
        IOException unknown = assertThrows(IOException.class,
                () -> CliProcessRunner.requireSupportedNodeVersion(0));
        assertTrue(unknown.getMessage().contains("无法确认"));
    }

    @Test void redactsCliFailurePayloadAtTheProcessBoundary() throws Exception {
        String node = CliLocator.findOnPath(System.getProperty("os.name", "").startsWith("Windows") ? "node.exe" : "node");
        String privateError = "failure token=secret Bearer abc.def at C:\\Users\\private-user\\file.js and /home/private-linux/file.js\nprivate-stack-frame";
        String script = "console.log(JSON.stringify({ok:false,error:process.argv[1]}));process.exitCode=1";
        IOException error = assertThrows(IOException.class, () -> new CliProcessRunner().execute(
                new CodeArtsSettings.State(), List.of(node, "-e", script, privateError)));
        assertFalse(error.getMessage().contains("secret"));
        assertFalse(error.getMessage().contains("private-user"));
        assertFalse(error.getMessage().contains("private-linux"));
        assertFalse(error.getMessage().contains("private-stack-frame"));
        assertTrue(error.getMessage().contains("[path]"));
    }
}
