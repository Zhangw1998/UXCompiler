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
  assert.equal(existsSync(resolve(result.artifactDir, "web_preview_state.json")), true);
  assert.equal(existsSync(resolve(result.artifactDir, "flutter_preview/pubspec.yaml")), true);
  assert.equal(existsSync(resolve(result.artifactDir, "flutter_preview.png")), true);
  assert.equal(existsSync(resolve(result.artifactDir, "flutter_preview_capture_report.json")), true);
  assert.equal(existsSync(resolve(result.artifactDir, "diff/visual_diff_report.json")), true);
  assert.equal(existsSync(resolve(result.artifactDir, "diff/diff_issues.json")), true);
  assert.equal(existsSync(resolve(result.artifactDir, "diff/diff_heatmap.png")), true);
  assert.equal(existsSync(resolve(result.artifactDir, "pipeline_run_report.json")), true);
  assert.equal(existsSync(resolve(result.artifactDir, "preview_artifact.json")), true);
  assert.equal(existsSync(resolve(result.artifactDir, "local_api_snapshot_report.json")), true);
  assert.equal(existsSync(resolve(result.artifactDir, "materialized_assets_report.json")), true);
  assert.equal(existsSync(resolve(result.artifactDir, "flutter_preview_analyze_report.json")), true);
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
  assert.equal(pipelineRunReport.steps.flutterAnalyze.status, "success");
  assert.equal(pipelineRunReport.steps.flutterAnalyze.errors, 0);
  assert.equal(pipelineRunReport.steps.flutterAnalyze.report, resolve(result.artifactDir, "flutter_preview_analyze_report.json"));
  assert.equal(pipelineRunReport.steps.flutterCapture.status, "success");
  assert.equal(pipelineRunReport.steps.visualDiff.status, "success");
  const previewArtifact = JSON.parse(readFileSync(resolve(result.artifactDir, "preview_artifact.json"), "utf8"));
  assert.equal(previewArtifact.files.webPreviewState, resolve(result.artifactDir, "web_preview_state.json"));
  assert.equal(previewArtifact.files.diffIssues, resolve(result.artifactDir, "diff/diff_issues.json"));
  assert.equal(previewArtifact.status.visualDiff, "success");
  const webPreviewState = JSON.parse(readFileSync(resolve(result.artifactDir, "web_preview_state.json"), "utf8"));
  assert.ok(webPreviewState.commands.length >= 10, "Expected local API web preview commands");
  const semanticLabels = JSON.parse(readFileSync(resolve(result.artifactDir, "semantic_labels.json"), "utf8"));
  const semanticIR = JSON.parse(readFileSync(resolve(result.artifactDir, "semantic_ir.json"), "utf8"));
  const inferredComponents = JSON.parse(readFileSync(resolve(result.artifactDir, "inferred_components.json"), "utf8"));
  const compileManifest = JSON.parse(readFileSync(resolve(result.artifactDir, "compile_manifest.json"), "utf8"));
  assert.equal(semanticLabels.source, "deterministic_fallback");
  assert.ok(semanticLabels.nodes.some((node) => node.role === "page" && node.sourceNodeIds?.length > 0));
  assert.equal(semanticIR.status, "fidelity_preserved");
  assert.equal(inferredComponents.status, "no_reusable_components_detected");
  assert.ok(compileManifest.artifacts.includes("semantic_labels.json"));
  assert.ok(compileManifest.artifacts.includes("semantic_ir.json"));
  assert.ok(compileManifest.artifacts.includes("inferred_components.json"));
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
  const fallbackSemanticIR = JSON.parse(readFileSync(resolve(fallbackResult.artifactDir, "semantic_ir.json"), "utf8"));
  assert.ok(fallbackManifest.renderDecisions.some((decision) => decision.strategy === "frame_screenshot_asset"));
  assert.ok(fallbackManifest.renderDecisions.some((decision) => decision.strategy === "covered_by_frame_screenshot"));
  assert.equal(fallbackSemanticIR.status, "fidelity_preserved");
  const fallbackReviewTasks = JSON.parse(readFileSync(resolve(fallbackResult.artifactDir, "review_tasks.json"), "utf8"));
  const fallbackTaskStatusReport = JSON.parse(readFileSync(resolve(fallbackResult.artifactDir, "task_status_report.json"), "utf8"));
  assert.ok(fallbackReviewTasks.some((task) => task.id === "task_frame_fallback_fallback_frame"));
  assert.ok(fallbackReviewTasks.some((task) => task.priority === "P1" && task.type === "asset_strategy_uncertain"));
  assert.equal(fallbackTaskStatusReport.codegenWriteBlocked, false);
  const fallbackPipelineRunReport = JSON.parse(readFileSync(resolve(fallbackResult.artifactDir, "pipeline_run_report.json"), "utf8"));
  assert.equal(fallbackPipelineRunReport.steps.snapshot.frameScreenshotFallback, true);
  assert.equal(fallbackPipelineRunReport.steps.flutterCapture.status, "skipped");
  assert.equal(fallbackPipelineRunReport.steps.visualDiff.status, "skipped");

  const zipAssetSourceNodeId = "zip:asset:1";
  const zipScene = JSON.parse(JSON.stringify(fallbackScene));
  zipScene.source.fileName = "plugin_zip_smoke";
  zipScene.source.frameNodeId = "zip:frame";
  zipScene.root.id = "zip:frame";
  zipScene.root.children.push({
    id: zipAssetSourceNodeId,
    name: "Zip Bitmap",
    type: "RECTANGLE",
    visible: true,
    absoluteBoundingBox: { x: 0, y: 0, width: 1, height: 1 },
    fills: [{ type: "IMAGE", visible: true, imageHash: "zip-image" }]
  });
  const zipBuffer = writeStoredZip([
    jsonZipEntry("source_snapshot.json", {
      id: "snap_zip_smoke",
      figmaFileKey: zipScene.source.fileKey,
      frameId: zipScene.source.frameNodeId,
      rawScenePath: "raw_figma_scene.json",
      referenceScreenshotPath: "figma_reference.png",
      assetDir: "raw_assets"
    }),
    jsonZipEntry("raw_figma_scene.json", zipScene),
    jsonZipEntry("extraction_report.json", { source: { frameNodeId: zipScene.source.frameNodeId }, warnings: [] }),
    jsonZipEntry("raw_assets_manifest.json", [
      {
        sourceNodeId: zipAssetSourceNodeId,
        name: "Zip Bitmap",
        format: "png",
        contentType: "image/png",
        path: "raw_assets/zip_asset_1.png"
      }
    ]),
    { name: "figma_reference.png", data: Buffer.from(referencePngBase64, "base64") },
    { name: "raw_assets/zip_asset_1.png", data: Buffer.from(referencePngBase64, "base64") }
  ]);
  const zipResponse = await fetch("http://127.0.0.1:8799/api/snapshot-zip", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      projectId: "zip-smoke",
      zipBase64: zipBuffer.toString("base64"),
      runPreview: false,
      runDiff: false
    })
  });
  assert.equal(zipResponse.ok, true);
  const zipResult = await zipResponse.json();
  assert.equal(zipResult.ok, true);
  assert.equal(zipResult.importedFromZip, true);
  assert.equal(existsSync(resolve(zipResult.artifactDir, "raw_figma_scene.json")), true);
  assert.equal(existsSync(resolve(zipResult.artifactDir, "figma_reference.png")), true);
  assert.equal(existsSync(resolve(zipResult.artifactDir, "extraction_report.json")), true);
  assert.equal(existsSync(resolve(zipResult.artifactDir, "semantic_labels.json")), true);
  assert.equal(existsSync(resolve(zipResult.artifactDir, "semantic_ir.json")), true);
  assert.equal(existsSync(resolve(zipResult.artifactDir, "inferred_components.json")), true);
  assert.equal(existsSync(resolve(zipResult.artifactDir, "assets/frames/figma_reference.png")), true);
  const zipMaterializedAssetReport = JSON.parse(readFileSync(resolve(zipResult.artifactDir, "materialized_assets_report.json"), "utf8"));
  assert.equal(zipMaterializedAssetReport.requested, 1);
  assert.equal(zipMaterializedAssetReport.materialized.some((asset) => asset.sourceNodeId === zipAssetSourceNodeId), true);
  const zipPipelineRunReport = JSON.parse(readFileSync(resolve(zipResult.artifactDir, "pipeline_run_report.json"), "utf8"));
  assert.equal(zipPipelineRunReport.source.sourceKind, "figma_plugin");
  assert.equal(zipPipelineRunReport.steps.snapshot.frameScreenshotFallback, true);
  assert.equal(zipPipelineRunReport.steps.flutterCapture.status, "skipped");

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

function jsonZipEntry(name, value) {
  return {
    name,
    data: Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
  };
}

function writeStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, entry.data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + entry.data.length;
  }
  const centralOffset = offset;
  const central = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, central, eocd]);
}

function crc32(data) {
  let crc = 0xffffffff;
  const table = getCrcTable();
  for (const byte of data) {
    crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

var crcTable;

function getCrcTable() {
  crcTable ??= Array.from({ length: 256 }, (_, index) => {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    return value >>> 0;
  });
  return crcTable;
}
