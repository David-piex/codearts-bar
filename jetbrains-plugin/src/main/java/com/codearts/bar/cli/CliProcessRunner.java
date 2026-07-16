package com.codearts.bar.cli;

import com.codearts.bar.model.UsageSnapshot;
import com.codearts.bar.model.SensitiveText;
import com.codearts.bar.settings.CodeArtsSettings;
import com.google.gson.JsonParser;
import com.google.gson.JsonObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentMap;
import java.util.concurrent.TimeUnit;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class CliProcessRunner {
    private static final int MIN_NODE_MAJOR = 18;
    private static final Pattern NODE_VERSION = Pattern.compile("^v?(\\d+)(?:\\.|$)");
    private static final ConcurrentMap<String, Integer> NODE_MAJORS = new ConcurrentHashMap<>();

    public JsonObject exportSession(CodeArtsSettings.State settings, java.util.List<String> args) throws IOException, InterruptedException {
        List<String> command = CliLocator.exportCommand(settings, args);
        try { return execute(settings, command); }
        catch (IOException first) {
            if (!CliLocator.repairEmbeddedRuntime(command)) throw first;
            return execute(settings, CliLocator.exportCommand(settings, args));
        }
    }
    public JsonObject exportSessions(CodeArtsSettings.State settings, java.util.List<String> args) throws IOException, InterruptedException {
        List<String> command = CliLocator.exportSessionsCommand(settings, args);
        try { return execute(settings, command); }
        catch (IOException first) {
            if (!CliLocator.repairEmbeddedRuntime(command)) throw first;
            return execute(settings, CliLocator.exportSessionsCommand(settings, args));
        }
    }
    public JsonObject loadQuery(CodeArtsSettings.State settings, String resource, java.util.List<String> args) throws IOException, InterruptedException {
        List<String> command = CliLocator.queryCommand(settings, resource, args);
        try { return queryData(execute(settings, command)); }
        catch (IOException first) {
            if (!CliLocator.repairEmbeddedRuntime(command)) throw first;
            return queryData(execute(settings, CliLocator.queryCommand(settings, resource, args)));
        }
    }

    static JsonObject queryData(JsonObject payload) throws IOException {
        if (payload == null || !payload.has("data") || !payload.get("data").isJsonObject()) {
            throw new IOException("CodeArts Bar CLI 查询响应缺少 data 对象");
        }
        return payload.getAsJsonObject("data");
    }
    public UsageSnapshot loadSnapshot(CodeArtsSettings.State settings) throws IOException, InterruptedException {
        List<String> command = CliLocator.snapshotCommand(settings);
        JsonObject payload;
        try { payload = execute(settings, command); }
        catch (IOException first) {
            if (!CliLocator.repairEmbeddedRuntime(command)) throw first;
            payload = execute(settings, CliLocator.snapshotCommand(settings));
        }
        UsageSnapshot snapshot = UsageSnapshot.fromJson(payload);
        if (!snapshot.ok()) throw new IOException(snapshot.error().isBlank() ? "CLI returned a failed state" : snapshot.error());
        return snapshot;
    }
    JsonObject execute(CodeArtsSettings.State settings, List<String> command) throws IOException, InterruptedException {
        if (settings.dbPath != null && !settings.dbPath.isBlank() && !Files.isRegularFile(Path.of(settings.dbPath.trim()))) {
            throw new IOException("数据库文件不存在，请在设置中重新选择 opencode.db，或留空使用自动发现。");
        }
        validateNodeRuntime(command);
        ProcessBuilder builder = new ProcessBuilder(command);
        if (settings.dbPath != null && !settings.dbPath.isBlank()) builder.environment().put("CODEARTS_BAR_DB", settings.dbPath.trim());
        if (settings.dailyLimit > 0) builder.environment().put("CODEARTS_BAR_DAILY_LIMIT", Long.toString(settings.dailyLimit));
        if (settings.windowHours > 0) builder.environment().put("CODEARTS_BAR_WINDOW_HOURS", Integer.toString(settings.windowHours));
        final Process process;
        try {
            process = builder.start();
        } catch (IOException startError) {
            String executable = command.isEmpty() ? "" : Path.of(command.getFirst()).getFileName().toString().toLowerCase();
            if (executable.equals("node") || executable.equals("node.exe")) {
                throw new IOException("未找到 Node.js。请安装 Node.js，或在设置中指定 Node.js 可执行文件。", startError);
            }
            if (executable.startsWith("codearts-bar")) {
                throw new IOException("无法启动 CodeArts Bar CLI。请检查 CLI 路径，或留空使用内嵌 CLI。", startError);
            }
            throw startError;
        }
        ByteArrayOutputStream stdout = new ByteArrayOutputStream();
        ByteArrayOutputStream stderr = new ByteArrayOutputStream();
        Thread outThread = Thread.ofVirtual().start(() -> transfer(process.getInputStream(), stdout));
        Thread errThread = Thread.ofVirtual().start(() -> transfer(process.getErrorStream(), stderr));
        int timeout = Math.max(5, settings.timeoutSeconds);
        try {
            if (!process.waitFor(timeout, TimeUnit.SECONDS)) {
                terminate(process);
                join(outThread, errThread);
                throw new IOException("CodeArts Bar CLI 执行超时（" + timeout + " 秒）");
            }
            join(outThread, errThread);
        } catch (InterruptedException interrupted) {
            terminate(process);
            throw interrupted;
        }
        String output = stdout.toString(StandardCharsets.UTF_8);
        String error = stderr.toString(StandardCharsets.UTF_8).trim();
        try {
            JsonObject payload = JsonParser.parseString(output).getAsJsonObject();
            if (process.exitValue() != 0) {
                String message = payload.has("error") ? payload.get("error").getAsString() : error;
                throw new IOException(message.isBlank() ? "CodeArts Bar CLI 退出码：" + process.exitValue() : SensitiveText.safeSummary(message));
            }
            if (payload.has("ok") && !payload.get("ok").getAsBoolean()) throw new IOException(payload.has("error") ? SensitiveText.safeSummary(payload.get("error").getAsString()) : "CLI returned a failed state");
            return payload;
        } catch (RuntimeException parseError) {
            if (process.exitValue() != 0) throw new IOException(error.isEmpty() ? "CodeArts Bar CLI 退出码：" + process.exitValue() : SensitiveText.safeSummary(error), parseError);
            throw new IOException("Cannot parse CodeArts Bar CLI JSON: " + SensitiveText.safeSummary(parseError.getMessage()), parseError);
        }
    }

    private static void validateNodeRuntime(List<String> command) throws IOException, InterruptedException {
        if (!usesNode(command)) return;
        String executable = command.getFirst();
        Integer cached = NODE_MAJORS.get(executable);
        if (cached != null) {
            requireSupportedNodeVersion(cached);
            return;
        }
        final Process process;
        try {
            process = new ProcessBuilder(executable, "--version").redirectErrorStream(true).start();
        } catch (IOException startError) {
            throw new IOException("未找到 Node.js。请安装 Node.js 18 或更高版本，或在设置中指定 Node.js 可执行文件。", startError);
        }
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        Thread outputThread = Thread.ofVirtual().start(() -> transfer(process.getInputStream(), output));
        try {
            if (!process.waitFor(5, TimeUnit.SECONDS)) {
                terminate(process);
                join(outputThread);
                throw new IOException("Node.js 版本检测超时。请在设置中指定 Node.js 18 或更高版本的可执行文件。");
            }
            join(outputThread);
        } catch (InterruptedException interrupted) {
            terminate(process);
            throw interrupted;
        }
        int major = process.exitValue() == 0 ? parseNodeMajor(output.toString(StandardCharsets.UTF_8)) : 0;
        requireSupportedNodeVersion(major);
        NODE_MAJORS.putIfAbsent(executable, major);
    }

    static int parseNodeMajor(String version) {
        Matcher match = NODE_VERSION.matcher(version == null ? "" : version.strip());
        if (!match.find()) return 0;
        try { return Integer.parseInt(match.group(1)); }
        catch (NumberFormatException ignored) { return 0; }
    }

    static void requireSupportedNodeVersion(int major) throws IOException {
        if (major >= MIN_NODE_MAJOR) return;
        if (major > 0) {
            throw new IOException("Node.js 版本过低（检测到 " + major + "）。CodeArts Bar 需要 Node.js 18 或更高版本。");
        }
        throw new IOException("无法确认 Node.js 版本。请安装 Node.js 18 或更高版本，或在设置中指定正确的可执行文件。");
    }

    private static boolean usesNode(List<String> command) {
        if (command == null || command.isEmpty()) return false;
        String executable = command.getFirst().replace('\\', '/');
        String name = executable.substring(executable.lastIndexOf('/') + 1).toLowerCase();
        if (name.equals("node") || name.equals("node.exe")) return true;
        if (command.size() < 2) return false;
        String entry = command.get(1).toLowerCase();
        return entry.endsWith(".js") || entry.endsWith(".cjs");
    }

    private static void transfer(java.io.InputStream input, ByteArrayOutputStream output) {
        try (input; output) { input.transferTo(output); } catch (IOException ignored) {}
    }

    private static void terminate(Process process) {
        if (!process.isAlive()) return;
        process.destroy();
        try {
            if (!process.waitFor(250, TimeUnit.MILLISECONDS)) process.destroyForcibly();
        } catch (InterruptedException interrupted) {
            process.destroyForcibly();
            Thread.currentThread().interrupt();
        }
    }

    private static void join(Thread... threads) throws InterruptedException {
        for (Thread thread : threads) thread.join();
    }
}
