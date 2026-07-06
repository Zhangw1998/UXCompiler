import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertReviewTaskContract } from "./review-task-contract.mjs";

const root = resolve("artifacts/sample");
const staleRoot = resolve("artifacts/sample-stale-cleanup");
const requiredFiles = [
  "raw_figma_scene.json",
  "extraction_report.json",
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
  "override_set.json",
  "reviewed_normalized_design_ir.json",
  "reviewed_asset_manifest.json",
  "reviewed_i18n_manifest.json",
  "reviewed_inferred_tokens.json",
  "reviewed_arb/app_en.arb",
  "override_conflict_report.json",
  "stale_override_report.json",
  "visual_ir.json",
  "web_preview_state.json",
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
  "flutter_preview_analyze_report.json",
  "regions.json",
  "region_tree.json",
  "layout_candidates.json",
  "layout_decisions.json",
  "inferred_components.json",
  "component_instance_map.json",
  "component_confidence_report.json",
  "semantic_labels.json",
  "ai_decision_report.json",
  "naming_map.json",
  "i18n_key_suggestions.json",
  "semantic_ir.json",
  "uplift_decisions.json",
  "uplift_diff_report.json",
  "normalization_report.json",
  "render_strategy_manifest.json",
  "flutter_generation_manifest.json",
  "normalized_design_ir.json",
  "compile_manifest.json"
];

for (const file of requiredFiles) {
  assert.equal(existsSync(resolve(root, file)), true, `Missing artifact: ${file}`);
}
for (const staleFile of [
  "visual_diff_report.json",
  "node_diff_report.json",
  "diff_issues.json",
  "manual_review_report.json",
  "repair_patch.json",
  "repair_iteration_log.json",
  "diff_heatmap.png",
  "preview_artifact.json",
  "pipeline_run_report.json",
  "flutter_preview_capture_report.json"
]) {
  assert.equal(existsSync(resolve(root, staleFile)), false, `Compile output must not retain stale runtime artifact: ${staleFile}`);
}

