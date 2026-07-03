import { createHash } from "node:crypto";
import type {
  AssetManifest,
  ComponentRegistry,
  ComponentRegistryEntry,
  I18nManifest,
  InferredTokens,
  NormalizedDesignIR,
  OverrideSet,
  OverrideTarget,
  StudioOperation,
  StudioResult,
  StudioValidationIssue,
  TokenRegistry,
  TokenRegistryEntry,
  UxOverride
} from "@uxcompiler/ir-schemas";
import { applyOverrides, createEmptyOverrideSet } from "@uxcompiler/override-engine";

export interface ApplyStudioOperationsInput {
  normalizedDesignIR: NormalizedDesignIR;
  assetManifest: AssetManifest;
  i18nManifest: I18nManifest;
  inferredTokens: InferredTokens;
  overrideSet?: OverrideSet;
  operations: StudioOperation[];
  actor?: "user" | "agent" | "system";
  now?: () => Date;
}

export function applyStudioOperations(input: ApplyStudioOperationsInput): StudioResult {
  const now = input.now ?? (() => new Date());
  const baseOverrideSet = input.overrideSet ?? createEmptyOverrideSet(input.normalizedDesignIR.source.frameNodeId);
  const issues: StudioValidationIssue[] = [];
  const validOperationIds: string[] = [];
  const rejectedOperationIds: string[] = [];
  const mutations: UxOverride[] = [];
  const componentRegistry: ComponentRegistry = { version: "0.1.0", components: [] };
  const nonI18n = new Set<string>();

  for (const operation of input.operations) {
    const operationId = operation.id ?? operationFingerprint(operation);
    const before = issues.length;
    validateOperation(operation, operationId, input, componentRegistry, nonI18n, issues);
    if (issues.length > before) {
      rejectedOperationIds.push(operationId);
      continue;
    }
    applyComponentRegistryOperation(componentRegistry, operation);
    if (operation.kind === "mark_non_i18n") {
      const message = findMessage(input.i18nManifest, operation);
      if (message) nonI18n.add(message.key);
    }
    mutations.push(toOverride(operation, operationId, input.actor ?? "user", now().toISOString(), input));
    validOperationIds.push(operationId);
  }

  const overrideResult = applyOverrides({
    normalizedDesignIR: input.normalizedDesignIR,
    assetManifest: input.assetManifest,
    i18nManifest: input.i18nManifest,
    inferredTokens: input.inferredTokens,
    overrideSet: {
      ...baseOverrideSet,
      hash: "",
      overrides: [...baseOverrideSet.overrides, ...mutations]
    }
  });
  const finalI18nManifest = removeNonI18nMessages(overrideResult.reviewedI18nManifest, nonI18n);
  const finalArbFile = renderArb(finalI18nManifest);
  const tokenRegistry = buildTokenRegistry(overrideResult.reviewedInferredTokens);

  return {
    version: "0.1.0",
    operations: input.operations,
    validationReport: {
      version: "0.1.0",
      issues,
      validOperationIds,
      rejectedOperationIds
    },
    overrideSet: overrideResult.overrideSet,
    overrideMutations: mutations,
    componentRegistry,
    tokenRegistry,
    finalAssetManifest: overrideResult.reviewedAssetManifest,
    finalI18nManifest,
    finalArbFile,
    overrideConflictReport: overrideResult.overrideConflictReport,
    staleOverrideReport: overrideResult.staleOverrideReport
  };
}

