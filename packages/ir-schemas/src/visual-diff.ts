import type { Bounds } from "./canonical-scene.js";

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

export interface VisualDiffResult {
  visualDiffReport: VisualDiffReport;
  nodeDiffReport: NodeDiffIssue[];
  heatmapPng: Uint8Array;
}