const readJson = (file) => JSON.parse(readFileSync(resolve(root, file), "utf8"));
const extractionReport = readJson("extraction_report.json");
const canonical = readJson("canonical_scene.json");
const mapping = readJson("node_mapping.json");
const tokens = readJson("inferred_tokens.json");
const assetManifest = readJson("asset_manifest.json");
const i18nManifest = readJson("i18n_manifest.json");
const arb = readJson("arb/app_en.arb");
const overrideSet = readJson("override_set.json");
const reviewedNormalized = readJson("reviewed_normalized_design_ir.json");
const staleOverrideReport = readJson("stale_override_report.json");
const visualIR = readJson("visual_ir.json");
const webPreviewState = readJson("web_preview_state.json");
const nodePixelMap = readJson("node_pixel_map.json");
const reviewTasks = readJson("review_tasks.json");
const taskStatusReport = readJson("task_status_report.json");
const formatReport = readJson("flutter_preview_format_report.json");
const analyzeReport = readJson("flutter_preview_analyze_report.json");
const regions = readJson("regions.json");
const regionTree = readJson("region_tree.json");
const decisions = readJson("layout_decisions.json");
const inferredComponents = readJson("inferred_components.json");
const componentInstanceMap = readJson("component_instance_map.json");
const componentConfidenceReport = readJson("component_confidence_report.json");
const semanticLabels = readJson("semantic_labels.json");
const aiDecisionReport = readJson("ai_decision_report.json");
const namingMap = readJson("naming_map.json");
const i18nKeySuggestions = readJson("i18n_key_suggestions.json");
const semanticIR = readJson("semantic_ir.json");
const upliftDecisions = readJson("uplift_decisions.json");
const upliftDiffReport = readJson("uplift_diff_report.json");
const normalizationReport = readJson("normalization_report.json");
const renderStrategyManifest = readJson("render_strategy_manifest.json");
const normalized = readJson("normalized_design_ir.json");
const compileManifest = readJson("compile_manifest.json");

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
assert.match(overrideSet.hash, /^sha256_[a-f0-9]{64}$/);
assert.equal(reviewedNormalized.tree.id, normalized.tree.id);
assert.equal(staleOverrideReport.staleOverrides.length, 0);
assert.equal(visualIR.root.type, "scene");
assert.ok(visualIR.root.children.length >= 10, "Expected VisualIR positioned children");
assert.equal(webPreviewState.renderer, "web_canvas_state");
assert.deepEqual(webPreviewState.viewport, { width: 390, height: 844 });
assert.ok(webPreviewState.commands.length >= 10, "Expected web preview commands");
assert.ok(webPreviewState.commands.some((command) => command.type === "text"), "Expected text web preview command");
assert.ok(nodePixelMap.length >= 10, "Expected node pixel map entries");
assert.ok(reviewTasks.length > 0, "Expected review tasks");
assertReviewTaskContract(reviewTasks, "sample review tasks");
assert.ok(reviewTasks.every((task) => task.status === "open"), "Expected open review tasks");
assert.ok(reviewTasks.every((task) => task.suggestedActions?.length > 0), "Expected task suggested actions");
assert.ok(reviewTasks.some((task) => task.type === "token_conflict"), "Expected token review task");
assert.ok(reviewTasks.some((task) => task.type === "semantic_uplift_pending"), "Expected semantic uplift review task");
assert.equal(taskStatusReport.total, reviewTasks.length);
assert.equal(taskStatusReport.byType.semantic_uplift_pending, reviewTasks.filter((task) => task.type === "semantic_uplift_pending").length);
assert.ok(
  reviewTasks.some((task) => task.id === "task_semantic_uplift_region_2" && task.evidence.strategy === "semantic_column_region"),
  "Expected content semantic uplift review task"
);
assert.equal(taskStatusReport.codegenWriteBlocked, false);
assert.equal(formatReport.status, "success");
assert.ok(["success", "skipped", "failed"].includes(analyzeReport.status), "Expected analyze report status");
assert.equal(analyzeReport.command, "flutter pub get && flutter analyze");
assert.equal(regions.length, 3);
assert.equal(regions[0].role, "header");
assert.equal(regions[1].role, "content");
assert.equal(regions[2].role, "footer");
assert.equal(regionTree.id, "region_tree_root");
assert.equal(regionTree.children.length, regions.length);
assert.ok(regionTree.children.some((region) => region.id === "region_1" && region.role === "header"));
assertDecision(decisions, "c_1_5", "column");
assertDecision(decisions, "c_1_15", "row");
assert.equal(inferredComponents.version, "2.0");
assert.equal(inferredComponents.status, "no_reusable_components_detected");
assert.deepEqual(inferredComponents.candidates, []);
assert.equal(inferredComponents.fallback, "generate_separate_widgets");
assert.equal(componentInstanceMap.version, "2.0");
assert.deepEqual(componentInstanceMap.components, []);
assert.ok(componentInstanceMap.unmappedSourceNodeIds.includes("1:1"));
assert.equal(componentConfidenceReport.status, "no_candidates");
assert.ok(componentConfidenceReport.warnings.some((warning) => warning.type === "no_reusable_components_detected"));
assert.equal(semanticLabels.version, "2.0");
assert.equal(semanticLabels.source, "deterministic_fallback");
assert.ok(semanticLabels.regions.some((region) => region.regionId === "region_1" && region.role === "header"));
assert.ok(semanticLabels.nodes.some((node) => node.sourceNodeIds.includes("1:1")));
assert.ok(semanticLabels.i18n.some((entry) => entry.suggestedKey === "title" && entry.sourceNodeId === "1:3"));
assert.ok(semanticLabels.assets.some((entry) => entry.sourceNodeId === "1:2"));
assert.equal(aiDecisionReport.status, "not_run");
assert.ok(aiDecisionReport.warnings.some((warning) => warning.type === "ai_adapter_not_configured"));
assert.equal(namingMap.regions.region_1, "HeaderRegion");
assert.equal(namingMap.i18n["1:3"], "title");
assert.ok(i18nKeySuggestions.suggestions.some((entry) => entry.sourceNodeId === "1:3" && entry.suggestedKey === "title"));
assert.equal(semanticIR.version, "2.0");
assert.equal(semanticIR.status, "fidelity_preserved");
assert.equal(semanticIR.normalizedDesignIR.tree.id, normalized.tree.id);
assert.equal(semanticIR.semanticLabels.source, "deterministic_fallback");
assert.equal(upliftDecisions.version, "2.0");
assert.ok(upliftDecisions.decisions.length >= regions.length);
assert.ok(upliftDecisions.decisions.every((decision) => decision.accepted === false));
assert.ok(upliftDecisions.decisions.every((decision) => decision.confidence > 0), "Expected scored semantic uplift candidates");
assert.ok(
  upliftDecisions.decisions.every((decision) => ["auto_diff_required", "review_diff_required", "keep_fidelity"].includes(decision.gate)),
  "Expected semantic uplift gate on each candidate"
);
assert.ok(
  upliftDecisions.decisions.some(
    (decision) => decision.regionId === "region_2" && decision.strategy === "semantic_column_region" && decision.gate === "review_diff_required"
  ),
  "Expected content region to be scored as a semantic column uplift candidate"
);
for (const decision of upliftDecisions.decisions) {
  assertScore(decision.scoreBreakdown.semanticConfidence, `${decision.regionId}.semanticConfidence`);
  assertScore(decision.scoreBreakdown.layoutConfidence, `${decision.regionId}.layoutConfidence`);
  assertScore(decision.scoreBreakdown.componentConfidence, `${decision.regionId}.componentConfidence`);
  assertScore(decision.scoreBreakdown.expectedDiffSafety, `${decision.regionId}.expectedDiffSafety`);
}
assert.equal(upliftDiffReport.status, "not_run");
assert.equal(normalizationReport.source.frameNodeId, "1:1");
assert.equal(normalizationReport.score.overall, normalized.confidence.overall);
assert.ok(normalizationReport.issues.some((issue) => issue.type === "token_conflict"));
assert.equal(renderStrategyManifest.page, "Login Mobile");
assert.deepEqual(renderStrategyManifest.viewport, { width: 390, height: 844 });
assert.ok(renderStrategyManifest.regions.some((region) => region.regionId === "region_1"));
assert.equal(extractionReport.source.rootNodeId, "1:1");
assert.equal(extractionReport.stats.nodes > 0, true);
assert.equal(extractionReport.stats.textNodes > 0, true);
assert.equal(Array.isArray(extractionReport.warnings), true);
assert.ok(compileManifest.artifacts.includes("extraction_report.json"));
assert.ok(compileManifest.artifacts.includes("region_tree.json"));
assert.ok(compileManifest.artifacts.includes("inferred_components.json"));
assert.ok(compileManifest.artifacts.includes("component_instance_map.json"));
assert.ok(compileManifest.artifacts.includes("component_confidence_report.json"));
assert.ok(compileManifest.artifacts.includes("semantic_labels.json"));
assert.ok(compileManifest.artifacts.includes("ai_decision_report.json"));
assert.ok(compileManifest.artifacts.includes("naming_map.json"));
assert.ok(compileManifest.artifacts.includes("i18n_key_suggestions.json"));
assert.ok(compileManifest.artifacts.includes("semantic_ir.json"));
assert.ok(compileManifest.artifacts.includes("uplift_decisions.json"));
assert.ok(compileManifest.artifacts.includes("uplift_diff_report.json"));
assert.ok(compileManifest.artifacts.includes("normalization_report.json"));
assert.ok(compileManifest.artifacts.includes("render_strategy_manifest.json"));
assert.ok(compileManifest.artifacts.includes("flutter_generation_manifest.json"));
assert.equal(normalized.version, "2.0");
assert.ok(normalized.confidence.overall >= 0.8, "Expected useful normalized confidence");

