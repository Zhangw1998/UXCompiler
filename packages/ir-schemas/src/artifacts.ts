import type { CanonicalScene, CanonicalizationReport, NodeMapping } from "./canonical-scene.js";
import type { LayoutCandidate, LayoutDecision, NormalizedDesignIR, Region } from "./layout.js";
import type { RawFigmaScene } from "./raw-figma-scene.js";
import type { InferredTokens, TokenConfidenceReport, TokenUsageMap } from "./tokens.js";
import type { AssetManifest, I18nManifest } from "./asset-i18n.js";
import type {
  FidelityGenerationManifest,
  FlutterPreviewProject,
  NodePixelMapEntry,
  VisualIR
} from "./visual-ir.js";
import type { ReviewTask, ReviewTaskStatusReport } from "./review-task.js";
import type { OverrideConflictReport, OverrideSet, StaleOverrideReport } from "./override.js";

export interface InferredComponentsArtifact {
  version: string;
  status: "candidates_detected" | "no_reusable_components_detected";
  candidates: unknown[];
  confidence: number;
  fallback?: string;
}

export interface SemanticLabelsArtifact {
  version: string;
  source: "deterministic_fallback" | "ai";
  status: "ready" | "needs_ai_review";
  regions: Array<{
    regionId: string;
    suggestedName: string;
    role: string;
    sourceNodeIds: string[];
    confidence: number;
    reason: string;
  }>;
  nodes: Array<{
    nodeId: string;
    sourceNodeIds: string[];
    suggestedName: string;
    role: string;
    confidence: number;
    reason: string;
  }>;
  assets: Array<{
    sourceNodeId: string;
    suggestedName: string;
    assetKind: string;
    confidence: number;
  }>;
  i18n: Array<{
    sourceNodeId: string;
    text: string;
    suggestedKey: string;
    confidence: number;
  }>;
  warnings: Array<{ type: string; message: string; sourceNodeId?: string }>;
}

export interface SemanticIRArtifact {
  version: string;
  status: "fidelity_preserved" | "uplift_ready";
  normalizedDesignIR: NormalizedDesignIR;
  semanticLabels: SemanticLabelsArtifact;
  inferredComponents: InferredComponentsArtifact;
  upliftDecisions: unknown[];
  fallbackReason?: string;
}

export interface PipelineArtifacts {
  rawFigmaScene: RawFigmaScene;
  canonicalScene: CanonicalScene;
  canonicalizationReport: CanonicalizationReport;
  nodeMapping: NodeMapping;
  inferredTokens: InferredTokens;
  tokenUsageMap: TokenUsageMap;
  tokenConfidenceReport: TokenConfidenceReport;
  dartTokenFile: string;
  assetManifest: AssetManifest;
  i18nManifest: I18nManifest;
  arbFile: Record<string, unknown>;
  overrideSet: OverrideSet;
  reviewedNormalizedDesignIR: NormalizedDesignIR;
  reviewedAssetManifest: AssetManifest;
  reviewedI18nManifest: I18nManifest;
  reviewedInferredTokens: InferredTokens;
  reviewedArbFile: Record<string, unknown>;
  overrideConflictReport: OverrideConflictReport;
  staleOverrideReport: StaleOverrideReport;
  visualIR: VisualIR;
  fidelityGenerationManifest: FidelityGenerationManifest;
  nodePixelMap: NodePixelMapEntry[];
  reviewTasks: ReviewTask[];
  taskStatusReport: ReviewTaskStatusReport;
  flutterPreviewProject: FlutterPreviewProject;
  regions: Region[];
  layoutCandidates: LayoutCandidate[];
  layoutDecisions: LayoutDecision[];
  inferredComponents: InferredComponentsArtifact;
  semanticLabels: SemanticLabelsArtifact;
  semanticIR: SemanticIRArtifact;
  normalizedDesignIR: NormalizedDesignIR;
}
