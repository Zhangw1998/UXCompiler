import { createHash } from "node:crypto";
import type {
  AssetManifest,
  I18nManifest,
  InferredTokens,
  LayoutType,
  NormalizedDesignIR,
  NormalizedNode,
  OverrideSet,
  OverrideTarget,
  OverrideType,
  TreeEditOperation,
  TreeEditValidationIssue,
  TreeEditorResult,
  UxOverride
} from "@uxcompiler/ir-schemas";
import { applyOverrides, createEmptyOverrideSet } from "@uxcompiler/override-engine";

export interface ApplyTreeEditsInput {
  normalizedDesignIR: NormalizedDesignIR;
  assetManifest: AssetManifest;
  i18nManifest: I18nManifest;
  inferredTokens: InferredTokens;
  overrideSet?: OverrideSet;
  operations: TreeEditOperation[];
  actor?: "user" | "agent" | "system";
  now?: () => Date;
}

const layoutTypes = new Set<LayoutType>(["column", "row", "grid", "stack", "absolute", "leaf"]);
const renderStrategies = new Set(["semantic_widget", "semantic_layout", "absolute_widget", "custom_painter", "asset_slice", "hybrid_region", "ignore"]);

export function applyTreeEdits(input: ApplyTreeEditsInput): TreeEditorResult {
  const now = input.now ?? (() => new Date());
  const baseOverrideSet = input.overrideSet ?? createEmptyOverrideSet(input.normalizedDesignIR.source.frameNodeId);
  const issues: TreeEditValidationIssue[] = [];
  const mutations: UxOverride[] = [];
  const validOperationIds: string[] = [];
  const rejectedOperationIds: string[] = [];
  const workingTree = clone(input.normalizedDesignIR.tree);
  const reservedRegionIds = new Set<string>();

  for (const operation of input.operations) {
    const operationId = operation.id ?? operationFingerprint(operation);
    const beforeIssueCount = issues.length;
    validateOperation(operation, operationId, workingTree, reservedRegionIds, issues);
    if (issues.length > beforeIssueCount) {
      rejectedOperationIds.push(operationId);
      continue;
    }
    const override = toOverride(operation, operationId, input.actor ?? "user", now().toISOString());
    mutations.push(override);
    validOperationIds.push(operationId);
    applyOperationToWorkingTree(operation, workingTree);
    if ("regionId" in operation) reservedRegionIds.add(operation.regionId);
    if (operation.kind === "merge_regions") reservedRegionIds.add(operation.targetRegionId);
  }

  const draftOverrideSet: OverrideSet = {
    ...baseOverrideSet,
    overrides: [...baseOverrideSet.overrides, ...mutations],
    hash: ""
  };
  const overrideResult = applyOverrides({
    normalizedDesignIR: input.normalizedDesignIR,
    assetManifest: input.assetManifest,
    i18nManifest: input.i18nManifest,
    inferredTokens: input.inferredTokens,
    overrideSet: draftOverrideSet
  });

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
    draftNormalizedDesignIR: overrideResult.reviewedNormalizedDesignIR,
    overrideConflictReport: overrideResult.overrideConflictReport,
    staleOverrideReport: overrideResult.staleOverrideReport
  };
}

function validateOperation(
  operation: TreeEditOperation,
  operationId: string,
  tree: NormalizedNode,
  reservedRegionIds: Set<string>,
  issues: TreeEditValidationIssue[]
): void {
  if (!operation.reason.trim()) {
    addIssue(issues, operationId, "missing_reason", "Tree Editor save operations must include a reason.");
    return;
  }
  switch (operation.kind) {
    case "create_region":
      validateRegionId(operation.regionId, operationId, tree, reservedRegionIds, issues);
      validateName(operation.name, operationId, issues);
      validateUniqueValues(operation.sourceNodeIds, operationId, "duplicate_source", "Create region source nodes must be unique.", issues);
      validateSourceNodes(operation.sourceNodeIds, operationId, tree, issues);
      validateLayout(operation.layout, operationId, issues);
      return;
    case "merge_regions":
      validateRegionId(operation.targetRegionId, operationId, tree, reservedRegionIds, issues, operation.sourceRegionIds);
      validateName(operation.name, operationId, issues);
      validateLayout(operation.layout, operationId, issues);
      validateUniqueValues(operation.sourceRegionIds, operationId, "duplicate_source", "Merge source regions must be unique.", issues);
      if (operation.sourceRegionIds.length < 2) addIssue(issues, operationId, "missing_source", "Merge requires at least two regions.");
      for (const regionId of operation.sourceRegionIds) {
        const node = findNode(tree, { kind: "normalized_node", normalizedNodeId: regionId });
        if (!node || node === tree) addIssue(issues, operationId, "missing_source", `Source region ${regionId} does not exist.`);
      }
      return;
    case "split_region":
      validateRegionId(operation.regionId, operationId, tree, reservedRegionIds, issues);
      validateName(operation.name, operationId, issues);
      validateLayout(operation.layout, operationId, issues);
      {
        const sourceRegion = findNode(tree, { kind: "normalized_node", normalizedNodeId: operation.sourceRegionId });
        if (!sourceRegion || sourceRegion === tree) {
          addIssue(issues, operationId, "missing_target", `Source region ${operation.sourceRegionId} does not exist.`);
          return;
        }
        validateUniqueValues(operation.sourceNodeIds, operationId, "duplicate_source", "Split region source nodes must be unique.", issues);
        validateSourceNodes(operation.sourceNodeIds, operationId, sourceRegion, issues);
      }
      return;
    case "move_node":
      validateMove(operation, operationId, tree, issues);
      return;
    case "rename_node":
      validateName(operation.name, operationId, issues);
      validateTarget(operation, operationId, tree, issues);
      return;
    case "force_layout":
      if (!layoutTypes.has(operation.strategy)) addIssue(issues, operationId, "invalid_parent", `Invalid layout strategy ${operation.strategy}.`);
      validateTarget(operation, operationId, tree, issues);
      return;
    case "force_render":
      if (!renderStrategies.has(operation.strategy)) {
        addIssue(issues, operationId, "invalid_render_strategy", `Invalid render strategy ${operation.strategy}.`);
      }
      {
        const node = findOperationTarget(tree, operation);
        if (!node) {
          addIssue(issues, operationId, "missing_target", "Target node does not exist.");
        } else if (operation.strategy === "asset_slice" && node.type === "text") {
          addIssue(issues, operationId, "invalid_render_strategy", "Text nodes cannot be forced to asset_slice.");
        }
      }
      return;
    case "ignore_node":
      validateTarget(operation, operationId, tree, issues);
      return;
  }
}

