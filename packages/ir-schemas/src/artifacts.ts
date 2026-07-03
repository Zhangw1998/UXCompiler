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
  visualIR: VisualIR;
  fidelityGenerationManifest: FidelityGenerationManifest;
  nodePixelMap: NodePixelMapEntry[];
  reviewTasks: ReviewTask[];
  taskStatusReport: ReviewTaskStatusReport;
  flutterPreviewProject: FlutterPreviewProject;
  regions: Region[];
  layoutCandidates: LayoutCandidate[];
  layoutDecisions: LayoutDecision[];
  normalizedDesignIR: NormalizedDesignIR;
}
