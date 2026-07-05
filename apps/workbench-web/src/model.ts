export type JsonRecord = Record<string, unknown>;

export interface WorkbenchArtifacts {
  artifactRoot?: string;
  normalizedDesignIR?: unknown;
  reviewedNormalizedDesignIR?: unknown;
  visualIR?: unknown;
  webPreviewState?: unknown;
  reviewTasks?: unknown;
  taskStatusReport?: unknown;
  overrideSet?: unknown;
  inferredTokens?: unknown;
  reviewedInferredTokens?: unknown;
  tokenRegistry?: unknown;
  assetManifest?: unknown;
  reviewedAssetManifest?: unknown;
  finalAssetManifest?: unknown;
  i18nManifest?: unknown;
  reviewedI18nManifest?: unknown;
  finalI18nManifest?: unknown;
  componentRegistry?: unknown;
  studioReport?: unknown;
  workbenchStudioActionReport?: unknown;
  workbenchStudioRollbackReport?: unknown;
  codegenReview?: unknown;
  codegenPromotionRules?: unknown;
  assetsToAdd?: unknown;
  arbPatch?: unknown;
  pubspecPatch?: unknown;
  mergeReport?: unknown;
  workbenchCodegenReviewReport?: unknown;
  projectWriteReport?: unknown;
  nodeRemapReport?: unknown;
  tokenMigrationReport?: unknown;
  workbenchSyncRemapReport?: unknown;
  staleOverrideReport?: unknown;
  overrideConflictReport?: unknown;
  visualDiffReport?: unknown;
  diffRepairReport?: unknown;
  repairPatch?: unknown;
  flutterPreviewFormatReport?: unknown;
  flutterPreviewAnalyzeReport?: unknown;
  flutterPreviewCaptureReport?: unknown;
  fidelityGenerationManifest?: unknown;
  flutterPreviewUrl?: string;
  diffHeatmapUrl?: string;
}

export interface TreeRow {
  id: string;
  name: string;
  type: string;
  depth: number;
  layout: string;
  confidence?: number;
  sourceNodeIds: string[];
  bounds?: Bounds;
  childCount: number;
}

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface VisualNode {
  sourceNodeId: string;
  type: string;
  x: number;
  y: number;
  w: number;
  h: number;
  text?: string;
  fill?: string;
}

export interface WorkbenchModel {
  artifactRoot: string;
  viewport: { width: number; height: number };
  project: {
    frameNodeId: string;
    frameName: string;
    status: string;
    confidence?: number;
  };
  metrics: Array<{ label: string; value: string; tone: "neutral" | "good" | "warn" | "bad" }>;
  reviewSummary: {
    total: number;
    open: number;
    blocked: boolean;
    byPriority: Record<string, number>;
    byType: Record<string, number>;
  };
  tokenCounts: Record<string, number>;
  treeRows: TreeRow[];
  visualNodes: VisualNode[];
  componentCount: number;
  assetCount: number;
  i18nCount: number;
  overrideCount: number;
  codegen: {
    status: string;
    blockers: number;
    filesToCreate: number;
    filesToModify: number;
  };
  sync: {
    matches: number;
    reviewRequired: number;
    staleOverrides: number;
  };
  preview: {
    hasVisualIR: boolean;
    hasWebPreviewState: boolean;
    hasFlutterPreview: boolean;
    hasDiffReport: boolean;
    hasHeatmap: boolean;
  };
  artifactStatus: Array<{ label: string; present: boolean; note: string }>;
}

