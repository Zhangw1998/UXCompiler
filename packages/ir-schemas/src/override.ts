export type OverrideType =
  | "node_parent_override"
  | "region_create_override"
  | "region_merge_override"
  | "region_split_override"
  | "layout_strategy_override"
  | "render_strategy_override"
  | "naming_override"
  | "component_candidate_override"
  | "component_prop_override"
  | "component_variant_override"
  | "token_merge_override"
  | "token_split_override"
  | "token_rename_override"
  | "asset_strategy_override"
  | "i18n_key_override"
  | "flutter_component_mapping_override"
  | "text_calibration_override"
  | "ignore_node_override";

export type OverrideStatus = "active" | "disabled";

export interface OverrideTarget {
  kind: "source_node" | "normalized_node" | "token" | "asset" | "i18n_message" | "page";
  sourceNodeId?: string;
  normalizedNodeId?: string;
  tokenName?: string;
  assetId?: string;
  messageKey?: string;
}

export interface UxOverride {
  id: string;
  scope?: "project" | "snapshot";
  type: OverrideType;
  target: OverrideTarget;
  payload: Record<string, unknown>;
  status: OverrideStatus;
  createdBy: "user" | "agent" | "system";
  createdAt: string;
  updatedAt?: string;
}

export interface OverrideSet {
  id: string;
  version: number;
  snapshotId?: string;
  hash: string;
  overrides: UxOverride[];
}

export interface OverrideConflict {
  overrideIds: string[];
  type: "duplicate_target" | "invalid_payload" | "cycle" | "unsupported_override";
  message: string;
  target?: OverrideTarget;
}

export interface OverrideConflictReport {
  version: string;
  generatedAt: string;
  conflicts: OverrideConflict[];
  warnings: Array<{ overrideId?: string; type: string; message: string }>;
}

export interface StaleOverride {
  overrideId: string;
  type: OverrideType;
  target: OverrideTarget;
  reason: string;
}

export interface StaleOverrideReport {
  version: string;
  generatedAt: string;
  staleOverrides: StaleOverride[];
  appliedOverrideIds: string[];
}
