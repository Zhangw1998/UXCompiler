import type { LayoutType, NormalizedDesignIR } from "./layout.js";
import type { OverrideConflictReport, OverrideSet, StaleOverrideReport, UxOverride } from "./override.js";

export type TreeEditOperation =
  | {
      id?: string;
      kind: "create_region";
      regionId: string;
      name: string;
      role?: "header" | "content" | "footer" | "overlay" | "section" | "list" | "decoration";
      sourceNodeIds: string[];
      layout?: LayoutType;
      reason: string;
    }
  | {
      id?: string;
      kind: "merge_regions";
      sourceRegionIds: string[];
      targetRegionId: string;
      name: string;
      role?: "header" | "content" | "footer" | "overlay" | "section" | "list" | "decoration";
      layout?: LayoutType;
      reason: string;
    }
  | {
      id?: string;
      kind: "split_region";
      sourceRegionId: string;
      regionId: string;
      name: string;
      role?: "header" | "content" | "footer" | "overlay" | "section" | "list" | "decoration";
      sourceNodeIds: string[];
      layout?: LayoutType;
      reason: string;
    }
  | {
      id?: string;
      kind: "move_node";
      normalizedNodeId?: string;
      sourceNodeId?: string;
      targetNormalizedParentId: string;
      reason: string;
    }
  | {
      id?: string;
      kind: "rename_node";
      normalizedNodeId?: string;
      sourceNodeId?: string;
      name: string;
      reason: string;
    }
  | {
      id?: string;
      kind: "force_layout";
      normalizedNodeId?: string;
      sourceNodeId?: string;
      strategy: LayoutType;
      reason: string;
    }
  | {
      id?: string;
      kind: "force_render";
      normalizedNodeId?: string;
      sourceNodeId?: string;
      strategy: "semantic_widget" | "semantic_layout" | "absolute_widget" | "custom_painter" | "asset_slice" | "hybrid_region" | "ignore";
      reason: string;
    }
  | {
      id?: string;
      kind: "ignore_node";
      normalizedNodeId?: string;
      sourceNodeId?: string;
      reason: string;
    };

export interface TreeEditValidationIssue {
  operationId: string;
  severity: "error" | "warning";
  code:
    | "missing_reason"
    | "missing_target"
    | "missing_source"
    | "duplicate_source"
    | "duplicate_region"
    | "invalid_parent"
    | "cycle"
    | "invalid_render_strategy"
    | "invalid_name"
    | "unsupported_operation";
  message: string;
}

export interface TreeEditValidationReport {
  version: string;
  issues: TreeEditValidationIssue[];
  validOperationIds: string[];
  rejectedOperationIds: string[];
}

export interface TreeEditorResult {
  version: string;
  operations: TreeEditOperation[];
  validationReport: TreeEditValidationReport;
  overrideSet: OverrideSet;
  overrideMutations: UxOverride[];
  draftNormalizedDesignIR: NormalizedDesignIR;
  overrideConflictReport: OverrideConflictReport;
  staleOverrideReport: StaleOverrideReport;
}
