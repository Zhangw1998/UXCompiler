#!/usr/bin/env node

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { createCodegenReview } from "@uxcompiler/codegen-review";
import {
  assertRawFigmaScene,
  createRawExtractionReport,
  type AssetManifestEntry,
  type CanonicalNode,
  type CodegenAnalyzeSummary,
  type CodegenFormatSummary,
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
  status?: "success" | "failed";
  reason?: string;
  path?: string;
  format?: "png";
  contentType?: string;
  pngBase64?: string;
  bytes?: number;
}

interface SnapshotRequest {
  sourceKind?: "figma_plugin" | "local_smoke" | "unknown";
  rawFigmaScene: RawFigmaScene;
  figmaReferencePngBase64?: string;
  preferFrameScreenshotFallback?: boolean;
  overrideSet?: OverrideSet;
  aiSemanticOutput?: unknown;
  assets?: SnapshotAsset[];
  extractionReport?: unknown;
  projectId?: string;
  runPreview?: boolean;
  runDiff?: boolean;
}

interface SnapshotZipImportRequest {
  zipBase64: string;
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
  failed: Array<{
    sourceNodeId?: string;
    name?: string;
    path?: string;
    reason: string;
  }>;
  unmatched: Array<{
    sourceNodeId?: string;
    name?: string;
    reason: string;
  }>;
}

interface PreviewCaptureMetadata {
  viewport?: { width: number; height: number };
  dpr?: number;
  fonts?: string[];
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
      failedAssets: number;
      frameScreenshotFallback: boolean;
    };
    compile: { status: string; normalizedConfidence: number };
    flutterAnalyze: { status: string; errors?: number; warnings?: number; report?: string; reason?: string };
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

  if (request.method === "POST" && url.pathname === "/api/snapshot-zip") {
    const body = (await readJsonBody(request)) as SnapshotZipImportRequest;
    const snapshot = readSnapshotZipRequest(body);
    const result = await saveSnapshot(snapshot);
    sendJson(response, 200, {
      ok: true,
      importedFromZip: true,
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
  await writeJson(resolve(artifactDir, "extraction_report.json"), body.extractionReport ?? createRawExtractionReport(body.rawFigmaScene));
  if (body.figmaReferencePngBase64) {
    await writeFile(resolve(artifactDir, "figma_reference.png"), Buffer.from(body.figmaReferencePngBase64, "base64"));
  }

  const snapshotAssets = body.assets ?? [];
  const materializedAssetSourceNodeIds = Array.from(
    new Set(
      snapshotAssets
        .filter((asset) => asset.status !== "failed" && !!asset.pngBase64)
        .map((asset) => asset.sourceNodeId)
        .filter(Boolean)
    )
  );
  const frameScreenshotAssetPath = shouldUseFrameScreenshotFallback(body) ? "assets/frames/figma_reference.png" : undefined;
  const artifacts = compileRawScene(body.rawFigmaScene, {
    materializedAssetSourceNodeIds,
    frameScreenshotAssetPath,
    overrideSet: body.overrideSet,
    aiSemanticOutput: body.aiSemanticOutput
  });
  const materializedAssetReport = await writePipelineArtifacts(artifactDir, artifacts, {
    assets: snapshotAssets,
    frameScreenshotAssetPath,
    frameScreenshotPngBase64: body.figmaReferencePngBase64
  });
  const pipelineRunReport = await runLocalPipeline(artifactDir, body, artifacts, materializedAssetReport);
  await writePreviewArtifact(artifactDir, pipelineRunReport);
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
    failedAssets: materializedAssetReport.failed.length,
    pipelineRunReport: resolve(artifactDir, "pipeline_run_report.json")
  });
  await writeJson(resolve(artifactDir, "pipeline_run_report.json"), pipelineRunReport);

  return {
    artifactDir,
    normalizedConfidence: artifacts.normalizedDesignIR.confidence.overall,
    pipelineRunReport
  };
}

