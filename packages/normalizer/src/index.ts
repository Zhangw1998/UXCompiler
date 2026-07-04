import type { OverrideSet, PipelineArtifacts, RawFigmaScene } from "@uxcompiler/ir-schemas";
import { normalizeAssetsAndI18n } from "@uxcompiler/asset-i18n-normalizer";
import { generateFlutterFidelity } from "@uxcompiler/flutter-fidelity-renderer";
import { canonicalizeRawScene } from "@uxcompiler/scene-canonicalizer";
import { inferLayout } from "@uxcompiler/layout-inferencer";
import { mineTokens } from "@uxcompiler/token-miner";
import { generateReviewTasks } from "@uxcompiler/review-task-engine";
import { applyOverrides } from "@uxcompiler/override-engine";

export interface CompileRawSceneOptions {
  materializedAssetSourceNodeIds?: readonly string[];
  frameScreenshotAssetPath?: string;
  overrideSet?: OverrideSet;
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
  const overrideResult = applyOverrides({
    normalizedDesignIR: layoutResult.normalizedDesignIR,
    assetManifest: assetI18nResult.assetManifest,
    i18nManifest: assetI18nResult.i18nManifest,
    inferredTokens: tokenResult.inferredTokens,
    overrideSet: options.overrideSet
  });
  const reviewTaskResult = generateReviewTasks({
    normalizedDesignIR: overrideResult.reviewedNormalizedDesignIR,
    layoutCandidates: layoutResult.layoutCandidates,
    layoutDecisions: layoutResult.layoutDecisions,
    inferredTokens: overrideResult.reviewedInferredTokens,
    tokenConfidenceReport: tokenResult.confidenceReport,
    assetManifest: overrideResult.reviewedAssetManifest,
    i18nManifest: overrideResult.reviewedI18nManifest,
    fidelityGenerationManifest: fidelityResult.fidelityGenerationManifest,
    staleOverrideReport: overrideResult.staleOverrideReport
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
    overrideSet: overrideResult.overrideSet,
    reviewedNormalizedDesignIR: overrideResult.reviewedNormalizedDesignIR,
    reviewedAssetManifest: overrideResult.reviewedAssetManifest,
    reviewedI18nManifest: overrideResult.reviewedI18nManifest,
    reviewedInferredTokens: overrideResult.reviewedInferredTokens,
    reviewedArbFile: overrideResult.reviewedArbFile,
    overrideConflictReport: overrideResult.overrideConflictReport,
    staleOverrideReport: overrideResult.staleOverrideReport,
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
