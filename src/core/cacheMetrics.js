(function(root){
  function metricNumber(value){
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  function cacheHitDenominator(metrics = {}){
    return metricNumber(metrics.input) + metricNumber(metrics.cacheRead);
  }
  function cacheHitRateRatio(metrics = {}){
    const denominator = cacheHitDenominator(metrics);
    return denominator > 0 ? metricNumber(metrics.cacheRead) / denominator : null;
  }
  function cacheHitRatePercent(metrics = {}){
    const ratio = cacheHitRateRatio(metrics);
    return ratio == null ? null : ratio * 100;
  }
  function cacheHitBasis(metrics = {}){
    return { cacheRead: metricNumber(metrics.cacheRead), denominator: cacheHitDenominator(metrics) };
  }
  function cacheCoverageRatePercent(metrics = {}){
    return cacheHitRatePercent(metrics);
  }
  function withCacheHitMetrics(metrics = {}){
    if(!metrics || typeof metrics !== 'object') return metrics;
    metrics.cacheHitDenominator = cacheHitDenominator(metrics);
    metrics.cacheHitRate = cacheHitRatePercent(metrics);
    return metrics;
  }
  const api = { metricNumber, cacheHitDenominator, cacheHitRateRatio, cacheHitRatePercent, cacheHitBasis, cacheCoverageRatePercent, withCacheHitMetrics };
  root.CacheMetrics = api;
  if(typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
