package com.codearts.bar.settings;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class SettingsValuesTest {
    @Test void parsesValidSettings() {
        SettingsValues values = SettingsValues.parse("200000", "24", "60", "30");
        assertEquals(200000, values.dailyLimit());
        assertEquals(24, values.windowHours());
        assertEquals(60, values.refreshSeconds());
        assertEquals(30, values.timeoutSeconds());
    }

    @Test void rejectsInvalidNumbersInsteadOfSilentlyKeepingOldValues() {
        assertThrows(IllegalArgumentException.class, () -> SettingsValues.parse("abc", "24", "60", "30"));
        assertThrows(IllegalArgumentException.class, () -> SettingsValues.parse("200000", "0", "60", "30"));
        assertThrows(IllegalArgumentException.class, () -> SettingsValues.parse("200000", "169", "60", "30"));
        assertThrows(IllegalArgumentException.class, () -> SettingsValues.parse("200000", "24", "9", "30"));
        assertThrows(IllegalArgumentException.class, () -> SettingsValues.parse("200000", "24", "60", "4"));
    }
}
