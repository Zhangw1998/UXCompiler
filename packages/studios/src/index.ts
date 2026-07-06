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
  const workingOverrides = baseOverrideSet.overrides.map(cloneOverride);
  const mutations: UxOverride[] = [];
  const newOverrides: UxOverride[] = [];
  let componentRegistry = componentRegistryFromOverrides(currentOverrideSet(baseOverrideSet, workingOverrides, newOverrides));
  let nonI18n = nonI18nFromOverrides(input.i18nManifest, currentOverrideSet(baseOverrideSet, workingOverrides, newOverrides));
  let i18nMerges = i18nMergesFromOverrides(input.i18nManifest, currentOverrideSet(baseOverrideSet, workingOverrides, newOverrides));

  for (const operation of input.operations) {
    const operationId = operation.id ?? operationFingerprint(operation);
    const before = issues.length;
    validateOperation(operation, operationId, input, componentRegistry, nonI18n, workingOverrides, issues);
    if (issues.length > before) {
      rejectedOperationIds.push(operationId);
      continue;
    }
    if (operation.kind === "disable_override") {
      const disabledOverride = disableOverride(workingOverrides, operation.overrideId, operation.reason, now().toISOString());
      mutations.push(disabledOverride);
      componentRegistry = componentRegistryFromOverrides(currentOverrideSet(baseOverrideSet, workingOverrides, newOverrides));
      nonI18n = nonI18nFromOverrides(input.i18nManifest, currentOverrideSet(baseOverrideSet, workingOverrides, newOverrides));
      i18nMerges = i18nMergesFromOverrides(input.i18nManifest, currentOverrideSet(baseOverrideSet, workingOverrides, newOverrides));
      validOperationIds.push(operationId);
      continue;
    }
    applyComponentRegistryOperation(componentRegistry, operation);
    if (operation.kind === "mark_non_i18n") {
      const message = findMessage(input.i18nManifest, operation);
      if (message) nonI18n.set(message.key, { sourceNodeId: message.sourceNodeId, reason: operation.reason });
    }
    if (operation.kind === "merge_i18n_messages") {
      const source = findMessage(input.i18nManifest, operation);
      const target = input.i18nManifest.messages.find((message) => message.key === operation.targetMessageKey);
      if (source && target) i18nMerges.set(source.sourceNodeId, { sourceKey: source.key, targetKey: target.key });
    }
    const override = toOverride(operation, operationId, input.actor ?? "user", now().toISOString(), input);
    newOverrides.push(override);
    mutations.push(override);
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
      overrides: [...workingOverrides, ...newOverrides]
    }
  });
  const finalI18nManifest = mergeI18nMessages(removeNonI18nMessages(overrideResult.reviewedI18nManifest, nonI18n), i18nMerges);
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
  nonI18n: Map<string, { sourceNodeId?: string; reason?: string }>,
  workingOverrides: UxOverride[],
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
      if (!operation.assetId && !operation.sourceNodeId) {
        addIssue(issues, operationId, "invalid_asset", "Asset Studio operations require assetId or sourceNodeId.");
      }
      if (!findAsset(input.assetManifest, operation)) {
        addIssue(issues, operationId, "invalid_asset", "Asset target does not exist.");
      }
      if (operation.path && assetPathInUse(input.assetManifest, operation.path, operation.assetId, operation.sourceNodeId)) {
        addIssue(issues, operationId, "invalid_asset", `Asset path ${operation.path} is already in use.`);
      }
      if (operation.scale !== undefined && (!Number.isFinite(operation.scale) || operation.scale <= 0 || operation.scale > 4)) {
        addIssue(issues, operationId, "invalid_asset", "Asset export scale must be between 0.01 and 4.");
      }
      if (operation.cropBounds && (operation.cropBounds.w <= 0 || operation.cropBounds.h <= 0)) {
        addIssue(issues, operationId, "invalid_asset", "Asset crop bounds require positive width and height.");
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
    case "accept_i18n_key":
      if (!findMessage(input.i18nManifest, operation)) addIssue(issues, operationId, "invalid_i18n_key", "i18n target does not exist.");
      return;
    case "define_i18n_placeholder":
      if (!findMessage(input.i18nManifest, operation)) addIssue(issues, operationId, "invalid_i18n_key", "i18n target does not exist.");
      if (!/^[a-z][A-Za-z0-9]*$/.test(operation.placeholder.name)) {
        addIssue(issues, operationId, "invalid_i18n_placeholder", `Placeholder ${operation.placeholder.name} must be lowerCamelCase.`);
      }
      if (!operation.placeholder.type.trim()) {
        addIssue(issues, operationId, "invalid_i18n_placeholder", "Placeholder type is required.");
      }
      return;
    case "merge_i18n_messages":
      {
        const source = findMessage(input.i18nManifest, operation);
        const target = input.i18nManifest.messages.find((message) => message.key === operation.targetMessageKey);
        if (!source) addIssue(issues, operationId, "invalid_i18n_key", "i18n source target does not exist.");
        if (!target) addIssue(issues, operationId, "invalid_i18n_key", `Target i18n key ${operation.targetMessageKey} does not exist.`);
        if (source && target && source.key === target.key) {
          addIssue(issues, operationId, "invalid_i18n_key", "Cannot merge an i18n message into itself.");
        }
        if (source && target && source.value !== target.value) {
          addIssue(issues, operationId, "invalid_i18n_key", "Only duplicate i18n text values can be merged.");
        }
      }
      return;
    case "mark_non_i18n":
      {
        const message = findMessage(input.i18nManifest, operation);
        if (!message) addIssue(issues, operationId, "invalid_i18n_key", "i18n target does not exist.");
        if (message && nonI18n.has(message.key)) addIssue(issues, operationId, "invalid_i18n_key", `${message.key} is already marked non-i18n.`);
      }
      return;
    case "disable_override":
      {
        const target = workingOverrides.find((override) => override.id === operation.overrideId);
        if (!target) {
          addIssue(issues, operationId, "invalid_override", `Override ${operation.overrideId} does not exist.`);
        } else if (target.status === "disabled") {
          addIssue(issues, operationId, "invalid_override", `Override ${operation.overrideId} is already disabled.`);
        }
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

function componentRegistryFromOverrides(overrideSet: OverrideSet): ComponentRegistry {
  const registry: ComponentRegistry = { version: "0.1.0", components: [] };
  for (const override of overrideSet.overrides) {
    if (override.status !== "active") continue;
    if (
      override.type !== "component_candidate_override" &&
      override.type !== "component_prop_override" &&
      override.type !== "component_variant_override" &&
      override.type !== "flutter_component_mapping_override"
    ) {
      continue;
    }
    const operation = override.payload as unknown;
    if (isStudioOperation(operation)) applyComponentRegistryOperation(registry, operation);
  }
  return registry;
}

function currentOverrideSet(baseOverrideSet: OverrideSet, workingOverrides: UxOverride[], newOverrides: UxOverride[]): OverrideSet {
  return {
    ...baseOverrideSet,
    overrides: [...workingOverrides, ...newOverrides]
  };
}

function cloneOverride(override: UxOverride): UxOverride {
  return JSON.parse(JSON.stringify(override)) as UxOverride;
}

function disableOverride(workingOverrides: UxOverride[], overrideId: string, reason: string, updatedAt: string): UxOverride {
  const index = workingOverrides.findIndex((override) => override.id === overrideId);
  if (index === -1) throw new Error(`Override ${overrideId} does not exist.`);
  const disabled = {
    ...workingOverrides[index],
    status: "disabled" as const,
    updatedAt,
    payload: {
      ...workingOverrides[index].payload,
      disabledReason: reason
    }
  };
  workingOverrides[index] = disabled;
  return cloneOverride(disabled);
}

function nonI18nFromOverrides(manifest: I18nManifest, overrideSet: OverrideSet): Map<string, { sourceNodeId?: string; reason?: string }> {
  const keys = new Map<string, { sourceNodeId?: string; reason?: string }>();
  for (const override of overrideSet.overrides) {
    if (override.status !== "active" || override.type !== "i18n_key_override") continue;
    if (typeof override.payload.nonI18nReason !== "string" || override.payload.nonI18nReason.length === 0) continue;
    const message = findMessage(manifest, {
      messageKey: typeof override.target.messageKey === "string" ? override.target.messageKey : undefined,
      sourceNodeId: typeof override.target.sourceNodeId === "string" ? override.target.sourceNodeId : undefined
    });
    const key = message?.key ?? (typeof override.payload.key === "string" ? override.payload.key : undefined);
    if (key) keys.set(key, { sourceNodeId: message?.sourceNodeId ?? override.target.sourceNodeId, reason: override.payload.nonI18nReason });
  }
  return keys;
}

function i18nMergesFromOverrides(manifest: I18nManifest, overrideSet: OverrideSet): Map<string, { sourceKey: string; targetKey: string }> {
  const merges = new Map<string, { sourceKey: string; targetKey: string }>();
  for (const override of overrideSet.overrides) {
    if (override.status !== "active" || override.type !== "i18n_key_override") continue;
    const sourceNodeId = typeof override.payload.mergeDuplicateSourceNodeId === "string" ? override.payload.mergeDuplicateSourceNodeId : undefined;
    const sourceKey = typeof override.payload.mergeDuplicateKey === "string" ? override.payload.mergeDuplicateKey : undefined;
    const targetKey = typeof override.payload.mergeIntoKey === "string" ? override.payload.mergeIntoKey : undefined;
    if (!sourceNodeId || !sourceKey || !targetKey) continue;
    if (!manifest.messages.some((message) => message.sourceNodeId === sourceNodeId && message.key === sourceKey)) continue;
    if (!manifest.messages.some((message) => message.key === targetKey)) continue;
    merges.set(sourceNodeId, { sourceKey, targetKey });
  }
  return merges;
}

function isStudioOperation(value: unknown): value is StudioOperation {
  return typeof value === "object" && value !== null && "kind" in value && typeof (value as { kind?: unknown }).kind === "string";
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
          sourceName: operation.sourceName,
          format: operation.format,
          path: operation.path,
          scale: operation.scale,
          cropBounds: operation.cropBounds,
          excludeTextNodes: operation.excludeTextNodes,
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
    case "accept_i18n_key":
      {
        const message = findMessage(input.i18nManifest, operation);
        return {
          ...base,
          type: "i18n_key_override",
          target: i18nTarget(operation),
          payload: { key: message?.key, description: message?.description, reason: operation.reason }
        };
      }
    case "define_i18n_placeholder":
      return {
        ...base,
        type: "i18n_key_override",
        target: i18nTarget(operation),
        payload: {
          placeholders: {
            [operation.placeholder.name]: {
              type: operation.placeholder.type,
              example: operation.placeholder.example,
              description: operation.placeholder.description
            }
          },
          reason: operation.reason
        }
      };
    case "merge_i18n_messages":
      {
        const source = findMessage(input.i18nManifest, operation);
        const target = input.i18nManifest.messages.find((message) => message.key === operation.targetMessageKey);
        return {
          ...base,
          type: "i18n_key_override",
          target: i18nTarget(operation),
          payload: {
            key: target?.key,
            description: target?.description,
            mergeIntoKey: target?.key,
            mergeDuplicateKey: source?.key,
            mergeDuplicateSourceNodeId: source?.sourceNodeId,
            reason: operation.reason
          }
        };
      }
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
    case "disable_override":
      throw new Error("disable_override updates an existing override and is handled before toOverride.");
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

function removeNonI18nMessages(manifest: I18nManifest, nonI18n: Map<string, { sourceNodeId?: string; reason?: string }>): I18nManifest {
  if (nonI18n.size === 0) return manifest;
  return {
    ...manifest,
    messages: manifest.messages.filter((message) => !nonI18n.has(message.key)),
    warnings: [
      ...manifest.warnings,
      ...Array.from(nonI18n).map(([key, metadata]) => ({
        sourceNodeId: metadata.sourceNodeId,
        type: "non_i18n",
        message: `${key} was marked as non-i18n by Studio review${metadata.reason ? `: ${metadata.reason}` : "."}`
      }))
    ]
  };
}

function mergeI18nMessages(manifest: I18nManifest, merges: Map<string, { sourceKey: string; targetKey: string }>): I18nManifest {
  if (merges.size === 0) return manifest;
  const removed: Array<{ sourceKey: string; targetKey: string; sourceNodeId: string }> = [];
  const messages = manifest.messages.filter((message) => {
    const merge = merges.get(message.sourceNodeId);
    if (!merge) return true;
    removed.push({ sourceKey: merge.sourceKey, targetKey: merge.targetKey, sourceNodeId: message.sourceNodeId });
    return false;
  });
  if (removed.length === 0) return manifest;
  return {
    ...manifest,
    messages,
    warnings: [
      ...manifest.warnings,
      ...removed.map((entry) => ({
        sourceNodeId: entry.sourceNodeId,
        type: "merged_duplicate_text",
        message: `${entry.sourceKey} was merged into ${entry.targetKey}.`
      }))
    ]
  };
}

function renderArb(manifest: I18nManifest): Record<string, unknown> {
  const arb: Record<string, unknown> = { "@@locale": manifest.locale };
  for (const message of manifest.messages) {
    const metadata: Record<string, unknown> = {
      description: message.description,
      sourceNodeId: message.sourceNodeId
    };
    if (message.placeholders && Object.keys(message.placeholders).length > 0) metadata.placeholders = message.placeholders;
    arb[message.key] = message.value;
    arb[`@${message.key}`] = metadata;
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
