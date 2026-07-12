"use strict";

function finite(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function usage(value = {}) {
  return {
    total: finite(value.total) || 0,
    input: finite(value.input) || 0,
    output: finite(value.output) || 0,
    reasoning: finite(value.reasoning) || 0,
    cacheRead: finite(value.cacheRead) || 0,
    cacheWrite: finite(value.cacheWrite) || 0,
    messages: finite(value.messages) || 0,
    errors: finite(value.errors) || 0,
    cacheHitRate: finite(value.cacheHitRate),
  };
}

function trend(items, limit) {
  return (items || []).slice(-limit).map((item) => ({
    start: finite(item.start),
    total: finite(item.total) || 0,
    input: finite(item.input) || 0,
    output: finite(item.output) || 0,
    cacheRead: finite(item.cacheRead) || 0,
  }));
}

function viewModel(snapshot) {
  if (!snapshot?.ok)
    return {
      ok: false,
      error:
        snapshot?.error ||
        "\u6682\u65f6\u65e0\u6cd5\u8bfb\u53d6\u672c\u5730\u4f7f\u7528\u6570\u636e\u3002",
      timestamp: Date.now(),
    };
  const performance = snapshot.performance?.window || {};
  const queue = snapshot.queue?.window || {};
  return {
    ok: true,
    timestamp: finite(snapshot.timestamp) || Date.now(),
    updatedAt: snapshot.updatedAt || "",
    adapter: snapshot.adapter || "",
    capabilities: {
      performance: snapshot.capabilities?.performance !== false,
      queue: snapshot.capabilities?.queue !== false,
    },
    status: snapshot.status || { level: "normal", label: "0%" },
    usage: {
      today: usage(snapshot.usage?.today),
      window: usage(snapshot.usage?.window),
      week: usage(snapshot.usage?.week),
      all: usage(snapshot.usage?.all),
      range: usage(snapshot.usage?.range),
    },
    config: { windowHours: finite(snapshot.config?.windowHours) || 24 },
    trends: {
      hourly24h: trend(snapshot.trends?.hourly24h, 48),
      daily14d: trend(snapshot.trends?.daily14d, 31),
      range: trend(snapshot.trends?.range, 400),
    },
    selectedRange: snapshot.selectedRange || null,
    selectedScope: snapshot.selectedScope || { source: "all", model: "all" },
    sourceErrors: (snapshot.sourceErrors || []).slice(0, 8).map((item) => ({ source: item.source || "", message: item.message || "\u6570\u636e\u6e90\u8bfb\u53d6\u5931\u8d25" })),
    models: (snapshot.models || []).slice(0, 8).map((item) => ({
      name: item.model || item.name || "\u672a\u77e5\u6a21\u578b",
      provider: item.provider || "",
      total: finite(item.total) || 0,
      messages: finite(item.messages) || 0,
      errors: finite(item.errors) || 0,
    })),
    sources: (snapshot.sourceStats || snapshot.sources || [])
      .slice(0, 8)
      .map((item) => ({
        id: item.source || item.id || item.key || "unknown",
        label:
          item.sourceLabel ||
          item.label ||
          item.key ||
          item.source ||
          item.id ||
          "\u672a\u77e5\u6570\u636e\u6e90",
        total: finite(item.total) || 0,
        messages: finite(item.messages ?? item.requests) || 0,
      })),
    sessions: (snapshot.sessions || [])
      .filter((item) => !item.archived)
      .slice(0, 8)
      .map((item) => ({
        id: item.id || "",
        title: item.title || "\u672a\u547d\u540d\u4f1a\u8bdd",
        directory: item.directory || "",
        sourceLabel: item.sourceLabel || item.source || "",
        age: finite(item.age),
        total: finite(item.usage?.total) || 0,
        model: item.usage?.topModel?.model || "",
      })),
    requests: (snapshot.requests || []).slice(0, 40).map((item) => ({
      id: item.id || "", time: finite(item.time), sessionTitle: item.sessionTitle || "\u672a\u547d\u540d\u4f1a\u8bdd",
      source: item.source || "", sourceLabel: item.sourceLabel || item.source || "", provider: item.provider || "", model: item.model || "",
      status: item.status ?? "", ok: item.ok !== false, total: finite(item.total) || 0, input: finite(item.input) || 0,
      output: finite(item.output) || 0, cacheRead: finite(item.cacheRead) || 0, cacheWrite: finite(item.cacheWrite) || 0, latencyMs: finite(item.latencyMs),
    })),
    performance: {
      latencyAvg: finite(performance.latency?.avg),
      latencyP95: finite(performance.latency?.p95),
      firstContentAvg: finite(performance.firstContentApprox?.avg),
      outputSpeed: finite(performance.outputTokensPerSec?.avg),
      errorRate: finite(performance.errorRate) || 0,
      queueAvg: finite(queue.avg),
      queueP95: finite(queue.p95),
    },
    dbSize: finite(snapshot.dbSize) || 0,
    stale: Boolean(snapshot.freshness?.stale),
  };
}

module.exports = { finite, usage, viewModel };
