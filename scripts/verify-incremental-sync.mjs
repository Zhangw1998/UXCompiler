import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { runIncrementalSync } from "../packages/incremental-sync/dist/index.js";

const root = "artifacts/incremental-sync-smoke";
const oldRawPath = resolve(root, "old_raw_figma_scene.json");
const newRawPath = resolve(root, "new_raw_figma_scene.json");
const overrideSetPath = resolve(root, "override_set.json");
const oldVisualDiffPath = resolve(root, "old_visual_diff_report.json");
const newVisualDiffPath = resolve(root, "new_visual_diff_report.json");
const outDir = resolve(root, "sync");
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });

const oldRaw = JSON.parse(readFileSync("examples/fixtures/login_raw_figma_scene.json", "utf8"));
const newRaw = JSON.parse(JSON.stringify(oldRaw));
newRaw.source.version = "snap_002";
renameNode(newRaw.root, "1:3", "2:3");
renameNode(newRaw.root, "1:4", "2:4", { name: "Subtitle Copy" });
removeNode(newRaw.root, "1:17");

const overrideSet = {
  id: "ovset_incremental_smoke",
  version: 1,
  snapshotId: "snap_001",
  hash: "",
  overrides: [
    override("ovr_title_name", "naming_override", { kind: "source_node", sourceNodeId: "1:3" }, { name: "LoginTitle" }),
    override("ovr_subtitle_render", "render_strategy_override", { kind: "source_node", sourceNodeId: "1:4" }, { strategy: "semantic_widget" }),
    override("ovr_button_layout", "layout_strategy_override", { kind: "source_node", sourceNodeId: "1:12" }, { strategy: "stack" }),
    override("ovr_divider_ignore", "ignore_node_override", { kind: "source_node", sourceNodeId: "1:17" }, { reason: "Decorative divider." }),
    override("ovr_header_region", "region_create_override", { kind: "page" }, { regionId: "region_header", name: "Header", sourceNodeIds: ["1:3", "1:12"] })
  ]
};

writeJson(oldRawPath, oldRaw);
writeJson(newRawPath, newRaw);
writeJson(overrideSetPath, overrideSet);
writeJson(oldVisualDiffPath, visualDiffReport(0.91, 0.09));
writeJson(newVisualDiffPath, visualDiffReport(0.86, 0.14));

const result = runIncrementalSync({
  oldRawScene: oldRaw,
  newRawScene: newRaw,
  overrideSet,
  oldSnapshotId: "snap_001",
  newSnapshotId: "snap_002",
  oldVisualDiffReport: visualDiffReport(0.91, 0.09),
  newVisualDiffReport: visualDiffReport(0.86, 0.14),
  now: () => new Date("2026-07-04T00:00:00.000Z")
});

assert.equal(result.nodeRemapReport.oldSnapshotId, "snap_001");
assert.equal(result.nodeRemapReport.newSnapshotId, "snap_002");
assert.equal(result.nodeRemapReport.visualDiffChange.status, "available");
assert.equal(result.nodeRemapReport.visualDiffChange.oldVisualScore, 0.91);
assert.equal(result.nodeRemapReport.visualDiffChange.newVisualScore, 0.86);
assert.equal(result.nodeRemapReport.visualDiffChange.visualScoreDelta, -0.05);
assert.equal(result.nodeRemapReport.visualDiffChange.pixelDiffRatioDelta, 0.05);
assert.equal(result.overrideSet.snapshotId, "snap_002");
assert.match(result.overrideSet.hash, /^sha256_[a-f0-9]{64}$/);

const titleMatch = matchFor(result, "1:3");
assert.equal(titleMatch.newSourceNodeId, "2:3");
assert.equal(titleMatch.method, "stable_key");
assert.equal(titleMatch.reviewRequired, false);

const subtitleMatch = matchFor(result, "1:4");
assert.equal(subtitleMatch.newSourceNodeId, "2:4");
assert.equal(subtitleMatch.method, "similarity");
assert.equal(subtitleMatch.reviewRequired, true);

