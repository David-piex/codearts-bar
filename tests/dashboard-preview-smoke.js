"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const script = fs.readFileSync(path.join(__dirname, "dashboard-preview-screenshot.js"), "utf8");

assert.match(script, /analytics-chart-hover-preview\.html/);
assert.match(script, /analytics-chart-hover-pinned\.png/);
assert.match(script, /analytics-total-overview\.html/);
assert.match(script, /analytics-total-overview\.png/);
assert.match(script, /pinnedHover/);
assert.match(script, /analyticsTotal/);
assert.match(script, /usage-total-board/);
assert.match(script, /usage-total-cache/);
assert.match(script, /chart-hover-preview/);
assert.match(script, /preview-pinned/);
assert.match(script, /assertPreviewHtml/);
assert.match(script, /\\u5df2\\u56fa\\u5b9a\\u70b9\\u4f4d/);
assert.match(script, /\\u7f13\\u5b58\\u547d\\u4e2d/);
assert.doesNotMatch(script, /tip-cache-bar/);
assert.doesNotMatch(script, /cache-meta/);
assert.doesNotMatch(script, /ctx\.fillText\('\?\?\?'/);
assert.doesNotMatch(script, /<span>\?{2,}/);
assert.doesNotMatch(script, />\? token/);
assert.ok(!script.includes("ctx.fillText('???'"));
assert.ok(!script.includes("<span>??"));
assert.ok(!script.includes(">? token"));

console.log("ok - dashboard preview smoke");
