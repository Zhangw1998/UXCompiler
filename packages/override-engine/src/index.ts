import { createHash } from "node:crypto";
import type {
  AssetManifest,
  AssetManifestEntry,
  I18nManifest,
  I18nMessage,
  InferredTokens,
  LayoutType,
  NormalizedDesignIR,
  NormalizedNode,
  OverrideConflict,
  OverrideConflictReport,
  OverrideSet,
  OverrideTarget,
  OverrideType,
  StaleOverride,
  StaleOverrideReport,
  UxOverride
} from "@uxcompiler/ir-schemas";

export interface ApplyOverridesInput {
  normalizedDesignIR: NormalizedDesignIR;
  assetManifest: AssetManifest;
  i18nManifest: I18nManifest;
  inferredTokens: InferredTokens;
  overrideSet?: OverrideSet;
}

export interface ApplyOverridesResult {
  overrideSet: OverrideSet;
  reviewedNormalizedDesignIR: NormalizedDesignIR;
  reviewedAssetManifest: AssetManifest;
  reviewedI18nManifest: I18nManifest;
  reviewedInferredTokens: InferredTokens;
  reviewedArbFile: Record<string, unknown>;
  overrideConflictReport: OverrideConflictReport;
  staleOverrideReport: StaleOverrideReport;
}

const overrideOrder: OverrideType[] = [
  "ignore_node_override",
  "region_create_override",
  "region_merge_override",
  "region_split_override",
  "node_parent_override",
  "token_merge_override",
  "token_split_override",
  "token_rename_override",
  "component_candidate_override",
  "component_prop_override",
  "component_variant_override",
  "naming_override",
  "layout_strategy_override",
  "render_strategy_override",
  "asset_strategy_override",
  "i18n_key_override",
  "flutter_component_mapping_override",
  "font_mapping_override",
  "text_calibration_override"
];

const layoutTypes = new Set<LayoutType>(["column", "row", "grid", "stack", "absolute", "leaf"]);

export function createEmptyOverrideSet(snapshotId?: string): OverrideSet {
  return withHash({
    id: "ovset_default",
    version: 1,
    snapshotId,
    hash: "",
    overrides: []
  });
}

export function applyOverrides(input: ApplyOverridesInput): ApplyOverridesResult {
  const overrideSet = withHash(input.overrideSet ?? createEmptyOverrideSet(input.normalizedDesignIR.source.frameNodeId));
  const reviewedNormalizedDesignIR = clone(input.normalizedDesignIR);
  const reviewedAssetManifest = clone(input.assetManifest);
  const reviewedI18nManifest = clone(input.i18nManifest);
  const reviewedInferredTokens = clone(input.inferredTokens);
  const generatedAt = reportTimestamp(overrideSet);
  const conflicts: OverrideConflict[] = [];
  const warnings: OverrideConflictReport["warnings"] = [];
  const staleOverrides: StaleOverride[] = [];
  const appliedOverrideIds: string[] = [];

  const active = overrideSet.overrides
    .filter((override) => override.status === "active")
    .map((override, index) => ({ override, index }))
    .sort((left, right) => orderOf(left.override.type) - orderOf(right.override.type) || left.index - right.index);
  detectDuplicateConflicts(
    active.map((entry) => entry.override),
    conflicts
  );

  for (const { override } of active) {
    const beforeAppliedCount = appliedOverrideIds.length;
    applyOne({
      override,
      normalizedDesignIR: reviewedNormalizedDesignIR,
      assetManifest: reviewedAssetManifest,
      i18nManifest: reviewedI18nManifest,
      inferredTokens: reviewedInferredTokens,
      conflicts,
      warnings,
      staleOverrides,
      appliedOverrideIds
    });
    if (appliedOverrideIds.length > beforeAppliedCount) {
      markOverride(reviewedNormalizedDesignIR.tree, override);
    }
  }

  return {
    overrideSet,
    reviewedNormalizedDesignIR,
    reviewedAssetManifest,
    reviewedI18nManifest,
    reviewedInferredTokens,
    reviewedArbFile: renderArb(reviewedI18nManifest),
    overrideConflictReport: {
      version: "0.1.0",
      generatedAt,
      conflicts,
      warnings
    },
    staleOverrideReport: {
      version: "0.1.0",
      generatedAt,
      staleOverrides,
      appliedOverrideIds
    }
  };
}

