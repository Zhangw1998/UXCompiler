import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const artifactRoot = "artifacts/local-api-smoke";
const referencePngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4AWP4DwQACfsD/c8LaHIAAAAASUVORK5CYII=";
rmSync(artifactRoot, { recursive: true, force: true });

const server = spawn("node", ["apps/local-api/dist/index.js"], {
  env: {
    ...process.env,
    UXCOMPILER_LOCAL_API_PORT: "8799",
    UXCOMPILER_ARTIFACTS_DIR: artifactRoot
  },
  stdio: ["ignore", "pipe", "pipe"]
});

try {
  await waitForHealth();
  const rawFigmaScene = JSON.parse(readFileSync("examples/fixtures/login_raw_figma_scene.json", "utf8"));
  const imageSourceNodeId = "smoke:asset:1";
  const duplicateImageSourceNodeId = "smoke:asset:2";
  const sliceSourceNodeId = "smoke:slice:1";
  const sliceTextSourceNodeId = "smoke:slice:text";
  rawFigmaScene.root.children.push({
    id: imageSourceNodeId,
    name: "Smoke Bitmap",
    type: "RECTANGLE",
    visible: true,
    absoluteBoundingBox: { x: 12, y: 12, width: 8, height: 8 },
    fills: [{ type: "IMAGE", visible: true, imageHash: "smoke-image" }]
  });
  rawFigmaScene.root.children.push({
    id: duplicateImageSourceNodeId,
    name: "Smoke Bitmap",
    type: "RECTANGLE",
    visible: true,
    absoluteBoundingBox: { x: 12, y: 24, width: 8, height: 8 },
    fills: [{ type: "IMAGE", visible: true, imageHash: "smoke-image-duplicate" }]
  });
  rawFigmaScene.root.children.push({
    id: sliceSourceNodeId,
    name: "Smoke Blur Slice",
    type: "FRAME",
    visible: true,
    absoluteBoundingBox: { x: 28, y: 12, width: 80, height: 24 },
    fills: [{ type: "SOLID", visible: true, color: { r: 0.4, g: 0.8, b: 0.2 } }],
    effects: [{ type: "LAYER_BLUR", visible: true, radius: 2 }],
    children: [
      {
        id: sliceTextSourceNodeId,
        name: "Smoke Slice Text",
        type: "TEXT",
        visible: true,
        absoluteBoundingBox: { x: 32, y: 16, width: 56, height: 12 },
        characters: "Do not slice",
        style: {
          fontFamily: "Inter",
          fontSize: 12,
          fontWeight: 500,
          lineHeightPx: 14,
          textAlignHorizontal: "LEFT"
        },
        fills: [{ type: "SOLID", visible: true, color: { r: 0, g: 0, b: 0 } }]
      }
    ]
  });
  const response = await fetch("http://127.0.0.1:8799/api/snapshots", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sourceKind: "local_smoke",
      rawFigmaScene,
      projectId: "smoke",
      figmaReferencePngBase64: referencePngBase64,
      assets: [
        {
          sourceNodeId: imageSourceNodeId,
          name: "Smoke Bitmap",
          format: "png",
          contentType: "image/png",
          pngBase64: referencePngBase64
        },
        {
          sourceNodeId: duplicateImageSourceNodeId,
          name: "Smoke Bitmap",
          format: "png",
          contentType: "image/png",
          pngBase64: referencePngBase64
        },
        {
          sourceNodeId: sliceSourceNodeId,
          name: "Smoke Blur Slice",
          format: "png",
          contentType: "image/png",
          pngBase64: referencePngBase64
        }
      ]
    })
  });
  assert.equal(response.ok, true);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.ok(result.artifactDir);
  assert.equal(existsSync(resolve(result.artifactDir, "raw_figma_scene.json")), true);
  assert.equal(existsSync(resolve(result.artifactDir, "normalized_design_ir.json")), true);
  assert.equal(existsSync(resolve(result.artifactDir, "flutter_preview/pubspec.yaml")), true);
  assert.equal(existsSync(resolve(result.artifactDir, "flutter_preview.png")), true);
  assert.equal(existsSync(resolve(result.artifactDir, "flutter_preview_capture_report.json")), true);
  assert.equal(existsSync(resolve(result.artifactDir, "diff/visual_diff_report.json")), true);
  assert.equal(existsSync(resolve(result.artifactDir, "diff/diff_heatmap.png")), true);
  assert.equal(existsSync(resolve(result.artifactDir, "pipeline_run_report.json")), true);
  assert.equal(existsSync(resolve(result.artifactDir, "local_api_snapshot_report.json")), true);
  assert.equal(existsSync(resolve(result.artifactDir, "materialized_assets_report.json")), true);
  assert.equal(existsSync(resolve(result.artifactDir, "review_tasks.json")), true);
  assert.equal(existsSync(resolve(result.artifactDir, "task_status_report.json")), true);
  assert.equal(existsSync(resolve(result.artifactDir, "override_set.json")), true);
  assert.equal(existsSync(resolve(result.artifactDir, "reviewed_normalized_design_ir.json")), true);
  assert.equal(existsSync(resolve(result.artifactDir, "override_conflict_report.json")), true);
  assert.equal(existsSync(resolve(result.artifactDir, "stale_override_report.json")), true);
  const materializedAssetReport = JSON.parse(readFileSync(resolve(result.artifactDir, "materialized_assets_report.json"), "utf8"));
  assert.equal(materializedAssetReport.requested, 3);
  assert.equal(materializedAssetReport.materialized.length, 3);
  const imageAsset = materializedAssetReport.materialized.find((asset) => asset.sourceNodeId === imageSourceNodeId);
  const duplicateImageAsset = materializedAssetReport.materialized.find((asset) => asset.sourceNodeId === duplicateImageSourceNodeId);
  const sliceAsset = materializedAssetReport.materialized.find((asset) => asset.sourceNodeId === sliceSourceNodeId);
  assert.ok(imageAsset);
  assert.ok(duplicateImageAsset);
  assert.ok(sliceAsset);
  assert.match(imageAsset.path, /^assets\/images\//);
  assert.match(duplicateImageAsset.path, /^assets\/images\//);
  assert.notEqual(duplicateImageAsset.path, imageAsset.path);
  assert.match(duplicateImageAsset.path, /^assets\/images\/smoke_bitmap_[a-f0-9]{8}\.png$/);
  assert.match(sliceAsset.path, /^assets\/slices\//);
  for (const materializedAsset of [imageAsset, duplicateImageAsset, sliceAsset]) {
    assert.equal(existsSync(resolve(result.artifactDir, materializedAsset.path)), true);
    assert.equal(existsSync(resolve(result.artifactDir, "flutter_preview", materializedAsset.path)), true);
  }
  const previewPage = readFileSync(resolve(result.artifactDir, "flutter_preview/lib/generated/fidelity/preview_page.dart"), "utf8");
  assert.match(previewPage, /Image\.asset\(/);
  assert.match(previewPage, /assets\/slices\/smoke_blur_slice\.png/);
  const pipelineRunReport = JSON.parse(readFileSync(resolve(result.artifactDir, "pipeline_run_report.json"), "utf8"));
  assert.equal(pipelineRunReport.source.sourceKind, "local_smoke");
  assert.equal(pipelineRunReport.steps.snapshot.materializedAssets, 3);
  assert.equal(pipelineRunReport.steps.snapshot.frameScreenshotFallback, false);
  assert.equal(pipelineRunReport.steps.flutterCapture.status, "success");
  assert.equal(pipelineRunReport.steps.visualDiff.status, "success");
  const diffReport = JSON.parse(readFileSync(resolve(result.artifactDir, "diff/visual_diff_report.json"), "utf8"));
  assert.ok(diffReport.environment.fonts.length > 0, "Expected visual diff font metadata");
  assert.match(diffReport.environment.flutterVersion, /^Flutter /);
  const assetManifest = JSON.parse(readFileSync(resolve(result.artifactDir, "asset_manifest.json"), "utf8"));
  const generatedAssetPaths = assetManifest.assets.map((asset) => asset.path).filter(Boolean);
  assert.equal(new Set(generatedAssetPaths).size, generatedAssetPaths.length, "Expected generated asset paths to be unique");
  assert.ok(
    assetManifest.warnings.some(
      (warning) => warning.sourceNodeId === sliceSourceNodeId && warning.type === "decorative_slice_contains_text"
    ),
    "Expected decorative slice text warning"
  );
  const reviewTasks = JSON.parse(readFileSync(resolve(result.artifactDir, "review_tasks.json"), "utf8"));
  const taskStatusReport = JSON.parse(readFileSync(resolve(result.artifactDir, "task_status_report.json"), "utf8"));
  const overrideSet = JSON.parse(readFileSync(resolve(result.artifactDir, "override_set.json"), "utf8"));
  assert.match(overrideSet.hash, /^sha256_[a-f0-9]{64}$/);
  assert.ok(reviewTasks.some((task) => task.type === "visual_diff_failed"));
  assert.ok(
    reviewTasks.some(
      (task) =>
        task.type === "resource_export_failed" &&
        task.priority === "P0" &&
        task.target?.sourceNodeIds?.includes(sliceSourceNodeId) &&
        task.evidence?.warningType === "decorative_slice_contains_text"
    ),
    "Expected P0 task for decorative slice containing text"
  );
  assert.ok(taskStatusReport.codegenWriteBlocked);
  assert.ok(taskStatusReport.byPriority.P0 > 0);

  const fallbackScene = {
    version: "2.0",
    source: {
      fileKey: "plugin_file",
      fileName: "plugin_fallback_smoke",
      frameNodeId: "fallback:frame",
      viewport: { width: 1, height: 1, scale: 1 }
    },
    root: {
      id: "fallback:frame",
      name: "Fallback Frame",
      type: "FRAME",
      visible: true,
      absoluteBoundingBox: { x: 0, y: 0, width: 1, height: 1 },
      fills: [{ type: "SOLID", visible: true, color: { r: 1, g: 1, b: 1 } }],
      children: [
        {
          id: "fallback:child",
          name: "Covered Child",
          type: "RECTANGLE",
          visible: true,
          absoluteBoundingBox: { x: 0, y: 0, width: 1, height: 1 },
          fills: [{ type: "SOLID", visible: true, color: { r: 1, g: 1, b: 1 } }]
        }
      ]
    }
  };
  const fallbackResponse = await fetch("http://127.0.0.1:8799/api/snapshots", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sourceKind: "figma_plugin",
      rawFigmaScene: fallbackScene,
      projectId: "fallback-smoke",
      figmaReferencePngBase64: referencePngBase64,
      runPreview: false,
      runDiff: false
    })
  });
  assert.equal(fallbackResponse.ok, true);
  const fallbackResult = await fallbackResponse.json();
  assert.equal(fallbackResult.ok, true);
  assert.equal(existsSync(resolve(fallbackResult.artifactDir, "assets/frames/figma_reference.png")), true);
  assert.equal(existsSync(resolve(fallbackResult.artifactDir, "flutter_preview/assets/frames/figma_reference.png")), true);
  const fallbackPreviewPage = readFileSync(
    resolve(fallbackResult.artifactDir, "flutter_preview/lib/generated/fidelity/preview_page.dart"),
    "utf8"
  );
  assert.match(fallbackPreviewPage, /assets\/frames\/figma_reference\.png/);
  const fallbackManifest = JSON.parse(readFileSync(resolve(fallbackResult.artifactDir, "fidelity_generation_manifest.json"), "utf8"));
  assert.ok(fallbackManifest.renderDecisions.some((decision) => decision.strategy === "frame_screenshot_asset"));
  assert.ok(fallbackManifest.renderDecisions.some((decision) => decision.strategy === "covered_by_frame_screenshot"));
  const fallbackReviewTasks = JSON.parse(readFileSync(resolve(fallbackResult.artifactDir, "review_tasks.json"), "utf8"));
  const fallbackTaskStatusReport = JSON.parse(readFileSync(resolve(fallbackResult.artifactDir, "task_status_report.json"), "utf8"));
  assert.ok(fallbackReviewTasks.some((task) => task.id === "task_frame_fallback_fallback_frame"));
  assert.ok(fallbackReviewTasks.some((task) => task.priority === "P1" && task.type === "asset_strategy_uncertain"));
  assert.equal(fallbackTaskStatusReport.codegenWriteBlocked, false);
  const fallbackPipelineRunReport = JSON.parse(readFileSync(resolve(fallbackResult.artifactDir, "pipeline_run_report.json"), "utf8"));
  assert.equal(fallbackPipelineRunReport.steps.snapshot.frameScreenshotFallback, true);
  assert.equal(fallbackPipelineRunReport.steps.flutterCapture.status, "skipped");
  assert.equal(fallbackPipelineRunReport.steps.visualDiff.status, "skipped");
  console.log("local api verification passed");
} finally {
  server.kill("SIGTERM");
}

async function waitForHealth() {
  for (let index = 0; index < 40; index += 1) {
    try {
      const response = await fetch("http://127.0.0.1:8799/health");
      if (response.ok) return;
    } catch {
      // retry
    }
    await new Promise((resolveTimeout) => setTimeout(resolveTimeout, 250));
  }
  const stdout = await streamText(server.stdout);
  const stderr = await streamText(server.stderr);
  throw new Error(`local api did not start\nstdout:\n${stdout}\nstderr:\n${stderr}`);
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