export function buildWorkbenchModel(artifacts: WorkbenchArtifacts): WorkbenchModel {
  const normalized = asRecord(artifacts.reviewedNormalizedDesignIR ?? artifacts.normalizedDesignIR);
  const visualIR = asRecord(artifacts.visualIR);
  const visualRoot = asRecord(visualIR.root);
  const visualSize = asRecord(visualRoot.size);
  const normalizedSource = asRecord(normalized.source);
  const normalizedViewport = asRecord(normalizedSource.viewport);
  const visualSource = asRecord(visualIR.source);
  const visualViewport = asRecord(visualSource.viewport);
  const viewport = {
    width: numberFrom(normalizedViewport.width) ?? numberFrom(visualViewport.width) ?? numberFrom(visualSize.w) ?? 0,
    height: numberFrom(normalizedViewport.height) ?? numberFrom(visualViewport.height) ?? numberFrom(visualSize.h) ?? 0
  };

  const tree = asRecord(normalized.tree);
  const confidence = numberFrom(asRecord(normalized.confidence).overall);
  const frameNodeId = stringFrom(normalizedSource.frameNodeId) ?? stringFrom(visualSource.frameNodeId) ?? "unknown";
  const frameName = stringFrom(tree.name) ?? "Current Frame";
  const reviewTasks = asArray(artifacts.reviewTasks).map(asRecord);
  const taskStatusReport = asRecord(artifacts.taskStatusReport);
  const codegenBlocked = booleanFrom(taskStatusReport.codegenWriteBlocked) ?? false;
  const reviewSummary = summarizeReviewTasks(reviewTasks, taskStatusReport, codegenBlocked);
  const tokens = asRecord(artifacts.reviewedInferredTokens ?? artifacts.inferredTokens ?? normalized.tokens);
  const tokenCounts = countTokenGroups(tokens);
  const overrideSet = asRecord(artifacts.overrideSet);
  const overrideCount = asArray(overrideSet.overrides).length;
  const assetManifest = asRecord(artifacts.finalAssetManifest ?? artifacts.reviewedAssetManifest ?? artifacts.assetManifest);
  const i18nManifest = asRecord(artifacts.finalI18nManifest ?? artifacts.reviewedI18nManifest ?? artifacts.i18nManifest);
  const components = asArray(asRecord(artifacts.componentRegistry).components ?? normalized.components);
  const assetCount = asArray(assetManifest.assets).length;
  const i18nCount = asArray(i18nManifest.messages).length;
  const codegen = summarizeCodegen(artifacts.codegenReview, codegenBlocked);
  const sync = summarizeSync(artifacts.nodeRemapReport, artifacts.staleOverrideReport);
  const visualNodes = collectVisualNodes(visualIR);
  const treeRows = flattenDesignTree(tree);
  const webPreviewCommands = asArray(asRecord(artifacts.webPreviewState).commands);
  const preview = {
    hasVisualIR: visualNodes.length > 0,
    hasWebPreviewState: webPreviewCommands.length > 0,
    hasFlutterPreview: Boolean(artifacts.flutterPreviewUrl),
    hasDiffReport: Boolean(artifacts.visualDiffReport),
    hasHeatmap: Boolean(artifacts.diffHeatmapUrl)
  };

  const status = codegenBlocked ? "review-blocked" : reviewSummary.open > 0 ? "needs-review" : "ready";
  const metrics = [
    metric("Open Tasks", reviewSummary.open, reviewSummary.open > 0 ? "warn" : "good"),
    metric("Tree Nodes", treeRows.length, treeRows.length > 0 ? "good" : "bad"),
    metric("Visual Nodes", visualNodes.length, visualNodes.length > 0 ? "good" : "bad"),
    metric("Overrides", overrideCount, overrideCount > 0 ? "neutral" : "neutral"),
    metric("Assets", assetCount, assetCount > 0 ? "good" : "warn"),
    metric("i18n Keys", i18nCount, i18nCount > 0 ? "good" : "warn")
  ];

  return {
    artifactRoot: artifacts.artifactRoot ?? "/artifacts/sample",
    viewport,
    project: {
      frameNodeId,
      frameName,
      status,
      confidence
    },
    metrics,
    reviewSummary,
    tokenCounts,
    treeRows,
    visualNodes,
    componentCount: components.length,
    assetCount,
    i18nCount,
    overrideCount,
    codegen,
    sync,
    preview,
    artifactStatus: [
      artifactStatus("Reviewed Normalized IR", Boolean(normalized.tree), frameName),
      artifactStatus("Visual IR", visualNodes.length > 0, `${visualNodes.length} render nodes`),
      artifactStatus("Web Preview", preview.hasWebPreviewState, `${webPreviewCommands.length} canvas commands`),
      artifactStatus("Review Tasks", reviewTasks.length > 0, `${reviewSummary.open} open`),
      artifactStatus("Override Set", Boolean(overrideSet.hash) || overrideCount > 0, `${overrideCount} overrides`),
      artifactStatus("Studio Review", Boolean(artifacts.studioReport), Boolean(artifacts.studioReport) ? "review applied" : "not applied"),
      artifactStatus("Flutter Preview", preview.hasFlutterPreview, preview.hasFlutterPreview ? "image available" : "missing"),
      artifactStatus("Codegen Review", Boolean(artifacts.codegenReview), codegen.status),
      artifactStatus("Incremental Sync", Boolean(artifacts.nodeRemapReport), `${sync.matches} matches`)
    ]
  };
}

export function flattenDesignTree(node: unknown, depth = 0, rows: TreeRow[] = []): TreeRow[] {
  const record = asRecord(node);
  if (Object.keys(record).length === 0) return rows;
  const children = asArray(record.children);
  const layout = asRecord(record.layout);
  const sourceNodeIds = asArray(record.sourceNodeIds)
    .map((entry) => stringFrom(entry))
    .filter((entry): entry is string => Boolean(entry));
  rows.push({
    id: stringFrom(record.id) ?? `node_${rows.length}`,
    name: stringFrom(record.name) ?? "Unnamed",
    type: stringFrom(record.type) ?? "node",
    depth,
    layout: stringFrom(layout.type) ?? stringFrom(record.layout) ?? "none",
    confidence: numberFrom(record.confidence),
    sourceNodeIds,
    bounds: boundsFrom(record.bounds),
    childCount: children.length
  });
  for (const child of children) flattenDesignTree(child, depth + 1, rows);
  return rows;
}

