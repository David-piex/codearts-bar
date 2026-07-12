package com.codearts.bar.model;

import org.junit.jupiter.api.Test;

import java.time.LocalDateTime;
import java.time.ZoneId;

import static org.junit.jupiter.api.Assertions.*;

class AnalyticsRangeTest {
    private static final ZoneId SHANGHAI = ZoneId.of("Asia/Shanghai");
    private static final long NOW = LocalDateTime.of(2026, 7, 12, 15, 30)
            .atZone(SHANGHAI).toInstant().toEpochMilli();

    @Test void todayStartsAtLocalMidnight() {
        long expected = LocalDateTime.of(2026, 7, 12, 0, 0)
                .atZone(SHANGHAI).toInstant().toEpochMilli();
        assertEquals(expected, AnalyticsRange.TODAY.startAt(NOW, SHANGHAI));
        assertTrue(AnalyticsRange.TODAY.hourly());
    }

    @Test void rollingRangesUseExactDurations() {
        assertEquals(24L * 60 * 60 * 1000, NOW - AnalyticsRange.LAST_24_HOURS.startAt(NOW, SHANGHAI));
        assertEquals(7L * 24 * 60 * 60 * 1000, NOW - AnalyticsRange.LAST_7_DAYS.startAt(NOW, SHANGHAI));
        assertEquals(30L * 24 * 60 * 60 * 1000, NOW - AnalyticsRange.LAST_30_DAYS.startAt(NOW, SHANGHAI));
        assertFalse(AnalyticsRange.LAST_7_DAYS.hourly());
    }

    @Test void restoresPersistedIdsAndFallsBackForOldOrInvalidState() {
        assertEquals(AnalyticsRange.LAST_14_DAYS, AnalyticsRange.fromId("14d"));
        assertEquals(AnalyticsRange.CUSTOM, AnalyticsRange.fromId("custom"));
        assertEquals(AnalyticsRange.TODAY, AnalyticsRange.fromId(null));
        assertEquals(AnalyticsRange.TODAY, AnalyticsRange.fromId("unknown"));
    }

    @Test void exposesStableLabelsAndBuckets() {
        assertEquals("最近 7 天", AnalyticsRange.LAST_7_DAYS.toString());
        assertEquals(3_600_000L, AnalyticsRange.LAST_24_HOURS.bucketMs());
        assertEquals(86_400_000L, AnalyticsRange.ALL_TIME.bucketMs());
        assertEquals(1L, AnalyticsRange.ALL_TIME.startAt(NOW, SHANGHAI));
    }

    @Test void resolvesCustomBoundsAndChoosesReadableBuckets() {
        long start = NOW - 36L * 60 * 60 * 1000;
        AnalyticsRange.Window shortWindow = AnalyticsRange.CUSTOM.resolve(NOW, SHANGHAI, start, NOW);
        assertEquals(start, shortWindow.start());
        assertEquals(NOW, shortWindow.end());
        assertEquals(3_600_000L, shortWindow.bucketMs());
        assertTrue(shortWindow.hourly());
        assertTrue(shortWindow.label().contains("–"));

        AnalyticsRange.Window longWindow = AnalyticsRange.CUSTOM.resolve(NOW, SHANGHAI, NOW - 7L * 86_400_000L, NOW);
        assertEquals(86_400_000L, longWindow.bucketMs());
        assertFalse(longWindow.hourly());
    }

    @Test void invalidCustomBoundsFallBackToToday() {
        AnalyticsRange.Window window = AnalyticsRange.CUSTOM.resolve(NOW, SHANGHAI, NOW, NOW - 1);
        assertEquals(AnalyticsRange.TODAY.startAt(NOW, SHANGHAI), window.start());
        assertEquals("今天", window.label());
    }

    @Test void normalizesPersistedCustomBounds() {
        AnalyticsRange.Bounds future = AnalyticsRange.normalizeCustomBounds(NOW, NOW + 86_400_000L, NOW + 172_800_000L);
        assertEquals(NOW - 7L * 86_400_000L, future.start());
        assertEquals(NOW, future.end());

        AnalyticsRange.Bounds reversed = AnalyticsRange.normalizeCustomBounds(NOW, NOW, NOW - 1);
        assertEquals(NOW - 7L * 86_400_000L, reversed.start());
        assertEquals(NOW, reversed.end());

        AnalyticsRange.Bounds tooLong = AnalyticsRange.normalizeCustomBounds(NOW, NOW - 500L * 86_400_000L, NOW);
        assertEquals(366L * 86_400_000L, tooLong.end() - tooLong.start());
    }

    @Test void detectsOffsetTransitionsAnywhereInsideTheRange() {
        ZoneId berlin = ZoneId.of("Europe/Berlin");
        long beforeSpring = LocalDateTime.of(2026, 3, 28, 0, 0).atZone(berlin).toInstant().toEpochMilli();
        long afterSpring = LocalDateTime.of(2026, 3, 30, 0, 0).atZone(berlin).toInstant().toEpochMilli();
        assertTrue(AnalyticsRange.crossesOffsetTransition(beforeSpring, afterSpring, berlin));
        assertEquals(3_600_000L, AnalyticsRange.transitionSafeBucketMs(beforeSpring, afterSpring, berlin));
        assertFalse(AnalyticsRange.crossesOffsetTransition(NOW - 7L * 86_400_000L, NOW, SHANGHAI));
        assertEquals(86_400_000L, AnalyticsRange.transitionSafeBucketMs(NOW - 7L * 86_400_000L, NOW, SHANGHAI));

        long yearStart = LocalDateTime.of(2026, 1, 1, 0, 0).atZone(berlin).toInstant().toEpochMilli();
        long yearEnd = LocalDateTime.of(2027, 1, 1, 0, 0).atZone(berlin).toInstant().toEpochMilli();
        assertTrue(AnalyticsRange.crossesOffsetTransition(yearStart, yearEnd, berlin));

        ZoneId lordHowe = ZoneId.of("Australia/Lord_Howe");
        long lordHoweStart = LocalDateTime.of(2026, 4, 1, 0, 0).atZone(lordHowe).toInstant().toEpochMilli();
        long lordHoweEnd = LocalDateTime.of(2026, 4, 8, 0, 0).atZone(lordHowe).toInstant().toEpochMilli();
        assertEquals(1_800_000L, AnalyticsRange.transitionSafeBucketMs(lordHoweStart, lordHoweEnd, lordHowe));
    }
}