function validateRegionId(
  regionId: string,
  operationId: string,
  tree: NormalizedNode,
  reservedRegionIds: Set<string>,
  issues: TreeEditValidationIssue[],
  allowedExistingIds: string[] = []
): void {
  if (!regionId.trim()) addIssue(issues, operationId, "invalid_name", "Region id is required.");
  const existing = findNode(tree, { kind: "normalized_node", normalizedNodeId: regionId });
  if ((existing && !allowedExistingIds.includes(regionId)) || reservedRegionIds.has(regionId)) {
    addIssue(issues, operationId, "duplicate_region", `Region id ${regionId} already exists.`);
  }
}

function validateSourceNodes(sourceNodeIds: string[], operationId: string, tree: NormalizedNode, issues: TreeEditValidationIssue[]): void {
  if (sourceNodeIds.length === 0) addIssue(issues, operationId, "missing_source", "At least one source node is required.");
  for (const sourceNodeId of sourceNodeIds) {
    const node = findNode(tree, { kind: "source_node", sourceNodeId });
    if (!node || node === tree) addIssue(issues, operationId, "missing_source", `Source node ${sourceNodeId} does not exist.`);
  }
}

function validateMove(operation: Extract<TreeEditOperation, { kind: "move_node" }>, operationId: string, tree: NormalizedNode, issues: TreeEditValidationIssue[]): void {
  validateOperationTargetShape(operation, operationId, issues);
  const node = findOperationTarget(tree, operation);
  const parent = findNode(tree, { kind: "normalized_node", normalizedNodeId: operation.targetNormalizedParentId });
  if (!node || node === tree) addIssue(issues, operationId, "missing_target", "Move target node does not exist or is the page root.");
  if (!parent) addIssue(issues, operationId, "invalid_parent", `Parent ${operation.targetNormalizedParentId} does not exist.`);
  if (node && parent && (node === parent || containsNode(node, parent.id))) {
    addIssue(issues, operationId, "cycle", "Move would create a tree cycle.");
  }
}

function validateTarget(
  operation: Extract<TreeEditOperation, { kind: "rename_node" | "force_layout" | "ignore_node" }>,
  operationId: string,
  tree: NormalizedNode,
  issues: TreeEditValidationIssue[]
): void {
  validateOperationTargetShape(operation, operationId, issues);
  const node = findOperationTarget(tree, operation);
  if (!node || node === tree) addIssue(issues, operationId, "missing_target", "Target node does not exist or is the page root.");
}

function validateOperationTargetShape(
  operation: { normalizedNodeId?: string; sourceNodeId?: string },
  operationId: string,
  issues: TreeEditValidationIssue[]
): void {
  const hasNormalizedTarget = typeof operation.normalizedNodeId === "string" && operation.normalizedNodeId.trim().length > 0;
  const hasSourceTarget = typeof operation.sourceNodeId === "string" && operation.sourceNodeId.trim().length > 0;
  if (!hasNormalizedTarget && !hasSourceTarget) {
    addIssue(issues, operationId, "missing_target", "Operation must include normalizedNodeId or sourceNodeId.");
  }
}

function validateUniqueValues(
  values: string[],
  operationId: string,
  code: TreeEditValidationIssue["code"],
  message: string,
  issues: TreeEditValidationIssue[]
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (!value.trim()) continue;
    if (seen.has(value)) {
      addIssue(issues, operationId, code, message);
      return;
    }
    seen.add(value);
  }
}

