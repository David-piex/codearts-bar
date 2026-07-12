package com.codearts.bar.cli;

import com.codearts.bar.model.UsageSnapshot;
import com.google.gson.JsonParser;
import org.junit.jupiter.api.Test;
import java.time.LocalDateTime;
import java.time.ZoneId;
import static org.junit.jupiter.api.Assertions.*;

class UsageSnapshotTest {
    @Test void parsesProtocolV1DashboardPayload() {
        String json = """
          {"protocolVersion":1,"ok":true,"generatedAt":12,"data":{"updatedAt":"now","dbPath":"db","adapter":"node:sqlite",
          "status":{"usagePercent":41.3,"level":"ok","label":"41%"},"usage":{"today":{"total":82600,"input":50000,"output":32000,"messages":52,"cacheHitRate":12.5},"window":{"total":143200},"week":{"total":200000},"all":{"total":300000}},
          "trends":{"hourly24h":[{"start":1,"total":5}],"daily14d":[]},"models":[{"name":"provider / model","provider":"provider","model":"model","total":100,"messages":2}],
          "sources":[{"key":"local","total":100,"requests":2}],"sessions":[{"id":"s1","title":"Session","usage":{"total":100,"modelCalls":2,"topModel":{"model":"model"}}}],
          "requests":[{"id":"r1","ok":true,"total":100,"status":200}],"health":{"level":"ok","label":"OK","message":"healthy"},"quota":{"primary":{"used":82600,"limit":200000,"percent":41.3}}}}
          """;
        UsageSnapshot snapshot=UsageSnapshot.fromJson(JsonParser.parseString(json).getAsJsonObject());
        assertTrue(snapshot.ok()); assertEquals(1,snapshot.protocolVersion()); assertEquals(82600,snapshot.todayTokens()); assertEquals(52,snapshot.requestCount());
        assertEquals(1,snapshot.hourlyTrend().size()); assertEquals("model",snapshot.sessions().getFirst().model()); assertEquals(1,snapshot.requests().size()); assertEquals("OK",snapshot.health().label());
        assertEquals("", snapshot.sessions().getFirst().source());
    }

    @Test void keepsMachineSourceIdForPagedSessionQueries() {
        String json = """
          {"items":[{"id":"s1","title":"Session","source":"custom","sourceLabel":"自定义","usage":{"total":10}}]}
          """;
        var rows = UsageSnapshot.sessionItems(JsonParser.parseString(json).getAsJsonObject());
        assertEquals(1, rows.size());
        assertEquals("custom", rows.getFirst().source());
    }

    @Test void parsesRangeFilteredAnalyticsPayload() {
        String json = """
          {"usage":{"total":220,"input":130,"cacheHitRate":7.8},
          "trend":[{"start":1,"total":220,"input":130}],
          "models":[{"name":"provider / model","total":220}],
          "sources":[{"label":"自定义","total":220,"requests":3}]}
          """;
        var analytics = UsageSnapshot.analytics(JsonParser.parseString(json).getAsJsonObject());
        assertEquals(220, analytics.usage().total());
        assertEquals(1, analytics.trend().size());
        assertEquals(1, analytics.models().size());
        assertEquals("自定义", analytics.sources().getFirst().label());
    }

    @Test void rebucketsHourlyTrendByRealLocalDaysAcrossDst() {
        ZoneId berlin = ZoneId.of("Europe/Berlin");
        long start = LocalDateTime.of(2026, 3, 28, 0, 0).atZone(berlin).toInstant().toEpochMilli();
        long end = LocalDateTime.of(2026, 3, 30, 0, 0).atZone(berlin).toInstant().toEpochMilli();
        long march28Late = LocalDateTime.of(2026, 3, 28, 23, 0).atZone(berlin).toInstant().toEpochMilli();
        long march29Late = LocalDateTime.of(2026, 3, 29, 23, 0).atZone(berlin).toInstant().toEpochMilli();
        var data = new UsageSnapshot.AnalyticsData(
                new UsageSnapshot.UsageWindow(30, 18, 12, 0, 3, 0, 2, 0, 10.0),
                java.util.List.of(
                        new UsageSnapshot.TrendPoint(march28Late, "", 10, 6, 4, 1),
                        new UsageSnapshot.TrendPoint(march29Late, "", 20, 12, 8, 2)),
                java.util.List.of(), java.util.List.of());

        var rebucketed = UsageSnapshot.withLocalDailyTrend(data, start, end, berlin);
        assertEquals(3, rebucketed.trend().size());
        assertEquals(10, rebucketed.trend().get(0).total());
        assertEquals(20, rebucketed.trend().get(1).total());
        assertEquals(0, rebucketed.trend().get(2).total());
        assertEquals(30, rebucketed.trend().stream().mapToLong(UsageSnapshot.TrendPoint::total).sum());
        assertEquals(start, rebucketed.trend().getFirst().start());
        assertEquals(end, rebucketed.trend().getLast().start());
    }

    @Test void keepsAllTimeLocalTrendSparseAndBounded() {
        ZoneId berlin = ZoneId.of("Europe/Berlin");
        long start = 1L;
        long end = LocalDateTime.of(2026, 7, 12, 12, 0).atZone(berlin).toInstant().toEpochMilli();
        long firstUse = LocalDateTime.of(2025, 1, 2, 9, 0).atZone(berlin).toInstant().toEpochMilli();
        long secondUse = LocalDateTime.of(2026, 7, 11, 18, 0).atZone(berlin).toInstant().toEpochMilli();
        var data = new UsageSnapshot.AnalyticsData(
                new UsageSnapshot.UsageWindow(42, 25, 17, 0, 4, 0, 2, 0, 10.0),
                java.util.List.of(
                        new UsageSnapshot.TrendPoint(firstUse, "", 12, 7, 5, 1),
                        new UsageSnapshot.TrendPoint(secondUse, "", 30, 18, 12, 3)),
                java.util.List.of(), java.util.List.of());

        var rebucketed = UsageSnapshot.withLocalDailyTrend(data, start, end, berlin);
        assertEquals(2, rebucketed.trend().size());
        assertEquals(42, rebucketed.trend().stream().mapToLong(UsageSnapshot.TrendPoint::total).sum());
        assertEquals(LocalDateTime.of(2025, 1, 2, 0, 0).atZone(berlin).toInstant().toEpochMilli(),
                rebucketed.trend().getFirst().start());
    }
}
