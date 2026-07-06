import type { CanonicalScene, CanonicalizationReport, NodeMapping } from "./canonical-scene.js";
import type { LayoutCandidate, LayoutDecision, NormalizedDesignIR, Region, RegionTreeNode } from "./layout.js";
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

export interface ComponentInstanceMapArtifact {
  version: string;
  components: Array<{
    componentId: string;
    name?: string;
    instances: Array<{ sourceNodeIds: string[]; nodeId?: string }>;
    status: "candidate" | "accepted" | "rejected" | "fallback";
  }>;
  unmappedSourceNodeIds: string[];
}

export interface ComponentConfidenceReportArtifact {
  version: string;
  status: "ready" | "no_candidates";
  candidates: Array<{
    componentId: string;
    name?: string;
    confidence: number;
    instanceCount: number;
    gate: "auto_reusable" | "needs_review" | "fallback";
    reason: string;
  }>;
  warnings: Array<{ type: string; message: string; componentId?: string }>;
}

export interface AiDecisionReportArtifact {
  version: string;
  status: "not_run" | "accepted" | "partially_accepted" | "rejected";
  decisions: unknown[];
  accepted: unknown[];
  rejected: unknown[];
  warnings: Array<{ type: string; message: string }>;
}

export interface NamingMapArtifact {
  version: string;
  regions: Record<string, string>;
  nodes: Record<string, string>;
  assets: Record<string, string>;
  i18n: Record<string, string>;
}

export interface I18nKeySuggestionsArtifact {
  version: string;
  locale: string;
  suggestions: Array<{
    sourceNodeId: string;
    text: string;
    suggestedKey: string;
    confidence: number;
    status: "accepted_fallback" | "needs_review";
  }>;
}

export interface UpliftDecisionArtifact {
  version: string;
  decisions: Array<{
    regionId?: string;
    sourceNodeIds: string[];
    from: string;
    to: string;
    strategy?: string;
    gate?: "auto_diff_required" | "review_diff_required" | "keep_fidelity";
    scoreBreakdown?: {
      semanticConfidence: number;
      layoutConfidence: number;
      componentConfidence: number;
      expectedDiffSafety: number;
    };
    confidence: number;
    accepted: boolean;
    reason: string;
  }>;
}

export interface UpliftDiffReportArtifact {
  version: string;
  status: "not_run" | "passed" | "failed";
  baseline?: string;
  comparisons: unknown[];
  reason?: string;
}

export interface NormalizationReportArtifact {
  version: string;
  source: {
    fileKey?: string;
    fileName?: string;
    frameNodeId?: string;
  };
  score: {
    overall: number;
    tokens: number;
    layout: number;
    components: number;
    assets: number;
  };
  issues: Array<{
    type: string;
    sourceNodeIds: string[];
    message: string;
    fallback?: string;
  }>;
}

export interface RenderStrategyManifestArtifact {
  version: string;
  page: string;
  viewport: { width: number; height: number };
  regions: Array<{
    regionId: string;
    sourceNodeIds: string[];
    strategy: string;
    reason: string;
    editable: boolean;
    confidence: number;
  }>;
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
  regionTree: RegionTreeNode;
  layoutCandidates: LayoutCandidate[];
  layoutDecisions: LayoutDecision[];
  inferredComponents: InferredComponentsArtifact;
  componentInstanceMap: ComponentInstanceMapArtifact;
  componentConfidenceReport: ComponentConfidenceReportArtifact;
  semanticLabels: SemanticLabelsArtifact;
  aiDecisionReport: AiDecisionReportArtifact;
  namingMap: NamingMapArtifact;
  i18nKeySuggestions: I18nKeySuggestionsArtifact;
  semanticIR: SemanticIRArtifact;
  upliftDecisions: UpliftDecisionArtifact;
  upliftDiffReport: UpliftDiffReportArtifact;
  normalizationReport: NormalizationReportArtifact;
  renderStrategyManifest: RenderStrategyManifestArtifact;
  normalizedDesignIR: NormalizedDesignIR;
}