function applyOne(context: {
  override: UxOverride;
  normalizedDesignIR: NormalizedDesignIR;
  assetManifest: AssetManifest;
  i18nManifest: I18nManifest;
  inferredTokens: InferredTokens;
  conflicts: OverrideConflict[];
  warnings: OverrideConflictReport["warnings"];
  staleOverrides: StaleOverride[];
  appliedOverrideIds: string[];
}): void {
  const { override } = context;
  switch (override.type) {
    case "ignore_node_override":
      applyIgnoreNode(context);
      return;
    case "region_create_override":
      applyRegionCreate(context);
      return;
    case "region_merge_override":
      applyRegionMerge(context);
      return;
    case "region_split_override":
      applyRegionSplit(context);
      return;
    case "node_parent_override":
      applyNodeParent(context);
      return;
    case "naming_override":
      applyNaming(context);
      return;
    case "layout_strategy_override":
      applyLayout(context);
      return;
    case "render_strategy_override":
      applyRender(context);
      return;
    case "asset_strategy_override":
      applyAsset(context);
      return;
    case "i18n_key_override":
      applyI18n(context);
      return;
    case "token_rename_override":
      applyTokenRename(context);
      return;
    case "token_merge_override":
      applyTokenMerge(context);
      return;
    case "token_split_override":
      applyTokenSplit(context);
      return;
    case "font_mapping_override":
      context.warnings.push({
        overrideId: override.id,
        type: "configuration_override",
        message: "font_mapping_override is recorded as project preview configuration for downstream renderers."
      });
      context.appliedOverrideIds.push(override.id);
      return;
    case "component_candidate_override":
    case "component_prop_override":
    case "component_variant_override":
    case "flutter_component_mapping_override":
    case "text_calibration_override":
      context.warnings.push({
        overrideId: override.id,
        type: "unsupported_override",
        message: `${override.type} is recorded but has no deterministic MVP apply behavior yet.`
      });
      context.appliedOverrideIds.push(override.id);
      return;
  }
}

function applyIgnoreNode(context: ApplyContext): void {
  const node = findNode(context.normalizedDesignIR.tree, context.override.target);
  if (!node || node === context.normalizedDesignIR.tree) {
    addStale(context, "Target node does not exist or is the page root.");
    return;
  }
  removeNode(context.normalizedDesignIR.tree, node.id);
  context.appliedOverrideIds.push(context.override.id);
}

function applyRegionCreate(context: ApplyContext): void {
  const payload = context.override.payload;
  const sourceNodeIds = stringArray(payload.sourceNodeIds);
  const regionId = stringValue(payload.regionId) ?? `region_${safeId(context.override.id)}`;
  const name = stringValue(payload.name) ?? "ReviewedRegion";
  const existing = findNode(context.normalizedDesignIR.tree, { kind: "normalized_node", normalizedNodeId: regionId });
  if (existing) {
    addConflict(context, "invalid_payload", `Region id ${regionId} already exists.`);
    return;
  }
  const nodes = sourceNodeIds
    .map((sourceNodeId) => findNode(context.normalizedDesignIR.tree, { kind: "source_node", sourceNodeId }))
    .filter((node): node is NormalizedNode => !!node && node !== context.normalizedDesignIR.tree);
  if (nodes.length === 0) {
    addStale(context, "No source nodes matched the region_create_override payload.");
    return;
  }
  for (const node of nodes) removeNode(context.normalizedDesignIR.tree, node.id);
  const region: NormalizedNode = {
    id: regionId,
    sourceNodeIds,
    type: "region",
    name,
    role: normalizeRole(stringValue(payload.role)),
    layout: { type: normalizeLayout(stringValue(payload.layout)) ?? "absolute" },
    bounds: unionBounds(nodes),
    overrideRefs: [context.override.id],
    children: nodes,
    confidence: 1
  };
  context.normalizedDesignIR.tree.children.push(region);
  context.appliedOverrideIds.push(context.override.id);
}