function validateOperation(
  operation: StudioOperation,
  operationId: string,
  input: ApplyStudioOperationsInput,
  componentRegistry: ComponentRegistry,
  nonI18n: Set<string>,
  issues: StudioValidationIssue[]
): void {
  if (!operation.reason.trim()) {
    addIssue(issues, operationId, "missing_reason", "Studio operations must include a reason.");
    return;
  }
  switch (operation.kind) {
    case "approve_component":
      validateComponentName(operation.name, operationId, issues);
      if (operation.instances.length < 2 && !operation.allowSingleUse) {
        addIssue(issues, operationId, "invalid_component", "Approved components need at least two instances unless allowSingleUse is true.");
      }
      return;
    case "reject_component":
      return;
    case "define_component_prop":
      if (!operation.prop.name.trim() || !operation.prop.sourceSelector.trim()) {
        addIssue(issues, operationId, "invalid_prop", "Component props require name and sourceSelector.");
      }
      return;
    case "define_component_variant":
      if (!operation.variant.name.trim() || operation.variant.values.length === 0) {
        addIssue(issues, operationId, "invalid_variant", "Component variants require name and values.");
      }
      return;
    case "map_flutter_component":
      if (!operation.flutter.import.trim() || !operation.flutter.constructor.trim()) {
        addIssue(issues, operationId, "invalid_flutter_mapping", "Flutter mapping requires import and constructor.");
      }
      return;
    case "rename_token":
      if (!findToken(input.inferredTokens, operation.tokenType, operation.from)) {
        addIssue(issues, operationId, "invalid_token", `Token ${operation.from} does not exist.`);
      }
      if (findToken(input.inferredTokens, operation.tokenType, operation.to)) {
        addIssue(issues, operationId, "duplicate_token", `Token ${operation.to} already exists.`);
      }
      return;
    case "merge_tokens":
      if (operation.sourceTokenNames.length < 2) {
        addIssue(issues, operationId, "invalid_token", "Token merge requires at least two source tokens.");
      }
      for (const name of operation.sourceTokenNames) {
        if (!findToken(input.inferredTokens, operation.tokenType, name)) {
          addIssue(issues, operationId, "invalid_token", `Token ${name} does not exist.`);
        }
      }
      return;
    case "split_token":
      if (!findToken(input.inferredTokens, operation.tokenType, operation.sourceTokenName)) {
        addIssue(issues, operationId, "invalid_token", `Token ${operation.sourceTokenName} does not exist.`);
      }
      if (operation.tokens.length === 0) addIssue(issues, operationId, "invalid_token", "Token split requires output tokens.");
      return;
    case "set_asset_strategy":
      if (!findAsset(input.assetManifest, operation)) {
        addIssue(issues, operationId, "invalid_asset", "Asset target does not exist.");
      }
      if (operation.path && assetPathInUse(input.assetManifest, operation.path, operation.assetId, operation.sourceNodeId)) {
        addIssue(issues, operationId, "invalid_asset", `Asset path ${operation.path} is already in use.`);
      }
      return;
    case "rename_i18n_key":
      if (!findMessage(input.i18nManifest, operation)) addIssue(issues, operationId, "invalid_i18n_key", "i18n target does not exist.");
      if (!/^[a-z][A-Za-z0-9]*$/.test(operation.key)) {
        addIssue(issues, operationId, "invalid_i18n_key", `i18n key ${operation.key} must be lowerCamelCase.`);
      }
      if (input.i18nManifest.messages.some((message) => message.key === operation.key && message !== findMessage(input.i18nManifest, operation))) {
        addIssue(issues, operationId, "invalid_i18n_key", `i18n key ${operation.key} already exists.`);
      }
      return;
    case "mark_non_i18n":
      {
        const message = findMessage(input.i18nManifest, operation);
        if (!message) addIssue(issues, operationId, "invalid_i18n_key", "i18n target does not exist.");
        if (message && nonI18n.has(message.key)) addIssue(issues, operationId, "invalid_i18n_key", `${message.key} is already marked non-i18n.`);
      }
      return;
  }
  void componentRegistry;
}

function applyComponentRegistryOperation(registry: ComponentRegistry, operation: StudioOperation): void {
  if (operation.kind === "approve_component") {
    upsertComponent(registry, {
      id: operation.componentId,
      name: operation.name,
      source: "inferred_and_user_approved",
      instances: operation.instances,
      props: [],
      variants: [],
      verified: false
    });
  } else if (operation.kind === "reject_component") {
    upsertComponent(registry, {
      id: operation.componentId,
      name: operation.componentId,
      source: "rejected",
      instances: [],
      props: [],
      variants: [],
      verified: false
    });
  } else if (operation.kind === "define_component_prop") {
    const component = ensureComponent(registry, operation.componentId);
    component.props = upsertByName(component.props, operation.prop);
  } else if (operation.kind === "define_component_variant") {
    const component = ensureComponent(registry, operation.componentId);
    component.variants = upsertByName(component.variants, operation.variant);
  } else if (operation.kind === "map_flutter_component") {
    const component = ensureComponent(registry, operation.componentId);
    component.flutter = operation.flutter;
  }
}

