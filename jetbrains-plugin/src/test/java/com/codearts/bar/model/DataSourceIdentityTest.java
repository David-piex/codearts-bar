package com.codearts.bar.model;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class DataSourceIdentityTest {
    @Test void normalizesEquivalentPaths() {
        assertEquals(DataSourceIdentity.of("D:/data/agent/../agent/opencode.db"),
                DataSourceIdentity.of("d:\\data\\agent\\opencode.db"));
    }

    @Test void detectsOnlyKnownCrossSourceChanges() {
        String displayed = DataSourceIdentity.of("D:/first/opencode.db");
        assertTrue(DataSourceIdentity.changed(displayed, "D:/second/opencode.db"));
        assertFalse(DataSourceIdentity.changed(displayed, "D:/first/opencode.db"));
        assertFalse(DataSourceIdentity.changed("", "D:/first/opencode.db"));
        assertFalse(DataSourceIdentity.changed(displayed, ""));
    }

    @Test void toleratesInvalidPersistedPaths() {
        assertFalse(DataSourceIdentity.of("bad\0path").isBlank());
    }
}
