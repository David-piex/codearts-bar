'use strict';

class ScoredCache {
  constructor(maxSize = 24, options = {}) {
    this.maxSize = Math.max(1, Number(maxSize) || 24);
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    this.cache = new Map();
  }

  get size() { return this.cache.size; }

  has(key) { return this.cache.has(key); }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    entry.lastAccessMs = this.now();
    entry.accessCount += 1;
    return entry.value;
  }

  set(key, value) {
    const now = this.now();
    const existing = this.cache.get(key);
    if (existing) {
      existing.value = value;
      existing.lastAccessMs = now;
      existing.accessCount += 1;
      return this;
    }
    this.cache.set(key, { value, accessCount: 1, createdMs: now, lastAccessMs: now });
    if (this.cache.size > this.maxSize) this.evictLeastValuable(now);
    return this;
  }

  delete(key) { return this.cache.delete(key); }

  clear() { this.cache.clear(); }

  score(entry, now = this.now()) {
    const ageMinutes = Math.max(0, now - entry.lastAccessMs) / 60000;
    return entry.accessCount / (1 + ageMinutes);
  }

  evictLeastValuable(now = this.now()) {
    let victimKey;
    let victimScore = Infinity;
    let victimCreatedMs = Infinity;
    for (const [key, entry] of this.cache) {
      const score = this.score(entry, now);
      if (score < victimScore || (score === victimScore && entry.createdMs < victimCreatedMs)) {
        victimKey = key;
        victimScore = score;
        victimCreatedMs = entry.createdMs;
      }
    }
    if (victimKey !== undefined) this.cache.delete(victimKey);
  }
}

module.exports = { ScoredCache };
