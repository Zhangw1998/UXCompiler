#!/usr/bin/env node

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import {
  assertRawFigmaScene,
  type AssetManifestEntry,
  type OverrideSet,
  type PipelineArtifacts,
  type RawFigmaScene,
  type VisualDiffReport
} from "@uxcompiler/ir-schemas";
import { compileRawScene } from "@uxcompiler/normalizer";
import { applyOverrides } from "@uxcompiler/override-engine";
import { generateReviewTasks } from "@uxcompiler/review-task-engine";
import { runVisualDiff } from "@uxcompiler/visual-diff";

interface SnapshotAsset {
  sourceNodeId: string;
  name?: string;
  format?: "png";
  contentType?: string;
  pngBase64: string;
  bytes?: number;
}

interface SnapshotRequest {
  sourceKind?: "figma_plugin" | "local_smoke" | "unknown";
  rawFigmaScene: RawFigmaScene;
  figmaReferencePngBase64?: string;
  preferFrameScreenshotFallback?: boolean;
  overrideSet?: OverrideSet;
  assets?: SnapshotAsset[];
  extractionReport?: unknown;
  projectId?: string;
  runPreview?: boolean;
  runDiff?: boolean;
}

interface MaterializedAssetReport {
  version: string;
  generatedAt: string;
  requested: number;
  materialized: Array<{
    sourceNodeId: string;
    path: string;
    bytes: number;
    format: "png";
  }>;
  unmatched: Array<{
    sourceNodeId?: string;
    name?: string;
    reason: string;
  }>;
}

interface LocalPipelineRunReport {
  version: string;
  generatedAt: string;
  artifactDir: string;
  source: {
    sourceKind?: string;
    fileKey?: string;
    fileName?: string;
    frameNodeId?: string;
  };
  steps: {
    snapshot: {
      status: string;
      hasReferenceScreenshot: boolean;
      requestedAssets: number;
      materializedAssets: number;
      frameScreenshotFallback: boolean;
    };
    compile: { status: string; normalizedConfidence: number };
    flutterCapture: { status: string; output?: string; report?: string; reason?: string; flutterVersion?: string };
    visualDiff: {
      status: string;
      pass?: boolean;
      visualScore?: number;
      pixelDiffRatio?: number;
      report?: string;
      heatmap?: string;
      reason?: string;
    };
  };
}

const execFileAsync = promisify(execFile);

const port = Number(process.env.UXCOMPILER_LOCAL_API_PORT ?? 8787);
const artifactRoot = resolve(process.env.UXCOMPILER_ARTIFACTS_DIR ?? "artifacts/figma-bridge");

