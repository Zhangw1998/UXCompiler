import type { OverrideSet, OverrideTarget, StaleOverride, UxOverride } from "./override.js";
import type { ReviewTask } from "./review-task.js";

export type NodeRemapMethod = "node_id_exact" | "stable_key" | "similarity" | "unmatched";

export type DesignChangeType =
  | "unchanged"
  | "visual_only_change"
  | "text_change"
  | "layout_change"
  | "node_added"
  | "node_removed"
  | "component_structure_change";

export interface NodeRemapMatch {
  oldSourceNodeId: string;
  newSourceNodeId?: string;
  matchScore: number;
  method: NodeRemapMethod;
  changeType: DesignChangeType;
  overrideReapplied: boolean;
  reviewRequired: boolean;
  evidence: {
    oldPath: string;
    newPath?: string;
    oldStableKey: string;
    newStableKey?: string;
    pathSimilarity: number;
    visualHashMatch: boolean;
    textSimilarity: number;
    siblingContextSimilarity: number;
  };
}

export interface ReappliedOverride {
  overrideId: string;
  type: UxOverride["type"];
  oldTarget: OverrideTarget;
  newTarget: OverrideTarget;
  remappedSourceNodeIds: Array<{ oldSourceNodeId: string; newSourceNodeId: string; matchScore: number }>;
  confidence: number;
  reviewRequired: boolean;
}

export interface NodeRemapReport {
  version: string;
  generatedAt: string;
  oldSnapshotId?: string;
  newSnapshotId?: string;
  rawSceneChanged: boolean;
  matches: NodeRemapMatch[];
  addedSourceNodeIds: string[];
  removedSourceNodeIds: string[];
  staleOverrides: StaleOverride[];
}

export interface IncrementalSyncRemapResult {
  version: string;
  oldSnapshotId?: string;
  newSnapshotId?: string;
  overrideSet: OverrideSet;
  nodeRemapReport: NodeRemapReport;
  reappliedOverrides: ReappliedOverride[];
  staleOverrides: StaleOverride[];
  incrementalReviewTasks: ReviewTask[];
}