function applyRegionMerge(context: ApplyContext): void {
  const payload = context.override.payload;
  const sourceRegionIds = stringArray(payload.sourceRegionIds);
  const targetRegionId = stringValue(payload.targetRegionId) ?? stringValue(payload.regionId) ?? `region_${safeId(context.override.id)}`;
  const name = stringValue(payload.name) ?? "MergedRegion";
  if (sourceRegionIds.length < 2) {
    addConflict(context, "invalid_payload", "region_merge_override requires at least two sourceRegionIds.");
    return;
  }
  const existing = findNode(context.normalizedDesignIR.tree, { kind: "normalized_node", normalizedNodeId: targetRegionId });
  if (existing && !sourceRegionIds.includes(existing.id)) {
    addConflict(context, "invalid_payload", `Target region id ${targetRegionId} already exists.`);
    return;
  }
  const regions = sourceRegionIds
    .map((id) => findNode(context.normalizedDesignIR.tree, { kind: "normalized_node", normalizedNodeId: id }))
    .filter((node): node is NormalizedNode => !!node && node !== context.normalizedDesignIR.tree);
  if (regions.length !== sourceRegionIds.length) {
    addStale(context, "One or more source regions no longer exist.");
    return;
  }
  const parent = findParent(context.normalizedDesignIR.tree, regions[0].id);
  if (!parent || !regions.every((region) => findParent(context.normalizedDesignIR.tree, region.id) === parent)) {
    addConflict(context, "invalid_payload", "region_merge_override requires sibling source regions.");
    return;
  }
  const mergedChildren = regions.flatMap((region) => region.children);
  const mergedSourceNodeIds = Array.from(new Set(regions.flatMap((region) => region.sourceNodeIds)));
  for (const region of regions) removeNode(context.normalizedDesignIR.tree, region.id);
  const merged: NormalizedNode = {
    id: targetRegionId,
    sourceNodeIds: mergedSourceNodeIds,
    type: "region",
    name,
    role: normalizeRole(stringValue(payload.role)),
    layout: { type: normalizeLayout(stringValue(payload.layout)) ?? "stack" },
    bounds: unionBounds(regions),
    overrideRefs: [context.override.id],
    children: mergedChildren,
    confidence: 1
  };
  parent.children.push(merged);
  context.appliedOverrideIds.push(context.override.id);
}

function applyRegionSplit(context: ApplyContext): void {
  const payload = context.override.payload;
  const sourceRegionId = stringValue(payload.sourceRegionId);
  const sourceNodeIds = stringArray(payload.sourceNodeIds);
  const regionId = stringValue(payload.regionId) ?? `region_${safeId(context.override.id)}`;
  const name = stringValue(payload.name) ?? "SplitRegion";
  if (!sourceRegionId || sourceNodeIds.length === 0) {
    addConflict(context, "invalid_payload", "region_split_override requires sourceRegionId and sourceNodeIds.");
    return;
  }
  const sourceRegion = findNode(context.normalizedDesignIR.tree, { kind: "normalized_node", normalizedNodeId: sourceRegionId });
  const parent = sourceRegion ? findParent(context.normalizedDesignIR.tree, sourceRegion.id) : undefined;
  const existing = findNode(context.normalizedDesignIR.tree, { kind: "normalized_node", normalizedNodeId: regionId });
  if (!sourceRegion || !parent || sourceRegion === context.normalizedDesignIR.tree) {
    addStale(context, "Source region no longer exists.");
    return;
  }
  if (existing) {
    addConflict(context, "invalid_payload", `Region id ${regionId} already exists.`);
    return;
  }
  const nodes = sourceNodeIds
    .map((sourceNodeId) => findNode(sourceRegion, { kind: "source_node", sourceNodeId }))
    .filter((node): node is NormalizedNode => !!node && node !== sourceRegion);
  if (nodes.length !== sourceNodeIds.length) {
    addStale(context, "One or more split source nodes no longer exist in the source region.");
    return;
  }
  for (const node of nodes) removeNode(sourceRegion, node.id);
  sourceRegion.sourceNodeIds = sourceRegion.sourceNodeIds.filter((sourceNodeId) => !sourceNodeIds.includes(sourceNodeId));
  const split: NormalizedNode = {
    id: regionId,
    sourceNodeIds,
    type: "region",
    name,
    role: normalizeRole(stringValue(payload.role)),
    layout: { type: normalizeLayout(stringValue(payload.layout)) ?? "stack" },
    bounds: unionBounds(nodes),
    overrideRefs: [context.override.id],
    children: nodes,
    confidence: 1
  };
  const sourceIndex = parent.children.findIndex((child) => child.id === sourceRegion.id);
  parent.children.splice(sourceIndex + 1, 0, split);
  context.appliedOverrideIds.push(context.override.id);
}