function readSnapshotZipRequest(body: SnapshotZipImportRequest): SnapshotRequest {
  if (!stringValue(body.zipBase64)) throw new Error("Missing required zipBase64.");
  const entries = readStoredZip(Buffer.from(body.zipBase64, "base64"));
  const entryMap = new Map(entries.map((entry) => [entry.name, entry.data]));
  const rawSceneEntry = entryMap.get("raw_figma_scene.json");
  if (!rawSceneEntry) throw new Error("Invalid UXCompiler snapshot zip: missing raw_figma_scene.json.");
  const rawFigmaScene = JSON.parse(rawSceneEntry.toString("utf8")) as RawFigmaScene;
  assertRawFigmaScene(rawFigmaScene);
  const referencePng = entryMap.get("figma_reference.png");
  const extractionReportEntry = entryMap.get("extraction_report.json");
  const assets = readSnapshotZipAssets(entryMap);
  return {
    sourceKind: "figma_plugin",
    rawFigmaScene,
    projectId: body.projectId,
    figmaReferencePngBase64: referencePng ? referencePng.toString("base64") : undefined,
    preferFrameScreenshotFallback: true,
    assets,
    extractionReport: extractionReportEntry ? JSON.parse(extractionReportEntry.toString("utf8")) : undefined,
    runPreview: body.runPreview,
    runDiff: body.runDiff
  };
}

function readSnapshotZipAssets(entryMap: Map<string, Buffer>): SnapshotAsset[] {
  const manifestEntry = entryMap.get("raw_assets_manifest.json");
  if (manifestEntry) {
    const manifest = JSON.parse(manifestEntry.toString("utf8"));
    if (!Array.isArray(manifest)) throw new Error("Invalid UXCompiler snapshot zip: raw_assets_manifest.json must be an array.");
    return manifest.flatMap((entry): SnapshotAsset[] => {
      const asset = objectValue(entry);
      const sourceNodeId = stringValue(asset?.sourceNodeId);
      const path = stringValue(asset?.path);
      if (!sourceNodeId) return [];
      if (path) assertSafeArchivePath(path);
      const status = stringValue(asset?.status);
      if (status === "failed" || status === "asset_export_failed") {
        return [
          {
            sourceNodeId,
            name: stringValue(asset?.name),
            status: "failed" as const,
            reason: stringValue(asset?.reason) ?? "Asset export failed in the Figma plugin.",
            path,
            format: "png" as const,
            contentType: stringValue(asset?.contentType) ?? "image/png",
            bytes: numberValue(asset?.bytes)
          }
        ];
      }
      if (!path) return [];
      const data = entryMap.get(path);
      if (!data) {
        return [
          {
            sourceNodeId,
            name: stringValue(asset?.name),
            status: "failed" as const,
            reason: `Referenced asset entry is missing from the snapshot zip: ${path}`,
            path,
            format: "png" as const,
            contentType: stringValue(asset?.contentType) ?? "image/png",
            bytes: undefined
          }
        ];
      }
      return [
        {
          sourceNodeId,
          name: stringValue(asset?.name),
          status: "success" as const,
          path,
          format: "png" as const,
          contentType: stringValue(asset?.contentType) ?? "image/png",
          pngBase64: data.toString("base64"),
          bytes: data.byteLength
        }
      ];
    });
  }
  return Array.from(entryMap.entries())
    .filter(([name]) => name.startsWith("raw_assets/") && name.endsWith(".png"))
    .map(([name, data]) => ({
      sourceNodeId: name.slice("raw_assets/".length, -".png".length),
      name,
      status: "success" as const,
      path: name,
      format: "png" as const,
      contentType: "image/png",
      pngBase64: data.toString("base64"),
      bytes: data.byteLength
    }));
}

