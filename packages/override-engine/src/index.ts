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
    case "component_candidate_override":
      applyComponentCandidate(context);
      return;
    case "component_prop_override":
      applyComponentProp(context);
      return;
    case "component_variant_override":
      applyComponentVariant(context);
      return;
    case "flutter_component_mapping_override":
      applyFlutterComponentMapping(context);
      return;
    case "font_mapping_override":
      context.warnings.push({
        overrideId: override.id,
        type: "configuration_override",
        message: "font_mapping_override is recorded as project preview configuration for downstream renderers."
      });
      context.appliedOverrideIds.push(override.id);
      return;
    case "text_calibration_override":
      applyTextCalibration(context);
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

function applyComponentCandidate(context: ApplyContext): void {
  const payload = context.override.payload;
  const componentId = componentIdValue(payload);
  const kind = stringValue(payload.kind);
  const action = stringValue(payload.action);
  if (!componentId) {
    addConflict(context, "invalid_payload", "component_candidate_override requires componentId.");
    return;
  }

  if (kind === "reject_component" || action === "reject") {
    removeComponent(context.normalizedDesignIR, componentId);
    context.appliedOverrideIds.push(context.override.id);
    return;
  }

  if (kind !== "approve_component" && action !== "approve") {
    addConflict(context, "invalid_payload", "component_candidate_override requires approve or reject action.");
    return;
  }

  const name = stringValue(payload.name) ?? stringValue(payload.componentName) ?? pascalCase(componentId);
  const instances = stringArray(payload.instances).length > 0
    ? stringArray(payload.instances)
    : stringArray(payload.sourceInstances);
  if (instances.length === 0) {
    addConflict(context, "invalid_payload", "Approved component overrides require at least one source instance.");
    return;
  }

  const existing = findComponent(context.normalizedDesignIR, componentId);
  upsertComponent(context.normalizedDesignIR, {
    ...(existing ?? {}),
    id: componentId,
    componentId,
    name,
    source: "inferred_and_user_approved",
    sourceInstances: instances,
    instances,
    props: arrayValue(existing?.props),
    variants: arrayValue(existing?.variants),
    flutter: recordValue(existing?.flutter),
    confidence: 1,
    status: "approved",
    verified: false,
    reason: stringValue(payload.reason) ?? "Component candidate approved by override."
  });
  context.appliedOverrideIds.push(context.override.id);
}

function applyComponentProp(context: ApplyContext): void {
  const payload = context.override.payload;
  const componentId = componentIdValue(payload);
  const prop = recordValue(payload.prop);
  if (!componentId || !prop) {
    addConflict(context, "invalid_payload", "component_prop_override requires componentId and prop.");
    return;
  }
  const component = findComponent(context.normalizedDesignIR, componentId);
  if (!component) {
    addStale(context, `Component ${componentId} does not exist for component_prop_override.`);
    return;
  }
  const name = stringValue(prop.name);
  const sourceSelector = stringValue(prop.sourceSelector);
  if (!name || !sourceSelector) {
    addConflict(context, "invalid_payload", "Component prop requires name and sourceSelector.");
    return;
  }
  component.props = upsertRecordByName(arrayValue(component.props), prop);
  context.appliedOverrideIds.push(context.override.id);
}

function applyComponentVariant(context: ApplyContext): void {
  const payload = context.override.payload;
  const componentId = componentIdValue(payload);
  const variant = recordValue(payload.variant);
  if (!componentId || !variant) {
    addConflict(context, "invalid_payload", "component_variant_override requires componentId and variant.");
    return;
  }
  const component = findComponent(context.normalizedDesignIR, componentId);
  if (!component) {
    addStale(context, `Component ${componentId} does not exist for component_variant_override.`);
    return;
  }
  const name = stringValue(variant.name);
  const values = stringArray(variant.values);
  if (!name || values.length === 0) {
    addConflict(context, "invalid_payload", "Component variant requires name and values.");
    return;
  }
  component.variants = upsertRecordByName(arrayValue(component.variants), { ...variant, values });
  context.appliedOverrideIds.push(context.override.id);
}

function applyFlutterComponentMapping(context: ApplyContext): void {
  const payload = context.override.payload;
  const componentId = componentIdValue(payload);
  const flutter = recordValue(payload.flutter);
  if (!componentId || !flutter) {
    addConflict(context, "invalid_payload", "flutter_component_mapping_override requires componentId and flutter mapping.");
    return;
  }
  const component = findComponent(context.normalizedDesignIR, componentId);
  if (!component) {
    addStale(context, `Component ${componentId} does not exist for flutter_component_mapping_override.`);
    return;
  }
  const importPath = stringValue(flutter.import);
  const constructor = stringValue(flutter.constructor);
  if (!importPath || !constructor) {
    addConflict(context, "invalid_payload", "Flutter component mapping requires import and constructor.");
    return;
  }
  component.flutter = flutter;
  component.verified = true;
  context.appliedOverrideIds.push(context.override.id);
}

