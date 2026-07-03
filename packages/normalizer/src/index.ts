import type { PipelineArtifacts, RawFigmaScene } from "@uxcompiler/ir-schemas";
import { normalizeAssetsAndI18n } from "@uxcompiler/asset-i18n-normalizer";
import { generateFlutterFidelity } from "@uxcompiler/flutter-fidelity-renderer";
import { canonicalizeRawScene } from "@uxcompiler/scene-canonicalizer";
import { inferLayout } from "@uxcompiler/layout-inferencer";
import { mineTokens } from "@uxcompiler/token-miner";
import { generateReviewTasks } from "@uxcompiler/review-task-engine";

export interface CompileRawSceneOptions {
  materializedAssetSourceNodeIds?: readonly string[];
  frameScreenshotAssetPath?: string;
}

export function compileRawScene(rawFigmaScene: RawFigmaScene, options: CompileRawSceneOptions = {}): PipelineArtifacts {
  const canonicalResult = canonicalizeRawScene(rawFigmaScene);
  const tokenResult = mineTokens(canonicalResult.canonicalScene);
  const assetI18nResult = normalizeAssetsAndI18n(canonicalResult.canonicalScene);
  const fidelityResult = generateFlutterFidelity(canonicalResult.canonicalScene, {
    assetManifest: assetI18nResult.assetManifest,
    materializedAssetSourceNodeIds: options.materializedAssetSourceNodeIds,
    frameScreenshotAssetPath: options.frameScreenshotAssetPath
  });
  const layoutResult = inferLayout(canonicalResult.canonicalScene, tokenResult.inferredTokens);
  const reviewTaskResult = generateReviewTasks({
    normalizedDesignIR: layoutResult.normalizedDesignIR,
    layoutCandidates: layoutResult.layoutCandidates,
    layoutDecisions: layoutResult.layoutDecisions,
    inferredTokens: tokenResult.inferredTokens,
    assetManifest: assetI18nResult.assetManifest,
    i18nManifest: assetI18nResult.i18nManifest,
    fidelityGenerationManifest: fidelityResult.fidelityGenerationManifest
  });

  return {
    rawFigmaScene,
    canonicalScene: canonicalResult.canonicalScene,
    canonicalizationReport: canonicalResult.report,
    nodeMapping: canonicalResult.nodeMapping,
    inferredTokens: tokenResult.inferredTokens,
    tokenUsageMap: tokenResult.tokenUsageMap,
    tokenConfidenceReport: tokenResult.confidenceReport,
    dartTokenFile: tokenResult.dartTokenFile,
    assetManifest: assetI18nResult.assetManifest,
    i18nManifest: assetI18nResult.i18nManifest,
    arbFile: assetI18nResult.arbFile,
    visualIR: fidelityResult.visualIR,
    fidelityGenerationManifest: fidelityResult.fidelityGenerationManifest,
    nodePixelMap: fidelityResult.nodePixelMap,
    reviewTasks: reviewTaskResult.reviewTasks,
    taskStatusReport: reviewTaskResult.taskStatusReport,
    flutterPreviewProject: fidelityResult.flutterPreviewProject,
    regions: layoutResult.regions,
    layoutCandidates: layoutResult.layoutCandidates,
    layoutDecisions: layoutResult.layoutDecisions,
    normalizedDesignIR: layoutResult.normalizedDesignIR
  };
}
