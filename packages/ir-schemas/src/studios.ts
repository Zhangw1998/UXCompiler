import type { AssetManifest, I18nManifest, I18nPlaceholder } from "./asset-i18n.js";
import type { InferredTokens } from "./tokens.js";
import type { OverrideConflictReport, OverrideSet, StaleOverrideReport, UxOverride } from "./override.js";

export type StudioOperation =
  | {
      id?: string;
      kind: "approve_component";
      componentId: string;
      name: string;
      instances: string[];
      allowSingleUse?: boolean;
      reason: string;
    }
  | {
      id?: string;
      kind: "reject_component";
      componentId: string;
      reason: string;
    }
  | {
      id?: string;
      kind: "define_component_prop";
      componentId: string;
      prop: ComponentPropDefinition;
      reason: string;
    }
  | {
      id?: string;
      kind: "define_component_variant";
      componentId: string;
      variant: ComponentVariantDefinition;
      reason: string;
    }
  | {
      id?: string;
      kind: "map_flutter_component";
      componentId: string;
      flutter: FlutterComponentMapping;
      reason: string;
    }
  | {
      id?: string;
      kind: "rename_token";
      tokenType: TokenRegistryEntry["type"];
      from: string;
      to: string;
      reason: string;
    }
  | {
      id?: string;
      kind: "merge_tokens";
      tokenType: TokenRegistryEntry["type"];
      sourceTokenNames: string[];
      canonicalTokenName: string;
      reason: string;
    }
  | {
      id?: string;
      kind: "split_token";
      tokenType: TokenRegistryEntry["type"];
      sourceTokenName: string;
      tokens: Array<Record<string, unknown> & { name: string }>;
      reason: string;
    }
  | {
      id?: string;
      kind: "set_asset_strategy";
      assetId?: string;
      sourceNodeId?: string;
      strategy: "real_text" | "svg_icon" | "image_asset" | "decorative_slice" | "custom_painter" | "ignored";
      sourceName?: string;
      format?: "svg" | "png" | "webp" | "jpg";
      path?: string;
      scale?: number;
      cropBounds?: { x: number; y: number; w: number; h: number };
      excludeTextNodes?: boolean;
      reason: string;
    }
  | {
      id?: string;
      kind: "rename_i18n_key";
      messageKey?: string;
      sourceNodeId?: string;
      key: string;
      description?: string;
      reason: string;
    }
  | {
      id?: string;
      kind: "accept_i18n_key";
      messageKey?: string;
      sourceNodeId?: string;
      reason: string;
    }
  | {
      id?: string;
      kind: "define_i18n_placeholder";
      messageKey?: string;
      sourceNodeId?: string;
      placeholder: I18nPlaceholderDefinition;
      reason: string;
    }
  | {
      id?: string;
      kind: "merge_i18n_messages";
      messageKey?: string;
      sourceNodeId?: string;
      targetMessageKey: string;
      reason: string;
    }
  | {
      id?: string;
      kind: "mark_non_i18n";
      messageKey?: string;
      sourceNodeId?: string;
      reason: string;
    }
  | {
      id?: string;
      kind: "disable_override";
      overrideId: string;
      reason: string;
    };

export interface ComponentPropDefinition {
  name: string;
  type: "text" | "asset" | "boolean" | "number" | "slot" | "enum";
  sourceSelector: string;
  optional?: boolean;
}

export interface ComponentVariantDefinition {
  name: string;
  values: string[];
}

export interface FlutterComponentMapping {
  import: string;
  constructor: string;
  props?: Record<string, unknown>;
}

export interface I18nPlaceholderDefinition extends I18nPlaceholder {
  name: string;
}

export interface ComponentRegistryEntry {
  id: string;
  name: string;
  source: "inferred_and_user_approved" | "user_defined" | "rejected";
  instances: string[];
  props: ComponentPropDefinition[];
  variants: ComponentVariantDefinition[];
  flutter?: FlutterComponentMapping;
  verified: boolean;
}

export interface ComponentRegistry {
  version: string;
  components: ComponentRegistryEntry[];
}

export interface TokenRegistryEntry {
  type: "color" | "spacing" | "typography" | "radius" | "shadow";
  name: string;
  value: unknown;
  aliases?: unknown[];
  confidence: number;
  usageCount: number;
  sourceNodeIds: string[];
  status: "active" | "raw" | "mapped";
  reason?: string;
}

export interface TokenRegistry {
  version: string;
  tokens: TokenRegistryEntry[];
}

export interface StudioValidationIssue {
  operationId: string;
  severity: "error" | "warning";
  code:
    | "missing_reason"
    | "invalid_component"
    | "invalid_prop"
    | "invalid_variant"
    | "invalid_flutter_mapping"
    | "invalid_token"
    | "duplicate_token"
    | "invalid_asset"
    | "invalid_i18n_key"
    | "invalid_i18n_placeholder"
    | "invalid_override";
  message: string;
}

export interface StudioValidationReport {
  version: string;
  issues: StudioValidationIssue[];
  validOperationIds: string[];
  rejectedOperationIds: string[];
}

export interface StudioResult {
  version: string;
  operations: StudioOperation[];
  validationReport: StudioValidationReport;
  overrideSet: OverrideSet;
  overrideMutations: UxOverride[];
  componentRegistry: ComponentRegistry;
  tokenRegistry: TokenRegistry;
  finalAssetManifest: AssetManifest;
  finalI18nManifest: I18nManifest;
  finalArbFile: Record<string, unknown>;
  overrideConflictReport: OverrideConflictReport;
  staleOverrideReport: StaleOverrideReport;
}