function applyTextCalibration(context: ApplyContext): void {
  const node = findNode(context.normalizedDesignIR.tree, context.override.target);
  if (!node) {
    addStale(context, "Target text node does not exist.");
    return;
  }
  if (node.type !== "text") {
    addConflict(context, "invalid_payload", "text_calibration_override can only target text nodes.");
    return;
  }

  const payload = context.override.payload;
  const calibrated = node as CalibratedTextNode;
  const textCalibration: Record<string, unknown> = {
    ...(recordValue(calibrated.textCalibration) ?? {}),
    ...(recordValue(calibrated.render?.textCalibration) ?? {})
  };
  let applied = false;

  const baselineShift = optionalNumberValue(payload.baselineShift);
  if (baselineShift !== undefined) {
    calibrated.baselineShift = baselineShift;
    textCalibration.baselineShift = baselineShift;
    applied = true;
  }

  const lineHeight = optionalPositiveNumber(payload.lineHeight);
  if (lineHeight !== undefined) {
    calibrated.lineHeight = lineHeight;
    textCalibration.lineHeight = lineHeight;
    applied = true;
  }
  const lineHeightDelta = optionalNumberValue(payload.lineHeightDelta);
  if (lineHeightDelta !== undefined) {
    if (optionalPositiveNumber(calibrated.lineHeight) !== undefined) {
      calibrated.lineHeight = Math.max(1, Number(calibrated.lineHeight) + lineHeightDelta);
    }
    textCalibration.lineHeightDelta = lineHeightDelta;
    applied = true;
  }

  const fontSize = optionalPositiveNumber(payload.fontSize);
  if (fontSize !== undefined) {
    calibrated.fontSize = fontSize;
    textCalibration.fontSize = fontSize;
    applied = true;
  }
  const fontSizeDelta = optionalNumberValue(payload.fontSizeDelta);
  if (fontSizeDelta !== undefined) {
    if (optionalPositiveNumber(calibrated.fontSize) !== undefined) {
      calibrated.fontSize = Math.max(1, Number(calibrated.fontSize) + fontSizeDelta);
    }
    textCalibration.fontSizeDelta = fontSizeDelta;
    applied = true;
  }

  const letterSpacing = optionalNumberValue(payload.letterSpacing);
  if (letterSpacing !== undefined) {
    calibrated.letterSpacing = letterSpacing;
    textCalibration.letterSpacing = letterSpacing;
    applied = true;
  }

  const boundsDelta = boundsDeltaValue(payload.bboxDelta);
  const offsetX = optionalNumberValue(payload.offsetX) ?? optionalNumberValue(payload.deltaX) ?? boundsDelta?.x;
  const offsetY = optionalNumberValue(payload.offsetY) ?? optionalNumberValue(payload.deltaY) ?? boundsDelta?.y;
  const widthDelta = optionalNumberValue(payload.widthDelta) ?? optionalNumberValue(payload.deltaW) ?? boundsDelta?.w;
  const heightDelta = optionalNumberValue(payload.heightDelta) ?? optionalNumberValue(payload.deltaH) ?? boundsDelta?.h;
  if (offsetX !== undefined || offsetY !== undefined || widthDelta !== undefined || heightDelta !== undefined) {
    const nextBounds = {
      x: node.bounds.x + (offsetX ?? 0),
      y: node.bounds.y + (offsetY ?? 0),
      w: node.bounds.w + (widthDelta ?? 0),
      h: node.bounds.h + (heightDelta ?? 0)
    };
    if (nextBounds.w <= 0 || nextBounds.h <= 0) {
      addConflict(context, "invalid_payload", "text_calibration_override bounds delta would create non-positive bounds.");
      return;
    }
    node.bounds = nextBounds;
    textCalibration.boundsDelta = {
      x: offsetX ?? 0,
      y: offsetY ?? 0,
      w: widthDelta ?? 0,
      h: heightDelta ?? 0
    };
    applied = true;
  }

  if (!applied) {
    addConflict(context, "invalid_payload", "text_calibration_override requires a baseline, typography, or bounds calibration payload.");
    return;
  }

  calibrated.textCalibration = textCalibration;
  calibrated.render = {
    ...(calibrated.render ?? {}),
    textCalibration
  };
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
  const mergeIntoKey = stringValue(context.override.payload.mergeIntoKey);
  if (mergeIntoKey) {
    const target = context.i18nManifest.messages.find((candidate) => candidate.key === mergeIntoKey);
    if (!target) {
      addStale(context, `Target i18n merge key ${mergeIntoKey} does not exist.`);
      return;
    }
    if (target.sourceNodeId === message.sourceNodeId) {
      addConflict(context, "invalid_payload", "Cannot merge an i18n message into itself.");
      return;
    }
    if (target.value !== message.value) {
      addConflict(context, "invalid_payload", "Only duplicate i18n text values can be merged.");
      return;
    }
    removeMessage(context.i18nManifest, message);
    context.i18nManifest.warnings.push({
      sourceNodeId: message.sourceNodeId,
      type: "merged_duplicate_text",
      message: `${message.key} was merged into ${target.key}.`
    });
    context.appliedOverrideIds.push(context.override.id);
    return;
  }
  const nonI18nReason = stringValue(context.override.payload.nonI18nReason);
  if (nonI18nReason) {
    removeMessage(context.i18nManifest, message);
    context.i18nManifest.warnings.push({
      sourceNodeId: message.sourceNodeId,
      type: "non_i18n",
      message: `${message.key} was marked as non-i18n by ${context.override.id}: ${nonI18nReason}`
    });
    context.appliedOverrideIds.push(context.override.id);
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

type CalibratedTextNode = NormalizedNode & {
  fontSize?: number;
  lineHeight?: number;
  letterSpacing?: number;
  baselineShift?: number;
  textCalibration?: Record<string, unknown>;
  render?: NormalizedNode["render"] & { textCalibration?: Record<string, unknown> };
};

function detectDuplicateConflicts(overrides: UxOverride[], conflicts: OverrideConflict[]): void {
  const seen = new Map<string, UxOverride>();
  for (const override of overrides) {
    const key = overrideConflictKey(override);
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

function overrideConflictKey(override: UxOverride): string {
  const componentId = componentIdValue(override.payload);
  if (
    componentId &&
    (override.type === "component_candidate_override" ||
      override.type === "component_prop_override" ||
      override.type === "component_variant_override" ||
      override.type === "flutter_component_mapping_override")
  ) {
    const childKey = override.type === "component_prop_override"
      ? stringValue(recordValue(override.payload.prop)?.name)
      : override.type === "component_variant_override"
        ? stringValue(recordValue(override.payload.variant)?.name)
        : undefined;
    return `${override.type}:${targetKey(override.target)}:${componentId}:${childKey ?? ""}`;
  }
  return `${override.type}:${targetKey(override.target)}`;
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

function componentIdValue(payload: Record<string, unknown>): string | undefined {
  return stringValue(payload.componentId) ?? stringValue(payload.inferredComponentId) ?? stringValue(payload.id);
}

function findComponent(ir: NormalizedDesignIR, componentId: string): Record<string, unknown> | undefined {
  return ir.components
    .map((component) => recordValue(component))
    .find((component) => {
      if (!component) return false;
      return componentIdValue(component) === componentId;
    });
}

function upsertComponent(ir: NormalizedDesignIR, component: Record<string, unknown>): void {
  const componentId = componentIdValue(component);
  if (!componentId) return;
  const index = ir.components.findIndex((candidate) => {
    const record = recordValue(candidate);
    return record ? componentIdValue(record) === componentId : false;
  });
  if (index === -1) ir.components.push(component);
  else ir.components[index] = component;
}

function removeComponent(ir: NormalizedDesignIR, componentId: string): void {
  ir.components = ir.components.filter((candidate) => {
    const record = recordValue(candidate);
    return !record || componentIdValue(record) !== componentId;
  });
}

function upsertRecordByName(items: unknown[], item: Record<string, unknown>): Record<string, unknown>[] {
  const name = stringValue(item.name);
  const records = items.map((entry) => recordValue(entry)).filter((entry): entry is Record<string, unknown> => Boolean(entry));
  if (!name) return records;
  const index = records.findIndex((entry) => stringValue(entry.name) === name);
  if (index === -1) return [...records, item];
  return [...records.slice(0, index), item, ...records.slice(index + 1)];
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

function removeMessage(manifest: I18nManifest, message: I18nMessage): void {
  manifest.messages = manifest.messages.filter((candidate) => candidate.sourceNodeId !== message.sourceNodeId || candidate.key !== message.key);
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

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
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

function optionalNumberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalPositiveNumber(value: unknown): number | undefined {
  const number = optionalNumberValue(value);
  return number !== undefined && number > 0 ? number : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function boundsDeltaValue(value: unknown): { x?: number; y?: number; w?: number; h?: number } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const delta = {
    x: optionalNumberValue(record.x),
    y: optionalNumberValue(record.y),
    w: optionalNumberValue(record.w),
    h: optionalNumberValue(record.h)
  };
  return delta.x !== undefined || delta.y !== undefined || delta.w !== undefined || delta.h !== undefined ? delta : undefined;
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

function pascalCase(value: string): string {
  const words = value.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const name = words.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join("");
  return name || "Component";
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
