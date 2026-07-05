export type ReviewTaskPriority = "P0" | "P1" | "P2";

export type ReviewTaskType =
  | "low_confidence_layout"
  | "low_confidence_component"
  | "ambiguous_name"
  | "token_conflict"
  | "asset_strategy_uncertain"
  | "i18n_key_uncertain"
  | "visual_diff_failed"
  | "font_missing"
  | "stale_override"
  | "flutter_analyze_failed"
  | "resource_export_failed"
  | "component_mapping_required"
  | "semantic_uplift_pending";

export type ReviewTaskStatus = "open" | "closed";

export interface OverrideSuggestion {
  type: string;
  payload: Record<string, unknown>;
  reason?: string;
}

export interface ReviewTaskSuggestedAction {
  label: string;
  override: OverrideSuggestion;
}

export interface ReviewTaskTarget {
  normalizedNodeId?: string;
  candidateId?: string;
  sourceNodeIds?: string[];
  assetId?: string;
  tokenName?: string;
  messageKey?: string;
  diffIssueId?: string;
  filePath?: string;
}

export interface ReviewTask {
  id: string;
  type: ReviewTaskType;
  priority: ReviewTaskPriority;
  target: ReviewTaskTarget;
  title: string;
  description: string;
  confidence: number;
  evidence: Record<string, unknown>;
  suggestedActions: ReviewTaskSuggestedAction[];
  status: ReviewTaskStatus;
  closedReason?: string;
  closeReason?: string;
  closedAt?: string;
  closedBy?: string;
  closedByOverrideId?: string;
}

export interface ReviewTaskStatusReport {
  version: string;
  generatedAt: string;
  total: number;
  open: number;
  byPriority: Record<ReviewTaskPriority, number>;
  byType: Partial<Record<ReviewTaskType, number>>;
  codegenWriteBlocked: boolean;
  blockedReasons: string[];
}

export interface ReviewTaskResult {
  reviewTasks: ReviewTask[];
  taskStatusReport: ReviewTaskStatusReport;
}