function applyNodeParent(context: ApplyContext): void {
  const node = findNode(context.normalizedDesignIR.tree, context.override.target);
  const targetParentId = stringValue(context.override.payload.targetNormalizedParentId);
  const parent = targetParentId ? findNode(context.normalizedDesignIR.tree, { kind: "normalized_node", normalizedNodeId: targetParentId }) : undefined;
  if (!node || node === context.normalizedDesignIR.tree || !parent) {
    addStale(context, "Source node or target parent does not exist.");
    return;
  }
  if (node === parent || containsNode(node, parent.id)) {
    addConflict(context, "cycle", "node_parent_override would create a tree cycle.");
    return;
  }
  removeNode(context.normalizedDesignIR.tree, node.id);
  parent.children.push(node);
  context.appliedOverrideIds.push(context.override.id);
}

function applyNaming(context: ApplyContext): void {
  const node = findNode(context.normalizedDesignIR.tree, context.override.target);
  const name = stringValue(context.override.payload.name);
  if (!node || !name) {
    addStale(context, "Target node does not exist or name is missing.");
    return;
  }
  node.name = name;
  context.appliedOverrideIds.push(context.override.id);
}

function applyLayout(context: ApplyContext): void {
  const node = findNode(context.normalizedDesignIR.tree, context.override.target);
  const strategy = normalizeLayout(stringValue(context.override.payload.strategy));
  if (!node || !strategy) {
    addStale(context, "Target node does not exist or layout strategy is invalid.");
    return;
  }
  node.layout = { ...node.layout, type: strategy };
  node.confidence = Math.max(node.confidence, 0.99);
  context.appliedOverrideIds.push(context.override.id);
}

function applyRender(context: ApplyContext): void {
  const node = findNode(context.normalizedDesignIR.tree, context.override.target);
  const strategy = stringValue(context.override.payload.strategy);
  if (!node || !strategy) {
    addStale(context, "Target node does not exist or render strategy is missing.");
    return;
  }
  node.render = { strategy, locked: true };
  context.appliedOverrideIds.push(context.override.id);
}

function applyAsset(context: ApplyContext): void {
  const asset = findAsset(context.assetManifest, context.override.target);
  const strategy = stringValue(context.override.payload.strategy);
  if (!asset || !strategy) {
    addStale(context, "Target asset does not exist or asset strategy is missing.");
    return;
  }
  asset.strategy = strategy as AssetManifestEntry["strategy"];
  const path = stringValue(context.override.payload.path);
  const format = stringValue(context.override.payload.format);
  if (path) asset.path = path;
  if (format && ["svg", "png", "webp", "jpg"].includes(format)) asset.format = format as AssetManifestEntry["format"];
  const scale = numberValue(context.override.payload.scale);
  if (scale > 0) asset.scale = scale;
  const cropBounds = boundsValue(context.override.payload.cropBounds);
  if (cropBounds) asset.cropBounds = cropBounds;
  const excludeTextNodes = booleanValue(context.override.payload.excludeTextNodes);
  if (excludeTextNodes !== undefined) asset.excludeTextNodes = excludeTextNodes;
  asset.reason = stringValue(context.override.payload.reason) ?? `Asset strategy overridden by ${context.override.id}.`;
  asset.confidence = 1;
  context.appliedOverrideIds.push(context.override.id);
}

function applyI18n(context: ApplyContext): void {
  const message = findMessage(context.i18nManifest, context.override.target);
  const key = stringValue(context.override.payload.key);
  if (!message) {
    addStale(context, "Target i18n message does not exist.");
    return;
  }
  if (key) message.key = key;
  message.description = stringValue(context.override.payload.description) ?? message.description;
  const placeholders = placeholdersValue(context.override.payload.placeholders);
  if (placeholders) message.placeholders = { ...(message.placeholders ?? {}), ...placeholders };
  message.confidence = 1;
  context.appliedOverrideIds.push(context.override.id);
}

