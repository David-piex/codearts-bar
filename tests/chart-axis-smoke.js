"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const desktopAxis = require(path.join(root, "src", "core", "chart-axis.js"));
const extensionAxisSource = fs.readFileSync(path.join(root, "extension", "media", "scripts", "chart-axis.js"), "utf8");
const context = { window: {}, console };
vm.runInNewContext(extensionAxisSource, context);
const extensionAxis = context.CodeArtsChartAxis;

for (const rawMax of [0, 1, 3, 9, 11, 999, 1000, 1588917, 1e12]) {
  const desktop = desktopAxis.niceChartScale(rawMax);
  const extension = extensionAxis.niceChartScale(rawMax);
  assert.deepEqual(JSON.parse(JSON.stringify(extension)), desktop, `desktop and extension scales should match for ${rawMax}`);
  assert.ok(desktop.max >= Math.max(1, rawMax));
  assert.equal(desktop.ticks[0], 0);
  assert.ok(desktop.ticks.length >= 4 && desktop.ticks.length <= 6);
  assert.equal(desktop.ticks.at(-1), desktop.max);
  desktop.ticks.slice(1).forEach((tick, index) => {
    assert.ok(tick > desktop.ticks[index]);
    assert.ok(Math.abs((tick - desktop.ticks[index]) - desktop.step) < Math.max(1e-9, desktop.step * 1e-9));
  });
  assert.ok(String(desktop.max).length <= 20);
}

for (const [length, width] of [[0, 300], [1, 300], [24, 280], [24, 900], [365, 1800]]) {
  const desktop = desktopAxis.chartAxisIndices(length, width);
  const extension = [...extensionAxis.chartAxisIndices(length, width)];
  assert.deepEqual(extension, desktop);
  if (length > 1) {
    assert.equal(desktop[0], 0);
    assert.equal(desktop.at(-1), length - 1);
  }
  assert.equal(new Set(desktop).size, desktop.length);
}

console.log("ok - chart axis smoke");