const server = createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    sendJson(response, 500, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`UXCompiler local API listening on http://127.0.0.1:${port}`);
  console.log(`Artifacts root: ${artifactRoot}`);
});

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? `127.0.0.1:${port}`}`);
  setCors(response);

  if (request.method === "OPTIONS") {
    response.writeHead(204);
    response.end();
    return;
  }

  if (request.method === "GET" && url.pathname === "/health") {
    sendJson(response, 200, {
      ok: true,
      service: "uxcompiler-local-api",
      port,
      artifactRoot
    });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/snapshots") {
    const body = (await readJsonBody(request)) as SnapshotRequest;
    assertRawFigmaScene(body.rawFigmaScene);
    const result = await saveSnapshot(body);
    sendJson(response, 200, {
      ok: true,
      ...result
    });
    return;
  }

  sendJson(response, 404, {
    ok: false,
    error: `No route for ${request.method} ${url.pathname}`
  });
}

async function saveSnapshot(body: SnapshotRequest): Promise<{ artifactDir: string; normalizedConfidence: number; pipelineRunReport: LocalPipelineRunReport }> {
  const source = body.rawFigmaScene.source;
  const projectId = body.projectId ?? safeName(source.fileName ?? source.fileKey ?? "figma_project");
  const frameId = safeName(source.frameNodeId ?? body.rawFigmaScene.root.id);
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const artifactDir = resolve(artifactRoot, `${projectId}_${frameId}_${stamp}`);

  await mkdir(artifactDir, { recursive: true });
  await writeJson(resolve(artifactDir, "raw_figma_scene.json"), body.rawFigmaScene);
  if (body.extractionReport) await writeJson(resolve(artifactDir, "extraction_report.json"), body.extractionReport);
  if (body.figmaReferencePngBase64) {
    await writeFile(resolve(artifactDir, "figma_reference.png"), Buffer.from(body.figmaReferencePngBase64, "base64"));
  }

  const snapshotAssets = body.assets ?? [];
  const materializedAssetSourceNodeIds = Array.from(new Set(snapshotAssets.map((asset) => asset.sourceNodeId).filter(Boolean)));
  const frameScreenshotAssetPath = shouldUseFrameScreenshotFallback(body) ? "assets/frames/figma_reference.png" : undefined;
  const artifacts = compileRawScene(body.rawFigmaScene, {
    materializedAssetSourceNodeIds,
    frameScreenshotAssetPath,
    overrideSet: body.overrideSet
  });
  const materializedAssetReport = await writePipelineArtifacts(artifactDir, artifacts, {
    assets: snapshotAssets,
    frameScreenshotAssetPath,
    frameScreenshotPngBase64: body.figmaReferencePngBase64
  });
  const pipelineRunReport = await runLocalPipeline(artifactDir, body, artifacts, materializedAssetReport);
  await writeRuntimeReviewTaskArtifacts(artifactDir, artifacts, pipelineRunReport);
  await writeJson(resolve(artifactDir, "local_api_snapshot_report.json"), {
    version: "0.1.0",
    generatedAt: new Date().toISOString(),
    artifactDir,
    projectId,
    sourceKind: body.sourceKind ?? "unknown",
    frameNodeId: source.frameNodeId,
    normalizedConfidence: artifacts.normalizedDesignIR.confidence.overall,
    hasReferenceScreenshot: !!body.figmaReferencePngBase64,
    frameScreenshotFallback: !!frameScreenshotAssetPath,
    requestedAssets: materializedAssetReport.requested,
    materializedAssets: materializedAssetReport.materialized.length,
    pipelineRunReport: resolve(artifactDir, "pipeline_run_report.json")
  });
  await writeJson(resolve(artifactDir, "pipeline_run_report.json"), pipelineRunReport);

  return {
    artifactDir,
    normalizedConfidence: artifacts.normalizedDesignIR.confidence.overall,
    pipelineRunReport
  };
}

async function writePipelineArtifacts(
  outDir: string,
  artifacts: PipelineArtifacts,
  options: { assets?: SnapshotAsset[]; frameScreenshotAssetPath?: string; frameScreenshotPngBase64?: string } = {}
): Promise<MaterializedAssetReport> {
  const files: Array<[string, unknown | string]> = [
    ["canonical_scene.json", artifacts.canonicalScene],
    ["canonicalization_report.json", artifacts.canonicalizationReport],
    ["node_mapping.json", artifacts.nodeMapping],
    ["inferred_tokens.json", artifacts.inferredTokens],
    ["token_usage_map.json", artifacts.tokenUsageMap],
    ["token_confidence_report.json", artifacts.tokenConfidenceReport],
    ["dart_tokens.dart", artifacts.dartTokenFile],
    ["asset_manifest.json", artifacts.assetManifest],
    ["i18n_manifest.json", artifacts.i18nManifest],
    ["arb/app_en.arb", artifacts.arbFile],
    ["override_set.json", artifacts.overrideSet],
    ["reviewed_normalized_design_ir.json", artifacts.reviewedNormalizedDesignIR],
    ["reviewed_asset_manifest.json", artifacts.reviewedAssetManifest],
    ["reviewed_i18n_manifest.json", artifacts.reviewedI18nManifest],
    ["reviewed_inferred_tokens.json", artifacts.reviewedInferredTokens],
    ["reviewed_arb/app_en.arb", artifacts.reviewedArbFile],
    ["override_conflict_report.json", artifacts.overrideConflictReport],
    ["stale_override_report.json", artifacts.staleOverrideReport],
    ["visual_ir.json", artifacts.visualIR],
    ["fidelity_generation_manifest.json", artifacts.fidelityGenerationManifest],
    ["node_pixel_map.json", artifacts.nodePixelMap],
    ["review_tasks.json", artifacts.reviewTasks],
    ["task_status_report.json", artifacts.taskStatusReport],
    ["regions.json", artifacts.regions],
    ["layout_candidates.json", artifacts.layoutCandidates],
    ["layout_decisions.json", artifacts.layoutDecisions],
    ["normalized_design_ir.json", artifacts.normalizedDesignIR],
    [
      "compile_manifest.json",
      {
        version: "0.1.0",
        generatedAt: new Date().toISOString(),
        artifacts: [
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
          "override_set.json",
          "reviewed_normalized_design_ir.json",
          "reviewed_asset_manifest.json",
          "reviewed_i18n_manifest.json",
          "reviewed_inferred_tokens.json",
          "reviewed_arb/app_en.arb",
          "override_conflict_report.json",
          "stale_override_report.json",
          "visual_ir.json",
          "fidelity_generation_manifest.json",
          "node_pixel_map.json",
          "review_tasks.json",
          "task_status_report.json",
          "materialized_assets_report.json",
          "flutter_preview/pubspec.yaml",
          "flutter_preview/lib/main.dart",
          "flutter_preview/lib/generated/fidelity/preview_page.dart",
          "flutter_preview/test/preview_test.dart",
          "flutter_preview/test/golden_preview_test.dart",
          "flutter_preview_format_report.json",
          "regions.json",
          "layout_candidates.json",
          "layout_decisions.json",
          "normalized_design_ir.json"
        ]
      }
    ]
  ];

  await Promise.all(
    files.map(async ([name, content]) => {
      const target = resolve(outDir, name);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`, "utf8");
    })
  );

  const previewDir = resolve(outDir, "flutter_preview");
  await rm(previewDir, { recursive: true, force: true });
  await Promise.all(
    Object.entries(artifacts.flutterPreviewProject.files).map(async ([name, content]) => {
      const target = resolve(previewDir, name);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    })
  );
  if (options.frameScreenshotAssetPath && options.frameScreenshotPngBase64) {
    const assetPath = safeAssetPath(options.frameScreenshotAssetPath);
    const bytes = Buffer.from(options.frameScreenshotPngBase64, "base64");
    if (bytes.byteLength > 0) {
      await writeBinaryAsset(resolve(outDir, assetPath), bytes);
      await writeBinaryAsset(resolve(previewDir, assetPath), bytes);
    }
  }
  const materializedAssetReport = await materializeSnapshotAssets(outDir, artifacts, options.assets ?? []);
  await writeJson(resolve(outDir, "materialized_assets_report.json"), materializedAssetReport);
  const formatReport = await formatFlutterPreview(previewDir);
  await writeJson(resolve(outDir, "flutter_preview_format_report.json"), formatReport);
  return materializedAssetReport;
}

