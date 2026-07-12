package com.codearts.bar.model;

import java.nio.file.InvalidPathException;
import java.nio.file.Path;

public final class DataSourceIdentity {
    private DataSourceIdentity() { }

    public static String of(String databasePath) {
        if (databasePath == null || databasePath.isBlank()) return "";
        try {
            return Path.of(databasePath.trim()).toAbsolutePath().normalize().toString().toLowerCase(java.util.Locale.ROOT);
        } catch (InvalidPathException ignored) {
            return databasePath.trim().toLowerCase(java.util.Locale.ROOT);
        }
    }

    public static boolean changed(String displayedIdentity, String nextPath) {
        String next = of(nextPath);
        return displayedIdentity != null && !displayedIdentity.isBlank() && !next.isBlank()
                && !displayedIdentity.equals(next);
    }
}
