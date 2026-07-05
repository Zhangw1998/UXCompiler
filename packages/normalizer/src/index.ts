import type {
  AssetManifest,
  I18nManifest,
  InferredComponentsArtifact,
  NormalizedDesignIR,
  NormalizedNode,
  OverrideSet,
  PipelineArtifacts,
  RawFigmaScene,
  Region,
  SemanticIRArtifact,
  SemanticLabelsArtifact
} from "@uxcompiler/ir-schemas";
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
  const inferredComponents = createInferredComponentsArtifact(layoutResult.normalizedDesignIR);
  const semanticLabels = createSemanticLabelsArtifact({
    normalizedDesignIR: layoutResult.normalizedDesignIR,
    regions: layoutResult.regions,
    assetManifest: assetI18nResult.assetManifest,
    i18nManifest: assetI18nResult.i18nManifest
  });
  const semanticIR = createSemanticIRArtifact(layoutResult.normalizedDesignIR, inferredComponents, semanticLabels);

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
    inferredComponents,
    semanticLabels,
    semanticIR,
    normalizedDesignIR: layoutResult.normalizedDesignIR
  };
}

function createInferredComponentsArtifact(normalizedDesignIR: NormalizedDesignIR): InferredComponentsArtifact {
  const candidates = Array.isArray(normalizedDesignIR.components) ? normalizedDesignIR.components : [];
  return {
    version: "2.0",
    status: candidates.length > 0 ? "candidates_detected" : "no_reusable_components_detected",
    candidates,
    confidence: normalizedDesignIR.confidence.components,
    fallback: candidates.length > 0 ? undefined : "generate_separate_widgets"
  };
}

function createSemanticLabelsArtifact(input: {
  normalizedDesignIR: NormalizedDesignIR;
  regions: Region[];
  assetManifest: AssetManifest;
  i18nManifest: I18nManifest;
}): SemanticLabelsArtifact {
  const nodes: SemanticLabelsArtifact["nodes"] = [];
  walkNormalized(input.normalizedDesignIR.tree, (node) => {
    nodes.push({
      nodeId: node.id,
      sourceNodeIds: node.sourceNodeIds,
      suggestedName: lowerCamel(node.name || node.id),
      role: node.role ?? node.type,
      confidence: node.confidence,
      reason: "Deterministic semantic fallback derived from normalized node role, type, and source name."
    });
  });

  return {
    version: "2.0",
    source: "deterministic_fallback",
    status: "needs_ai_review",
    regions: input.regions.map((region) => ({
      regionId: region.id,
      suggestedName: region.name,
      role: region.role,
      sourceNodeIds: region.sourceNodeIds,
      confidence: 0.78,
      reason: "Region role inferred from vertical segmentation and frame position."
    })),
    nodes,
    assets: input.assetManifest.assets
      .filter((asset) => asset.strategy !== "real_text" && asset.strategy !== "ignored")
      .map((asset) => ({
        sourceNodeId: asset.sourceNodeId,
        suggestedName: asset.path ? fileStem(asset.path) : lowerSnake(asset.sourceName || asset.id),
        assetKind: asset.strategy,
        confidence: asset.confidence
      })),
    i18n: input.i18nManifest.messages.map((message) => ({
      sourceNodeId: message.sourceNodeId,
      text: message.value,
      suggestedKey: message.key,
      confidence: message.confidence
    })),
    warnings: [
      {
        type: "ai_labeling_not_run",
        message: "Semantic labels were generated by deterministic fallback rules; run AI semantic labeling before automatic semantic uplift."
      }
    ]
  };
}

function createSemanticIRArtifact(
  normalizedDesignIR: NormalizedDesignIR,
  inferredComponents: InferredComponentsArtifact,
  semanticLabels: SemanticLabelsArtifact
): SemanticIRArtifact {
  return {
    version: "2.0",
    status: "fidelity_preserved",
    normalizedDesignIR,
    semanticLabels,
    inferredComponents,
    upliftDecisions: [],
    fallbackReason: "No diff-verified semantic uplift decisions have been accepted yet, so fidelity rendering remains authoritative."
  };
}

function walkNormalized(node: NormalizedNode, visit: (node: NormalizedNode) => void): void {
  visit(node);
  for (const child of node.children) walkNormalized(child, visit);
}

function lowerCamel(value: string): string {
  const words = wordsFrom(value);
  if (words.length === 0) return "node";
  return words
    .map((word, index) => (index === 0 ? word.toLowerCase() : `${word[0].toUpperCase()}${word.slice(1).toLowerCase()}`))
    .join("");
}

function lowerSnake(value: string): string {
  const words = wordsFrom(value);
  return words.length > 0 ? words.map((word) => word.toLowerCase()).join("_") : "asset";
}

function fileStem(path: string): string {
  const name = path.split("/").pop() ?? path;
  return lowerSnake(name.replace(/\.[^.]+$/, ""));
}

function wordsFrom(value: string): string[] {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}