function applyTokenRename(context: ApplyContext): void {
  const from = stringValue(context.override.payload.from) ?? context.override.target.tokenName;
  const to = stringValue(context.override.payload.to) ?? stringValue(context.override.payload.name);
  if (!from || !to) {
    addStale(context, "Token rename override is missing from/to token names.");
    return;
  }
  let renamed = false;
  const groups = [
    context.inferredTokens.colors,
    context.inferredTokens.spacing,
    context.inferredTokens.typography,
    context.inferredTokens.radii,
    context.inferredTokens.shadows
  ];
  for (const group of groups) {
    const token = group.find((candidate) => candidate.name === from);
    if (token) {
      token.name = to;
      token.confidence = 1;
      renamed = true;
    }
  }
  if (!renamed) {
    addStale(context, `Token ${from} does not exist.`);
    return;
  }
  context.appliedOverrideIds.push(context.override.id);
}

function applyTokenMerge(context: ApplyContext): void {
  const tokenType = stringValue(context.override.payload.tokenType);
  const sourceNames = stringArray(context.override.payload.sourceTokenNames);
  const canonicalName = stringValue(context.override.payload.canonicalTokenName) ?? stringValue(context.override.payload.name);
  if (!tokenType || sourceNames.length < 2 || !canonicalName) {
    addStale(context, "Token merge override is missing tokenType, sourceTokenNames, or canonicalTokenName.");
    return;
  }
  const group = tokenGroup(context.inferredTokens, tokenType);
  if (!group) {
    addStale(context, `Token type ${tokenType} is not supported.`);
    return;
  }
  const tokens = sourceNames.map((name) => group.find((candidate) => candidate.name === name));
  if (tokens.some((token) => !token)) {
    addStale(context, "One or more token_merge_override sources do not exist.");
    return;
  }
  const existingCanonical = group.find((token) => token.name === canonicalName);
  const [firstToken] = tokens as Array<Record<string, unknown>>;
  const merged = existingCanonical ?? clone(firstToken);
  merged.name = canonicalName;
  merged.confidence = 1;
  merged.usageCount = tokens.reduce((sum, token) => sum + numberValue(token?.usageCount), 0);
  merged.sourceNodeIds = Array.from(new Set(tokens.flatMap((token) => stringArray(token?.sourceNodeIds))));
  merged.aliases = Array.from(new Set(tokens.flatMap((token) => arrayValue(token?.aliases))));
  const nextGroup = group.filter((token) => {
    const name = stringValue(token.name);
    return !name || (!sourceNames.includes(name) && name !== canonicalName);
  });
  nextGroup.push(merged);
  replaceTokenGroup(context.inferredTokens, tokenType, nextGroup);
  context.appliedOverrideIds.push(context.override.id);
}

function applyTokenSplit(context: ApplyContext): void {
  const tokenType = stringValue(context.override.payload.tokenType);
  const sourceName = stringValue(context.override.payload.sourceTokenName) ?? context.override.target.tokenName;
  const outputs = Array.isArray(context.override.payload.tokens) ? context.override.payload.tokens : [];
  if (!tokenType || !sourceName || outputs.length === 0) {
    addStale(context, "Token split override is missing tokenType, sourceTokenName, or tokens.");
    return;
  }
  const group = tokenGroup(context.inferredTokens, tokenType);
  if (!group) {
    addStale(context, `Token type ${tokenType} is not supported.`);
    return;
  }
  const source = group.find((token) => token.name === sourceName);
  if (!source) {
    addStale(context, `Token ${sourceName} does not exist.`);
    return;
  }
  const nextGroup = group.filter((token) => token.name !== sourceName);
  for (const output of outputs) {
    if (!output || typeof output !== "object") continue;
    const patch = output as Record<string, unknown>;
    const name = stringValue(patch.name);
    if (!name) continue;
    nextGroup.push({
      ...clone(source),
      ...patch,
      name,
      confidence: 1,
      sourceNodeIds: stringArray(patch.sourceNodeIds).length > 0 ? stringArray(patch.sourceNodeIds) : source.sourceNodeIds
    });
  }
  replaceTokenGroup(context.inferredTokens, tokenType, nextGroup);
  context.appliedOverrideIds.push(context.override.id);
}

