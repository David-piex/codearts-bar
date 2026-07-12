package com.codearts.bar.actions;

import org.junit.jupiter.api.Test;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;

class DataFolderResolverTest {
    @Test void prefersDatabaseUsedByCurrentSnapshot() {
        Path database = DataFolderResolver.resolveDatabase("C:/actual/cli-data/opencode.db", "C:/configured/opencode.db", "C:/home");
        assertEquals(Path.of("C:/actual/cli-data/opencode.db").toAbsolutePath().normalize(), database);
    }

    @Test void fallsBackToConfiguredDatabaseWithoutSuccessfulSnapshot() {
        Path database = DataFolderResolver.resolveDatabase("", "C:/configured/opencode.db", "C:/home");
        assertEquals(Path.of("C:/configured/opencode.db").toAbsolutePath().normalize(), database);
    }

    @Test void usesDesktopDefaultWhenNoDatabaseIsKnown() {
        Path database = DataFolderResolver.resolveDatabase("", "", "C:/home");
        assertEquals(Path.of("C:/home/.codeartsdoer/codearts-data/opencode.db").toAbsolutePath().normalize(), database);
    }

    @Test void trimsPersistedPaths() {
        Path database = DataFolderResolver.resolveDatabase("  C:/actual/opencode.db  ", "", "C:/home");
        assertEquals(Path.of("C:/actual/opencode.db").toAbsolutePath().normalize(), database);
    }
}
