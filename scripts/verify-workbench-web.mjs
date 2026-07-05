import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildWorkbenchModel } from "../apps/workbench-web/dist/model.js";

const root = "artifacts/workbench-web-smoke";
const sampleDir = resolve(root, "sample");
const bulkDir = resolve(root, "bulk-sample");
const p0BulkDir = resolve(root, "p0-bulk-sample");
const fontDir = resolve(root, "font-sample");
const componentMappingDir = resolve(root, "component-mapping-sample");
rmSync(root, { recursive: true, force: true });

execFileSync(
  "node",
  [
    "apps/cli/dist/index.js",
    "compile",
    "--input",
    "examples/fixtures/login_raw_figma_scene.json",
    "--out",
    sampleDir
  ],
  { stdio: "pipe" }
);
cpSync(sampleDir, bulkDir, { recursive: true });
cpSync(sampleDir, p0BulkDir, { recursive: true });
cpSync(sampleDir, fontDir, { recursive: true });
cpSync(sampleDir, componentMappingDir, { recursive: true });
const p0BulkTasks = readJson(p0BulkDir, "review_tasks.json");
p0BulkTasks.unshift({
  id: "task_verify_p0_bulk_guard",
  type: "visual_diff_failed",
  priority: "P0",
  target: { normalizedNodeId: "c_1_1", sourceNodeIds: ["1:1"] },
  title: "Verify P0 bulk close guard",
  description: "P0 tasks must not be closed through bulk low-risk handling.",
  confidence: 0.1,
  evidence: { source: "verify-workbench-web" },
  suggestedActions: [
    {
      label: "Keep blocked",
      override: {
        type: "render_strategy_override",
        payload: { action: "keep_blocked" },
        reason: "P0 review tasks require explicit single-task resolution."
      }
    }
  ],
  status: "open"
});
writeJson(p0BulkDir, "review_tasks.json", p0BulkTasks);
const fontTasks = readJson(fontDir, "review_tasks.json");
fontTasks.unshift({
  id: "task_verify_font_mapping",
  type: "font_missing",
  priority: "P1",
  target: { tokenName: "text_display", sourceNodeIds: ["1:3"] },
  title: "Verify font mapping action",
  description: "Workbench task actions must support font_mapping_override suggestions.",
  confidence: 0.4,
  evidence: { tokenName: "text_display", fontFamily: "Inter" },
  suggestedActions: [
    {
      label: "Map font family",
      override: {
        type: "font_mapping_override",
        payload: { tokenName: "text_display", fromFamily: "Inter", fallbackFamily: "SF Pro Display" },
        reason: "Verify Workbench font mapping task action writeback."
      }
    }
  ],
  status: "open"
});
writeJson(fontDir, "review_tasks.json", fontTasks);
const componentMappingIr = readJson(componentMappingDir, "normalized_design_ir.json");
componentMappingIr.components = [
  ...(componentMappingIr.components ?? []),
  {
    componentId: "cmp_task_mapping",
    name: "TaskMappingCard",
    source: "inferred_and_user_approved",
    sourceInstances: ["1:12", "1:14"],
    instances: ["1:12", "1:14"],
    confidence: 1,
    status: "approved",
    verified: false
  }
];
writeJson(componentMappingDir, "normalized_design_ir.json", componentMappingIr);
writeJson(componentMappingDir, "reviewed_normalized_design_ir.json", componentMappingIr);
const componentMappingTasks = readJson(componentMappingDir, "review_tasks.json");
componentMappingTasks.unshift({
  id: "task_verify_component_mapping",
  type: "component_mapping_required",
  priority: "P1",
  target: { candidateId: "cmp_task_mapping", sourceNodeIds: ["1:12", "1:14"] },
  title: "Verify component mapping action",
  description: "Workbench task actions must support flutter_component_mapping_override suggestions.",
  confidence: 1,
  evidence: { componentId: "cmp_task_mapping", name: "TaskMappingCard" },
  suggestedActions: [
    {
      label: "Map Flutter component",
      override: {
        type: "flutter_component_mapping_override",
        payload: {
          kind: "map_flutter_component",
          flutter: { import: "package:app/ui/task_mapping_card.dart", constructor: "TaskMappingCard" }
        },
        reason: "Verify Workbench component mapping task action writeback."
      }
    }
  ],
  status: "open"
});
writeJson(componentMappingDir, "review_tasks.json", componentMappingTasks);

const flutterPreviewPath = resolve(sampleDir, "flutter_preview.png");
const hasFlutterPreview = existsSync(flutterPreviewPath);
const artifacts = {
  artifactRoot: "/artifacts/workbench-web-smoke/sample",
  reviewedNormalizedDesignIR: readJson(sampleDir, "reviewed_normalized_design_ir.json"),
  normalizedDesignIR: readJson(sampleDir, "normalized_design_ir.json"),
  visualIR: readJson(sampleDir, "visual_ir.json"),
  webPreviewState: readJson(sampleDir, "web_preview_state.json"),
  reviewTasks: readJson(sampleDir, "review_tasks.json"),
  taskStatusReport: readJson(sampleDir, "task_status_report.json"),
  overrideSet: readJson(sampleDir, "override_set.json"),
  reviewedInferredTokens: readJson(sampleDir, "reviewed_inferred_tokens.json"),
  reviewedAssetManifest: readJson(sampleDir, "reviewed_asset_manifest.json"),
  reviewedI18nManifest: readJson(sampleDir, "reviewed_i18n_manifest.json"),
  staleOverrideReport: readJson(sampleDir, "stale_override_report.json"),
  overrideConflictReport: readJson(sampleDir, "override_conflict_report.json"),
  fidelityGenerationManifest: readJson(sampleDir, "fidelity_generation_manifest.json"),
  flutterPreviewAnalyzeReport: readJson(sampleDir, "flutter_preview_analyze_report.json"),
  flutterPreviewCaptureReport: existsSync(resolve(sampleDir, "flutter_preview_capture_report.json"))
    ? readJson(sampleDir, "flutter_preview_capture_report.json")
    : undefined,
  flutterPreviewUrl: hasFlutterPreview ? "/artifacts/workbench-web-smoke/sample/flutter_preview.png" : undefined
};

const model = buildWorkbenchModel(artifacts);
assert.deepEqual(model.viewport, { width: 390, height: 844 });
assert.equal(model.project.frameNodeId, "1:1");
assert.ok(model.project.confidence >= 0.8);
assert.ok(model.treeRows.length >= 10, "Expected normalized tree rows");
assert.ok(model.visualNodes.length >= 10, "Expected visual preview nodes");
assert.ok(model.reviewSummary.open > 0, "Expected open review tasks");
assert.ok(model.tokenCounts.colors >= 4, "Expected color tokens");
assert.ok(model.assetCount >= 8, "Expected asset decisions");
assert.ok(model.i18nCount >= 6, "Expected i18n messages");
assert.equal(model.preview.hasVisualIR, true);
assert.equal(model.preview.hasWebPreviewState, true);
assert.equal(model.preview.hasFlutterPreview, hasFlutterPreview);
assert.ok(model.artifactStatus.some((entry) => entry.label === "Visual IR" && entry.present));
assert.ok(model.artifactStatus.some((entry) => entry.label === "Web Preview" && entry.present));

const server = spawn("node", ["scripts/workbench-web-server.mjs", "--port", "8798", "--artifacts", "/artifacts/workbench-web-smoke/sample"], {
  stdio: ["ignore", "pipe", "pipe"]
});

