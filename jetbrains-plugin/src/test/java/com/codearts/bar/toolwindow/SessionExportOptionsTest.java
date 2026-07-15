package com.codearts.bar.toolwindow;

import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;

class SessionExportOptionsTest {
    @Test void defaultsKeepContentAndRedactionWithoutSensitiveToolIo() {
        var options = CodeArtsDashboardPanel.SessionExportOptions.defaults();
        List<String> args = new ArrayList<>();
        options.appendCliArgs(args);

        assertEquals(List.of(), args);
        assertEquals(new CodeArtsDashboardPanel.SessionExportOptions(true, false, true, true), options);
    }

    @Test void mapsEveryPrivacyOptOutAndExplicitToolIoChoice() {
        var options = new CodeArtsDashboardPanel.SessionExportOptions(false, true, false, false);
        List<String> args = new ArrayList<>();
        options.appendCliArgs(args);

        assertEquals(List.of("--no-content", "--include-tool-io", "--no-redact-paths", "--no-errors"), args);
    }
}
