'use strict';

function niceChartScale(rawMax, targetSteps = 4) {
  const safeMax = Number.isFinite(Number(rawMax)) && Number(rawMax) > 0 ? Number(rawMax) : 1;
  const steps = Math.max(2, Math.min(6, Math.round(Number(targetSteps) || 4)));
  const roughStep = safeMax / steps;
  const magnitude = 10 ** Math.floor(Math.log10(roughStep));
  const normalized = roughStep / magnitude;
  const niceFactor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10;
  const step = niceFactor * magnitude;
  const max = Math.max(step, Math.ceil(safeMax / step) * step);
  const tickCount = Math.max(1, Math.round(max / step));
  return {
    max,
    step,
    ticks: Array.from({ length: tickCount + 1 }, (_, index) => Number((index * step).toPrecision(12))),
  };
}

function chartAxisIndices(length, width, minGap = 78) {
  const count = Math.max(0, Math.floor(Number(length) || 0));
  if (!count) return [];
  if (count === 1) return [0];
  const slots = Math.max(2, Math.min(count, Math.floor(Math.max(1, Number(width) || 1) / Math.max(48, Number(minGap) || 78)) + 1));
  return [...new Set(Array.from({ length: slots }, (_, index) => Math.round(index * (count - 1) / (slots - 1))))];
}

if (typeof module !== "undefined" && module.exports) module.exports = { niceChartScale, chartAxisIndices };
