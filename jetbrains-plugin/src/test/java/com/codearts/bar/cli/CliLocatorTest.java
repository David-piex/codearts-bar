package com.codearts.bar.cli;

import com.codearts.bar.settings.CodeArtsSettings;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

class CliLocatorTest {
    @TempDir Path temp;

    @AfterEach void clearDevelopmentOverride() {
        System.clearProperty("codearts.bar.cli");
    }

    @Test void explicitJavaScriptCliUsesExplicitNode() throws Exception {
        Path node = Files.writeString(temp.resolve("node.exe"), "node");
        Path cli = Files.writeString(temp.resolve("custom.js"), "cli");
        CodeArtsSettings.State settings = settings(node, cli);

        List<String> command = command(settings, () -> fail("embedded CLI must not be used"));

        assertEquals(List.of(node.toString(), cli.toString(), "query", "analytics", "--start", "10"), command);
    }

    @Test void explicitExecutableCliDoesNotAddNode() throws Exception {
        Path cli = Files.writeString(temp.resolve("custom-cli.exe"), "cli");
        CodeArtsSettings.State settings = settings(null, cli);

        List<String> command = command(settings, () -> fail("embedded CLI must not be used"));

        assertEquals(List.of(cli.toString(), "query", "analytics", "--start", "10"), command);
    }

    @Test void existingDevelopmentOverrideWinsOverEmbeddedCli() throws Exception {
        Path dev = Files.writeString(temp.resolve("dev.js"), "cli");
        System.setProperty("codearts.bar.cli", dev.toString());

        List<String> command = command(settings(null, null), () -> fail("embedded CLI must not be used"));

        assertEquals(dev.toString(), command.get(1));
        assertTrue(command.getFirst().endsWith("node") || command.getFirst().endsWith("node.exe"));
    }

    @Test void missingDevelopmentOverrideFallsBackToEmbeddedCli() throws Exception {
        Path embedded = Files.writeString(temp.resolve("embedded.js"), "cli");
        System.setProperty("codearts.bar.cli", temp.resolve("missing.js").toString());

        List<String> command = command(settings(null, null), () -> embedded);

        assertEquals(embedded.toString(), command.get(1));
    }

    @Test void embeddedFailureIsActionableAndNeverFallsBackToGlobalCli() {
        IOException error = assertThrows(IOException.class,
                () -> command(settings(null, null), () -> { throw new IOException("cache is read-only"); }));

        assertAll(
                () -> assertTrue(error.getMessage().contains("内嵌 CodeArts Bar CLI 无法准备")),
                () -> assertTrue(error.getMessage().contains("cache is read-only")),
                () -> assertTrue(error.getMessage().contains("IDE system 目录权限")),
                () -> assertTrue(error.getMessage().contains("明确指定 CLI 路径")));
    }

    @Test void invalidExplicitPathsFailBeforePreparingEmbeddedCli() {
        CodeArtsSettings.State settings = settings(temp.resolve("missing-node.exe"), null);

        IOException error = assertThrows(IOException.class,
                () -> command(settings, () -> fail("embedded CLI must not be used")));

        assertTrue(error.getMessage().contains("Node.js 路径不存在"));
    }

    private List<String> command(CodeArtsSettings.State settings, CliLocator.EmbeddedCliProvider provider) throws IOException {
        return CliLocator.queryCommand(settings, "analytics", List.of("--start", "10"), provider);
    }

    private static CodeArtsSettings.State settings(Path node, Path cli) {
        CodeArtsSettings.State settings = new CodeArtsSettings.State();
        settings.nodePath = node == null ? "" : node.toString();
        settings.cliPath = cli == null ? "" : cli.toString();
        return settings;
    }
}
