import type { Bounds } from "./canonical-scene.js";
import type { InferredTokens } from "./tokens.js";

export type LayoutType = "column" | "row" | "grid" | "stack" | "absolute" | "leaf";

export interface Region {
  id: string;
  name: string;
  role: "header" | "content" | "footer" | "overlay" | "section";
  bounds: Bounds;
  sourceNodeIds: string[];
}

export interface LayoutDecision {
  nodeId: string;
  sourceNodeIds: string[];
  layout: LayoutType;
  score: number;
  confidence: number;
  evidence: string[];
  fallback?: LayoutType;
}

export interface LayoutCandidate {
  nodeId: string;
  candidates: Array<{ layout: LayoutType; score: number; evidence: string[] }>;
}

export interface NormalizedNode {
  id: string;
  sourceNodeIds: string[];
  type: "page" | "region" | "container" | "text" | "rect" | "image" | "vector";
  name: string;
  layout: { type: LayoutType; gap?: string | number };
  bounds: Bounds;
  tokenRefs?: Record<string, string>;
  children: NormalizedNode[];
  confidence: number;
}

export interface NormalizedDesignIR {
  version: string;
  source: {
    frameNodeId?: string;
    viewport: { width: number; height: number };
  };
  tokens: InferredTokens;
  components: unknown[];
  tree: NormalizedNode;
  fallbacks: Array<{ nodeId: string; reason: string; strategy: string }>;
  confidence: {
    overall: number;
    tokens: number;
    layout: number;
    components: number;
  };
}

export interface LayoutInferenceResult {
  regions: Region[];
  layoutCandidates: LayoutCandidate[];
  layoutDecisions: LayoutDecision[];
  normalizedDesignIR: NormalizedDesignIR;
}