type ApplyContext = {
  override: UxOverride;
  normalizedDesignIR: NormalizedDesignIR;
  assetManifest: AssetManifest;
  i18nManifest: I18nManifest;
  inferredTokens: InferredTokens;
  conflicts: OverrideConflict[];
  warnings: OverrideConflictReport["warnings"];
  staleOverrides: StaleOverride[];
  appliedOverrideIds: string[];
};

function detectDuplicateConflicts(overrides: UxOverride[], conflicts: OverrideConflict[]): void {
  const seen = new Map<string, UxOverride>();
  for (const override of overrides) {
    const key = `${override.type}:${targetKey(override.target)}`;
    const previous = seen.get(key);
    if (previous && JSON.stringify(previous.payload) !== JSON.stringify(override.payload)) {
      conflicts.push({
        overrideIds: [previous.id, override.id],
        type: "duplicate_target",
        message: `Multiple active ${override.type} entries target ${targetKey(override.target)}.`,
        target: override.target
      });
    } else {
      seen.set(key, override);
    }
  }
}

function findNode(root: NormalizedNode, target: OverrideTarget): NormalizedNode | undefined {
  if (target.kind === "page") return root;
  if (target.normalizedNodeId) return findByNormalizedNodeId(root, target.normalizedNodeId);
  if (target.sourceNodeId) return findBySourceNodeId(root, target.sourceNodeId);
  return undefined;
}

function findByNormalizedNodeId(root: NormalizedNode, normalizedNodeId: string): NormalizedNode | undefined {
  let found: NormalizedNode | undefined;
  walk(root, (node) => {
    if (found) return;
    if (node.id === normalizedNodeId) found = node;
  });
  return found;
}

function findBySourceNodeId(root: NormalizedNode, sourceNodeId: string): NormalizedNode | undefined {
  for (const child of root.children) {
    const found = findBySourceNodeId(child, sourceNodeId);
    if (found) return found;
  }
  return root.sourceNodeIds.includes(sourceNodeId) ? root : undefined;
}

function findAsset(manifest: AssetManifest, target: OverrideTarget): AssetManifestEntry | undefined {
  return manifest.assets.find((asset) => {
    if (target.assetId && asset.id === target.assetId) return true;
    if (target.sourceNodeId && asset.sourceNodeId === target.sourceNodeId) return true;
    return false;
  });
}

function findMessage(manifest: I18nManifest, target: OverrideTarget): I18nMessage | undefined {
  return manifest.messages.find((message) => {
    if (target.messageKey && message.key === target.messageKey) return true;
    if (target.sourceNodeId && message.sourceNodeId === target.sourceNodeId) return true;
    return false;
  });
}

function removeNode(root: NormalizedNode, nodeId: string): NormalizedNode | undefined {
  for (const [index, child] of root.children.entries()) {
    if (child.id === nodeId) {
      return root.children.splice(index, 1)[0];
    }
    const nested = removeNode(child, nodeId);
    if (nested) return nested;
  }
  return undefined;
}

function containsNode(root: NormalizedNode, nodeId: string): boolean {
  let found = false;
  walk(root, (node) => {
    if (node.id === nodeId) found = true;
  });
  return found;
}

function findParent(root: NormalizedNode, nodeId: string): NormalizedNode | undefined {
  for (const child of root.children) {
    if (child.id === nodeId) return root;
    const nested = findParent(child, nodeId);
    if (nested) return nested;
  }
  return undefined;
}

function markOverride(root: NormalizedNode, override: UxOverride): void {
  const node = findNode(root, override.target);
  if (!node) return;
  node.overrideRefs = Array.from(new Set([...(node.overrideRefs ?? []), override.id]));
}

function walk(node: NormalizedNode, visit: (node: NormalizedNode) => void): void {
  visit(node);
  for (const child of node.children) walk(child, visit);
}