if (commandExists("flutter")) {
  assert.equal(analyzeReport.status, "success");
  assert.equal(analyzeReport.errors, 0);
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
      "artifacts/sample/flutter_preview.png",
      "--viewport",
      "390x844",
      "--dpr",
      "1"
    ],
    {
      stdio: "pipe"
    }
  );
  assert.equal(existsSync(resolve(root, "flutter_preview.png")), true, "Expected preview capture PNG");
  assert.equal(existsSync(resolve(root, "flutter_preview_capture_report.json")), true, "Expected preview capture report");
  const captureReport = readJson("flutter_preview_capture_report.json");
  assert.deepEqual(captureReport.viewport, { width: 390, height: 844 });
  assert.equal(captureReport.dpr, 1);
  assert.deepEqual(captureReport.fonts, []);
}

rmSync(staleRoot, { recursive: true, force: true });
mkdirSync(resolve(staleRoot, "diff"), { recursive: true });
writeFileSync(resolve(staleRoot, "visual_diff_report.json"), "{}\n");
writeFileSync(resolve(staleRoot, "node_diff_report.json"), "[]\n");
writeFileSync(resolve(staleRoot, "diff_heatmap.png"), "stale");
writeFileSync(resolve(staleRoot, "preview_artifact.json"), "{}\n");
writeFileSync(resolve(staleRoot, "diff/visual_diff_report.json"), "{}\n");
execFileSync(
  "node",
  [
    "apps/cli/dist/index.js",
    "compile",
    "--input",
    "examples/fixtures/login_raw_figma_scene.json",
    "--out",
    staleRoot
  ],
  { stdio: "pipe" }
);
for (const stalePath of [
  "visual_diff_report.json",
  "node_diff_report.json",
  "diff_heatmap.png",
  "preview_artifact.json",
  "diff/visual_diff_report.json"
]) {
  assert.equal(existsSync(resolve(staleRoot, stalePath)), false, `Recompile must remove stale artifact: ${stalePath}`);
}
const staleCompileManifest = JSON.parse(readFileSync(resolve(staleRoot, "compile_manifest.json"), "utf8"));
assert.equal(staleCompileManifest.artifacts.includes("visual_diff_report.json"), false);

console.log("sample verification passed");

function assertDecision(decisions, nodeId, layout) {
  const decision = decisions.find((candidate) => candidate.nodeId === nodeId);
  assert.ok(decision, `Missing layout decision for ${nodeId}`);
  assert.equal(decision.layout, layout);
  assert.ok(decision.confidence > 0.8, `Low confidence for ${nodeId}`);
}

function assertScore(value, label) {
  assert.equal(typeof value, "number", `${label} must be a number`);
  assert.ok(value >= 0 && value <= 1, `${label} must be normalized`);
}

function commandExists(command) {
  try {
    execFileSync("which", [command], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}