async function writePipelineArtifacts(
  outDir: string,
  artifacts: PipelineArtifacts,
  options: { assets?: SnapshotAsset[]; frameScreenshotAssetPath?: string; frameScreenshotPngBase64?: string } = {}
): Promise<MaterializedAssetReport> {
  await cleanStaleGeneratedArtifacts(outDir);
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
    ["web_preview_state.json", createWebPreviewState(artifacts.visualIR)],
    ["fidelity_generation_manifest.json", artifacts.fidelityGenerationManifest],
    ["node_pixel_map.json", artifacts.nodePixelMap],
    ["review_tasks.json", artifacts.reviewTasks],
    ["task_status_report.json", artifacts.taskStatusReport],
    ["regions.json", artifacts.regions],
    ["region_tree.json", artifacts.regionTree],
    ["layout_candidates.json", artifacts.layoutCandidates],
    ["layout_decisions.json", artifacts.layoutDecisions],
    ["inferred_components.json", artifacts.inferredComponents],
    ["component_instance_map.json", artifacts.componentInstanceMap],
    ["component_confidence_report.json", artifacts.componentConfidenceReport],
    ["semantic_labels.json", artifacts.semanticLabels],
    ["ai_decision_report.json", artifacts.aiDecisionReport],
    ["naming_map.json", artifacts.namingMap],
    ["i18n_key_suggestions.json", artifacts.i18nKeySuggestions],
    ["semantic_ir.json", artifacts.semanticIR],
    ["uplift_decisions.json", artifacts.upliftDecisions],
    ["uplift_diff_report.json", artifacts.upliftDiffReport],
    ["normalization_report.json", artifacts.normalizationReport],
    ["render_strategy_manifest.json", artifacts.renderStrategyManifest],
    ["normalized_design_ir.json", artifacts.normalizedDesignIR],
    [
      "compile_manifest.json",
      {
        version: "0.1.0",
        generatedAt: new Date().toISOString(),
        artifacts: [
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
          "flutter_generation_manifest.json",
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
          "flutter_preview_analyze_report.json",
          "preview_artifact.json",
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
  await materializeGeneratedSvgAssets(outDir, artifacts);
  await writeJson(resolve(outDir, "materialized_assets_report.json"), materializedAssetReport);
  const formatReport = await formatFlutterPreview(previewDir);
  const analyzeReport = await analyzeFlutterPreview(previewDir);
  await Promise.all([
    writeJson(resolve(outDir, "flutter_preview_format_report.json"), formatReport),
    writeJson(resolve(outDir, "flutter_preview_analyze_report.json"), analyzeReport)
  ]);
  const codegenReview = createCodegenReview({
    normalizedDesignIR: artifacts.reviewedNormalizedDesignIR,
    assetManifest: artifacts.reviewedAssetManifest,
    i18nManifest: artifacts.reviewedI18nManifest,
    flutterPreviewFiles: artifacts.flutterPreviewProject.files,
    reviewTasks: artifacts.reviewTasks,
    taskStatusReport: artifacts.taskStatusReport,
    fidelityGenerationManifest: artifacts.fidelityGenerationManifest,
    nodePixelMap: artifacts.nodePixelMap,
    overrideSet: artifacts.overrideSet,
    staleOverrideReport: artifacts.staleOverrideReport,
    format: codegenFormatSummary(formatReport, "flutter_preview_format_report.json"),
    analyze: codegenAnalyzeSummary(analyzeReport, "flutter_preview_analyze_report.json")
  });
  await writeJson(resolve(outDir, "flutter_generation_manifest.json"), codegenReview.codegenReview);
  return materializedAssetReport;
}

async function cleanStaleGeneratedArtifacts(outDir: string): Promise<void> {
  const stalePaths = [
    "generated",
    "patches",
    "diff",
    "visual_diff_report.json",
    "node_diff_report.json",
    "diff_issues.json",
    "manual_review_report.json",
    "repair_patch.json",
    "repair_iteration_log.json",
    "diff_heatmap.png",
    "preview_artifact.json",
    "pipeline_run_report.json",
    "flutter_preview.png",
    "flutter_preview_capture_report.json",
    "project_write_report.json",
    "local_api_snapshot_report.json",
    "materialized_assets_report.json",
    "review_task_action_report.json",
    "review_task_closure_log.json",
    "review_task_bulk_close_report.json",
    "tree_edit_report.json",
    "workbench_tree_edit_action_report.json",
    "studio_report.json",
    "component_registry.json",
    "token_registry.json",
    "workbench_studio_action_report.json",
    "workbench_studio_rollback_report.json",
    "promote_report.json",
    "codegen_promotion_rules.json",
    "node_remap_report.json",
    "token_migration_report.json",
    "reapplied_overrides.json",
    "stale_overrides.json",
    "incremental_review_tasks.json",
    "workbench_sync_remap_report.json",
    "workbench_codegen_review_report.json",
    "workbench_codegen_write_report.json",
    "diff_repair_report.json",
    "diff_repair_rollback_report.json",
    "workbench_diff_repair_report.json",
    "workbench_diff_repair_rollback_report.json"
  ];
  await Promise.all(stalePaths.map((path) => rm(resolve(outDir, path), { recursive: true, force: true })));
}

async function materializeGeneratedSvgAssets(outDir: string, artifacts: PipelineArtifacts): Promise<void> {
  const sourceNodes = new Map<string, CanonicalNode>();
  collectCanonicalNodesBySourceId(artifacts.canonicalScene.root, sourceNodes);
  await Promise.all(
    artifacts.reviewedAssetManifest.assets
      .filter((asset) => asset.strategy === "svg_icon" && typeof asset.path === "string" && asset.path.length > 0)
      .map(async (asset) => {
        const target = resolve(outDir, asset.path as string);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, renderSvgIconAsset(asset, sourceNodes.get(asset.sourceNodeId)), "utf8");
      })
  );
}

function collectCanonicalNodesBySourceId(node: CanonicalNode, target: Map<string, CanonicalNode>): void {
  target.set(node.sourceNodeId, node);
  for (const child of node.children) collectCanonicalNodesBySourceId(child, target);
}

function renderSvgIconAsset(asset: AssetManifestEntry, node: CanonicalNode | undefined): string {
  const width = Math.max(1, Math.round(node?.bounds.w ?? 24));
  const height = Math.max(1, Math.round(node?.bounds.h ?? 24));
  const fill = solidFillHex(node);
  const opacity = clampOpacity(node?.style.opacity ?? 1);
  const title = escapeXml(asset.sourceName || asset.id);
  const shape =
    width === height
      ? `<circle cx="${width / 2}" cy="${height / 2}" r="${width / 2}" fill="${fill}" fill-opacity="${opacity}" />`
      : `<rect width="${width}" height="${height}" fill="${fill}" fill-opacity="${opacity}" />`;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${title}" data-uxc-source-node-id="${escapeXml(asset.sourceNodeId)}">`,
    `  <title>${title}</title>`,
    `  ${shape}`,
    "</svg>",
    ""
  ].join("\n");
}

function solidFillHex(node: CanonicalNode | undefined): string {
  const fill = node?.style.fills.find((paint) => paint.type === "SOLID" && paint.color);
  const color = fill?.color;
  if (!color) return "#000000";
  const red = colorChannelToHex(color.r);
  const green = colorChannelToHex(color.g);
  const blue = colorChannelToHex(color.b);
  return `#${red}${green}${blue}`;
}

function colorChannelToHex(value: number): string {
  return Math.round(Math.max(0, Math.min(1, value)) * 255)
    .toString(16)
    .padStart(2, "0");
}

function clampOpacity(value: number): number {
  return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 1));
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
    tokenConfidenceReport: artifacts.tokenConfidenceReport,
    assetManifest: overrideResult.reviewedAssetManifest,
    i18nManifest: overrideResult.reviewedI18nManifest,
    fidelityGenerationManifest: artifacts.fidelityGenerationManifest,
    overrideSet: overrideResult.overrideSet,
    staleOverrideReport: overrideResult.staleOverrideReport,
    visualDiffReport,
    upliftDecisions: artifacts.upliftDecisions,
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
    failed: [],
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
    if (asset.status === "failed") {
      report.failed.push({
        sourceNodeId: asset.sourceNodeId,
        name: asset.name,
        path: asset.path,
        reason: asset.reason ?? "Asset export failed before materialization."
      });
      continue;
    }

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
  const flutterAnalyze = await readFlutterAnalyzeStep(resolve(artifactDir, "flutter_preview_analyze_report.json"));
  let flutterCapture: LocalPipelineRunReport["steps"]["flutterCapture"];
  let visualDiff: LocalPipelineRunReport["steps"]["visualDiff"];

  if (shouldRunPreview) {
    try {
      const previewPath = resolve(artifactDir, "flutter_preview.png");
      const captureMetadata = {
        viewport: source.viewport
          ? {
              width: source.viewport.width,
              height: source.viewport.height
            }
          : undefined,
        dpr: source.viewport?.scale ?? 1,
        fonts: collectFontFamilies(artifacts)
      };
      const captureReport = await captureFlutterPreview(resolve(artifactDir, "flutter_preview"), previewPath, captureMetadata);
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
        failedAssets: materializedAssetReport.failed.length,
        frameScreenshotFallback: shouldUseFrameScreenshotFallback(body)
      },
      compile: {
        status: "success",
        normalizedConfidence: artifacts.normalizedDesignIR.confidence.overall
      },
      flutterAnalyze,
      flutterCapture,
      visualDiff
    }
  };
}