try {
  await waitForServer();
  const base = "http://127.0.0.1:8798";
  const html = await fetchText(`${base}/apps/workbench-web/?artifacts=/artifacts/workbench-web-smoke/sample`);
  const js = await fetchText(`${base}/apps/workbench-web/dist/main.js`);
  const modelJs = await fetchText(`${base}/apps/workbench-web/dist/model.js`);
  const css = await fetchText(`${base}/apps/workbench-web/dist/styles.css`);
  const visual = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/visual_ir.json`);
  const previewPng = hasFlutterPreview ? await fetch(`${base}/artifacts/workbench-web-smoke/sample/flutter_preview.png`) : undefined;

  assert.match(html, /id="app"/);
  assert.match(js, /loadFromArtifactRoot/);
  assert.match(js, /Token Migration/);
  assert.match(js, /Assets To Add/);
  assert.match(js, /ARB Changes/);
  assert.match(js, /Pubspec Patch/);
  assert.match(js, /Merge Report/);
  assert.match(js, /Generated Widgets/);
  assert.match(js, /Fallback Regions/);
  assert.match(js, /Unresolved Review Tasks/);
  assert.match(js, /Manual Overrides/);
  assert.match(modelJs, /buildWorkbenchModel/);
  assert.match(css, /preview-stage/);
  assert.match(css, /code-block/);
  assert.equal(visual.root.type, "scene");
  if (previewPng) {
    assert.equal(previewPng.ok, true);
    assert.equal(previewPng.headers.get("content-type"), "image/png");
  }

  const bulkTasks = await fetchJson(`${base}/artifacts/workbench-web-smoke/bulk-sample/review_tasks.json`);
  const bulkTaskIds = bulkTasks.filter((task) => task.status === "open" && task.priority === "P2").slice(0, 2).map((task) => task.id);
  assert.ok(bulkTaskIds.length > 0, "Expected P2 tasks for bulk close smoke");
  const bulkCloseResponse = await fetch(`${base}/api/workbench/task-bulk-close`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactRoot: "/artifacts/workbench-web-smoke/bulk-sample",
      taskIds: bulkTaskIds,
      reason: "Verify P2 bulk close smoke."
    })
  });
  assert.equal(bulkCloseResponse.ok, true);
  const bulkCloseResult = await bulkCloseResponse.json();
  assert.equal(bulkCloseResult.ok, true);
  assert.equal(bulkCloseResult.report.closedTaskCount, bulkTaskIds.length);
  assert.equal(bulkCloseResult.report.afterOpenTasks, bulkCloseResult.report.beforeOpenTasks - bulkTaskIds.length);
  const bulkUpdatedTasks = await fetchJson(`${base}/artifacts/workbench-web-smoke/bulk-sample/review_tasks.json`);
  const bulkTaskStatusReport = await fetchJson(`${base}/artifacts/workbench-web-smoke/bulk-sample/task_status_report.json`);
  const bulkClosureLog = await fetchJson(`${base}/artifacts/workbench-web-smoke/bulk-sample/review_task_closure_log.json`);
  assert.equal(bulkTaskIds.every((taskId) => !bulkUpdatedTasks.some((task) => task.id === taskId)), true);
  assert.equal(bulkTaskStatusReport.open, bulkUpdatedTasks.filter((task) => task.status === "open").length);
  assert.equal(bulkClosureLog.slice(-bulkTaskIds.length).every((entry) => entry.bulkClosed === true), true);
  assert.equal(bulkClosureLog.at(-1).taskSnapshot.closedReason, "Verify P2 bulk close smoke.");

  const p0BulkCloseResponse = await fetch(`${base}/api/workbench/task-bulk-close`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactRoot: "/artifacts/workbench-web-smoke/p0-bulk-sample",
      taskIds: ["task_verify_p0_bulk_guard"],
      reason: "This P0 task must not close in bulk."
    })
  });
  assert.equal(p0BulkCloseResponse.status, 500);
  const p0BulkCloseResult = await p0BulkCloseResponse.json();
  assert.equal(p0BulkCloseResult.ok, false);
  assert.match(p0BulkCloseResult.error, /P0 review task cannot be bulk closed/);
  const p0BulkTasksAfter = await fetchJson(`${base}/artifacts/workbench-web-smoke/p0-bulk-sample/review_tasks.json`);
  assert.equal(p0BulkTasksAfter.some((task) => task.id === "task_verify_p0_bulk_guard" && task.status === "open"), true);

  const fontActionResponse = await fetch(`${base}/api/workbench/task-action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactRoot: "/artifacts/workbench-web-smoke/font-sample",
      taskId: "task_verify_font_mapping",
      actionIndex: 0
    })
  });
  assert.equal(fontActionResponse.ok, true);
  const fontActionResult = await fontActionResponse.json();
  assert.equal(fontActionResult.ok, true);
  assert.equal(fontActionResult.report.overrideId, "ovr_task_verify_font_mapping_action_0");
  const fontOverrideSet = await fetchJson(`${base}/artifacts/workbench-web-smoke/font-sample/override_set.json`);
  const fontTokens = await fetchJson(`${base}/artifacts/workbench-web-smoke/font-sample/reviewed_inferred_tokens.json`);
  const fontReviewTasks = await fetchJson(`${base}/artifacts/workbench-web-smoke/font-sample/review_tasks.json`);
  assert.equal(fontOverrideSet.overrides.some((entry) => entry.id === "ovr_task_verify_font_mapping_action_0" && entry.type === "font_mapping_override"), true);
  assert.equal(findTypographyToken(fontTokens, "text_display").fontFamily, "SF Pro Display");
  assert.equal(findTypographyToken(fontTokens, "text_display").confidence, 1);
  assert.equal(fontReviewTasks.some((task) => task.id === "task_verify_font_mapping"), false);

  const componentMappingActionResponse = await fetch(`${base}/api/workbench/task-action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactRoot: "/artifacts/workbench-web-smoke/component-mapping-sample",
      taskId: "task_verify_component_mapping",
      actionIndex: 0
    })
  });
  assert.equal(componentMappingActionResponse.ok, true);
  const componentMappingActionResult = await componentMappingActionResponse.json();
  assert.equal(componentMappingActionResult.ok, true);
  assert.equal(componentMappingActionResult.report.overrideId, "ovr_task_verify_component_mapping_action_0");
  const componentMappingOverrideSet = await fetchJson(`${base}/artifacts/workbench-web-smoke/component-mapping-sample/override_set.json`);
  const componentMappingIrAfter = await fetchJson(`${base}/artifacts/workbench-web-smoke/component-mapping-sample/reviewed_normalized_design_ir.json`);
  const componentMappingTasksAfter = await fetchJson(`${base}/artifacts/workbench-web-smoke/component-mapping-sample/review_tasks.json`);
  const componentMappingOverride = componentMappingOverrideSet.overrides.find((entry) => entry.id === "ovr_task_verify_component_mapping_action_0");
  assert.equal(componentMappingOverride.type, "flutter_component_mapping_override");
  assert.equal(componentMappingOverride.payload.componentId, "cmp_task_mapping");
  const mappedComponent = findComponentById(componentMappingIrAfter, "cmp_task_mapping");
  assert.equal(mappedComponent.flutter.import, "package:app/ui/task_mapping_card.dart");
  assert.equal(mappedComponent.flutter.constructor, "TaskMappingCard");
  assert.equal(mappedComponent.verified, true);
  assert.equal(componentMappingTasksAfter.some((task) => task.id === "task_verify_component_mapping"), false);

  assert.equal(artifacts.reviewTasks.some((task) => task.type === "semantic_uplift_pending"), true);
  const tokenTask = artifacts.reviewTasks.find((task) => task.type === "token_conflict" && task.target?.tokenName === "radius_18");
  assert.ok(tokenTask, "Expected radius_18 token task for task-action smoke");
  const firstTaskId = tokenTask.id;
  const actionResponse = await fetch(`${base}/api/workbench/task-action`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactRoot: "/artifacts/workbench-web-smoke/sample",
      taskId: firstTaskId,
      actionIndex: 0
    })
  });
  assert.equal(actionResponse.ok, true);
  const actionResult = await actionResponse.json();
  assert.equal(actionResult.ok, true);
  assert.equal(actionResult.report.taskId, firstTaskId);
  assert.match(actionResult.report.overrideId, /^ovr_/);
  assert.equal(actionResult.report.beforeOpenTasks, artifacts.reviewTasks.length);
  assert.ok(actionResult.report.afterOpenTasks < actionResult.report.beforeOpenTasks + 2);

  const updatedTasks = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/review_tasks.json`);
  const updatedOverrideSet = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/override_set.json`);
  const actionReport = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/review_task_action_report.json`);
  const closureLog = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/review_task_closure_log.json`);
  const updatedTokens = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/reviewed_inferred_tokens.json`);
  assert.equal(updatedTasks.length, actionResult.report.afterOpenTasks);
  assert.equal(updatedTasks.some((task) => task.id === firstTaskId), false);
  assert.equal(updatedTasks.some((task) => task.type === "semantic_uplift_pending"), true);
  assert.equal(updatedOverrideSet.overrides.length, 1);
  assert.match(updatedOverrideSet.hash, /^sha256_[a-f0-9]{64}$/);
  assert.equal(actionReport.afterOpenTasks, updatedTasks.length);
  assert.equal(actionReport.closureReason.length > 0, true);
  assert.equal(closureLog.at(-1).taskId, firstTaskId);
  assert.equal(closureLog.at(-1).status, "closed");
  assert.equal(closureLog.at(-1).closureReason, actionReport.closureReason);
  assert.equal(closureLog.at(-1).taskSnapshot.status, "closed");
  assert.equal(closureLog.at(-1).taskSnapshot.closedReason, actionReport.closureReason);
  assert.equal(closureLog.at(-1).taskSnapshot.closedAt, closureLog.at(-1).closedAt);
  assert.equal(closureLog.at(-1).taskSnapshot.closedBy, "user");
  assert.equal(findTokenConfidence(updatedTokens, "radius_18"), 1);

  const treeEditResponse = await fetch(`${base}/api/workbench/tree-edit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactRoot: "/artifacts/workbench-web-smoke/sample",
      operation: {
        id: "verify_rename_title",
        kind: "rename_node",
        sourceNodeId: "1:3",
        name: "LoginTitleReviewed",
        reason: "Verify Workbench Tree Editor rename writeback."
      }
    })
  });
  assert.equal(treeEditResponse.ok, true);
  const treeEditResult = await treeEditResponse.json();
  assert.equal(treeEditResult.ok, true);
  assert.deepEqual(treeEditResult.report.overrideIds, ["ovr_tree_verify_rename_title"]);
  const treeEditReport = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/tree_edit_report.json`);
  const treeActionReport = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/workbench_tree_edit_action_report.json`);
  const treeEditedOverrideSet = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/override_set.json`);
  const reviewedTree = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/reviewed_normalized_design_ir.json`);
  assert.equal(treeEditReport.validationReport.validOperationIds.includes("verify_rename_title"), true);
  assert.equal(treeActionReport.overrideIds.includes("ovr_tree_verify_rename_title"), true);
  assert.equal(treeEditedOverrideSet.overrides.length, 2);
  assert.equal(findNodeNameBySource(reviewedTree.tree, "1:3"), "LoginTitleReviewed");

  const treeSplitResponse = await fetch(`${base}/api/workbench/tree-edit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactRoot: "/artifacts/workbench-web-smoke/sample",
      operation: {
        id: "verify_split_credentials",
        kind: "split_region",
        sourceRegionId: "n_1_5",
        regionId: "region_workbench_credentials",
        name: "WorkbenchCredentials",
        role: "content",
        sourceNodeIds: ["1:6", "1:9"],
        layout: "column",
        reason: "Verify Workbench Tree Editor split region writeback."
      }
    })
  });
  assert.equal(treeSplitResponse.ok, true);
  const treeSplitResult = await treeSplitResponse.json();
  assert.equal(treeSplitResult.ok, true);
  assert.deepEqual(treeSplitResult.report.overrideIds, ["ovr_tree_verify_split_credentials"]);
  const splitReviewedTree = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/reviewed_normalized_design_ir.json`);
  const splitRegion = findNodeById(splitReviewedTree.tree, "region_workbench_credentials");
  assert.equal(splitRegion.name, "WorkbenchCredentials");
  assert.deepEqual(splitRegion.sourceNodeIds, ["1:6", "1:9"]);

  const treeMoveResponse = await fetch(`${base}/api/workbench/tree-edit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactRoot: "/artifacts/workbench-web-smoke/sample",
      operation: {
        id: "verify_move_divider",
        kind: "move_node",
        sourceNodeId: "1:17",
        targetNormalizedParentId: "region_workbench_credentials",
        reason: "Verify Workbench Tree Editor move node writeback."
      }
    })
  });
  assert.equal(treeMoveResponse.ok, true);
  const treeMoveResult = await treeMoveResponse.json();
  assert.equal(treeMoveResult.ok, true);
  assert.deepEqual(treeMoveResult.report.overrideIds, ["ovr_tree_verify_move_divider"]);
  const movedReviewedTree = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/reviewed_normalized_design_ir.json`);
  const movedRegion = findNodeById(movedReviewedTree.tree, "region_workbench_credentials");
  assert.equal(Boolean(findNodeBySource(movedRegion, "1:17")), true);
  const treeAdvancedOverrideSet = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/override_set.json`);
  assert.equal(treeAdvancedOverrideSet.overrides.some((entry) => entry.id === "ovr_tree_verify_split_credentials" && entry.type === "region_split_override"), true);
  assert.equal(treeAdvancedOverrideSet.overrides.some((entry) => entry.id === "ovr_tree_verify_move_divider" && entry.type === "node_parent_override"), true);

  const studioTokenResponse = await fetch(`${base}/api/workbench/studio-operation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactRoot: "/artifacts/workbench-web-smoke/sample",
      operation: {
        id: "verify_rename_spacing",
        kind: "rename_token",
        tokenType: "spacing",
        from: "space_10",
        to: "space_10_reviewed",
        reason: "Verify Workbench Studio token rename writeback."
      }
    })
  });
  assert.equal(studioTokenResponse.ok, true);
  const studioTokenResult = await studioTokenResponse.json();
  assert.equal(studioTokenResult.ok, true);
  assert.deepEqual(studioTokenResult.report.overrideIds, ["ovr_studio_verify_rename_spacing"]);
  const tokenRegistry = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/token_registry.json`);
  const studioTokenReport = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/studio_report.json`);
  const studioActionReport = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/workbench_studio_action_report.json`);
  const studioTokenOverrideSet = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/override_set.json`);
  const studioReviewedTokens = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/reviewed_inferred_tokens.json`);
  assert.equal(studioTokenReport.validationReport.validOperationIds.includes("verify_rename_spacing"), true);
  assert.equal(studioActionReport.overrideIds.includes("ovr_studio_verify_rename_spacing"), true);
  assert.equal(studioTokenOverrideSet.overrides.some((entry) => entry.id === "ovr_studio_verify_rename_spacing" && entry.type === "token_rename_override"), true);
  assert.equal(findTokenConfidence(studioReviewedTokens, "space_10_reviewed"), 1);
  assert.equal(findTokenConfidence(studioReviewedTokens, "space_10"), undefined);
  assert.equal(tokenRegistry.tokens.some((token) => token.type === "spacing" && token.name === "space_10_reviewed"), true);

  const studioTokenMergeResponse = await fetch(`${base}/api/workbench/studio-operation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactRoot: "/artifacts/workbench-web-smoke/sample",
      operation: {
        id: "verify_merge_spacing",
        kind: "merge_tokens",
        tokenType: "spacing",
        sourceTokenNames: ["space_12", "space_16"],
        canonicalTokenName: "space_body_gap",
        reason: "Verify Workbench Studio token merge writeback."
      }
    })
  });
  assert.equal(studioTokenMergeResponse.ok, true);
  const studioTokenMergeResult = await studioTokenMergeResponse.json();
  assert.equal(studioTokenMergeResult.ok, true);
  assert.deepEqual(studioTokenMergeResult.report.overrideIds, ["ovr_studio_verify_merge_spacing"]);
  const mergedTokens = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/reviewed_inferred_tokens.json`);
  const mergedTokenRegistry = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/token_registry.json`);
  const mergedOverrideSet = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/override_set.json`);
  assert.equal(mergedOverrideSet.overrides.some((entry) => entry.id === "ovr_studio_verify_merge_spacing" && entry.type === "token_merge_override"), true);
  assert.equal(findTokenConfidence(mergedTokens, "space_body_gap"), 1);
  assert.equal(findTokenConfidence(mergedTokens, "space_12"), undefined);
  assert.equal(mergedTokenRegistry.tokens.some((token) => token.type === "spacing" && token.name === "space_body_gap"), true);

  const studioTokenSplitResponse = await fetch(`${base}/api/workbench/studio-operation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactRoot: "/artifacts/workbench-web-smoke/sample",
      operation: {
        id: "verify_split_radius",
        kind: "split_token",
        tokenType: "radius",
        sourceTokenName: "radius_16",
        tokens: [
          { name: "radius_input_top", value: 16, sourceNodeIds: ["1:7"] },
          { name: "radius_input_bottom", value: 16, sourceNodeIds: ["1:10"] }
        ],
        reason: "Verify Workbench Studio token split writeback."
      }
    })
  });
  assert.equal(studioTokenSplitResponse.ok, true);
  const studioTokenSplitResult = await studioTokenSplitResponse.json();
  assert.equal(studioTokenSplitResult.ok, true);
  assert.deepEqual(studioTokenSplitResult.report.overrideIds, ["ovr_studio_verify_split_radius"]);
  const splitTokens = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/reviewed_inferred_tokens.json`);
  const splitOverrideSet = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/override_set.json`);
  assert.equal(splitOverrideSet.overrides.some((entry) => entry.id === "ovr_studio_verify_split_radius" && entry.type === "token_split_override"), true);
  assert.equal(findTokenConfidence(splitTokens, "radius_16"), undefined);
  assert.equal(findTokenConfidence(splitTokens, "radius_input_top"), 1);
  assert.equal(findTokenConfidence(splitTokens, "radius_input_bottom"), 1);

  const studioAssetResponse = await fetch(`${base}/api/workbench/studio-operation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactRoot: "/artifacts/workbench-web-smoke/sample",
      operation: {
        id: "verify_asset_strategy",
        kind: "set_asset_strategy",
        assetId: "asset_1_17",
        strategy: "decorative_slice",
        sourceName: "Workbench Divider Slice",
        format: "png",
        path: "assets/slices/divider_dot_workbench.png",
        scale: 3,
        cropBounds: { x: 185, y: 622, w: 20, h: 20 },
        excludeTextNodes: true,
        reason: "Verify Workbench Studio asset strategy writeback."
      }
    })
  });
  assert.equal(studioAssetResponse.ok, true);
  const studioAssetResult = await studioAssetResponse.json();
  assert.equal(studioAssetResult.ok, true);
  assert.deepEqual(studioAssetResult.report.overrideIds, ["ovr_studio_verify_asset_strategy"]);
  const finalAssets = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/final_asset_manifest.json`);
  const reviewedAssets = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/reviewed_asset_manifest.json`);
  const assetOverrideSet = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/override_set.json`);
  const assetOverride = assetOverrideSet.overrides.find((entry) => entry.id === "ovr_studio_verify_asset_strategy");
  assert.equal(assetOverride.type, "asset_strategy_override");
  assert.equal(assetOverride.payload.sourceName, "Workbench Divider Slice");
  assert.equal(findAssetById(finalAssets, "asset_1_17").strategy, "decorative_slice");
  assert.equal(findAssetById(finalAssets, "asset_1_17").sourceName, "Workbench Divider Slice");
  const reviewedDividerAsset = findAssetById(reviewedAssets, "asset_1_17");
  assert.equal(reviewedDividerAsset.sourceName, "Workbench Divider Slice");
  assert.equal(reviewedDividerAsset.path, "assets/slices/divider_dot_workbench.png");
  assert.equal(reviewedDividerAsset.scale, 3);
  assert.deepEqual(reviewedDividerAsset.cropBounds, { x: 185, y: 622, w: 20, h: 20 });
  assert.equal(reviewedDividerAsset.excludeTextNodes, true);

  const studioI18nResponse = await fetch(`${base}/api/workbench/studio-operation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactRoot: "/artifacts/workbench-web-smoke/sample",
      operation: {
        id: "verify_rename_title_key",
        kind: "rename_i18n_key",
        sourceNodeId: "1:3",
        key: "loginTitle",
        description: "Reviewed login title.",
        reason: "Verify Workbench Studio i18n key writeback."
      }
    })
  });
  assert.equal(studioI18nResponse.ok, true);
  const studioI18nResult = await studioI18nResponse.json();
  assert.equal(studioI18nResult.ok, true);
  assert.deepEqual(studioI18nResult.report.overrideIds, ["ovr_studio_verify_rename_title_key"]);
  const finalI18n = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/final_i18n_manifest.json`);
  const reviewedI18n = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/reviewed_i18n_manifest.json`);
  const finalArb = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/arb/app_en.arb`);
  const reviewedArb = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/reviewed_arb/app_en.arb`);
  const i18nOverrideSet = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/override_set.json`);
  assert.equal(i18nOverrideSet.overrides.some((entry) => entry.id === "ovr_studio_verify_rename_title_key" && entry.type === "i18n_key_override"), true);
  assert.equal(findMessageByKey(finalI18n, "loginTitle").value, "Welcome back");
  assert.equal(findMessageByKey(reviewedI18n, "loginTitle").description, "Reviewed login title.");
  assert.equal(finalArb.loginTitle, "Welcome back");
  assert.equal(reviewedArb.loginTitle, "Welcome back");

  const studioPlaceholderResponse = await fetch(`${base}/api/workbench/studio-operation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactRoot: "/artifacts/workbench-web-smoke/sample",
      operation: {
        id: "verify_title_placeholder",
        kind: "define_i18n_placeholder",
        sourceNodeId: "1:3",
        placeholder: {
          name: "titleText",
          type: "String",
          example: "Welcome back",
          description: "Resolved login title text."
        },
        reason: "Verify Workbench Studio i18n placeholder writeback."
      }
    })
  });
  assert.equal(studioPlaceholderResponse.ok, true);
  const studioPlaceholderResult = await studioPlaceholderResponse.json();
  assert.equal(studioPlaceholderResult.ok, true);
  assert.deepEqual(studioPlaceholderResult.report.overrideIds, ["ovr_studio_verify_title_placeholder"]);
  const placeholderI18n = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/final_i18n_manifest.json`);
  const placeholderArb = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/arb/app_en.arb`);
  const placeholderOverrideSet = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/override_set.json`);
  assert.equal(placeholderOverrideSet.overrides.some((entry) => entry.id === "ovr_studio_verify_title_placeholder" && entry.type === "i18n_key_override"), true);
  assert.equal(findMessageByKey(placeholderI18n, "loginTitle").placeholders.titleText.type, "String");
  assert.equal(placeholderArb["@loginTitle"].placeholders.titleText.example, "Welcome back");

  const studioNonI18nResponse = await fetch(`${base}/api/workbench/studio-operation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactRoot: "/artifacts/workbench-web-smoke/sample",
      operation: {
        id: "verify_subtitle_non_i18n",
        kind: "mark_non_i18n",
        messageKey: "subtitle",
        reason: "Verify Workbench Studio non-i18n writeback."
      }
    })
  });
  assert.equal(studioNonI18nResponse.ok, true);
  const studioNonI18nResult = await studioNonI18nResponse.json();
  assert.equal(studioNonI18nResult.ok, true);
  assert.deepEqual(studioNonI18nResult.report.overrideIds, ["ovr_studio_verify_subtitle_non_i18n"]);
  const nonI18nFinal = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/final_i18n_manifest.json`);
  const nonI18nArb = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/arb/app_en.arb`);
  const nonI18nOverrideSet = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/override_set.json`);
  assert.equal(nonI18nOverrideSet.overrides.some((entry) => entry.id === "ovr_studio_verify_subtitle_non_i18n" && entry.type === "i18n_key_override"), true);
  assert.equal(Boolean(findMessageByKey(nonI18nFinal, "subtitle")), false);
  assert.equal(nonI18nArb.subtitle, undefined);

  const componentApproveResponse = await fetch(`${base}/api/workbench/studio-operation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactRoot: "/artifacts/workbench-web-smoke/sample",
      operation: {
        id: "verify_component_approve",
        kind: "approve_component",
        componentId: "cmp_workbench_submit",
        name: "WorkbenchSubmit",
        instances: ["1:12"],
        allowSingleUse: true,
        reason: "Verify Workbench Component Studio approval writeback."
      }
    })
  });
  assert.equal(componentApproveResponse.ok, true);
  const componentApproveResult = await componentApproveResponse.json();
  assert.equal(componentApproveResult.ok, true);
  assert.deepEqual(componentApproveResult.report.overrideIds, ["ovr_studio_verify_component_approve"]);

  const componentPropResponse = await fetch(`${base}/api/workbench/studio-operation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactRoot: "/artifacts/workbench-web-smoke/sample",
      operation: {
        id: "verify_component_prop",
        kind: "define_component_prop",
        componentId: "cmp_workbench_submit",
        prop: { name: "label", type: "text", sourceSelector: "sourceNodeId:1:14" },
        reason: "Verify Workbench Component Studio prop writeback."
      }
    })
  });
  assert.equal(componentPropResponse.ok, true);
  const componentPropResult = await componentPropResponse.json();
  assert.equal(componentPropResult.ok, true);
  assert.deepEqual(componentPropResult.report.overrideIds, ["ovr_studio_verify_component_prop"]);

  const componentVariantResponse = await fetch(`${base}/api/workbench/studio-operation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactRoot: "/artifacts/workbench-web-smoke/sample",
      operation: {
        id: "verify_component_variant",
        kind: "define_component_variant",
        componentId: "cmp_workbench_submit",
        variant: { name: "state", values: ["default", "disabled"] },
        reason: "Verify Workbench Component Studio variant writeback."
      }
    })
  });
  assert.equal(componentVariantResponse.ok, true);
  const componentVariantResult = await componentVariantResponse.json();
  assert.equal(componentVariantResult.ok, true);
  assert.deepEqual(componentVariantResult.report.overrideIds, ["ovr_studio_verify_component_variant"]);

  const componentMappingResponse = await fetch(`${base}/api/workbench/studio-operation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactRoot: "/artifacts/workbench-web-smoke/sample",
      operation: {
        id: "verify_component_mapping",
        kind: "map_flutter_component",
        componentId: "cmp_workbench_submit",
        flutter: {
          import: "package:app/ui/workbench_submit.dart",
          constructor: "WorkbenchSubmit.primary",
          props: { label: { from: "prop.label", i18n: true } }
        },
        reason: "Verify Workbench Component Studio Flutter mapping writeback."
      }
    })
  });
  assert.equal(componentMappingResponse.ok, true);
  const componentMappingResult = await componentMappingResponse.json();
  assert.equal(componentMappingResult.ok, true);
  assert.deepEqual(componentMappingResult.report.overrideIds, ["ovr_studio_verify_component_mapping"]);
  const componentRegistry = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/component_registry.json`);
  const componentOverrideSet = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/override_set.json`);
  const workbenchSubmit = findComponentById(componentRegistry, "cmp_workbench_submit");
  assert.equal(componentOverrideSet.overrides.some((entry) => entry.id === "ovr_studio_verify_component_mapping" && entry.type === "flutter_component_mapping_override"), true);
  assert.equal(workbenchSubmit.name, "WorkbenchSubmit");
  assert.equal(workbenchSubmit.props[0].sourceSelector, "sourceNodeId:1:14");
  assert.equal(workbenchSubmit.variants[0].values.includes("disabled"), true);
  assert.equal(workbenchSubmit.flutter.constructor, "WorkbenchSubmit.primary");

  const projectPath = resolve(root, "target-flutter-project");
  const codegenReviewResponse = await fetch(`${base}/api/workbench/codegen-review`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactRoot: "/artifacts/workbench-web-smoke/sample",
      projectPath,
      projectId: "workbench_smoke",
      normalizedIrId: "nir_workbench_smoke",
      allowLowVisualScore: true
    })
  });
  assert.equal(codegenReviewResponse.ok, true);
  const codegenReviewResult = await codegenReviewResponse.json();
  assert.equal(codegenReviewResult.ok, true);
  assert.equal(codegenReviewResult.report.projectPath, projectPath);
  assert.equal(codegenReviewResult.report.filesToCreate > 0, true);
  const codegenReview = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/codegen_review.json`);
  const codegenReviewReport = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/workbench_codegen_review_report.json`);
  const codegenAssetsToAdd = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/assets_to_add.json`);
  const codegenArbPatch = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/arb_patch.json`);
  const codegenPubspecPatch = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/pubspec_patch.json`);
  const codegenMergeReport = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/merge_report.json`);
  const generatedMain = await fetchText(`${base}/artifacts/workbench-web-smoke/sample/generated/lib/main.dart`);
  assert.equal(codegenReview.projectId, "workbench_smoke");
  assert.equal(codegenReviewReport.buildId, codegenReview.buildId);
  assert.equal(codegenReview.format.status, "success");
  assert.equal(codegenReview.format.source, "flutter_preview_format_report.json");
  assert.equal(codegenReview.analyze.source, "flutter_preview_analyze_report.json");
  assert.equal(Array.isArray(codegenAssetsToAdd), true);
  assert.equal(codegenAssetsToAdd.length, codegenReview.assetsToAdd.length);
  assert.equal(Array.isArray(codegenArbPatch.keysToAdd), true);
  assert.equal(codegenArbPatch.keysToAdd.length, codegenReview.arbKeysToAdd.length);
  assert.equal(typeof codegenPubspecPatch.patch, "string");
  assert.match(codegenPubspecPatch.patch, /pubspec.yaml/);
  assert.equal(Array.isArray(codegenMergeReport.files), true);
  assert.equal(codegenReview.generatedWidgets.some((widget) => widget.strategy === "semantic_page_facade"), true);
  assert.equal(Array.isArray(codegenReview.fallbackRegions), true);
  assert.equal(codegenReview.unresolvedReviewTasks.length > 0, true);
  assert.equal(codegenReview.manualOverrideSummary.active > 0, true);
  assert.equal(codegenReviewReport.generatedWidgets, codegenReview.generatedWidgets.length);
  assert.equal(codegenReviewReport.fallbackRegions, codegenReview.fallbackRegions.length);
  assert.equal(codegenReviewReport.unresolvedReviewTasks, codegenReview.unresolvedReviewTasks.length);
  assert.equal(codegenReviewReport.manualOverrides, codegenReview.manualOverrideSummary.active);
  assert.match(generatedMain, /@uxc-generated:start/);

  const codegenWriteResponse = await fetch(`${base}/api/workbench/codegen-write`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactRoot: "/artifacts/workbench-web-smoke/sample",
      projectPath,
      dryRun: true,
      allowBlocked: true
    })
  });
  assert.equal(codegenWriteResponse.ok, true);
  const codegenWriteResult = await codegenWriteResponse.json();
  assert.equal(codegenWriteResult.ok, true);
  assert.equal(codegenWriteResult.report.mode, "dry_run");
  assert.equal(codegenWriteResult.report.wrote, false);
  const projectWriteReport = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/project_write_report.json`);
  const workbenchWriteReport = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/workbench_codegen_write_report.json`);
  assert.equal(projectWriteReport.mode, "dry_run");
  assert.equal(workbenchWriteReport.buildId, codegenReview.buildId);
  assert.equal(projectWriteReport.files.some((file) => file.status === "created"), true);

  writeTextFile(resolve(projectPath, "lib/features/login_mobile/presentation/pages/login_mobile_page.dart"), "class HandWrittenLoginPage {}\n");
  const manualScaffoldConflictResponse = await fetch(`${base}/api/workbench/codegen-review`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactRoot: "/artifacts/workbench-web-smoke/sample",
      projectPath,
      projectId: "workbench_smoke",
      normalizedIrId: "nir_workbench_smoke",
      allowLowVisualScore: true
    })
  });
  assert.equal(manualScaffoldConflictResponse.ok, true);
  const manualScaffoldConflictResult = await manualScaffoldConflictResponse.json();
  assert.equal(manualScaffoldConflictResult.ok, true);
  assert.equal(manualScaffoldConflictResult.report.gateStatus, "blocked");
  const manualScaffoldConflictReview = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/codegen_review.json`);
  assert.equal(
    manualScaffoldConflictReview.gates.blockers.some(
      (blocker) =>
        blocker.type === "manual_file_conflict" &&
        blocker.filePath === "lib/features/login_mobile/presentation/pages/login_mobile_page.dart"
    ),
    true
  );

  writeFileSync(
    resolve(sampleDir, "flutter_preview_format_report.json"),
    `${JSON.stringify(
      {
        status: "failed",
        command: "dart format lib test",
        exitCode: 1,
        stderr: "Could not format because generated_page.dart has a syntax error."
      },
      null,
      2
    )}\n`
  );
  const blockedFormatReviewResponse = await fetch(`${base}/api/workbench/codegen-review`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactRoot: "/artifacts/workbench-web-smoke/sample",
      projectPath,
      allowLowVisualScore: true
    })
  });
  assert.equal(blockedFormatReviewResponse.ok, true);
  const blockedFormatReviewResult = await blockedFormatReviewResponse.json();
  assert.equal(blockedFormatReviewResult.ok, true);
  assert.equal(blockedFormatReviewResult.report.gateStatus, "blocked");
  assert.equal(blockedFormatReviewResult.report.formatStatus, "failed");
  assert.equal(blockedFormatReviewResult.report.formatSource, "flutter_preview_format_report.json");
  const blockedFormatReview = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/codegen_review.json`);
  assert.equal(blockedFormatReview.format.status, "failed");
  assert.equal(blockedFormatReview.gates.blockers.some((blocker) => blocker.type === "dart_format_failed"), true);
  writeFileSync(
    resolve(sampleDir, "flutter_preview_format_report.json"),
    `${JSON.stringify(
      {
        status: "success",
        command: "dart format lib test",
        stdout: "Formatted 4 files (0 changed) in 0.01 seconds.",
        stderr: ""
      },
      null,
      2
    )}\n`
  );

  writeFileSync(
    resolve(sampleDir, "flutter_analyze_report.json"),
    `${JSON.stringify(
      {
        version: "0.1.0",
        generatedAt: "2026-07-04T00:00:00.000Z",
        errors: 1,
        warnings: 2,
        diagnostics: [{ severity: "ERROR", message: "Undefined name 'brokenWidget'." }]
      },
      null,
      2
    )}\n`
  );
  const blockedAnalyzeReviewResponse = await fetch(`${base}/api/workbench/codegen-review`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactRoot: "/artifacts/workbench-web-smoke/sample",
      projectPath,
      allowLowVisualScore: true
    })
  });
  assert.equal(blockedAnalyzeReviewResponse.ok, true);
  const blockedAnalyzeReviewResult = await blockedAnalyzeReviewResponse.json();
  assert.equal(blockedAnalyzeReviewResult.ok, true);
  assert.equal(blockedAnalyzeReviewResult.report.gateStatus, "blocked");
  assert.equal(blockedAnalyzeReviewResult.report.analyzeErrors, 1);
  assert.equal(blockedAnalyzeReviewResult.report.analyzeSource, "flutter_analyze_report.json");
  const blockedAnalyzeReview = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/codegen_review.json`);
  assert.equal(blockedAnalyzeReview.analyze.errors, 1);
  assert.equal(blockedAnalyzeReview.analyze.source, "flutter_analyze_report.json");
  assert.equal(blockedAnalyzeReview.gates.blockers.some((blocker) => blocker.type === "flutter_analyze_failed"), true);
  const blockedAnalyzeWriteResponse = await fetch(`${base}/api/workbench/codegen-write`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactRoot: "/artifacts/workbench-web-smoke/sample",
      projectPath,
      dryRun: true
    })
  });
  assert.equal(blockedAnalyzeWriteResponse.ok, true);
  const blockedAnalyzeWriteResult = await blockedAnalyzeWriteResponse.json();
  assert.equal(blockedAnalyzeWriteResult.ok, true);
  assert.equal(blockedAnalyzeWriteResult.report.wrote, false);
  assert.equal(blockedAnalyzeWriteResult.report.blockers.some((blocker) => blocker.type === "flutter_analyze_failed"), true);

  writeSyntheticVisualDiff(sampleDir);
  const issueRepairResponse = await fetch(`${base}/api/workbench/diff-repair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactRoot: "/artifacts/workbench-web-smoke/sample",
      repairKind: "issue_asset_slice",
      issueId: "diff_verify_region"
    })
  });
  assert.equal(issueRepairResponse.ok, true);
  const issueRepairResult = await issueRepairResponse.json();
  assert.equal(issueRepairResult.ok, true);
  assert.equal(issueRepairResult.report.overrideId, "ovr_diff_diff_verify_region_asset_slice");
  const issueRepairReport = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/workbench_diff_repair_report.json`);
  const issueRepairPatch = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/repair_patch.json`);
  const issueRepairLog = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/repair_iteration_log.json`);
  const issueRepairTasks = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/review_tasks.json`);
  const issueRepairOverrideSet = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/override_set.json`);
  assert.equal(issueRepairReport.repairKind, "issue_asset_slice");
  assert.equal(issueRepairReport.repairPatchPath, "repair_patch.json");
  assert.equal(issueRepairPatch.overrideId, "ovr_diff_diff_verify_region_asset_slice");
  assert.equal(issueRepairPatch.status, "applied");
  assert.equal(issueRepairPatch.rollback.type, "disable_override");
  assert.equal(issueRepairPatch.afterOverride.payload.strategy, "asset_slice");
  assert.equal(issueRepairLog.iterations.some((entry) => entry.event === "applied" && entry.overrideId === "ovr_diff_diff_verify_region_asset_slice"), true);
  assert.equal(issueRepairOverrideSet.overrides.some((entry) => entry.id === "ovr_diff_diff_verify_region_asset_slice" && entry.type === "render_strategy_override"), true);
  assert.equal(issueRepairTasks.some((task) => task.id === "task_visual_diff_page"), true);
  assert.equal(issueRepairTasks.some((task) => task.id === "task_visual_diff_verify_region"), false);

  const issueRollbackResponse = await fetch(`${base}/api/workbench/diff-repair-rollback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactRoot: "/artifacts/workbench-web-smoke/sample",
      overrideId: "ovr_diff_diff_verify_region_asset_slice"
    })
  });
  assert.equal(issueRollbackResponse.ok, true);
  const issueRollbackResult = await issueRollbackResponse.json();
  assert.equal(issueRollbackResult.ok, true);
  assert.equal(issueRollbackResult.report.rollbackType, "disable_override");
  const issueRollbackPatch = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/repair_patch.json`);
  const issueRollbackTasks = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/review_tasks.json`);
  const issueRollbackOverrideSet = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/override_set.json`);
  const disabledIssueOverride = issueRollbackOverrideSet.overrides.find((entry) => entry.id === "ovr_diff_diff_verify_region_asset_slice");
  assert.equal(issueRollbackPatch.status, "rolled_back");
  assert.equal(disabledIssueOverride.status, "disabled");
  assert.equal(issueRollbackTasks.some((task) => task.id === "task_visual_diff_verify_region"), true);

  const issueRepairAgainResponse = await fetch(`${base}/api/workbench/diff-repair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactRoot: "/artifacts/workbench-web-smoke/sample",
      repairKind: "issue_asset_slice",
      issueId: "diff_verify_region"
    })
  });
  assert.equal(issueRepairAgainResponse.ok, true);
  const issueRepairAgainResult = await issueRepairAgainResponse.json();
  assert.equal(issueRepairAgainResult.ok, true);
  assert.equal(issueRepairAgainResult.report.overrideId, "ovr_diff_diff_verify_region_asset_slice");
  const issueRepairAgainOverrideSet = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/override_set.json`);
  const activeIssueOverride = issueRepairAgainOverrideSet.overrides.find((entry) => entry.id === "ovr_diff_diff_verify_region_asset_slice");
  assert.equal(activeIssueOverride.status, "active");

  writeSyntheticTextVisualDiff(sampleDir);
  const textRepairResponse = await fetch(`${base}/api/workbench/diff-repair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactRoot: "/artifacts/workbench-web-smoke/sample",
      repairKind: "issue_asset_slice",
      issueId: "diff_text_baseline"
    })
  });
  assert.equal(textRepairResponse.ok, true);
  const textRepairResult = await textRepairResponse.json();
  assert.equal(textRepairResult.ok, true);
  assert.equal(textRepairResult.report.overrideId, "ovr_diff_diff_text_baseline_text_calibration");
  const textRepairPatch = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/repair_patch.json`);
  const textRepairTasks = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/review_tasks.json`);
  const textRepairOverrideSet = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/override_set.json`);
  assert.equal(textRepairPatch.afterOverride.type, "text_calibration_override");
  assert.equal(textRepairPatch.afterOverride.target.sourceNodeId, "1:3");
  assert.equal(textRepairPatch.afterOverride.payload.baselineShift, -1);
  assert.equal(textRepairPatch.afterOverride.payload.diffIssueId, "diff_text_baseline");
  assert.equal(textRepairOverrideSet.overrides.some((entry) => entry.id === "ovr_diff_diff_text_baseline_text_calibration" && entry.type === "text_calibration_override"), true);
  assert.equal(textRepairTasks.some((task) => task.id === "task_visual_diff_text_baseline"), false);

  const pageRepairResponse = await fetch(`${base}/api/workbench/diff-repair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactRoot: "/artifacts/workbench-web-smoke/sample",
      repairKind: "page_frame_fallback",
      issueId: "page"
    })
  });
  assert.equal(pageRepairResponse.ok, true);
  const pageRepairResult = await pageRepairResponse.json();
  assert.equal(pageRepairResult.ok, true);
  assert.equal(pageRepairResult.report.overrideId, "ovr_diff_page_frame_fallback");
  const pageRepairTasks = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/review_tasks.json`);
  const pageRepairOverrideSet = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/override_set.json`);
  assert.equal(pageRepairOverrideSet.overrides.some((entry) => entry.id === "ovr_diff_page_frame_fallback" && entry.type === "render_strategy_override"), true);
  assert.equal(pageRepairTasks.some((task) => task.type === "visual_diff_failed"), false);
  writeSyntheticVisualDiff(sampleDir);

  const studioRollbackResponse = await fetch(`${base}/api/workbench/studio-rollback`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactRoot: "/artifacts/workbench-web-smoke/sample",
      overrideIds: ["ovr_studio_verify_component_mapping"]
    })
  });
  assert.equal(studioRollbackResponse.ok, true);
  const studioRollbackResult = await studioRollbackResponse.json();
  assert.equal(studioRollbackResult.ok, true);
  assert.deepEqual(studioRollbackResult.report.rollbackOverrideIds, ["ovr_studio_verify_component_mapping"]);
  const studioRollbackReport = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/workbench_studio_rollback_report.json`);
  const studioRollbackOverrideSet = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/override_set.json`);
  const studioRollbackRegistry = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/component_registry.json`);
  const disabledStudioOverride = studioRollbackOverrideSet.overrides.find((entry) => entry.id === "ovr_studio_verify_component_mapping");
  const rolledBackComponent = findComponentById(studioRollbackRegistry, "cmp_workbench_submit");
  assert.equal(studioRollbackReport.rollbackOverrideIds.includes("ovr_studio_verify_component_mapping"), true);
  assert.equal(disabledStudioOverride.status, "disabled");
  assert.equal(rolledBackComponent.flutter, undefined);

  const nextRawPath = resolve(root, "next_raw_figma_scene.json");
  const nextRaw = JSON.parse(readFileSync(resolve(sampleDir, "raw_figma_scene.json"), "utf8"));
  nextRaw.source.version = "workbench_smoke_next";
  renameRawNode(nextRaw.root, "1:3", "2:3", { name: "Login Heading" });
  removeRawNode(nextRaw.root, "1:17");
  setRawSolidFillColor(nextRaw.root, "1:13", { r: 0.1686, g: 0.4275, b: 0.902 });
  writeFileSync(nextRawPath, `${JSON.stringify(nextRaw, null, 2)}\n`);
  const syncRemapResponse = await fetch(`${base}/api/workbench/sync-remap`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactRoot: "/artifacts/workbench-web-smoke/sample",
      newRawPath: nextRawPath
    })
  });
  assert.equal(syncRemapResponse.ok, true);
  const syncRemapResult = await syncRemapResponse.json();
  assert.equal(syncRemapResult.ok, true);
  assert.equal(syncRemapResult.report.reappliedOverrides > 0, true);
  assert.equal(syncRemapResult.report.staleOverrides > 0, true);
  const syncRemapReport = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/workbench_sync_remap_report.json`);
  const nodeRemapReport = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/node_remap_report.json`);
  const tokenMigrationReport = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/token_migration_report.json`);
  const reappliedOverrides = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/reapplied_overrides.json`);
  const staleOverrides = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/stale_overrides.json`);
  const reviewTasksAfterSync = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/review_tasks.json`);
  assert.equal(syncRemapReport.newSnapshotId, "workbench_smoke_next");
  assert.notEqual(syncRemapReport.tokenMigrationStatus, "unchanged");
  assert.equal(syncRemapReport.visualDiffChange.status, "missing_new");
  assert.equal(syncRemapReport.visualDiffChange.oldVisualScore, 0.82);
  assert.equal(nodeRemapReport.matches.some((entry) => entry.oldSourceNodeId === "1:3" && entry.newSourceNodeId === "2:3"), true);
  assert.equal(nodeRemapReport.matches.some((entry) => entry.oldSourceNodeId === "1:13" && entry.changeType === "token_value_change"), true);
  assert.equal(nodeRemapReport.visualDiffChange.status, "missing_new");
  assert.notEqual(tokenMigrationReport.status, "unchanged");
  assert.equal(tokenMigrationReport.summary.valueChanged > 0, true);
  assert.equal(reappliedOverrides.some((entry) => entry.overrideId === "ovr_tree_verify_rename_title"), true);
  assert.equal(staleOverrides.length > 0, true);
  assert.equal(reviewTasksAfterSync.some((task) => task.id.startsWith("task_incremental_remap_")), true);
  const staleGateResponse = await fetch(`${base}/api/workbench/codegen-review`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactRoot: "/artifacts/workbench-web-smoke/sample",
      projectPath,
      allowLowVisualScore: true
    })
  });
  assert.equal(staleGateResponse.ok, true);
  const staleGateResult = await staleGateResponse.json();
  assert.equal(staleGateResult.ok, true);
  assert.equal(staleGateResult.report.gateStatus, "blocked");
  const staleGateReview = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/codegen_review.json`);
  assert.equal(staleGateReview.gates.blockers.some((blocker) => blocker.type === "stale_override_unresolved"), true);
  const overrideHistory = readNdjson(sampleDir, "override_history.ndjson");
  assert.equal(overrideHistory.some((entry) => entry.source === "review_task_action" && entry.overrideId === actionResult.report.overrideId && entry.event === "added"), true);
  assert.equal(overrideHistory.some((entry) => entry.source === "tree_edit" && entry.overrideId === "ovr_tree_verify_rename_title" && entry.event === "added"), true);
  assert.equal(overrideHistory.some((entry) => entry.source === "studio_operation" && entry.overrideId === "ovr_studio_verify_rename_spacing" && entry.event === "added"), true);
  assert.equal(overrideHistory.some((entry) => entry.source === "studio_rollback" && entry.overrideId === "ovr_studio_verify_component_mapping" && entry.event === "disabled"), true);
  assert.equal(overrideHistory.some((entry) => entry.source === "diff_repair" && entry.overrideId === "ovr_diff_diff_text_baseline_text_calibration" && entry.event === "added"), true);
  assert.equal(overrideHistory.some((entry) => entry.source === "diff_repair_rollback" && entry.overrideId === "ovr_diff_diff_verify_region_asset_slice" && entry.event === "disabled"), true);
  assert.equal(overrideHistory.some((entry) => entry.source === "sync_remap" && entry.overrideId === "ovr_tree_verify_rename_title" && entry.event === "updated"), true);
  assert.equal(overrideHistory.every((entry) => entry.timestamp && entry.actor && entry.previousHash !== undefined && entry.nextHash), true);

  console.log("workbench-web verification passed");
} finally {
  server.kill("SIGTERM");
}

function readJson(base, file) {
  return JSON.parse(readFileSync(resolve(base, file), "utf8"));
}

function readNdjson(base, file) {
  const path = resolve(base, file);
  assert.equal(existsSync(path), true, `Missing ${file}`);
  return readFileSync(path, "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

function writeJson(base, file, value) {
  writeFileSync(resolve(base, file), `${JSON.stringify(value, null, 2)}\n`);
}

function writeSyntheticVisualDiff(base) {
  const report = {
    version: "0.1.0",
    generatedAt: "2026-07-04T00:00:00.000Z",
    inputs: {
      reference: "figma_reference.png",
      candidate: "flutter_preview.png",
      heatmap: "diff_heatmap.png"
    },
    environment: {
      viewport: { width: 390, height: 844 },
      dpr: 1,
      fonts: ["Inter"],
      flutterVersion: "Flutter smoke",
      themeBrightness: "light",
      locale: "en",
      textScaleFactor: 1,
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      renderer: "png_pixelmatch"
    },
    page: {
      pass: false,
      score: {
        visualScore: 0.82,
        pixelDiffRatio: 0.18,
        diffPixels: 59248,
        totalPixels: 329160
      },
      threshold: {
        visualScore: 0.98,
        pixelDiffRatio: 0.02
      }
    },
    issues: [
      {
        issueId: "diff_verify_region",
        type: "pixel_diff_region",
        sourceNodeId: "1:17",
        bounds: { x: 185, y: 622, w: 20, h: 20 },
        score: {
          visualScore: 0.65,
          pixelDiffRatio: 0.35,
          diffPixels: 140,
          totalPixels: 400
        },
        suggestedFixes: [{ type: "render_strategy_override", payload: { strategy: "asset_slice" } }]
      }
    ],
    warnings: []
  };
  writeFileSync(resolve(base, "visual_diff_report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function writeSyntheticTextVisualDiff(base) {
  const report = {
    version: "0.1.0",
    generatedAt: "2026-07-04T00:00:00.000Z",
    inputs: {
      reference: "figma_reference.png",
      candidate: "flutter_preview.png",
      heatmap: "diff_heatmap.png"
    },
    environment: {
      viewport: { width: 390, height: 844 },
      dpr: 1,
      fonts: ["Inter"],
      flutterVersion: "Flutter smoke",
      themeBrightness: "light",
      locale: "en",
      textScaleFactor: 1,
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
      renderer: "png_pixelmatch"
    },
    page: {
      pass: false,
      score: {
        visualScore: 0.91,
        pixelDiffRatio: 0.09,
        diffPixels: 29624,
        totalPixels: 329160
      },
      threshold: {
        visualScore: 0.98,
        pixelDiffRatio: 0.02
      }
    },
    issues: [
      {
        issueId: "diff_text_baseline",
        type: "pixel_diff_region",
        sourceNodeId: "1:3",
        bounds: { x: 24, y: 96, w: 220, h: 38 },
        score: {
          visualScore: 0.92,
          pixelDiffRatio: 0.08,
          diffPixels: 670,
          totalPixels: 8360
        },
        suggestedFixes: [{ type: "text_calibration_override", payload: { baselineShift: -1, lineHeightDelta: 1 } }]
      }
    ],
    warnings: []
  };
  writeFileSync(resolve(base, "visual_diff_report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

function writeTextFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function renameRawNode(root, id, newId, patch = {}) {
  const node = findRawNode(root, id);
  assert.ok(node, `Missing raw node ${id}`);
  node.id = newId;
  Object.assign(node, patch);
}

function removeRawNode(root, id) {
  if (!root.children) return false;
  const index = root.children.findIndex((child) => child.id === id);
  if (index !== -1) {
    root.children.splice(index, 1);
    return true;
  }
  return root.children.some((child) => removeRawNode(child, id));
}

function setRawSolidFillColor(root, id, color) {
  const node = findRawNode(root, id);
  assert.ok(node, `Missing raw node ${id}`);
  assert.equal(Array.isArray(node.fills), true, `Raw node ${id} has no fills`);
  assert.equal(node.fills[0]?.type, "SOLID", `Raw node ${id} first fill is not SOLID`);
  node.fills[0].color = color;
}

function findRawNode(root, id) {
  if (root.id === id) return root;
  for (const child of root.children ?? []) {
    const match = findRawNode(child, id);
    if (match) return match;
  }
  return undefined;
}

async function waitForServer() {
  for (let index = 0; index < 40; index += 1) {
    try {
      const response = await fetch("http://127.0.0.1:8798/apps/workbench-web/");
      if (response.ok) return;
    } catch {
      // retry
    }
    await new Promise((resolveTimeout) => setTimeout(resolveTimeout, 250));
  }
  const stdout = await streamText(server.stdout);
  const stderr = await streamText(server.stderr);
  throw new Error(`workbench server did not start\nstdout:\n${stdout}\nstderr:\n${stderr}`);
}

async function fetchText(url) {
  const response = await fetch(url);
  assert.equal(response.ok, true, `Fetch failed: ${url}`);
  return await response.text();
}

async function fetchJson(url) {
  const response = await fetch(url);
  assert.equal(response.ok, true, `Fetch failed: ${url}`);
  return await response.json();
}

async function streamText(stream) {
  if (!stream) return "";
  return new Promise((resolveText) => {
    let text = "";
    stream.on("data", (chunk) => {
      text += chunk.toString();
    });
    setTimeout(() => resolveText(text), 50);
  });
}

function findTokenConfidence(tokens, name) {
  for (const group of ["colors", "spacing", "typography", "radii", "shadows"]) {
    const token = tokens[group]?.find((entry) => entry.name === name);
    if (token) return token.confidence;
  }
  return undefined;
}

function findTypographyToken(tokens, name) {
  const token = tokens.typography?.find((entry) => entry.name === name);
  assert.ok(token, `Missing typography token ${name}`);
  return token;
}

function findNodeNameBySource(node, sourceNodeId) {
  if (node.sourceNodeIds?.includes(sourceNodeId)) return node.name;
  for (const child of node.children ?? []) {
    const found = findNodeNameBySource(child, sourceNodeId);
    if (found) return found;
  }
  return undefined;
}

function findNodeById(node, id) {
  if (node.id === id) return node;
  for (const child of node.children ?? []) {
    const found = findNodeById(child, id);
    if (found) return found;
  }
  return undefined;
}

function findNodeBySource(node, sourceNodeId) {
  if (node.sourceNodeIds?.includes(sourceNodeId)) return node;
  for (const child of node.children ?? []) {
    const found = findNodeBySource(child, sourceNodeId);
    if (found) return found;
  }
  return undefined;
}

function findAssetById(manifest, id) {
  return manifest.assets.find((asset) => asset.id === id);
}

function findMessageByKey(manifest, key) {
  return manifest.messages.find((message) => message.key === key);
}

function findComponentById(registry, id) {
  return registry.components.find((component) => component.id === id || component.componentId === id);
}