const buttonMatch = matchFor(result, "1:12");
assert.equal(buttonMatch.newSourceNodeId, "1:12");
assert.equal(buttonMatch.method, "node_id_exact");

const dividerMatch = matchFor(result, "1:17");
assert.equal(dividerMatch.method, "unmatched");
assert.equal(result.staleOverrides.some((entry) => entry.overrideId === "ovr_divider_ignore"), true);
assert.equal(result.overrideSet.overrides.find((entry) => entry.id === "ovr_divider_ignore").status, "disabled");
assert.ok(result.reappliedOverrides.some((entry) => entry.overrideId === "ovr_title_name" && entry.newTarget.sourceNodeId === "2:3"));
assert.ok(result.reappliedOverrides.some((entry) => entry.overrideId === "ovr_subtitle_render" && entry.reviewRequired));
assert.ok(result.incrementalReviewTasks.some((task) => task.evidence.overrideId === "ovr_subtitle_render"));

const regionOverride = result.overrideSet.overrides.find((entry) => entry.id === "ovr_header_region");
assert.deepEqual(regionOverride.payload.sourceNodeIds, ["2:3", "1:12"]);

execFileSync(
  "node",
  [
    "apps/cli/dist/index.js",
    "sync",
    "remap",
    "--old-raw",
    oldRawPath,
    "--new-raw",
    newRawPath,
    "--override-set",
    overrideSetPath,
    "--old-snapshot-id",
    "snap_001",
    "--new-snapshot-id",
    "snap_002",
    "--old-visual-diff",
    oldVisualDiffPath,
    "--new-visual-diff",
    newVisualDiffPath,
    "--out",
    outDir
  ],
  { stdio: "pipe" }
);

for (const file of [
  "override_set.json",
  "node_remap_report.json",
  "reapplied_overrides.json",
  "stale_overrides.json",
  "incremental_review_tasks.json"
]) {
  assert.equal(existsSync(resolve(outDir, file)), true, `Missing ${file}`);
}
const cliReport = JSON.parse(readFileSync(resolve(outDir, "node_remap_report.json"), "utf8"));
assert.equal(cliReport.matches.some((entry) => entry.oldSourceNodeId === "1:3" && entry.newSourceNodeId === "2:3"), true);
assert.equal(cliReport.visualDiffChange.visualScoreDelta, -0.05);

console.log("incremental sync verification passed");

function override(id, type, target, payload) {
  return {
    id,
    type,
    target,
    payload,
    status: "active",
    createdBy: "user",
    createdAt: "2026-07-04T00:00:00.000Z"
  };
}

function matchFor(result, oldSourceNodeId) {
  const match = result.nodeRemapReport.matches.find((entry) => entry.oldSourceNodeId === oldSourceNodeId);
  assert.ok(match, `Missing remap for ${oldSourceNodeId}`);
  return match;
}

function renameNode(root, id, newId, patch = {}) {
  const node = findNode(root, id);
  assert.ok(node, `Missing node ${id}`);
  node.id = newId;
  Object.assign(node, patch);
}

function removeNode(root, id) {
  if (!root.children) return false;
  const index = root.children.findIndex((child) => child.id === id);
  if (index !== -1) {
    root.children.splice(index, 1);
    return true;
  }
  return root.children.some((child) => removeNode(child, id));
}

function findNode(root, id) {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return undefined;
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function visualDiffReport(visualScore, pixelDiffRatio) {
  return {
    version: "0.1.0",
    generatedAt: "2026-07-04T00:00:00.000Z",
    inputs: {
      reference: "figma_reference.png",
      candidate: "flutter_preview.png",
      heatmap: "diff_heatmap.png"
    },
    environment: {
      dpr: 1,
      fonts: ["Inter"],
      renderer: "png_pixelmatch"
    },
    page: {
      pass: visualScore >= 0.98,
      score: {
        visualScore,
        pixelDiffRatio,
        diffPixels: Math.round(pixelDiffRatio * 1000),
        totalPixels: 1000
      },
      threshold: {
        visualScore: 0.98,
        pixelDiffRatio: 0.02
      }
    },
    issues: [],
    warnings: []
  };
}