async function writePreviewArtifact(artifactDir: string, pipelineRunReport: LocalPipelineRunReport): Promise<void> {
  const diffDir = pipelineRunReport.steps.visualDiff.report ? dirname(pipelineRunReport.steps.visualDiff.report) : undefined;
  await writeJson(resolve(artifactDir, "preview_artifact.json"), {
    version: "0.1.0",
    generatedAt: new Date().toISOString(),
    artifactDir,
    source: pipelineRunReport.source,
    status: {
      flutterAnalyze: pipelineRunReport.steps.flutterAnalyze.status,
      flutterCapture: pipelineRunReport.steps.flutterCapture.status,
      visualDiff: pipelineRunReport.steps.visualDiff.status,
      pass: pipelineRunReport.steps.visualDiff.pass,
      visualScore: pipelineRunReport.steps.visualDiff.visualScore,
      pixelDiffRatio: pipelineRunReport.steps.visualDiff.pixelDiffRatio
    },
    files: {
      flutterPreview: pipelineRunReport.steps.flutterCapture.output,
      flutterAnalyzeReport: pipelineRunReport.steps.flutterAnalyze.report,
      flutterCaptureReport: pipelineRunReport.steps.flutterCapture.report,
      webPreviewState: resolve(artifactDir, "web_preview_state.json"),
      visualDiffReport: pipelineRunReport.steps.visualDiff.report,
      diffIssues: diffDir ? resolve(diffDir, "diff_issues.json") : undefined,
      nodeDiffReport: diffDir ? resolve(diffDir, "node_diff_report.json") : undefined,
      repairPatch: diffDir ? resolve(diffDir, "repair_patch.json") : undefined,
      repairIterationLog: diffDir ? resolve(diffDir, "repair_iteration_log.json") : undefined,
      heatmap: pipelineRunReport.steps.visualDiff.heatmap
    }
  });
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

async function analyzeFlutterPreview(previewDir: string): Promise<Record<string, unknown>> {
  const command = "flutter pub get && flutter analyze";
  try {
    const pubGet = await execFileAsync("flutter", ["pub", "get"], { cwd: previewDir });
    const analyze = await execFileAsync("flutter", ["analyze"], { cwd: previewDir });
    const parsed = parseAnalyzeOutput(`${analyze.stdout}\n${analyze.stderr}`);
    return {
      status: "success",
      command,
      errors: parsed.errors,
      warnings: parsed.warnings,
      pubGet: {
        stdout: pubGet.stdout,
        stderr: pubGet.stderr
      },
      stdout: analyze.stdout,
      stderr: analyze.stderr
    };
  } catch (error) {
    const candidate = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: string | number };
    if (candidate.code === "ENOENT") {
      return {
        status: "skipped",
        command,
        reason: "flutter command was not found"
      };
    }
    const parsed = parseAnalyzeOutput(`${candidate.stdout ?? ""}\n${candidate.stderr ?? ""}`);
    return {
      status: "failed",
      command,
      exitCode: candidate.code,
      errors: parsed.errors,
      warnings: parsed.warnings,
      stdout: candidate.stdout,
      stderr: candidate.stderr
    };
  }
}

