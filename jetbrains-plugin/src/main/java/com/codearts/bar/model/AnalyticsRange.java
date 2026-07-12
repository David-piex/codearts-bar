package com.codearts.bar.model;

import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.zone.ZoneOffsetTransition;
import java.time.format.DateTimeFormatter;
import java.util.Arrays;

public enum AnalyticsRange {
    TODAY("today", "今天", true),
    LAST_24_HOURS("24h", "最近 24 小时", true),
    LAST_7_DAYS("7d", "最近 7 天", false),
    LAST_14_DAYS("14d", "最近 14 天", false),
    LAST_30_DAYS("30d", "最近 30 天", false),
    ALL_TIME("all", "全部时间", false),
    CUSTOM("custom", "自定义…", false);

    private static final long DAY_MS = 86_400_000L;
    private static final DateTimeFormatter CUSTOM_TIME = DateTimeFormatter.ofPattern("M月d日 HH:mm");

    private final String id;
    private final String label;
    private final boolean hourly;

    AnalyticsRange(String id, String label, boolean hourly) {
        this.id = id;
        this.label = label;
        this.hourly = hourly;
    }

    public String id() { return id; }
    public String label() { return label; }
    public boolean hourly() { return hourly; }
    public boolean custom() { return this == CUSTOM; }
    public long bucketMs() { return hourly ? 3_600_000L : DAY_MS; }

    public long startAt(long now, ZoneId zone) {
        return switch (this) {
            case TODAY -> LocalDate.ofInstant(Instant.ofEpochMilli(now), zone)
                    .atStartOfDay(zone).toInstant().toEpochMilli();
            case LAST_24_HOURS -> now - DAY_MS;
            case LAST_7_DAYS -> now - 7L * DAY_MS;
            case LAST_14_DAYS -> now - 14L * DAY_MS;
            case LAST_30_DAYS -> now - 30L * DAY_MS;
            case ALL_TIME -> 1L;
            case CUSTOM -> throw new IllegalStateException("Custom analytics ranges require explicit bounds");
        };
    }

    public Window resolve(long now, ZoneId zone, long customStart, long customEnd) {
        if (!custom()) return new Window(startAt(now, zone), now, bucketMs(), label, hourly);
        if (customStart <= 0 || customEnd <= customStart) return TODAY.resolve(now, zone, 0, 0);
        long duration = customEnd - customStart;
        boolean useHourlyBuckets = duration <= 2L * DAY_MS;
        String startLabel = CUSTOM_TIME.format(Instant.ofEpochMilli(customStart).atZone(zone));
        String endLabel = CUSTOM_TIME.format(Instant.ofEpochMilli(customEnd).atZone(zone));
        return new Window(customStart, customEnd, useHourlyBuckets ? 3_600_000L : DAY_MS,
                startLabel + " – " + endLabel, useHourlyBuckets);
    }

    public static Bounds normalizeCustomBounds(long now, long customStart, long customEnd) {
        long end = Math.min(customEnd, now);
        long start = customStart;
        if (start <= 0 || end <= start) {
            start = now - 7L * DAY_MS;
            end = now;
        }
        long maxSpan = 366L * DAY_MS;
        if (end - start > maxSpan) start = end - maxSpan;
        return new Bounds(start, end);
    }

    public static boolean crossesOffsetTransition(long start, long end, ZoneId zone) {
        return transitionSafeBucketMs(start, end, zone) < 86_400_000L;
    }

    public static long transitionSafeBucketMs(long start, long end, ZoneId zone) {
        if (end <= start) return DAY_MS;
        Instant limit = Instant.ofEpochMilli(end);
        ZoneOffsetTransition transition = zone.getRules().nextTransition(Instant.ofEpochMilli(start).minusMillis(1));
        long bucketMs = DAY_MS;
        while (transition != null && !transition.getInstant().isAfter(limit)) {
            long deltaMs = Math.abs((long) transition.getOffsetAfter().getTotalSeconds()
                    - transition.getOffsetBefore().getTotalSeconds()) * 1_000L;
            bucketMs = greatestCommonDivisor(bucketMs, deltaMs);
            transition = zone.getRules().nextTransition(transition.getInstant());
        }
        return bucketMs;
    }

    private static long greatestCommonDivisor(long left, long right) {
        while (right != 0) {
            long remainder = left % right;
            left = right;
            right = remainder;
        }
        return Math.max(60_000L, Math.abs(left));
    }

    public static AnalyticsRange fromId(String id) {
        if (id == null || id.isBlank()) return TODAY;
        return Arrays.stream(values()).filter(range -> range.id.equals(id)).findFirst().orElse(TODAY);
    }

    public record Window(long start, long end, long bucketMs, String label, boolean hourly) {}
    public record Bounds(long start, long end) {}

    @Override public String toString() { return label; }
}
