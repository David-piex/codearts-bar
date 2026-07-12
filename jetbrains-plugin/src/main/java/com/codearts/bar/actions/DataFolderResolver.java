package com.codearts.bar.actions;

import java.nio.file.InvalidPathException;
import java.nio.file.Path;

final class DataFolderResolver {
    private DataFolderResolver() {}

    static Path resolveDatabase(String snapshotDbPath, String configuredDbPath, String userHome) {
        String database = firstNonBlank(snapshotDbPath, configuredDbPath);
        if (!database.isBlank()) {
            Path path = Path.of(database).toAbsolutePath().normalize();
            if (path.getParent() == null) throw new InvalidPathException(database, "数据库路径没有父目录");
            return path;
        }
        return Path.of(userHome, ".codeartsdoer", "codearts-data", "opencode.db").toAbsolutePath().normalize();
    }

    private static String firstNonBlank(String first, String second) {
        if (first != null && !first.isBlank()) return first.trim();
        if (second != null && !second.isBlank()) return second.trim();
        return "";
    }
}
