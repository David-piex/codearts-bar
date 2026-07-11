package com.codearts.bar.cli;

import com.codearts.bar.model.UsageSnapshot;
import com.codearts.bar.settings.CodeArtsSettings;
import com.google.gson.JsonParser;
import com.google.gson.JsonObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.TimeUnit;

public final class CliProcessRunner {
    public JsonObject loadQuery(CodeArtsSettings.State settings, String resource, java.util.List<String> args) throws IOException, InterruptedException {
        return execute(settings, CliLocator.queryCommand(settings, resource, args));
    }
    public UsageSnapshot loadSnapshot(CodeArtsSettings.State settings) throws IOException, InterruptedException {
        JsonObject payload = execute(settings, CliLocator.snapshotCommand(settings));
        UsageSnapshot snapshot = UsageSnapshot.fromJson(payload);
        if (!snapshot.ok()) throw new IOException(snapshot.error().isBlank() ? "CLI returned a failed state" : snapshot.error());
        return snapshot;
    }
    private JsonObject execute(CodeArtsSettings.State settings, List<String> command) throws IOException, InterruptedException {
        ProcessBuilder builder = new ProcessBuilder(command);
        if (settings.dbPath != null && !settings.dbPath.isBlank()) builder.environment().put("CODEARTS_BAR_DB", settings.dbPath.trim());
        if (settings.dailyLimit > 0) builder.environment().put("CODEARTS_BAR_DAILY_LIMIT", Long.toString(settings.dailyLimit));
        if (settings.windowHours > 0) builder.environment().put("CODEARTS_BAR_WINDOW_HOURS", Integer.toString(settings.windowHours));
        Process process = builder.start();
        ByteArrayOutputStream stdout = new ByteArrayOutputStream();
        ByteArrayOutputStream stderr = new ByteArrayOutputStream();
        Thread outThread = Thread.ofVirtual().start(() -> transfer(process.getInputStream(), stdout));
        Thread errThread = Thread.ofVirtual().start(() -> transfer(process.getErrorStream(), stderr));
        int timeout = Math.max(5, settings.timeoutSeconds);
        if (!process.waitFor(timeout, TimeUnit.SECONDS)) {
            process.destroyForcibly();
            throw new IOException("CodeArts Bar CLI 执行超时（" + timeout + " 秒）");
        }
        outThread.join(); errThread.join();
        String output = stdout.toString(StandardCharsets.UTF_8);
        String error = stderr.toString(StandardCharsets.UTF_8).trim();
        if (process.exitValue() != 0) throw new IOException(error.isEmpty() ? "CodeArts Bar CLI 退出码：" + process.exitValue() : error);
        try {
            JsonObject payload = JsonParser.parseString(output).getAsJsonObject();
            if (payload.has("ok") && !payload.get("ok").getAsBoolean()) throw new IOException(payload.has("error") ? payload.get("error").getAsString() : "CLI returned a failed state");
            return payload;
        } catch (RuntimeException parseError) {
            throw new IOException("Cannot parse CodeArts Bar CLI JSON: " + parseError.getMessage(), parseError);
        }
    }

    private static void transfer(java.io.InputStream input, ByteArrayOutputStream output) {
        try (input; output) { input.transferTo(output); } catch (IOException ignored) {}
    }
}
