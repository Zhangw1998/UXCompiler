import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve("artifacts/sample");
const requiredFiles = [
  "raw_figma_scene.json",
  "canonical_scene.json",
  "canonicalization_report.json",
  "node_mapping.json",
  "inferred_tokens.json",
  "token_usage_map.json",
  "token_confidence_report.json",
  "dart_tokens.dart",
  "asset_manifest.json",
  "i18n_manifest.json",
  "arb/app_en.arb",
  "visual_ir.json",
  "fidelity_generation_manifest.json",
  "node_pixel_map.json",
  "review_tasks.json",
  "task_status_report.json",
  "flutter_preview/pubspec.yaml",
  "flutter_preview/lib/main.dart",
  "flutter_preview/lib/generated/fidelity/preview_page.dart",
  "flutter_preview/test/preview_test.dart",
  "flutter_preview/test/golden_preview_test.dart",
  "flutter_preview_format_report.json",
  "regions.json",
  "layout_candidates.json",
  "layout_decisions.json",
  "normalized_design_ir.json",
  "compile_manifest.json"
];

for (const file of requiredFiles) {
  assert.equal(existsSync(resolve(root, file)), true, `Missing artifact: ${file}`);
}

const readJson = (file) => JSON.parse(readFileSync(resolve(root, file), "utf8"));
const canonical = readJson("canonical_scene.json");
const mapping = readJson("node_mapping.json");
const tokens = readJson("inferred_tokens.json");
const assetManifest = readJson("asset_manifest.json");
const i18nManifest = readJson("i18n_manifest.json");
const arb = readJson("arb/app_en.arb");
const visualIR = readJson("visual_ir.json");
const nodePixelMap = readJson("node_pixel_map.json");
const reviewTasks = readJson("review_tasks.json");
const taskStatusReport = readJson("task_status_report.json");
const formatReport = readJson("flutter_preview_format_report.json");
const regions = readJson("regions.json");
const decisions = readJson("layout_decisions.json");
const normalized = readJson("normalized_design_ir.json");

assert.equal(canonical.root.sourceNodeId, "1:1");
assert.deepEqual(canonical.source.viewport, { width: 390, height: 844 });
assert.deepEqual(mapping.rawToCanonical["1:1"], ["c_1_1"]);
assert.ok(tokens.colors.length >= 4, "Expected color tokens");
assert.ok(tokens.spacing.length >= 3, "Expected spacing tokens");
assert.ok(tokens.typography.length >= 3, "Expected typography tokens");
assert.ok(assetManifest.assets.length >= 8, "Expected asset strategy entries");
assert.ok(i18nManifest.messages.length >= 6, "Expected extracted text messages");
assert.equal(arb["@@locale"], "en");
assert.equal(arb.title, "Welcome back");
assert.equal(visualIR.root.type, "scene");
assert.ok(visualIR.root.children.length >= 10, "Expected VisualIR positioned children");
assert.ok(nodePixelMap.length >= 10, "Expected node pixel map entries");
assert.ok(reviewTasks.length > 0, "Expected review tasks");
assert.ok(reviewTasks.every((task) => task.status === "open"), "Expected open review tasks");
assert.ok(reviewTasks.every((task) => task.suggestedActions?.length > 0), "Expected task suggested actions");
assert.ok(reviewTasks.some((task) => task.type === "token_conflict"), "Expected token review task");
assert.equal(taskStatusReport.total, reviewTasks.length);
assert.equal(taskStatusReport.codegenWriteBlocked, false);
assert.equal(formatReport.status, "success");
assert.equal(regions.length, 3);
assert.equal(regions[0].role, "header");
assert.equal(regions[1].role, "content");
assert.equal(regions[2].role, "footer");
assertDecision(decisions, "c_1_5", "column");
assertDecision(decisions, "c_1_15", "row");
assert.equal(normalized.version, "2.0");
assert.ok(normalized.confidence.overall >= 0.8, "Expected useful normalized confidence");

if (commandExists("flutter")) {
  execFileSync("flutter", ["pub", "get"], {
    cwd: resolve(root, "flutter_preview"),
    stdio: "pipe"
  });
  execFileSync("flutter", ["analyze"], {
    cwd: resolve(root, "flutter_preview"),
    stdio: "pipe"
  });
  execFileSync("flutter", ["test", "test/preview_test.dart"], {
    cwd: resolve(root, "flutter_preview"),
    stdio: "pipe"
  });
  execFileSync(
    "node",
    [
      "apps/cli/dist/index.js",
      "preview",
      "capture",
      "--project",
      "artifacts/sample/flutter_preview",
      "--out",
      "artifacts/sample/flutter_preview.png"
    ],
    {
      stdio: "pipe"
    }
  );
  assert.equal(existsSync(resolve(root, "flutter_preview.png")), true, "Expected preview capture PNG");
  assert.equal(existsSync(resolve(root, "flutter_preview_capture_report.json")), true, "Expected preview capture report");
}

console.log("sample verification passed");

function assertDecision(decisions, nodeId, layout) {
  const decision = decisions.find((candidate) => candidate.nodeId === nodeId);
  assert.ok(decision, `Missing layout decision for ${nodeId}`);
  assert.equal(decision.layout, layout);
  assert.ok(decision.confidence > 0.8, `Low confidence for ${nodeId}`);
}

function commandExists(command) {
  try {
    execFileSync("which", [command], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
