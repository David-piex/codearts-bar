package com.codearts.bar.toolwindow;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class SessionExportFileNameTest {
    @Test void protectsWindowsReservedNames() {
        assertEquals("_CON.json", CodeArtsDashboardPanel.safeExportFileName("CON", "json"));
        assertEquals("_com1.xlsx", CodeArtsDashboardPanel.safeExportFileName("com1", "xlsx"));
    }

    @Test void truncatesByCodePointWithoutSplittingEmoji() {
        String fileName = CodeArtsDashboardPanel.safeExportFileName("😀".repeat(120), "md");
        String stem = fileName.substring(0, fileName.length() - 3);
        assertEquals(100, stem.codePointCount(0, stem.length()));
        assertTrue(stem.endsWith("😀"));
    }
}
