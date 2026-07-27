let chartPoints = [];
let chartAnimationFrame = null;
let chartHoverFrame = null;
let chartHover = { idx: -1, x: NaN, y: NaN, tx: NaN, ty: NaN, focusKey: '', pulse: 0 };
let chartPinnedIndex = -1;
let lastChartTipKey = '';
let lastChartHoverKey = '';
let chartResizeObserver = null;
let chartResizeObservedCanvas = null;
let chartResizeSizeKey = '';
let chartCanvasBoxCache = { width: 0, height: 0, dpr: 0, key: '', timestamp: 0, source: '' };
let chartGeometryDirty = false;
let chartBindTimer = null;
let chartBindFrame = null;
let chartBindIdle = null;
let chartBindFallbackTimer = null;
let chartBindToken = 0;
let chartZoomSettleTimer = null;
let chartResizeSettleTimer = null;
let chartResizeQuietUntil = 0;
let lastChartDrawSignature = '';
let chartStableBucketCache = new Map();
let storedChartSeries = initialStateValue('chartSeries', '') || '';
if(initialStateValue('chartSeriesLeanMigrated') !== '1'){
  if(!storedChartSeries || storedChartSeries === 'total,input,output,cacheHitRate') storedChartSeries = 'total,input,output,cacheRead';
  writeInitialStateValue('chartSeries', storedChartSeries);
  writeInitialStateValue('chartSeriesLeanMigrated', '1');
}
if(initialStateValue('chartSeriesMinimalMigrated') !== '1'){
  const chosen = new Set(String(storedChartSeries || '').split(',').filter(Boolean));
  if(!chosen.size || chosen.has('cacheHitRate') || chosen.has('cacheWrite') || chosen.has('ttftMs') || chosen.has('waitMs') || chosen.has('queueMs')){
    storedChartSeries = 'total,input,output,cacheRead';
    writeInitialStateValue('chartSeries', storedChartSeries);
  }
  writeInitialStateValue('chartSeriesMinimalMigrated', '1');
}
if(initialStateValue('chartSeriesTokenOnlyMigrated') !== '1'){
  const chosen = new Set(String(storedChartSeries || '').split(',').filter(Boolean));
  if(!chosen.size || chosen.has('cacheHitRate') || !chosen.has('cacheRead')){
    storedChartSeries = 'total,input,output,cacheRead';
    writeInitialStateValue('chartSeries', storedChartSeries);
  }
  writeInitialStateValue('chartSeriesTokenOnlyMigrated', '1');
}
let visibleSeries = new Set((storedChartSeries || 'total,input,output,cacheRead').split(',').filter(Boolean));
