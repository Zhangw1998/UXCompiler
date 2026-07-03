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
