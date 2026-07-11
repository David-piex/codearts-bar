"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const scanRoots = [path.join(root, "src"), path.join(root, "extension"), path.join(root, "tests"), path.join(root, "jetbrains-plugin", "src")];
const testPatternFixtures = new Set([
  path.join(root, "tests", "dashboard-preview-screenshot.js"),
  path.join(root, "tests", "dashboard-preview-smoke.js"),
  path.join(root, "tests", "dashboard-style-smoke.js"),
  path.join(root, "tests", "i18n-smoke.js"),
]);
const rootFiles = ["README.md", "package.json", "electron-builder.runtime.js", ".gitignore"].map((name) => path.join(root, name));
const generated = new Set([
  path.join(root, "src", "dashboard-renderer.js"),
  path.join(root, "src", "dashboard-bundle.css"),
  path.join(root, "extension", "media", "scripts", "chart-axis.js"),
]);
const extensions = new Set([".js", ".java", ".kts", ".xml", ".properties", ".html", ".css", ".json", ".md"]);
const issues = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(file);
    else if (extensions.has(path.extname(file)) && !generated.has(file) && !testPatternFixtures.has(file)) {
      const bytes = fs.readFileSync(file);
      const text = bytes.toString("utf8");
      if (text.includes("\uFFFD")) issues.push(`${path.relative(root, file)} contains U+FFFD`);
      if (/\?{3,}/.test(text)) issues.push(`${path.relative(root, file)} contains corrupted question-mark text`);
      if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) && bytes.subarray(3, 5).toString("ascii") === "#!") issues.push(`${path.relative(root, file)} has BOM before shebang`);
    }
  }
}
scanRoots.forEach(walk);
for (const file of rootFiles) {
  if (!fs.existsSync(file)) continue;
  const bytes = fs.readFileSync(file);
  const text = bytes.toString("utf8");
  if (text.includes("\uFFFD")) issues.push(`${path.relative(root, file)} contains U+FFFD`);
  if (/\?{3,}/.test(text)) issues.push(`${path.relative(root, file)} contains corrupted question-mark text`);
}
assert.deepEqual(issues, [], issues.join("\n"));
console.log("ok - source encoding smoke");