function codegenFormatSummary(value: Record<string, unknown>, source: string): CodegenFormatSummary {
  const statusValue = stringValue(value.status)?.toLowerCase();
  const exitCode = numberValue(value.exitCode);
  const status: CodegenFormatSummary["status"] =
    statusValue === "success" || exitCode === 0
      ? "success"
      : statusValue === "skipped"
        ? "skipped"
        : statusValue === "failed" || statusValue === "error" || statusValue === "failure" || (exitCode ?? 0) > 0
          ? "failed"
          : "unknown";
  return {
    status,
    source,
    command: stringValue(value.command),
    stdout: stringValue(value.stdout),
    stderr: stringValue(value.stderr),
    raw: value
  };
}

function codegenAnalyzeSummary(value: Record<string, unknown>, source: string): CodegenAnalyzeSummary {
  return {
    errors: numberValue(value.errors) ?? 0,
    warnings: numberValue(value.warnings) ?? 0,
    source,
    stdout: stringValue(value.stdout),
    stderr: stringValue(value.stderr),
    raw: value
  };
}

async function captureFlutterPreview(projectDir: string, outPath: string, metadata: PreviewCaptureMetadata = {}): Promise<Record<string, unknown>> {
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
    viewport: metadata.viewport,
    dpr: metadata.dpr,
    fonts: metadata.fonts ?? [],
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
  await writeJson(resolve(options.outDir, "diff_issues.json"), result.nodeDiffReport);
  await writeJson(resolve(options.outDir, "repair_patch.json"), result.repairPatch);
  await writeJson(resolve(options.outDir, "repair_iteration_log.json"), result.repairIterationLog);
  if (result.manualReviewReport) {
    await writeJson(resolve(options.outDir, "manual_review_report.json"), result.manualReviewReport);
  }
  await writeFile(heatmapPath, result.heatmapPng);
  return result.visualDiffReport;
}

