package com.codearts.bar.settings;

record SettingsValues(long dailyLimit, int windowHours, int refreshSeconds, int timeoutSeconds) {
    static SettingsValues parse(String dailyLimit, String windowHours, String refreshSeconds, String timeoutSeconds) {
        long limit = positiveLong(dailyLimit, "每日 Token 显示上限");
        int window = boundedInt(windowHours, "滚动窗口", 1, 168);
        int refresh = minimumInt(refreshSeconds, "自动刷新", 10);
        int timeout = minimumInt(timeoutSeconds, "CLI 超时", 5);
        return new SettingsValues(limit, window, refresh, timeout);
    }

    private static long positiveLong(String value, String label) {
        try {
            long parsed = Long.parseLong(value.trim());
            if (parsed < 1) throw new NumberFormatException();
            return parsed;
        } catch (Exception ignored) {
            throw new IllegalArgumentException(label + "必须是大于 0 的整数");
        }
    }

    private static int boundedInt(String value, String label, int minimum, int maximum) {
        int parsed = integer(value, label);
        if (parsed < minimum || parsed > maximum) {
            throw new IllegalArgumentException(label + "必须在 " + minimum + " 到 " + maximum + " 之间");
        }
        return parsed;
    }

    private static int minimumInt(String value, String label, int minimum) {
        int parsed = integer(value, label);
        if (parsed < minimum) throw new IllegalArgumentException(label + "不能小于 " + minimum);
        return parsed;
    }

    private static int integer(String value, String label) {
        try { return Integer.parseInt(value.trim()); }
        catch (Exception ignored) { throw new IllegalArgumentException(label + "必须是整数"); }
    }
}
