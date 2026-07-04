import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { buildWorkbenchModel } from "../apps/workbench-web/dist/model.js";

const root = "artifacts/workbench-web-smoke";
const sampleDir = resolve(root, "sample");
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

const flutterPreviewPath = resolve(sampleDir, "flutter_preview.png");
const hasFlutterPreview = existsSync(flutterPreviewPath);
const artifacts = {
  artifactRoot: "/artifacts/workbench-web-smoke/sample",
  reviewedNormalizedDesignIR: readJson(sampleDir, "reviewed_normalized_design_ir.json"),
  normalizedDesignIR: readJson(sampleDir, "normalized_design_ir.json"),
  visualIR: readJson(sampleDir, "visual_ir.json"),
  reviewTasks: readJson(sampleDir, "review_tasks.json"),
  taskStatusReport: readJson(sampleDir, "task_status_report.json"),
  overrideSet: readJson(sampleDir, "override_set.json"),
  reviewedInferredTokens: readJson(sampleDir, "reviewed_inferred_tokens.json"),
  reviewedAssetManifest: readJson(sampleDir, "reviewed_asset_manifest.json"),
  reviewedI18nManifest: readJson(sampleDir, "reviewed_i18n_manifest.json"),
  staleOverrideReport: readJson(sampleDir, "stale_override_report.json"),
  overrideConflictReport: readJson(sampleDir, "override_conflict_report.json"),
  fidelityGenerationManifest: readJson(sampleDir, "fidelity_generation_manifest.json"),
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
assert.equal(model.preview.hasFlutterPreview, hasFlutterPreview);
assert.ok(model.artifactStatus.some((entry) => entry.label === "Visual IR" && entry.present));

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
  assert.match(modelJs, /buildWorkbenchModel/);
  assert.match(css, /preview-stage/);
  assert.equal(visual.root.type, "scene");
  if (previewPng) {
    assert.equal(previewPng.ok, true);
    assert.equal(previewPng.headers.get("content-type"), "image/png");
  }

  const firstTaskId = artifacts.reviewTasks[0].id;
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
  assert.equal(actionResult.report.afterOpenTasks, artifacts.reviewTasks.length - 1);

  const updatedTasks = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/review_tasks.json`);
  const updatedOverrideSet = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/override_set.json`);
  const actionReport = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/review_task_action_report.json`);
  const updatedTokens = await fetchJson(`${base}/artifacts/workbench-web-smoke/sample/reviewed_inferred_tokens.json`);
  assert.equal(updatedTasks.length, artifacts.reviewTasks.length - 1);
  assert.equal(updatedTasks.some((task) => task.id === firstTaskId), false);
  assert.equal(updatedOverrideSet.overrides.length, 1);
  assert.match(updatedOverrideSet.hash, /^sha256_[a-f0-9]{64}$/);
  assert.equal(actionReport.afterOpenTasks, artifacts.reviewTasks.length - 1);
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
  assert.equal(studioTokenOverrideSet.overrides.length, 3);
  assert.equal(findTokenConfidence(studioReviewedTokens, "space_10_reviewed"), 1);
  assert.equal(findTokenConfidence(studioReviewedTokens, "space_10"), undefined);
  assert.equal(tokenRegistry.tokens.some((token) => token.type === "spacing" && token.name === "space_10_reviewed"), true);

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
        format: "png",
        path: "assets/slices/divider_dot_workbench.png",
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
  assert.equal(assetOverrideSet.overrides.length, 4);
  assert.equal(findAssetById(finalAssets, "asset_1_17").strategy, "decorative_slice");
  assert.equal(findAssetById(reviewedAssets, "asset_1_17").path, "assets/slices/divider_dot_workbench.png");

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
  assert.equal(i18nOverrideSet.overrides.length, 5);
  assert.equal(findMessageByKey(finalI18n, "loginTitle").value, "Welcome back");
  assert.equal(findMessageByKey(reviewedI18n, "loginTitle").description, "Reviewed login title.");
  assert.equal(finalArb.loginTitle, "Welcome back");
  assert.equal(reviewedArb.loginTitle, "Welcome back");

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
  const generatedMain = await fetchText(`${base}/artifacts/workbench-web-smoke/sample/generated/lib/main.dart`);
  assert.equal(codegenReview.projectId, "workbench_smoke");
  assert.equal(codegenReviewReport.buildId, codegenReview.buildId);
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

  console.log("workbench-web verification passed");
} finally {
  server.kill("SIGTERM");
}

function readJson(base, file) {
  return JSON.parse(readFileSync(resolve(base, file), "utf8"));
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

function findNodeNameBySource(node, sourceNodeId) {
  if (node.sourceNodeIds?.includes(sourceNodeId)) return node.name;
  for (const child of node.children ?? []) {
    const found = findNodeNameBySource(child, sourceNodeId);
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