export function collectVisualNodes(visualIR: unknown): VisualNode[] {
  const root = asRecord(asRecord(visualIR).root);
  const children = asArray(root.children);
  const nodes: VisualNode[] = [];
  for (const entry of children) {
    const positioned = asRecord(entry);
    const child = asRecord(positioned.child);
    const sourceNodeId = stringFrom(positioned.sourceNodeId) ?? stringFrom(child.sourceNodeId) ?? "unknown";
    nodes.push({
      sourceNodeId,
      type: stringFrom(child.type) ?? stringFrom(positioned.type) ?? "node",
      x: numberFrom(positioned.x) ?? 0,
      y: numberFrom(positioned.y) ?? 0,
      w: numberFrom(positioned.w) ?? numberFrom(child.w) ?? 0,
      h: numberFrom(positioned.h) ?? numberFrom(child.h) ?? 0,
      text: stringFrom(child.text),
      fill: stringFrom(child.fill)
    });
  }
  return nodes;
}

export function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

export function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function stringFrom(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function numberFrom(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function booleanFrom(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function summarizeReviewTasks(
  tasks: JsonRecord[],
  taskStatusReport: JsonRecord,
  codegenBlocked: boolean
): WorkbenchModel["reviewSummary"] {
  const byPriority = recordOfNumbers(taskStatusReport.byPriority);
  const byType = recordOfNumbers(taskStatusReport.byType);
  if (Object.keys(byPriority).length === 0 || Object.keys(byType).length === 0) {
    for (const task of tasks) {
      const priority = stringFrom(task.priority) ?? "P?";
      const type = stringFrom(task.type) ?? "unknown";
      byPriority[priority] = (byPriority[priority] ?? 0) + 1;
      byType[type] = (byType[type] ?? 0) + 1;
    }
  }
  const total = numberFrom(taskStatusReport.total) ?? tasks.length;
  const open = numberFrom(taskStatusReport.open) ?? tasks.filter((task) => task.status !== "closed").length;
  return {
    total,
    open,
    blocked: codegenBlocked,
    byPriority,
    byType
  };
}

function summarizeCodegen(value: unknown, codegenBlocked: boolean): WorkbenchModel["codegen"] {
  const review = asRecord(value);
  const gates = asRecord(review.gates);
  const status = stringFrom(gates.status) ?? (codegenBlocked ? "blocked" : "not-generated");
  return {
    status,
    blockers: asArray(gates.blockers).length,
    filesToCreate: asArray(review.filesToCreate).length,
    filesToModify: asArray(review.filesToModify).length
  };
}

function summarizeSync(nodeRemapReport: unknown, staleOverrideReport: unknown): WorkbenchModel["sync"] {
  const report = asRecord(nodeRemapReport);
  const matches = asArray(report.matches).map(asRecord);
  const staleReport = asRecord(staleOverrideReport);
  return {
    matches: matches.length,
    reviewRequired: matches.filter((match) => booleanFrom(match.reviewRequired)).length,
    staleOverrides: asArray(report.staleOverrides).length + asArray(staleReport.staleOverrides).length
  };
}

function countTokenGroups(tokens: JsonRecord): Record<string, number> {
  return {
    colors: asArray(tokens.colors).length,
    spacing: asArray(tokens.spacing).length,
    typography: asArray(tokens.typography).length,
    radii: asArray(tokens.radii).length,
    shadows: asArray(tokens.shadows).length
  };
}

function recordOfNumbers(value: unknown): Record<string, number> {
  const record = asRecord(value);
  const result: Record<string, number> = {};
  for (const [key, count] of Object.entries(record)) {
    if (typeof count === "number" && Number.isFinite(count)) result[key] = count;
  }
  return result;
}

function boundsFrom(value: unknown): Bounds | undefined {
  const bounds = asRecord(value);
  const x = numberFrom(bounds.x);
  const y = numberFrom(bounds.y);
  const w = numberFrom(bounds.w);
  const h = numberFrom(bounds.h);
  if (x === undefined || y === undefined || w === undefined || h === undefined) return undefined;
  return { x, y, w, h };
}

function metric(label: string, value: number, tone: "neutral" | "good" | "warn" | "bad"): WorkbenchModel["metrics"][number] {
  return {
    label,
    value: String(value),
    tone
  };
}

function artifactStatus(label: string, present: boolean, note: string): WorkbenchModel["artifactStatus"][number] {
  return { label, present, note };
}
