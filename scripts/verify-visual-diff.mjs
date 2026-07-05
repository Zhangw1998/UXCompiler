import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runVisualDiff } from "../packages/visual-diff/dist/index.js";

const requireFromVisualDiff = createRequire(new URL("../packages/visual-diff/package.json", import.meta.url));
const { PNG } = requireFromVisualDiff("pngjs");

const root = resolve("artifacts/visual-diff-smoke");
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });

const white = rgba(255, 255, 255);
const black = rgba(0, 0, 0);
const blue = rgba(0, 64, 255);

const reference = png(4, 4, white);
const identical = png(4, 4, white);
const changed = png(4, 4, white, [
  { x: 0, y: 0, w: 2, h: 2, color: black },
  { x: 3, y: 3, w: 1, h: 1, color: blue }
]);
const wrongSize = png(3, 5, white);

const passing = runVisualDiff({
  referencePng: reference,
  candidatePng: identical,
  referencePath: "reference.png",
  candidatePath: "identical.png",
  heatmapPath: "diff_heatmap.png",
  viewport: { width: 4, height: 4 },
  dpr: 2,
  fonts: ["Inter", "Inter", "Roboto"],
  flutterVersion: "Flutter 3.35.0"
});
assert.equal(passing.visualDiffReport.page.pass, true);
assert.equal(passing.visualDiffReport.page.score.visualScore, 1);
assert.deepEqual(passing.visualDiffReport.environment.fonts, ["Inter", "Roboto"]);
assert.equal(passing.nodeDiffReport.length, 0);
assert.equal(passing.manualReviewReport, undefined);
assert.equal(PNG.sync.read(Buffer.from(passing.heatmapPng)).width, 4);

const failing = runVisualDiff({
  referencePng: reference,
  candidatePng: changed,
  referencePath: "reference.png",
  candidatePath: "changed.png",
  heatmapPath: "diff_heatmap.png",
  nodePixelMap: [
    { sourceNodeId: "node:black", bounds: { x: 0, y: 0, w: 2, h: 2 } },
    { sourceNodeId: "node:blue", bounds: { x: 3, y: 3, w: 1, h: 1 } }
  ],
  threshold: { visualScore: 0.99, pixelDiffRatio: 0.01 }
});
assert.equal(failing.visualDiffReport.page.pass, false);
assert.ok(failing.visualDiffReport.page.score.visualScore < 0.99);
assert.equal(failing.nodeDiffReport.length, 2);
assert.deepEqual(
  failing.nodeDiffReport.map((issue) => issue.sourceNodeId),
  ["node:black", "node:blue"]
);
assert.ok(failing.nodeDiffReport.every((issue) => issue.suggestedFixes.length > 0));
assert.equal(failing.manualReviewReport?.required, true);
assert.equal(failing.manualReviewReport?.severity, "P0");
assert.deepEqual(
  failing.manualReviewReport?.issues.map((issue) => issue.sourceNodeId),
  ["node:black", "node:blue"]
);

const sizeMismatch = runVisualDiff({
  referencePng: reference,
  candidatePng: wrongSize,
  referencePath: "reference.png",
  candidatePath: "wrong_size.png",
  heatmapPath: "diff_heatmap.png"
});
assert.equal(sizeMismatch.visualDiffReport.page.pass, false);
assert.equal(sizeMismatch.nodeDiffReport[0].type, "size_mismatch");
assert.equal(sizeMismatch.visualDiffReport.warnings[0].type, "size_mismatch");
assert.equal(sizeMismatch.manualReviewReport?.issues[0].type, "size_mismatch");
const mismatchHeatmap = PNG.sync.read(Buffer.from(sizeMismatch.heatmapPng));
assert.equal(mismatchHeatmap.width, 4);
assert.equal(mismatchHeatmap.height, 5);

execFileSync(
  "node",
  [
    "apps/cli/dist/index.js",
    "preview",
    "diff",
    "--reference",
    writePng("reference.png", reference),
    "--candidate",
    writePng("changed.png", changed),
    "--node-pixel-map",
    writeJson("node_pixel_map.json", [
      { sourceNodeId: "node:black", bounds: { x: 0, y: 0, w: 2, h: 2 } }
    ]),
    "--out",
    resolve(root, "cli")
  ],
  { stdio: "pipe" }
);
assert.equal(existsSync(resolve(root, "cli/visual_diff_report.json")), true);
assert.equal(existsSync(resolve(root, "cli/node_diff_report.json")), true);
assert.equal(existsSync(resolve(root, "cli/diff_heatmap.png")), true);
assert.equal(existsSync(resolve(root, "cli/manual_review_report.json")), true);
const cliManualReview = JSON.parse(readFileSync(resolve(root, "cli/manual_review_report.json"), "utf8"));
assert.equal(cliManualReview.required, true);
assert.equal(cliManualReview.issues[0].sourceNodeId, "node:black");

console.log("visual diff verification passed");

function png(width, height, fill, patches = []) {
  const image = new PNG({ width, height });
  paint(image, 0, 0, width, height, fill);
  for (const patch of patches) paint(image, patch.x, patch.y, patch.w, patch.h, patch.color);
  return PNG.sync.write(image);
}

function paint(image, x, y, w, h, color) {
  for (let row = y; row < y + h; row += 1) {
    for (let column = x; column < x + w; column += 1) {
      const index = (row * image.width + column) * 4;
      image.data[index] = color[0];
      image.data[index + 1] = color[1];
      image.data[index + 2] = color[2];
      image.data[index + 3] = color[3];
    }
  }
}

function rgba(r, g, b, a = 255) {
  return [r, g, b, a];
}

function writePng(file, bytes) {
  const path = resolve(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, bytes);
  return path;
}

function writeJson(file, value) {
  const path = resolve(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return path;
}