async function readFlutterAnalyzeStep(path: string): Promise<LocalPipelineRunReport["steps"]["flutterAnalyze"]> {
  try {
    const report = JSON.parse(await readFile(path, "utf8")) as Record<string, unknown>;
    return {
      status: stringValue(report.status) ?? "unknown",
      errors: numberValue(report.errors),
      warnings: numberValue(report.warnings),
      report: path,
      reason: stringValue(report.reason)
    };
  } catch {
    return {
      status: "missing",
      reason: "flutter_preview_analyze_report.json was not generated."
    };
  }
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

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function createWebPreviewState(visualIR: unknown): Record<string, unknown> {
  const root = objectValue(objectValue(visualIR)?.root);
  const size = objectValue(root?.size);
  const viewport = {
    width: numberValue(size?.w) ?? 0,
    height: numberValue(size?.h) ?? 0
  };
  const warnings: Array<{ type: string; message: string; sourceNodeId?: string }> = [];
  const commands: Array<Record<string, unknown>> = [];
  for (const child of arrayValue(root?.children) ?? []) {
    collectWebPreviewCommands(child, 0, 0, commands, warnings);
  }
  if (commands.length === 0) {
    warnings.push({ type: "empty_preview", message: "VisualIR did not contain drawable web preview nodes." });
  }
  return {
    version: "0.1.0",
    generatedAt: new Date().toISOString(),
    renderer: "web_canvas_state",
    viewport,
    commands,
    warnings
  };
}

function collectWebPreviewCommands(
  nodeValue: unknown,
  offsetX: number,
  offsetY: number,
  commands: Array<Record<string, unknown>>,
  warnings: Array<{ type: string; message: string; sourceNodeId?: string }>
): void {
  const node = objectValue(nodeValue);
  if (!node) return;
  const type = stringValue(node.type);
  if (type === "positioned") {
    const x = offsetX + (numberValue(node.x) ?? 0);
    const y = offsetY + (numberValue(node.y) ?? 0);
    collectWebPreviewCommands(node.child, x, y, commands, warnings);
    return;
  }
  if (type === "stack" || type === "scene") {
    for (const child of arrayValue(node.children) ?? []) collectWebPreviewCommands(child, offsetX, offsetY, commands, warnings);
    return;
  }
  const sourceNodeId = stringValue(node.sourceNodeId);
  const w = numberValue(node.w) ?? 0;
  const h = numberValue(node.h) ?? 0;
  if (w <= 0 || h <= 0) {
    warnings.push({ type: "invalid_bounds", message: "Skipped a web preview node with non-positive bounds.", sourceNodeId });
    return;
  }
  if (type === "rect") {
    commands.push({
      type: "rect",
      sourceNodeId,
      x: offsetX,
      y: offsetY,
      w,
      h,
      fill: stringValue(node.fill) ?? "#ffffff",
      stroke: stringValue(node.stroke),
      strokeWidth: numberValue(node.strokeWidth),
      radius: numberValue(node.radius),
      opacity: numberValue(node.opacity)
    });
    return;
  }
  if (type === "text") {
    commands.push({
      type: "text",
      sourceNodeId,
      x: offsetX,
      y: offsetY,
      w,
      h,
      text: stringValue(node.text) ?? "",
      color: stringValue(node.color) ?? "#111111",
      fontFamily: stringValue(node.fontFamily) ?? "Inter, system-ui, sans-serif",
      fontSize: numberValue(node.fontSize) ?? 14,
      fontWeight: numberValue(node.fontWeight) ?? 400,
      lineHeight: numberValue(node.lineHeight)
    });
    return;
  }
  if (type === "image") {
    commands.push({
      type: "image",
      sourceNodeId,
      x: offsetX,
      y: offsetY,
      w,
      h,
      mode: stringValue(node.mode) ?? "placeholder",
      assetPath: stringValue(node.assetPath)
    });
    return;
  }
  warnings.push({ type: "unsupported_node", message: `Skipped unsupported VisualIR node type: ${type ?? "unknown"}.`, sourceNodeId });
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function parseAnalyzeOutput(output: string): { errors: number; warnings: number } {
  const result = { errors: 0, warnings: 0 };
  if (!output.trim()) return result;
  for (const line of output.split(/\r?\n/)) {
    const lower = line.toLowerCase();
    const errorSummary = lower.match(/\b(\d+)\s+errors?\b/);
    const warningSummary = lower.match(/\b(\d+)\s+warnings?\b/);
    if (errorSummary) result.errors = Math.max(result.errors, Number(errorSummary[1]));
    if (warningSummary) result.warnings = Math.max(result.warnings, Number(warningSummary[1]));
    if (/\berror\s*[•:-]/.test(lower) || /:\s*error\s*$/.test(lower)) result.errors += 1;
    if (/\bwarning\s*[•:-]/.test(lower) || /:\s*warning\s*$/.test(lower)) result.warnings += 1;
  }
  return result;
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "snapshot";
}

type ZipEntryOutput = {
  name: string;
  data: Buffer;
};

function readStoredZip(buffer: Buffer): ZipEntryOutput[] {
  const eocdOffset = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocdOffset === -1) throw new Error("Invalid zip archive: missing end of central directory.");
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries: ZipEntryOutput[] = [];
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Invalid zip archive: corrupt central directory.");
    const method = buffer.readUInt16LE(cursor + 10);
    if (method !== 0) throw new Error("Unsupported snapshot zip: only stored entries are supported.");
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    assertSafeArchivePath(name);
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("Invalid zip archive: corrupt local entry.");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    entries.push({ name, data: buffer.subarray(dataStart, dataStart + compressedSize) });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function assertSafeArchivePath(path: string): void {
  if (!path || path.startsWith("/") || path.includes("..") || path.includes("\\")) {
    throw new Error(`Unsafe snapshot zip path: ${path}`);
  }
}