async function writeRuntimeReviewTaskArtifacts(
  artifactDir: string,
  artifacts: PipelineArtifacts,
  pipelineRunReport: LocalPipelineRunReport
): Promise<void> {
  const visualDiffReport = await readVisualDiffReport(pipelineRunReport.steps.visualDiff.report);
  const overrideResult = applyOverrides({
    normalizedDesignIR: artifacts.normalizedDesignIR,
    assetManifest: artifacts.assetManifest,
    i18nManifest: artifacts.i18nManifest,
    inferredTokens: artifacts.inferredTokens,
    overrideSet: artifacts.overrideSet
  });
  const result = generateReviewTasks({
    normalizedDesignIR: overrideResult.reviewedNormalizedDesignIR,
    layoutCandidates: artifacts.layoutCandidates,
    layoutDecisions: artifacts.layoutDecisions,
    inferredTokens: overrideResult.reviewedInferredTokens,
    assetManifest: overrideResult.reviewedAssetManifest,
    i18nManifest: overrideResult.reviewedI18nManifest,
    fidelityGenerationManifest: artifacts.fidelityGenerationManifest,
    overrideSet: overrideResult.overrideSet,
    staleOverrideReport: overrideResult.staleOverrideReport,
    visualDiffReport,
    flutterCapture: {
      status: pipelineRunReport.steps.flutterCapture.status,
      reason: pipelineRunReport.steps.flutterCapture.reason
    }
  });
  await writeJson(resolve(artifactDir, "review_tasks.json"), result.reviewTasks);
  await writeJson(resolve(artifactDir, "task_status_report.json"), result.taskStatusReport);
  await writeJson(resolve(artifactDir, "reviewed_normalized_design_ir.json"), overrideResult.reviewedNormalizedDesignIR);
  await writeJson(resolve(artifactDir, "reviewed_asset_manifest.json"), overrideResult.reviewedAssetManifest);
  await writeJson(resolve(artifactDir, "reviewed_i18n_manifest.json"), overrideResult.reviewedI18nManifest);
  await writeJson(resolve(artifactDir, "reviewed_inferred_tokens.json"), overrideResult.reviewedInferredTokens);
  await writeJson(resolve(artifactDir, "reviewed_arb/app_en.arb"), overrideResult.reviewedArbFile);
  await writeJson(resolve(artifactDir, "override_conflict_report.json"), overrideResult.overrideConflictReport);
  await writeJson(resolve(artifactDir, "stale_override_report.json"), overrideResult.staleOverrideReport);
}

