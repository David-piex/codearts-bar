package com.codearts.bar.cli;

import com.codearts.bar.model.UsageSnapshot;
import com.google.gson.JsonParser;
import org.junit.jupiter.api.Test;
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
    }
}
