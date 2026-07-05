import type { OverrideSet, OverrideTarget, StaleOverride, UxOverride } from "./override.js";
import type { ReviewTask } from "./review-task.js";

export type NodeRemapMethod = "node_id_exact" | "stable_key" | "similarity" | "unmatched";

export type DesignChangeType =
  | "unchanged"
  | "visual_only_change"
  | "text_change"
  | "token_value_change"
  | "asset_change"
  | "layout_change"
  | "node_added"
  | "node_removed"
  | "component_structure_change";

export type TokenMigrationKind = "color" | "typography" | "radius";

export type TokenMigrationChangeType = "added" | "removed" | "value_changed";

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
  visualDiffChange: VisualDiffChange;
  matches: NodeRemapMatch[];
  addedSourceNodeIds: string[];
  removedSourceNodeIds: string[];
  staleOverrides: StaleOverride[];
}

export interface VisualDiffChange {
  status: "available" | "missing" | "missing_old" | "missing_new";
  oldVisualScore?: number;
  newVisualScore?: number;
  visualScoreDelta?: number;
  oldPixelDiffRatio?: number;
  newPixelDiffRatio?: number;
  pixelDiffRatioDelta?: number;
}

export interface TokenMigrationChange {
  kind: TokenMigrationKind;
  changeType: TokenMigrationChangeType;
  key: string;
  oldValue?: string | number;
  newValue?: string | number;
  oldSourceNodeIds: string[];
  newSourceNodeIds: string[];
  confidence: number;
  reason: string;
}

export interface TokenMigrationReport {
  version: string;
  generatedAt: string;
  oldSnapshotId?: string;
  newSnapshotId?: string;
  status: "unchanged" | "changed" | "migration_recommended";
  summary: {
    oldTokenLikeValues: number;
    newTokenLikeValues: number;
    added: number;
    removed: number;
    valueChanged: number;
  };
  changes: TokenMigrationChange[];
  warnings: Array<{ type: string; message: string }>;
}

export interface IncrementalSyncRemapResult {
  version: string;
  oldSnapshotId?: string;
  newSnapshotId?: string;
  overrideSet: OverrideSet;
  nodeRemapReport: NodeRemapReport;
  tokenMigrationReport: TokenMigrationReport;
  reappliedOverrides: ReappliedOverride[];
  staleOverrides: StaleOverride[];
  incrementalReviewTasks: ReviewTask[];
}