function validateName(name: string, operationId: string, issues: TreeEditValidationIssue[]): void {
  if (!/^[A-Za-z][A-Za-z0-9_ ]*$/.test(name)) {
    addIssue(issues, operationId, "invalid_name", `Name ${name} is not a stable editor name.`);
  }
}

function validateLayout(layout: LayoutType | undefined, operationId: string, issues: TreeEditValidationIssue[]): void {
  if (layout && !layoutTypes.has(layout)) addIssue(issues, operationId, "invalid_parent", `Invalid layout ${layout}.`);
}

function toOverride(operation: TreeEditOperation, operationId: string, actor: UxOverride["createdBy"], createdAt: string): UxOverride {
  const base = {
    id: `ovr_tree_${safeId(operationId)}`,
    status: "active" as const,
    createdBy: actor,
    createdAt
  };
  switch (operation.kind) {
    case "create_region":
      return {
        ...base,
        type: "region_create_override",
        target: { kind: "page" },
        payload: pickPayload(operation, ["regionId", "name", "role", "sourceNodeIds", "layout", "reason"])
      };
    case "merge_regions":
      return {
        ...base,
        type: "region_merge_override",
        target: { kind: "page" },
        payload: pickPayload(operation, ["sourceRegionIds", "targetRegionId", "name", "role", "layout", "reason"])
      };
    case "split_region":
      return {
        ...base,
        type: "region_split_override",
        target: { kind: "normalized_node", normalizedNodeId: operation.sourceRegionId },
        payload: pickPayload(operation, ["sourceRegionId", "regionId", "name", "role", "sourceNodeIds", "layout", "reason"])
      };
    case "move_node":
      return {
        ...base,
        type: "node_parent_override",
        target: operationTarget(operation),
        payload: pickPayload(operation, ["targetNormalizedParentId", "reason"])
      };
    case "rename_node":
      return {
        ...base,
        type: "naming_override",
        target: operationTarget(operation),
        payload: pickPayload(operation, ["name", "reason"])
      };
    case "force_layout":
      return {
        ...base,
        type: "layout_strategy_override",
        target: operationTarget(operation),
        payload: { strategy: operation.strategy, reason: operation.reason }
      };
    case "force_render":
      return {
        ...base,
        type: "render_strategy_override",
        target: operationTarget(operation),
        payload: { strategy: operation.strategy, reason: operation.reason }
      };
    case "ignore_node":
      return {
        ...base,
        type: "ignore_node_override",
        target: operationTarget(operation),
        payload: { reason: operation.reason }
      };
  }
}

function applyOperationToWorkingTree(operation: TreeEditOperation, tree: NormalizedNode): void {
  const override = toOverride(operation, operation.id ?? operationFingerprint(operation), "system", "1970-01-01T00:00:00.000Z");
  const result = applyOverrides({
    normalizedDesignIR: {
      version: "draft",
      source: { viewport: { width: tree.bounds.w, height: tree.bounds.h } },
      tokens: { version: "draft", colors: [], spacing: [], typography: [], radii: [], shadows: [] },
      components: [],
      tree,
      fallbacks: [],
      confidence: { overall: 1, tokens: 1, layout: 1, components: 1 }
    },
    assetManifest: { version: "draft", assets: [], warnings: [] },
    i18nManifest: { version: "draft", locale: "en", messages: [], warnings: [] },
    inferredTokens: { version: "draft", colors: [], spacing: [], typography: [], radii: [], shadows: [] },
    overrideSet: { id: "draft", version: 1, hash: "", overrides: [override] }
  });
  Object.assign(tree, result.reviewedNormalizedDesignIR.tree);
}

function operationTarget(operation: { normalizedNodeId?: string; sourceNodeId?: string }): OverrideTarget {
  if (operation.normalizedNodeId) return { kind: "normalized_node", normalizedNodeId: operation.normalizedNodeId };
  return { kind: "source_node", sourceNodeId: operation.sourceNodeId };
}

function findOperationTarget(tree: NormalizedNode, operation: { normalizedNodeId?: string; sourceNodeId?: string }): NormalizedNode | undefined {
  return findNode(tree, operationTarget(operation));
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

function containsNode(root: NormalizedNode, nodeId: string): boolean {
  let found = false;
  walk(root, (node) => {
    if (node.id === nodeId) found = true;
  });
  return found;
}

function walk(node: NormalizedNode, visit: (node: NormalizedNode) => void): void {
  visit(node);
  for (const child of node.children) walk(child, visit);
}

function addIssue(issues: TreeEditValidationIssue[], operationId: string, code: TreeEditValidationIssue["code"], message: string): void {
  issues.push({
    operationId,
    severity: "error",
    code,
    message
  });
}

function pickPayload<T extends Record<string, unknown>>(source: T, keys: Array<keyof T>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined) payload[String(key)] = value;
  }
  return payload;
}

function operationFingerprint(operation: TreeEditOperation): string {
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

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
