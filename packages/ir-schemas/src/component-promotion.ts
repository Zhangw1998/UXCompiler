import type { ComponentRegistry, FlutterComponentMapping } from "./studios.js";

export interface PromoteGeneratedWidgetRequest {
  componentId: string;
  name: string;
  generatedFilePath: string;
  sourceNodeIds: string[];
  flutter: FlutterComponentMapping;
  props?: Record<string, unknown>;
  reason: string;
  allowManualFile?: boolean;
}

export interface ComponentPromotionRule {
  componentId: string;
  name: string;
  generatedFilePath: string;
  sourceNodeIds: string[];
  flutter: FlutterComponentMapping;
  skipGeneratedRegions: boolean;
  updateCallsitesOnly: boolean;
  promotedAt: string;
  reason: string;
}

export interface PromoteGeneratedWidgetIssue {
  severity: "error" | "warning";
  code:
    | "missing_reason"
    | "invalid_component"
    | "invalid_flutter_mapping"
    | "missing_source_nodes"
    | "missing_generated_marker"
    | "duplicate_component";
  message: string;
}

export interface PromoteGeneratedWidgetReport {
  version: string;
  generatedAt: string;
  request: PromoteGeneratedWidgetRequest;
  issues: PromoteGeneratedWidgetIssue[];
  promoted: boolean;
  rule?: ComponentPromotionRule;
}

export interface PromoteGeneratedWidgetResult {
  version: string;
  componentRegistry: ComponentRegistry;
  promotionRules: ComponentPromotionRule[];
  promoteReport: PromoteGeneratedWidgetReport;
}
