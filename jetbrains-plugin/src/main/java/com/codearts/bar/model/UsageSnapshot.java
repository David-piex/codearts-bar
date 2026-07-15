package com.codearts.bar.model;

import com.google.gson.*;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.*;

public record UsageSnapshot(
        boolean ok, String error, int protocolVersion, long timestamp, String updatedAt, String dbPath, long dbSize, String adapter,
        double usagePercent, String statusLevel, String statusLabel,
        UsageWindow today, UsageWindow window, UsageWindow week, UsageWindow all,
        List<TrendPoint> hourlyTrend, List<TrendPoint> dailyTrend,
        List<ModelUsage> models, List<SourceInfo> sources, List<SessionInfo> sessions, List<RequestInfo> requests,
        Performance performance, QueueStats queue, Health health, Quota quota,
        long sessionTotal, long sessionActive
) {
    private static final int MAX_DENSE_TREND_BUCKETS = 400;
    public record UsageWindow(long total, long input, long output, long reasoning, long cacheRead, long cacheWrite, long messages, long errors, Double cacheHitRate) {}
    public record TrendPoint(long start, String label, long total, long input, long output, long cacheRead) {}
    public record ModelUsage(String name, String provider, String model, long total, long input, long output, long reasoning, long cacheRead, long requests, long errors, Double cacheHitRate, Double latencyAvg, Double latencyP95) {}
    public record SourceInfo(String label, String adapter, String dbPath, long total, long requests, long errors, Double latencyAvg, Double latencyP95) {}
    public record ProviderUsage(String name, long total, long requests, long errors) {}
    public record ProjectInfo(String id, String directory, long count) {
        @Override public String toString() {
            if (directory == null || directory.isBlank()) return "未关联项目";
            try { return java.nio.file.Path.of(directory).getFileName().toString(); }
            catch (RuntimeException ignored) { return directory; }
        }
    }
    public record SessionInfo(String id, String title, String directory, String source, long updatedAt, long ageMs, long total, long input, long output, long requests, String model, long errors, Double cacheHitRate) {}
    public record RequestInfo(String id, String sessionTitle, String source, String provider, String model, long time, Integer status, boolean success, String error, long total, long input, long output, long reasoning, long cacheRead, long cacheWrite, long latencyMs, Double ttftMs, Double firstContentMs, Double outputTokensPerSec) {
        public String displayStatus() {
            return success ? "成功" : status == null || status <= 0 ? "错误" : "错误 " + status;
        }
    }
    public record MetricCompleteness(boolean latency, boolean firstContentApprox, boolean outputTokensPerSec, boolean ttft) {}
    public record AnalyticsData(UsageWindow usage, List<TrendPoint> trend, List<ModelUsage> models,
                                List<ProviderUsage> providers, List<SourceInfo> sources, List<ProjectInfo> projects,
                                Performance performance, boolean complete, boolean sampled, MetricCompleteness metrics) {}
    public record Performance(long samples, long errors, Double errorRate, Double latencyAvg, Double latencyP95, Double ttftAvg, Double ttftP95, Double firstContentAvg, Double outputTokensPerSec) {}
    public record QueueStats(long samples, Double avgMs, Double p95Ms, Double maxMs) {}
    public record Health(String level, String label, String message, List<String> issues) {}
    public record Quota(long used, Long limit, Long remaining, Double percent, long resetAt, String label, String note) {}

    public long todayTokens() { return today.total(); }
    public long windowTokens() { return window.total(); }
    public long inputTokens() { return today.input(); }
    public long outputTokens() { return today.output(); }
    public long requestCount() { return today.messages(); }
    public Double cacheHitRate() { return today.cacheHitRate(); }

    public static UsageSnapshot empty(String message) {
        UsageWindow zero = usage(new JsonObject());
        return new UsageSnapshot(false, message, 1, 0, "", "", 0, "", 0, "unknown", "--", zero, zero, zero, zero,
                List.of(), List.of(), List.of(), List.of(), List.of(), List.of(), new Performance(0,0,null,null,null,null,null,null,null),
                new QueueStats(0,null,null,null), new Health("unknown","Unknown",message,List.of()), new Quota(0,null,null,null,0,"", ""),0,0);
    }

    public static UsageSnapshot fromJson(JsonObject envelope) {
        boolean envelopeMode = envelope.has("protocolVersion");
        int protocol = (int) number(envelope, "protocolVersion");
        if (!bool(envelope, "ok", true)) return empty(string(envelope, "error"));
        JsonObject root = envelopeMode ? object(envelope, "data") : envelope;
        JsonObject usage = object(root, "usage");
        JsonObject status = object(root, "status");
        JsonObject trends = object(root, "trends");
        JsonObject perf = object(object(root, "performance"), "window");
        JsonObject queue = object(object(root, "queue"), "window");
        JsonObject health = object(root, "health");
        JsonObject primaryQuota = object(object(root, "quota"), "primary");
        JsonObject sessionSummary = object(root, "sessionSummary");
        List<String> issues = new ArrayList<>();
        for (JsonElement e : array(health, "issues")) issues.add(e.isJsonObject() ? string(e.getAsJsonObject(), "message") : e.getAsString());
        return new UsageSnapshot(true, "", protocol == 0 ? 1 : protocol,
                envelopeMode ? number(envelope, "generatedAt") : number(root, "timestamp"), string(root,"updatedAt"), string(root,"dbPath"), number(root,"dbSize"), string(root,"adapter"),
                decimal(status,"usagePercent"), string(status,"level"), string(status,"label"),
                usage(object(usage,"today")), usage(object(usage,"window")), usage(object(usage,"week")), usage(object(usage,"all")),
                trend(array(trends,"hourly24h")), trend(array(trends,"daily14d")), models(array(root,"models")), sources(array(root,"sources")),
                sessions(array(root,"sessions")), requests(array(root,"requests")), performance(perf), queue(queue),
                new Health(string(health,"level"), string(health,"label"), string(health,"message"), List.copyOf(issues)),
                new Quota(number(primaryQuota,"used"), longOrNull(primaryQuota,"limit"), longOrNull(primaryQuota,"remaining"), decimalOrNull(primaryQuota,"percent"), number(primaryQuota,"resetAt"), string(primaryQuota,"label"), string(object(root,"quota"),"note")),
                number(sessionSummary,"total"), number(sessionSummary,"active"));
    }

    private static UsageWindow usage(JsonObject x) { return new UsageWindow(number(x,"total"),number(x,"input"),number(x,"output"),number(x,"reasoning"),number(x,"cacheRead"),number(x,"cacheWrite"),number(x,"messages"),number(x,"errors"),decimalOrNull(x,"cacheHitRate")); }
    private static List<TrendPoint> trend(JsonArray a) { List<TrendPoint> out=new ArrayList<>(); for(JsonElement e:a){if(!e.isJsonObject())continue;JsonObject x=e.getAsJsonObject();out.add(new TrendPoint(number(x,"start"),string(x,"label"),number(x,"total"),number(x,"input"),number(x,"output"),number(x,"cacheRead")));}return List.copyOf(out); }
    private static List<ModelUsage> models(JsonArray a) { List<ModelUsage> out=new ArrayList<>(); for(JsonElement e:a){if(!e.isJsonObject())continue;JsonObject x=e.getAsJsonObject(),p=object(x,"performance"),lat=object(p,"latency");out.add(new ModelUsage(string(x,"name"),string(x,"provider"),string(x,"model"),number(x,"total"),number(x,"input"),number(x,"output"),number(x,"reasoning"),number(x,"cacheRead"),number(x,"messages"),number(x,"errors"),decimalOrNull(x,"cacheHitRate"),decimalOrNull(lat,"avg"),decimalOrNull(lat,"p95")));}return List.copyOf(out); }
    private static List<SourceInfo> sources(JsonArray a) { List<SourceInfo> out=new ArrayList<>(); for(JsonElement e:a){if(!e.isJsonObject())continue;JsonObject x=e.getAsJsonObject(),lat=object(x,"latency");String label=first(string(x,"sourceLabel"),string(x,"label"),string(x,"key"),string(x,"source"),string(x,"id"));out.add(new SourceInfo(label,string(x,"adapter"),string(x,"dbPath"),number(x,"total"),numberEither(x,"messages","requests"),number(x,"errors"),decimalOrNull(lat,"avg"),decimalOrNull(lat,"p95")));}return List.copyOf(out); }
    public static List<SessionInfo> sessionItems(JsonObject data) { return sessions(array(data, "items")); }
    public static List<RequestInfo> requestItems(JsonObject data) { return requests(array(data, "items")); }
    public static AnalyticsData analytics(JsonObject data) {
        JsonObject completeness = object(data, "completeness");
        return new AnalyticsData(usage(object(data,"usage")),trend(array(data,"trend")),models(array(data,"models")),
                providers(array(data,"providers")),sources(array(data,"sources")),projects(array(data,"projects")),
                performance(object(data,"performance")),bool(completeness,"complete",true),bool(completeness,"sampled",false),
                metricCompleteness(object(completeness,"metrics")));
    }
    public static List<ModelUsage> filterModels(JsonObject data) { return models(array(data, "models")); }
    public static List<ProjectInfo> filterProjects(JsonObject data) { return projects(array(data, "projects")); }
    public static AnalyticsData withLocalDailyTrend(AnalyticsData data, long start, long end, ZoneId zone) {
        if (data == null || end < start) return data;
        Map<LocalDate, long[]> totals = new TreeMap<>();
        for (TrendPoint point : data.trend()) {
            LocalDate day = Instant.ofEpochMilli(point.start()).atZone(zone).toLocalDate();
            long[] values = totals.computeIfAbsent(day, ignored -> new long[4]);
            values[0] += point.total();
            values[1] += point.input();
            values[2] += point.output();
            values[3] += point.cacheRead();
        }
        LocalDate first = Instant.ofEpochMilli(start).atZone(zone).toLocalDate();
        // The analytics range is [start, end); an exact local midnight belongs
        // to the next day and must not create an extra empty bucket.
        LocalDate last = Instant.ofEpochMilli(Math.max(start, end - 1)).atZone(zone).toLocalDate();
        List<TrendPoint> daily = new ArrayList<>();
        long dayCount = last.toEpochDay() - first.toEpochDay() + 1;
        if (dayCount > MAX_DENSE_TREND_BUCKETS) {
            for (Map.Entry<LocalDate, long[]> entry : totals.entrySet()) {
                long[] values = entry.getValue();
                daily.add(new TrendPoint(entry.getKey().atStartOfDay(zone).toInstant().toEpochMilli(), "",
                        values[0], values[1], values[2], values[3]));
            }
            return new AnalyticsData(data.usage(), List.copyOf(daily), data.models(), data.providers(), data.sources(), data.projects(), data.performance(), data.complete(), data.sampled(), data.metrics());
        }
        for (LocalDate day = first; !day.isAfter(last); day = day.plusDays(1)) {
            long[] values = totals.getOrDefault(day, new long[4]);
            daily.add(new TrendPoint(day.atStartOfDay(zone).toInstant().toEpochMilli(), "",
                    values[0], values[1], values[2], values[3]));
        }
        return new AnalyticsData(data.usage(), List.copyOf(daily), data.models(), data.providers(), data.sources(), data.projects(), data.performance(), data.complete(), data.sampled(), data.metrics());
    }
    private static List<SessionInfo> sessions(JsonArray a) { List<SessionInfo> out=new ArrayList<>(); for(JsonElement e:a){if(!e.isJsonObject())continue;JsonObject x=e.getAsJsonObject(),u=object(x,"usage"),top=object(u,"topModel");out.add(new SessionInfo(string(x,"id"),string(x,"title"),string(x,"directory"),first(string(x,"source"),string(x,"sourceLabel")),number(x,"updatedAt"),number(x,"age"),number(u,"total"),number(u,"input"),number(u,"output"),numberEither(u,"modelCalls","messages"),string(top,"model"),number(u,"errors"),decimalOrNull(u,"cacheHitRate")));}return List.copyOf(out); }
    private static List<ProviderUsage> providers(JsonArray a) { List<ProviderUsage> out=new ArrayList<>(); for(JsonElement e:a){if(!e.isJsonObject())continue;JsonObject x=e.getAsJsonObject();out.add(new ProviderUsage(first(string(x,"name"),string(x,"provider")),number(x,"total"),numberEither(x,"messages","requests"),number(x,"errors")));}return List.copyOf(out); }
    private static List<ProjectInfo> projects(JsonArray a) { List<ProjectInfo> out=new ArrayList<>(); for(JsonElement e:a){if(!e.isJsonObject())continue;JsonObject x=e.getAsJsonObject();out.add(new ProjectInfo(first(string(x,"id"),string(x,"key"),string(x,"directory")),string(x,"directory"),number(x,"count")));}return List.copyOf(out); }
    private static List<RequestInfo> requests(JsonArray a) { List<RequestInfo> out=new ArrayList<>(); for(JsonElement e:a){if(!e.isJsonObject())continue;JsonObject x=e.getAsJsonObject();out.add(new RequestInfo(string(x,"id"),string(x,"sessionTitle"),first(string(x,"sourceLabel"),string(x,"source")),string(x,"provider"),string(x,"model"),numberEither(x,"time","createdAt"),integerOrNull(x,"status"),bool(x,"ok",true),string(x,"error"),number(x,"total"),number(x,"input"),number(x,"output"),number(x,"reasoning"),number(x,"cacheRead"),number(x,"cacheWrite"),number(x,"latencyMs"),decimalOrNull(x,"ttftMs"),decimalOrNull(x,"firstContentMs"),decimalOrNull(x,"outputTokensPerSec")));}return List.copyOf(out); }
    private static Performance performance(JsonObject x) { JsonObject latency=object(x,"latency"),ttft=object(x,"ttft"),content=object(x,"firstContentApprox"),rate=object(x,"outputTokensPerSec");return new Performance(number(x,"samples"),number(x,"errors"),decimalOrNull(x,"errorRate"),decimalOrNull(latency,"avg"),decimalOrNull(latency,"p95"),decimalOrNull(ttft,"avg"),decimalOrNull(ttft,"p95"),decimalOrNull(content,"avg"),decimalOrNull(rate,"avg")); }
    private static MetricCompleteness metricCompleteness(JsonObject x) { return new MetricCompleteness(bool(x,"latency",false),bool(x,"firstContentApprox",false),bool(x,"outputTokensPerSec",false),bool(x,"ttft",false)); }
    private static QueueStats queue(JsonObject x) { return new QueueStats(number(x,"samples"),decimalOrNull(x,"avg"),decimalOrNull(x,"p95"),decimalOrNull(x,"max")); }
    private static JsonObject object(JsonObject o,String k){JsonElement v=o==null?null:o.get(k);return v!=null&&v.isJsonObject()?v.getAsJsonObject():new JsonObject();}
    private static JsonArray array(JsonObject o,String k){JsonElement v=o==null?null:o.get(k);return v!=null&&v.isJsonArray()?v.getAsJsonArray():new JsonArray();}
    private static String string(JsonObject o,String k){JsonElement v=o==null?null:o.get(k);try{return v==null||v.isJsonNull()?"":v.getAsString();}catch(Exception e){return "";}}
    private static long number(JsonObject o,String k){JsonElement v=o==null?null:o.get(k);try{return v==null||v.isJsonNull()?0:v.getAsLong();}catch(Exception e){return 0;}}
    private static long numberEither(JsonObject o,String a,String b){return o.has(a)?number(o,a):number(o,b);}
    private static Long longOrNull(JsonObject o,String k){JsonElement v=o==null?null:o.get(k);try{return v==null||v.isJsonNull()?null:v.getAsLong();}catch(Exception e){return null;}}
    private static Integer integerOrNull(JsonObject o,String k){Long v=longOrNull(o,k);return v==null||v<Integer.MIN_VALUE||v>Integer.MAX_VALUE?null:v.intValue();}
    private static Double decimalOrNull(JsonObject o,String k){JsonElement v=o==null?null:o.get(k);try{return v==null||v.isJsonNull()?null:v.getAsDouble();}catch(Exception e){return null;}}
    private static double decimal(JsonObject o,String k){Double v=decimalOrNull(o,k);return v==null?0:v;}
    private static boolean bool(JsonObject o,String k,boolean f){JsonElement v=o==null?null:o.get(k);try{return v==null||v.isJsonNull()?f:v.getAsBoolean();}catch(Exception e){return f;}}
    private static String first(String... values){for(String v:values)if(v!=null&&!v.isBlank())return v;return "";}
}