function toOverride(
  operation: StudioOperation,
  operationId: string,
  actor: UxOverride["createdBy"],
  createdAt: string,
  input: ApplyStudioOperationsInput
): UxOverride {
  const base = {
    id: `ovr_studio_${safeId(operationId)}`,
    status: "active" as const,
    createdBy: actor,
    createdAt
  };
  switch (operation.kind) {
    case "approve_component":
    case "reject_component":
      return {
        ...base,
        type: "component_candidate_override",
        target: { kind: "page" },
        payload: { ...operation }
      };
    case "define_component_prop":
      return {
        ...base,
        type: "component_prop_override",
        target: { kind: "page" },
        payload: { ...operation }
      };
    case "define_component_variant":
      return {
        ...base,
        type: "component_variant_override",
        target: { kind: "page" },
        payload: { ...operation }
      };
    case "map_flutter_component":
      return {
        ...base,
        type: "flutter_component_mapping_override",
        target: { kind: "page" },
        payload: { ...operation }
      };
    case "rename_token":
      return {
        ...base,
        type: "token_rename_override",
        target: { kind: "token", tokenName: operation.from },
        payload: { tokenType: operation.tokenType, from: operation.from, to: operation.to, reason: operation.reason }
      };
    case "merge_tokens":
      return {
        ...base,
        type: "token_merge_override",
        target: { kind: "token", tokenName: operation.canonicalTokenName },
        payload: {
          tokenType: operation.tokenType,
          sourceTokenNames: operation.sourceTokenNames,
          canonicalTokenName: operation.canonicalTokenName,
          reason: operation.reason
        }
      };
    case "split_token":
      return {
        ...base,
        type: "token_split_override",
        target: { kind: "token", tokenName: operation.sourceTokenName },
        payload: { tokenType: operation.tokenType, sourceTokenName: operation.sourceTokenName, tokens: operation.tokens, reason: operation.reason }
      };
    case "set_asset_strategy":
      return {
        ...base,
        type: "asset_strategy_override",
        target: assetTarget(operation),
        payload: {
          strategy: operation.strategy,
          format: operation.format,
          path: operation.path,
          reason: operation.reason
        }
      };
    case "rename_i18n_key":
      return {
        ...base,
        type: "i18n_key_override",
        target: i18nTarget(operation),
        payload: { key: operation.key, description: operation.description, reason: operation.reason }
      };
    case "mark_non_i18n":
      {
        const message = findMessage(input.i18nManifest, operation);
        return {
          ...base,
          type: "i18n_key_override",
          target: i18nTarget(operation),
          payload: {
            key: message?.key,
            description: message?.description,
            nonI18nReason: operation.reason,
            reason: operation.reason
          }
        };
      }
  }
}

function buildTokenRegistry(tokens: InferredTokens): TokenRegistry {
  return {
    version: "0.1.0",
    tokens: [
      ...tokens.colors.map((token) => tokenEntry("color", token, token.value)),
      ...tokens.spacing.map((token) => tokenEntry("spacing", token, token.value)),
      ...tokens.typography.map((token) => tokenEntry("typography", token, token)),
      ...tokens.radii.map((token) => tokenEntry("radius", token, token.value)),
      ...tokens.shadows.map((token) => tokenEntry("shadow", token, token.value))
    ]
  };
}

function tokenEntry(type: TokenRegistryEntry["type"], token: { name: string; confidence: number; usageCount: number; sourceNodeIds: string[]; aliases?: unknown[] }, value: unknown): TokenRegistryEntry {
  return {
    type,
    name: token.name,
    value,
    aliases: token.aliases,
    confidence: token.confidence,
    usageCount: token.usageCount,
    sourceNodeIds: token.sourceNodeIds,
    status: "active"
  };
}

function removeNonI18nMessages(manifest: I18nManifest, nonI18n: Set<string>): I18nManifest {
  if (nonI18n.size === 0) return manifest;
  return {
    ...manifest,
    messages: manifest.messages.filter((message) => !nonI18n.has(message.key)),
    warnings: [
      ...manifest.warnings,
      ...Array.from(nonI18n).map((key) => ({
        type: "non_i18n",
        message: `${key} was marked as non-i18n by Studio review.`
      }))
    ]
  };
}