async function readVisualDiffReport(path: string | undefined): Promise<VisualDiffReport | undefined> {
  if (!path) return undefined;
  try {
    return JSON.parse(await readFile(path, "utf8")) as VisualDiffReport;
  } catch {
    return undefined;
  }
}

async function materializeSnapshotAssets(
  outDir: string,
  artifacts: PipelineArtifacts,
  snapshotAssets: SnapshotAsset[]
): Promise<MaterializedAssetReport> {
  const report: MaterializedAssetReport = {
    version: "0.1.0",
    generatedAt: new Date().toISOString(),
    requested: snapshotAssets.length,
    materialized: [],
    unmatched: []
  };
  if (snapshotAssets.length === 0) return report;

  const manifestEntries = new Map<string, AssetManifestEntry>();
  for (const entry of artifacts.assetManifest.assets) {
    if (entry.path && isMaterializableAsset(entry)) {
      manifestEntries.set(entry.sourceNodeId, entry);
    }
  }

  for (const asset of snapshotAssets) {
    if (!asset.sourceNodeId || !asset.pngBase64) {
      report.unmatched.push({
        sourceNodeId: asset.sourceNodeId,
        name: asset.name,
        reason: "Asset payload is missing sourceNodeId or pngBase64."
      });
      continue;
    }

    const manifestEntry = manifestEntries.get(asset.sourceNodeId);
    if (!manifestEntry?.path) {
      report.unmatched.push({
        sourceNodeId: asset.sourceNodeId,
        name: asset.name,
        reason: "No renderable asset manifest entry exists for this source node."
      });
      continue;
    }

    const assetPath = safeAssetPath(manifestEntry.path);
    const bytes = Buffer.from(asset.pngBase64, "base64");
    if (bytes.byteLength === 0) {
      report.unmatched.push({
        sourceNodeId: asset.sourceNodeId,
        name: asset.name,
        reason: "Decoded asset payload is empty."
      });
      continue;
    }

    await writeBinaryAsset(resolve(outDir, assetPath), bytes);
    await writeBinaryAsset(resolve(outDir, "flutter_preview", assetPath), bytes);
    report.materialized.push({
      sourceNodeId: asset.sourceNodeId,
      path: assetPath,
      bytes: bytes.byteLength,
      format: "png"
    });
  }

  return report;
}

function isMaterializableAsset(entry: AssetManifestEntry): boolean {
  return entry.strategy === "image_asset" || entry.strategy === "decorative_slice";
}