function unionBounds(nodes: NormalizedNode[]): NormalizedNode["bounds"] {
  const minX = Math.min(...nodes.map((node) => node.bounds.x));
  const minY = Math.min(...nodes.map((node) => node.bounds.y));
  const maxX = Math.max(...nodes.map((node) => node.bounds.x + node.bounds.w));
  const maxY = Math.max(...nodes.map((node) => node.bounds.y + node.bounds.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
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

function withHash(overrideSet: OverrideSet): OverrideSet {
  const copy = clone(overrideSet);
  copy.hash = "";
  copy.hash = `sha256_${createHash("sha256").update(stableStringify(copy)).digest("hex")}`;
  return copy;
}

function reportTimestamp(overrideSet: OverrideSet): string {
  const timestamps = overrideSet.overrides
    .flatMap((override) => [override.updatedAt, override.createdAt])
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .sort();
  return timestamps.at(-1) ?? "1970-01-01T00:00:00.000Z";
}

function addStale(context: ApplyContext, reason: string): void {
  context.staleOverrides.push({
    overrideId: context.override.id,
    type: context.override.type,
    target: context.override.target,
    reason
  });
}

function addConflict(context: ApplyContext, type: OverrideConflict["type"], message: string): void {
  context.conflicts.push({
    overrideIds: [context.override.id],
    type,
    message,
    target: context.override.target
  });
}

function orderOf(type: OverrideType): number {
  const index = overrideOrder.indexOf(type);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
}

function normalizeLayout(value: string | undefined): LayoutType | undefined {
  return value && layoutTypes.has(value as LayoutType) ? (value as LayoutType) : undefined;
}

function normalizeRole(value: string | undefined): NormalizedNode["role"] | undefined {
  const roles = new Set<NonNullable<NormalizedNode["role"]>>(["header", "content", "footer", "overlay", "section", "list", "decoration"]);
  return value && roles.has(value as NonNullable<NormalizedNode["role"]>) ? (value as NonNullable<NormalizedNode["role"]>) : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0) : [];
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function numberValue(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function boundsValue(value: unknown): AssetManifestEntry["cropBounds"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const x = numberValue(record.x);
  const y = numberValue(record.y);
  const w = numberValue(record.w);
  const h = numberValue(record.h);
  if (w <= 0 || h <= 0) return undefined;
  return { x, y, w, h };
}

function placeholdersValue(value: unknown): I18nMessage["placeholders"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const placeholders: NonNullable<I18nMessage["placeholders"]> = {};
  for (const [name, entry] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[a-z][A-Za-z0-9]*$/.test(name) || !entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const record = entry as Record<string, unknown>;
    const type = stringValue(record.type);
    if (!type) continue;
    placeholders[name] = {
      type,
      ...(stringValue(record.example) ? { example: stringValue(record.example) } : {}),
      ...(stringValue(record.description) ? { description: stringValue(record.description) } : {})
    };
  }
  return Object.keys(placeholders).length > 0 ? placeholders : undefined;
}

function tokenGroup(tokens: InferredTokens, tokenType: string): Array<Record<string, unknown>> | undefined {
  if (tokenType === "color" || tokenType === "colors") return tokens.colors as unknown as Array<Record<string, unknown>>;
  if (tokenType === "spacing") return tokens.spacing as unknown as Array<Record<string, unknown>>;
  if (tokenType === "typography") return tokens.typography as unknown as Array<Record<string, unknown>>;
  if (tokenType === "radius" || tokenType === "radii") return tokens.radii as unknown as Array<Record<string, unknown>>;
  if (tokenType === "shadow" || tokenType === "shadows") return tokens.shadows as unknown as Array<Record<string, unknown>>;
  return undefined;
}

function replaceTokenGroup(tokens: InferredTokens, tokenType: string, group: Array<Record<string, unknown>>): void {
  if (tokenType === "color" || tokenType === "colors") tokens.colors = group as unknown as InferredTokens["colors"];
  if (tokenType === "spacing") tokens.spacing = group as unknown as InferredTokens["spacing"];
  if (tokenType === "typography") tokens.typography = group as unknown as InferredTokens["typography"];
  if (tokenType === "radius" || tokenType === "radii") tokens.radii = group as unknown as InferredTokens["radii"];
  if (tokenType === "shadow" || tokenType === "shadows") tokens.shadows = group as unknown as InferredTokens["shadows"];
}

function targetKey(target: OverrideTarget): string {
  return [
    target.kind,
    target.sourceNodeId,
    target.normalizedNodeId,
    target.tokenName,
    target.assetId,
    target.messageKey
  ]
    .filter(Boolean)
    .join(":");
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

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