function renderArb(manifest: I18nManifest): Record<string, unknown> {
  const arb: Record<string, unknown> = { "@@locale": manifest.locale };
  for (const message of manifest.messages) {
    arb[message.key] = message.value;
    arb[`@${message.key}`] = {
      description: message.description,
      sourceNodeId: message.sourceNodeId
    };
  }
  return arb;
}

function upsertComponent(registry: ComponentRegistry, component: ComponentRegistryEntry): void {
  const index = registry.components.findIndex((candidate) => candidate.id === component.id);
  if (index === -1) registry.components.push(component);
  else registry.components[index] = { ...registry.components[index], ...component };
}

function ensureComponent(registry: ComponentRegistry, componentId: string): ComponentRegistryEntry {
  let component = registry.components.find((candidate) => candidate.id === componentId);
  if (!component) {
    component = {
      id: componentId,
      name: componentId,
      source: "user_defined",
      instances: [],
      props: [],
      variants: [],
      verified: false
    };
    registry.components.push(component);
  }
  return component;
}

function upsertByName<T extends { name: string }>(items: T[], item: T): T[] {
  const index = items.findIndex((candidate) => candidate.name === item.name);
  if (index === -1) return [...items, item];
  return [...items.slice(0, index), item, ...items.slice(index + 1)];
}

function validateComponentName(name: string, operationId: string, issues: StudioValidationIssue[]): void {
  if (!/^[A-Z][A-Za-z0-9]*$/.test(name)) addIssue(issues, operationId, "invalid_component", `Component name ${name} must be PascalCase.`);
}

function findToken(tokens: InferredTokens, type: TokenRegistryEntry["type"], name: string): { name: string } | undefined {
  return tokenGroup(tokens, type).find((token) => token.name === name);
}

function tokenGroup(tokens: InferredTokens, type: TokenRegistryEntry["type"]): Array<{ name: string }> {
  if (type === "color") return tokens.colors;
  if (type === "spacing") return tokens.spacing;
  if (type === "typography") return tokens.typography;
  if (type === "radius") return tokens.radii;
  return tokens.shadows;
}

function findAsset(manifest: AssetManifest, target: { assetId?: string; sourceNodeId?: string }) {
  return manifest.assets.find((asset) => {
    if (target.assetId && asset.id === target.assetId) return true;
    if (target.sourceNodeId && asset.sourceNodeId === target.sourceNodeId) return true;
    return false;
  });
}

function assetPathInUse(manifest: AssetManifest, path: string, assetId?: string, sourceNodeId?: string): boolean {
  return manifest.assets.some((asset) => asset.path === path && asset.id !== assetId && asset.sourceNodeId !== sourceNodeId);
}

function findMessage(manifest: I18nManifest, target: { messageKey?: string; sourceNodeId?: string }) {
  return manifest.messages.find((message) => {
    if (target.messageKey && message.key === target.messageKey) return true;
    if (target.sourceNodeId && message.sourceNodeId === target.sourceNodeId) return true;
    return false;
  });
}

function assetTarget(operation: { assetId?: string; sourceNodeId?: string }): OverrideTarget {
  if (operation.assetId) return { kind: "asset", assetId: operation.assetId };
  return { kind: "source_node", sourceNodeId: operation.sourceNodeId };
}

function i18nTarget(operation: { messageKey?: string; sourceNodeId?: string }): OverrideTarget {
  if (operation.messageKey) return { kind: "i18n_message", messageKey: operation.messageKey };
  return { kind: "source_node", sourceNodeId: operation.sourceNodeId };
}

function addIssue(issues: StudioValidationIssue[], operationId: string, code: StudioValidationIssue["code"], message: string): void {
  issues.push({
    operationId,
    severity: "error",
    code,
    message
  });
}

function operationFingerprint(operation: StudioOperation): string {
  return `${operation.kind}_${createHash("sha256").update(stableStringify(operation)).digest("hex").slice(0, 10)}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || "unknown";
}