function shouldUseFrameScreenshotFallback(body: SnapshotRequest): boolean {
  if (!body.figmaReferencePngBase64) return false;
  return body.preferFrameScreenshotFallback ?? body.sourceKind === "figma_plugin";
}

function safeAssetPath(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  if (normalized.startsWith("/") || normalized.includes("..") || !normalized.startsWith("assets/")) {
    throw new Error(`Unsafe generated asset path: ${path}`);
  }
  return normalized;
}

async function writeBinaryAsset(path: string, bytes: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

async function runLocalPipeline(
  artifactDir: string,
  body: SnapshotRequest,
  artifacts: PipelineArtifacts,
  materializedAssetReport: MaterializedAssetReport
): Promise<LocalPipelineRunReport> {
  const source = body.rawFigmaScene.source;
  const shouldRunPreview = body.runPreview ?? true;
  const shouldRunDiff = body.runDiff ?? true;
  let flutterCapture: LocalPipelineRunReport["steps"]["flutterCapture"];
  let visualDiff: LocalPipelineRunReport["steps"]["visualDiff"];

  if (shouldRunPreview) {
    try {
      const previewPath = resolve(artifactDir, "flutter_preview.png");
      const captureReport = await captureFlutterPreview(resolve(artifactDir, "flutter_preview"), previewPath);
      flutterCapture = {
        status: "success",
        output: previewPath,
        report: resolve(artifactDir, "flutter_preview_capture_report.json"),
        flutterVersion: stringValue(captureReport.flutterVersion)
      };
    } catch (error) {
      flutterCapture = {
        status: "failed",
        reason: error instanceof Error ? error.message : String(error)
      };
    }
  } else {
    flutterCapture = {
      status: "skipped",
      reason: "runPreview=false"
    };
  }

  if (shouldRunDiff && body.figmaReferencePngBase64 && flutterCapture.status === "success" && flutterCapture.output) {
    try {
      const diffDir = resolve(artifactDir, "diff");
      const diffReport = await writeVisualDiffArtifacts({
        referencePath: resolve(artifactDir, "figma_reference.png"),
        candidatePath: flutterCapture.output,
        outDir: diffDir,
        nodePixelMapPath: resolve(artifactDir, "node_pixel_map.json"),
        viewport: source.viewport
          ? {
              width: source.viewport.width,
              height: source.viewport.height
            }
          : undefined,
        dpr: source.viewport?.scale ?? 1,
        fonts: collectFontFamilies(artifacts),
        flutterVersion: flutterCapture.flutterVersion
      });
      visualDiff = {
        status: "success",
        pass: diffReport.page.pass,
        visualScore: diffReport.page.score.visualScore,
        pixelDiffRatio: diffReport.page.score.pixelDiffRatio,
        report: resolve(diffDir, "visual_diff_report.json"),
        heatmap: resolve(diffDir, "diff_heatmap.png")
      };
    } catch (error) {
      visualDiff = {
        status: "failed",
        reason: error instanceof Error ? error.message : String(error)
      };
    }
  } else {
    visualDiff = {
      status: "skipped",
      reason: !body.figmaReferencePngBase64
        ? "Figma reference screenshot was not provided."
        : flutterCapture.status !== "success"
          ? "Flutter capture did not succeed."
          : "runDiff=false"
    };
  }

  return {
    version: "0.1.0",
    generatedAt: new Date().toISOString(),
    artifactDir,
    source: {
      sourceKind: body.sourceKind ?? "unknown",
      fileKey: source.fileKey,
      fileName: source.fileName,
      frameNodeId: source.frameNodeId
    },
    steps: {
      snapshot: {
        status: "success",
        hasReferenceScreenshot: !!body.figmaReferencePngBase64,
        requestedAssets: materializedAssetReport.requested,
        materializedAssets: materializedAssetReport.materialized.length,
        frameScreenshotFallback: shouldUseFrameScreenshotFallback(body)
      },
      compile: {
        status: "success",
        normalizedConfidence: artifacts.normalizedDesignIR.confidence.overall
      },
      flutterCapture,
      visualDiff
    }
  };
}

async function formatFlutterPreview(previewDir: string): Promise<Record<string, unknown>> {
  try {
    const result = await execFileAsync("dart", ["format", "lib", "test"], {
      cwd: previewDir
    });
    return {
      status: "success",
      command: "dart format lib test",
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    const candidate = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: string | number };
    if (candidate.code === "ENOENT") {
      return {
        status: "skipped",
        command: "dart format lib test",
        reason: "dart command was not found"
      };
    }
    throw new Error(`dart format failed: ${candidate.stderr ?? candidate.message}`);
  }
}

async function captureFlutterPreview(projectDir: string, outPath: string): Promise<Record<string, unknown>> {
  const goldenPath = resolve(projectDir, "test/goldens/flutter_preview.png");
  const flutterVersion = await commandVersion("flutter", ["--version"]);
  await execFileAsync("flutter", ["pub", "get"], { cwd: projectDir });
  const testResult = await execFileAsync("flutter", ["test", "--update-goldens", "test/golden_preview_test.dart"], {
    cwd: projectDir
  });
  const golden = await readFile(goldenPath);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, golden);
  const report = {
    status: "success",
    command: "flutter test --update-goldens test/golden_preview_test.dart",
    projectDir,
    output: outPath,
    goldenPath,
    flutterVersion,
    stdout: testResult.stdout,
    stderr: testResult.stderr,
    generatedAt: new Date().toISOString()
  };
  await writeJson(resolve(dirname(outPath), "flutter_preview_capture_report.json"), report);
  return report;
}

