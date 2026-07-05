import type { Bounds } from "./canonical-scene.js";
import type { UxOverride } from "./override.js";

export interface VisualDiffScore {
  visualScore: number;
  pixelDiffRatio: number;
  diffPixels: number;
  totalPixels: number;
}

export interface NodeDiffIssue {
  issueId: string;
  type: "pixel_diff_region" | "size_mismatch";
  sourceNodeId?: string;
  bounds?: Bounds;
  score: VisualDiffScore;
  suggestedFixes: Array<{ type: string; payload: Record<string, unknown> }>;
}

export interface VisualDiffReport {
  version: string;
  generatedAt: string;
  inputs: {
    reference: string;
    candidate: string;
    heatmap: string;
  };
  environment: {
    viewport?: { width: number; height: number };
    dpr: number;
    fonts: string[];
    flutterVersion?: string;
    renderer: "png_pixelmatch";
  };
  page: {
    pass: boolean;
    score: VisualDiffScore;
    threshold: {
      visualScore: number;
      pixelDiffRatio: number;
    };
  };
  issues: NodeDiffIssue[];
  warnings: Array<{ type: string; message: string }>;
}

export interface VisualDiffManualReviewReport {
  version: string;
  generatedAt: string;
  required: boolean;
  reason: string;
  severity: "P0" | "P1";
  inputs: VisualDiffReport["inputs"];
  page: VisualDiffReport["page"];
  issues: Array<{
    issueId: string;
    type: NodeDiffIssue["type"];
    sourceNodeId?: string;
    bounds?: Bounds;
    score: VisualDiffScore;
  }>;
  suggestedActions: Array<{ label: string; reason: string; payload: Record<string, unknown> }>;
}

export interface VisualDiffRepairPatchOperation {
  patchId: string;
  issueId: string;
  target: "override_set";
  operation: "add_override";
  sourceNodeId?: string;
  override: UxOverride;
  rollback: {
    type: "disable_override";
    overrideId: string;
  };
  reason: string;
}

export interface VisualDiffRepairPatch {
  version: string;
  generatedAt: string;
  status: "not_needed" | "proposed";
  inputs: VisualDiffReport["inputs"];
  page: VisualDiffReport["page"];
  patches: VisualDiffRepairPatchOperation[];
}

export interface VisualDiffRepairIterationLog {
  version: string;
  generatedAt: string;
  maxIterations: number;
  iterations: Array<{
    iteration: number;
    status: "not_run" | "proposed";
    visualScore: number;
    pixelDiffRatio: number;
    repairPatchPath: string;
    rollbackAvailable: boolean;
    reason: string;
  }>;
}

export interface VisualDiffResult {
  visualDiffReport: VisualDiffReport;
  nodeDiffReport: NodeDiffIssue[];
  heatmapPng: Uint8Array;
  repairPatch: VisualDiffRepairPatch;
  repairIterationLog: VisualDiffRepairIterationLog;
  manualReviewReport?: VisualDiffManualReviewReport;
}