async function writeVisualDiffArtifacts(options: {
  referencePath: string;
  candidatePath: string;
  outDir: string;
  nodePixelMapPath?: string;
  viewport?: { width: number; height: number };
  dpr?: number;
  fonts?: string[];
  flutterVersion?: string;
}): Promise<ReturnType<typeof runVisualDiff>["visualDiffReport"]> {
  const heatmapPath = resolve(options.outDir, "diff_heatmap.png");
  const nodePixelMap = options.nodePixelMapPath
    ? (JSON.parse(await readFile(options.nodePixelMapPath, "utf8")) as [])
    : undefined;
  const result = runVisualDiff({
    referencePng: await readFile(options.referencePath),
    candidatePng: await readFile(options.candidatePath),
    referencePath: options.referencePath,
    candidatePath: options.candidatePath,
    heatmapPath,
    nodePixelMap,
    viewport: options.viewport,
    dpr: options.dpr,
    fonts: options.fonts,
    flutterVersion: options.flutterVersion
  });
  await mkdir(options.outDir, { recursive: true });
  await writeJson(resolve(options.outDir, "visual_diff_report.json"), result.visualDiffReport);
  await writeJson(resolve(options.outDir, "node_diff_report.json"), result.nodeDiffReport);
  await writeFile(heatmapPath, result.heatmapPng);
  return result.visualDiffReport;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const body = Buffer.concat(chunks).toString("utf8");
  if (!body.trim()) return {};
  return JSON.parse(body);
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  setCors(response);
  response.writeHead(status, { "content-type": "application/json" });
  response.end(`${JSON.stringify(value, null, 2)}\n`);
}

function setCors(response: ServerResponse): void {
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
  response.setHeader("access-control-allow-headers", "content-type");
}

async function commandVersion(command: string, args: string[]): Promise<string | undefined> {
  try {
    const result = await execFileAsync(command, args);
    return (result.stdout || result.stderr).split(/\r?\n/)[0] || undefined;
  } catch {
    return undefined;
  }
}

function collectFontFamilies(artifacts: PipelineArtifacts): string[] {
  const typography = artifacts.reviewedNormalizedDesignIR.tokens?.typography ?? artifacts.normalizedDesignIR.tokens?.typography ?? [];
  return [...new Set(typography.map((token) => token.fontFamily).filter((fontFamily) => typeof fontFamily === "string" && fontFamily.length > 0))].sort(
    (left, right) => left.localeCompare(right)
  );
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "snapshot";
}
