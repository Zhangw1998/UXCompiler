import { createHash } from "node:crypto";
import type {
  IncrementalSyncRemapResult,
  NodeRemapMatch,
  NodeRemapReport,
  OverrideSet,
  OverrideTarget,
  RawFigmaNode,
  RawFigmaScene,
  ReappliedOverride,
  ReviewTask,
  StaleOverride,
  TokenMigrationReport,
  VisualDiffChange,
  VisualDiffReport,
  UxOverride
} from "@uxcompiler/ir-schemas";

export interface RunIncrementalSyncInput {
  oldRawScene: RawFigmaScene;
  newRawScene: RawFigmaScene;
  overrideSet: OverrideSet;
  oldSnapshotId?: string;
  newSnapshotId?: string;
  oldVisualDiffReport?: VisualDiffReport;
  newVisualDiffReport?: VisualDiffReport;
  actor?: "user" | "agent" | "system";
  now?: () => Date;
}

interface NodeProfile {
  id: string;
  type: string;
  name: string;
  path: string;
  parentPath: string;
  siblingContext: string;
  textHash: string;
  visualHash: string;
  tokenHash: string;
  stableKey: string;
  text: string;
  bounds?: { x: number; y: number; width: number; height: number };
  childrenCount: number;
}

interface TokenObservation {
  kind: "color" | "typography" | "radius";
  key: string;
  slot: string;
  value: string | number;
  sourceNodeId: string;
}

interface RemapDecision {
  match?: NodeRemapMatch;
  stale?: string;
}

const autoReapplyThreshold = 0.9;
const reviewReapplyThreshold = 0.7;

export function runIncrementalSync(input: RunIncrementalSyncInput): IncrementalSyncRemapResult {
  const now = input.now ?? (() => new Date());
  const generatedAt = now().toISOString();
  const oldProfiles = indexScene(input.oldRawScene);
  const newProfiles = indexScene(input.newRawScene);
  const matches = buildMatches(oldProfiles, newProfiles);
  const tokenMigrationReport = buildTokenMigrationReport(input.oldRawScene, input.newRawScene, matches, {
    generatedAt,
    oldSnapshotId: input.oldSnapshotId,
    newSnapshotId: input.newSnapshotId
  });
  const remap = new Map(matches.filter((match) => match.newSourceNodeId && match.matchScore >= reviewReapplyThreshold).map((match) => [match.oldSourceNodeId, match]));
  const staleOverrides: StaleOverride[] = [];
  const reappliedOverrides: ReappliedOverride[] = [];
  const incrementalReviewTasks: ReviewTask[] = [];
  const overrides: UxOverride[] = [];

  for (const override of input.overrideSet.overrides) {
    const remapped = remapOverride(override, remap, generatedAt, input.actor ?? "agent");
    if (!("override" in remapped)) {
      staleOverrides.push({
        overrideId: override.id,
        type: override.type,
        target: override.target,
        reason: remapped.stale
      });
      overrides.push({ ...override, status: "disabled", updatedAt: generatedAt });
      continue;
    }
    overrides.push(remapped.override);
    reappliedOverrides.push(remapped.reapplied);
    if (remapped.reapplied.reviewRequired) {
      incrementalReviewTasks.push(reviewTaskForOverride(remapped.reapplied, remapped.override));
    }
  }

  const usedOldNodeIds = new Set(reappliedOverrides.flatMap((entry) => entry.remappedSourceNodeIds.map((item) => item.oldSourceNodeId)));
  const nodeRemapReport: NodeRemapReport = {
    version: "0.1.0",
    generatedAt,
    oldSnapshotId: input.oldSnapshotId,
    newSnapshotId: input.newSnapshotId,
    rawSceneChanged: hashStable(input.oldRawScene.root) !== hashStable(input.newRawScene.root),
    visualDiffChange: summarizeVisualDiffChange(input.oldVisualDiffReport, input.newVisualDiffReport),
    matches: matches.map((match) => ({
      ...match,
      overrideReapplied: usedOldNodeIds.has(match.oldSourceNodeId)
    })),
    addedSourceNodeIds: [...newProfiles.keys()].filter((id) => ![...matches].some((match) => match.newSourceNodeId === id)).sort(),
    removedSourceNodeIds: matches.filter((match) => !match.newSourceNodeId).map((match) => match.oldSourceNodeId).sort(),
    staleOverrides
  };

  return {
    version: "0.1.0",
    oldSnapshotId: input.oldSnapshotId,
    newSnapshotId: input.newSnapshotId,
    overrideSet: withHash({
      ...input.overrideSet,
      snapshotId: input.newSnapshotId ?? input.newRawScene.source.frameNodeId ?? input.overrideSet.snapshotId,
      overrides,
      hash: ""
    }),
    nodeRemapReport,
    tokenMigrationReport,
    reappliedOverrides,
    staleOverrides,
    incrementalReviewTasks
  };
}

function buildMatches(oldProfiles: Map<string, NodeProfile>, newProfiles: Map<string, NodeProfile>): NodeRemapMatch[] {
  const consumedNewIds = new Set<string>();
  const matches: NodeRemapMatch[] = [];
  for (const oldProfile of oldProfiles.values()) {
    const exact = newProfiles.get(oldProfile.id);
    if (exact) {
      consumedNewIds.add(exact.id);
      matches.push(toMatch(oldProfile, exact, 1, "node_id_exact"));
      continue;
    }
    const candidates = [...newProfiles.values()].filter((candidate) => !consumedNewIds.has(candidate.id) && candidate.type === oldProfile.type);
    const scored = candidates
      .map((candidate) => {
        const score = scoreProfiles(oldProfile, candidate);
        return { candidate, score };
      })
      .sort((left, right) => right.score - left.score);
    const best = scored[0];
    if (best && best.score >= reviewReapplyThreshold) {
      consumedNewIds.add(best.candidate.id);
      matches.push(toMatch(oldProfile, best.candidate, best.score, best.score >= autoReapplyThreshold ? "stable_key" : "similarity"));
    } else {
      matches.push(toMissingMatch(oldProfile));
    }
  }
  return matches.sort((left, right) => left.oldSourceNodeId.localeCompare(right.oldSourceNodeId));
}

function summarizeVisualDiffChange(oldReport?: VisualDiffReport, newReport?: VisualDiffReport): VisualDiffChange {
  if (!oldReport && !newReport) return { status: "missing" };
  if (!oldReport) {
    return {
      status: "missing_old",
      newVisualScore: round(newReport?.page.score.visualScore ?? 0),
      newPixelDiffRatio: round(newReport?.page.score.pixelDiffRatio ?? 0)
    };
  }
  if (!newReport) {
    return {
      status: "missing_new",
      oldVisualScore: round(oldReport.page.score.visualScore),
      oldPixelDiffRatio: round(oldReport.page.score.pixelDiffRatio)
    };
  }
  const oldVisualScore = round(oldReport.page.score.visualScore);
  const newVisualScore = round(newReport.page.score.visualScore);
  const oldPixelDiffRatio = round(oldReport.page.score.pixelDiffRatio);
  const newPixelDiffRatio = round(newReport.page.score.pixelDiffRatio);
  return {
    status: "available",
    oldVisualScore,
    newVisualScore,
    visualScoreDelta: round(newVisualScore - oldVisualScore),
    oldPixelDiffRatio,
    newPixelDiffRatio,
    pixelDiffRatioDelta: round(newPixelDiffRatio - oldPixelDiffRatio)
  };
}

function scoreProfiles(oldProfile: NodeProfile, newProfile: NodeProfile): number {
  if (oldProfile.stableKey === newProfile.stableKey) return 0.93;
  const pathSimilarity = stringSimilarity(oldProfile.path, newProfile.path);
  const visualScore = oldProfile.visualHash === newProfile.visualHash ? 1 : boundsSimilarity(oldProfile.bounds, newProfile.bounds);
  const textScore = stringSimilarity(oldProfile.text, newProfile.text);
  const siblingScore = stringSimilarity(oldProfile.siblingContext, newProfile.siblingContext);
  const nameScore = stringSimilarity(oldProfile.name, newProfile.name);
  const structureScore = oldProfile.childrenCount === newProfile.childrenCount ? 1 : 0;
  return round(0.15 * pathSimilarity + 0.2 * visualScore + 0.15 * textScore + 0.15 * siblingScore + 0.25 * nameScore + 0.1 * structureScore);
}

function toMatch(oldProfile: NodeProfile, newProfile: NodeProfile, score: number, method: NodeRemapMatch["method"]): NodeRemapMatch {
  const textChanged = oldProfile.textHash !== newProfile.textHash;
  const tokenChanged = oldProfile.tokenHash !== newProfile.tokenHash;
  const visualChanged = oldProfile.visualHash !== newProfile.visualHash;
  const layoutChanged = boundsSimilarity(oldProfile.bounds, newProfile.bounds) < 0.98;
  return {
    oldSourceNodeId: oldProfile.id,
    newSourceNodeId: newProfile.id,
    matchScore: round(score),
    method,
    changeType: textChanged
      ? "text_change"
      : tokenChanged
        ? "token_value_change"
        : layoutChanged
          ? "layout_change"
          : visualChanged
            ? "visual_only_change"
            : "unchanged",
    overrideReapplied: false,
    reviewRequired: score < autoReapplyThreshold,
    evidence: {
      oldPath: oldProfile.path,
      newPath: newProfile.path,
      oldStableKey: oldProfile.stableKey,
      newStableKey: newProfile.stableKey,
      pathSimilarity: round(stringSimilarity(oldProfile.path, newProfile.path)),
      visualHashMatch: oldProfile.visualHash === newProfile.visualHash,
      textSimilarity: round(stringSimilarity(oldProfile.text, newProfile.text)),
      siblingContextSimilarity: round(stringSimilarity(oldProfile.siblingContext, newProfile.siblingContext))
    }
  };
}

function toMissingMatch(oldProfile: NodeProfile): NodeRemapMatch {
  return {
    oldSourceNodeId: oldProfile.id,
    matchScore: 0,
    method: "unmatched",
    changeType: "node_removed",
    overrideReapplied: false,
    reviewRequired: true,
    evidence: {
      oldPath: oldProfile.path,
      oldStableKey: oldProfile.stableKey,
      pathSimilarity: 0,
      visualHashMatch: false,
      textSimilarity: 0,
      siblingContextSimilarity: 0
    }
  };
}

function buildTokenMigrationReport(
  oldScene: RawFigmaScene,
  newScene: RawFigmaScene,
  matches: NodeRemapMatch[],
  metadata: { generatedAt: string; oldSnapshotId?: string; newSnapshotId?: string }
): TokenMigrationReport {
  const oldTokens = collectSceneTokens(oldScene);
  const newTokens = collectSceneTokens(newScene);
  const oldByKey = groupTokensByKey(oldTokens);
  const newByKey = groupTokensByKey(newTokens);
  const changes: TokenMigrationReport["changes"] = [];

  for (const key of [...new Set([...oldByKey.keys(), ...newByKey.keys()])].sort()) {
    const oldEntries = oldByKey.get(key) ?? [];
    const newEntries = newByKey.get(key) ?? [];
    const oldValue = mostCommonValue(oldEntries);
    const newValue = mostCommonValue(newEntries);
    const kind = oldEntries[0]?.kind ?? newEntries[0]?.kind ?? "color";
    if (oldValue !== undefined && newValue !== undefined && oldValue !== newValue) {
      changes.push({
        kind,
        changeType: "value_changed",
        key,
        oldValue,
        newValue,
        oldSourceNodeIds: uniqueSorted(oldEntries.map((entry) => entry.sourceNodeId)),
        newSourceNodeIds: uniqueSorted(newEntries.map((entry) => entry.sourceNodeId)),
        confidence: 0.9,
        reason: "Same token-like slot exists in both snapshots but its value changed."
      });
    } else if (oldValue === undefined && newValue !== undefined) {
      changes.push({
        kind,
        changeType: "added",
        key,
        newValue,
        oldSourceNodeIds: [],
        newSourceNodeIds: uniqueSorted(newEntries.map((entry) => entry.sourceNodeId)),
        confidence: 0.82,
        reason: "Token-like value appears only in the new snapshot."
      });
    } else if (oldValue !== undefined && newValue === undefined) {
      changes.push({
        kind,
        changeType: "removed",
        key,
        oldValue,
        oldSourceNodeIds: uniqueSorted(oldEntries.map((entry) => entry.sourceNodeId)),
        newSourceNodeIds: [],
        confidence: 0.82,
        reason: "Token-like value appears only in the old snapshot."
      });
    }
  }

  const valueChanged = changes.filter((entry) => entry.changeType === "value_changed").length;
  const added = changes.filter((entry) => entry.changeType === "added").length;
  const removed = changes.filter((entry) => entry.changeType === "removed").length;
  const matchedTokenChanges = matches.filter((match) => match.changeType === "token_value_change").length;
  const changeCount = added + removed + valueChanged;
  const oldTokenLikeValues = oldByKey.size;
  const changeRatio = oldTokenLikeValues > 0 ? changeCount / oldTokenLikeValues : changeCount;
  const status =
    changeCount === 0
      ? "unchanged"
      : changeCount >= 6 || changeRatio >= 0.3 || matchedTokenChanges >= 3
        ? "migration_recommended"
        : "changed";

  return {
    version: "0.1.0",
    generatedAt: metadata.generatedAt,
    oldSnapshotId: metadata.oldSnapshotId,
    newSnapshotId: metadata.newSnapshotId,
    status,
    summary: {
      oldTokenLikeValues,
      newTokenLikeValues: newByKey.size,
      added,
      removed,
      valueChanged
    },
    changes,
    warnings: [
      {
        type: "conservative_extraction",
        message:
          "Token migration report is derived from raw Figma color, text style, and radius values; spacing token inference is intentionally omitted until canonical token binding data is available."
      }
    ]
  };
}

function remapOverride(
  override: UxOverride,
  remap: Map<string, NodeRemapMatch>,
  updatedAt: string,
  actor: UxOverride["createdBy"]
): { override: UxOverride; reapplied: ReappliedOverride; stale?: never } | { stale: string } {
  const sourceNodeIds = sourceNodeIdsForOverride(override);
  const remappedSourceNodeIds: ReappliedOverride["remappedSourceNodeIds"] = [];
  for (const sourceNodeId of sourceNodeIds) {
    const decision: RemapDecision = remapSourceNodeId(sourceNodeId, remap);
    if (decision.stale) return { stale: decision.stale };
    if (decision.match?.newSourceNodeId) {
      remappedSourceNodeIds.push({
        oldSourceNodeId: sourceNodeId,
        newSourceNodeId: decision.match.newSourceNodeId,
        matchScore: decision.match.matchScore
      });
    }
  }
  const rewritten = rewriteOverride(override, remap, updatedAt, actor);
  const confidence = remappedSourceNodeIds.length > 0 ? Math.min(...remappedSourceNodeIds.map((entry) => entry.matchScore)) : 1;
  return {
    override: rewritten,
    reapplied: {
      overrideId: override.id,
      type: override.type,
      oldTarget: override.target,
      newTarget: rewritten.target,
      remappedSourceNodeIds,
      confidence,
      reviewRequired: confidence < autoReapplyThreshold
    }
  };
}

function remapSourceNodeId(sourceNodeId: string, remap: Map<string, NodeRemapMatch>): RemapDecision {
  const match = remap.get(sourceNodeId);
  if (!match?.newSourceNodeId) return { stale: `Source node ${sourceNodeId} could not be matched in the new snapshot.` };
  return { match };
}

function rewriteOverride(override: UxOverride, remap: Map<string, NodeRemapMatch>, updatedAt: string, actor: UxOverride["createdBy"]): UxOverride {
  return {
    ...override,
    target: rewriteTarget(override.target, remap),
    payload: rewritePayload(override.payload, remap) as Record<string, unknown>,
    updatedAt,
    createdBy: override.createdBy ?? actor
  };
}

function rewriteTarget(target: OverrideTarget, remap: Map<string, NodeRemapMatch>): OverrideTarget {
  if (!target.sourceNodeId) return target;
  const mapped = remap.get(target.sourceNodeId)?.newSourceNodeId;
  return mapped ? { ...target, sourceNodeId: mapped } : target;
}

function rewritePayload(value: unknown, remap: Map<string, NodeRemapMatch>, key?: string): unknown {
  if (Array.isArray(value)) {
    if (key === "sourceNodeIds") {
      return value.map((entry) => (typeof entry === "string" ? remap.get(entry)?.newSourceNodeId ?? entry : entry));
    }
    return value.map((entry) => rewritePayload(entry, remap));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entry]) => [entryKey, rewritePayload(entry, remap, entryKey)]));
  }
  if (typeof value === "string") {
    if (key === "sourceNodeId") return remap.get(value)?.newSourceNodeId ?? value;
    return value.replace(/sourceNodeId:([^\s,;]+)/g, (_match, id: string) => `sourceNodeId:${remap.get(id)?.newSourceNodeId ?? id}`);
  }
  return value;
}

function sourceNodeIdsForOverride(override: UxOverride): string[] {
  const ids = new Set<string>();
  if (override.target.sourceNodeId) ids.add(override.target.sourceNodeId);
  collectSourceNodeIds(override.payload, ids);
  return [...ids].sort();
}

function collectSourceNodeIds(value: unknown, ids: Set<string>, key?: string): void {
  if (Array.isArray(value)) {
    if (key === "sourceNodeIds") {
      for (const entry of value) if (typeof entry === "string") ids.add(entry);
    } else {
      for (const entry of value) collectSourceNodeIds(entry, ids);
    }
    return;
  }
  if (value && typeof value === "object") {
    for (const [entryKey, entry] of Object.entries(value)) collectSourceNodeIds(entry, ids, entryKey);
    return;
  }
  if (typeof value === "string") {
    if (key === "sourceNodeId") ids.add(value);
    for (const match of value.matchAll(/sourceNodeId:([^\s,;]+)/g)) ids.add(match[1]);
  }
}

function reviewTaskForOverride(reapplied: ReappliedOverride, override: UxOverride): ReviewTask {
  return {
    id: `task_incremental_remap_${safeId(override.id)}`,
    type: "stale_override",
    priority: "P1",
    target: {
      sourceNodeIds: reapplied.remappedSourceNodeIds.map((entry) => entry.newSourceNodeId)
    },
    title: "Confirm remapped override",
    description: `Override ${override.id} was remapped with confidence ${round(reapplied.confidence)} and needs review before codegen write.`,
    confidence: reapplied.confidence,
    evidence: {
      overrideId: override.id,
      remappedSourceNodeIds: reapplied.remappedSourceNodeIds
    },
    suggestedActions: [
      {
        label: "Keep remapped override",
        override: {
          type: override.type,
          payload: override.payload,
          reason: "User confirmed the incremental remap."
        }
      }
    ],
    status: "open"
  };
}

function indexScene(scene: RawFigmaScene): Map<string, NodeProfile> {
  const index = new Map<string, NodeProfile>();
  const walk = (node: RawFigmaNode, ancestors: RawFigmaNode[]): void => {
    const siblings = ancestors.at(-1)?.children ?? [node];
    const path = [...ancestors.map((ancestor) => ancestor.name), node.name].join("/");
    const parentPath = ancestors.map((ancestor) => ancestor.name).join("/");
    const siblingContext = siblings.map((sibling) => `${sibling.type}:${sibling.name}`).join("|");
    const text = node.characters ?? "";
    const visual = {
      bounds: node.absoluteBoundingBox,
      fills: node.fills,
      strokes: node.strokes,
      effects: node.effects,
      cornerRadius: node.cornerRadius,
      opacity: node.opacity
    };
    const tokenSignature = collectNodeTokens(node, path).map(({ kind, slot, value }) => ({ kind, slot, value }));
    const profile: NodeProfile = {
      id: node.id,
      type: node.type,
      name: node.name,
      path,
      parentPath,
      siblingContext,
      textHash: hashStable(text),
      visualHash: hashStable(visual),
      tokenHash: hashStable(tokenSignature),
      stableKey: hashStable({
        type: node.type,
        name: node.name,
        parentPath,
        textHash: hashStable(text),
        visualHash: hashStable(visual),
        siblingContext
      }),
      text,
      bounds: node.absoluteBoundingBox,
      childrenCount: node.children?.length ?? 0
    };
    index.set(node.id, profile);
    for (const child of node.children ?? []) walk(child, [...ancestors, node]);
  };
  walk(scene.root, []);
  return index;
}

function collectSceneTokens(scene: RawFigmaScene): TokenObservation[] {
  const tokens: TokenObservation[] = [];
  const walk = (node: RawFigmaNode, ancestors: RawFigmaNode[]): void => {
    const path = [...ancestors.map((ancestor) => ancestor.name), node.name].join("/");
    tokens.push(...collectNodeTokens(node, path));
    for (const child of node.children ?? []) walk(child, [...ancestors, node]);
  };
  walk(scene.root, []);
  return tokens;
}

function collectNodeTokens(node: RawFigmaNode, path: string): TokenObservation[] {
  const tokens: TokenObservation[] = [];
  collectPaintTokens(node, path, "fills", node.fills, tokens);
  collectPaintTokens(node, path, "strokes", node.strokes, tokens);
  if (node.type === "TEXT" && node.style) {
    const fontName = typeof node.style.fontName === "string" ? node.style.fontName : [node.style.fontName?.family, node.style.fontName?.style].filter(Boolean).join("/");
    const fontFamily = node.style.fontFamily ?? fontName;
    const lineHeight = typeof node.style.lineHeight === "number" ? node.style.lineHeight : node.style.lineHeight?.value;
    const letterSpacing = typeof node.style.letterSpacing === "number" ? node.style.letterSpacing : node.style.letterSpacing?.value;
    tokens.push({
      kind: "typography",
      key: `typography:${path}:style`,
      slot: "style",
      value: [fontFamily || "unknown", node.style.fontSize ?? "auto", node.style.fontWeight ?? "auto", node.style.lineHeightPx ?? lineHeight ?? "auto", letterSpacing ?? "auto"].join("|"),
      sourceNodeId: node.id
    });
  }
  if (typeof node.cornerRadius === "number") {
    tokens.push({
      kind: "radius",
      key: `radius:${path}:cornerRadius`,
      slot: "cornerRadius",
      value: round(node.cornerRadius),
      sourceNodeId: node.id
    });
  }
  if (Array.isArray(node.rectangleCornerRadii) && node.rectangleCornerRadii.some((entry) => typeof entry === "number")) {
    tokens.push({
      kind: "radius",
      key: `radius:${path}:rectangleCornerRadii`,
      slot: "rectangleCornerRadii",
      value: node.rectangleCornerRadii.map((entry) => round(entry)).join("|"),
      sourceNodeId: node.id
    });
  }
  return tokens;
}

function collectPaintTokens(node: RawFigmaNode, path: string, group: "fills" | "strokes", paints: RawFigmaNode["fills"], tokens: TokenObservation[]): void {
  paints?.forEach((paint, index) => {
    if (paint.visible === false || paint.type !== "SOLID" || !paint.color) return;
    tokens.push({
      kind: "color",
      key: `color:${path}:${group}[${index}]`,
      slot: `${group}[${index}]`,
      value: colorValue(paint.color, paint.opacity),
      sourceNodeId: node.id
    });
  });
}

function colorValue(color: { r: number; g: number; b: number; a?: number }, opacity?: number): string {
  const alpha = color.a ?? opacity ?? 1;
  const hex = [color.r, color.g, color.b].map((channel) => Math.round(Math.max(0, Math.min(1, channel)) * 255).toString(16).padStart(2, "0")).join("");
  return alpha >= 1 ? `#${hex}` : `#${hex}/${round(alpha)}`;
}

function groupTokensByKey(tokens: TokenObservation[]): Map<string, TokenObservation[]> {
  const grouped = new Map<string, TokenObservation[]>();
  for (const token of tokens) {
    grouped.set(token.key, [...(grouped.get(token.key) ?? []), token]);
  }
  return grouped;
}

function mostCommonValue(tokens: TokenObservation[]): string | number | undefined {
  const counts = new Map<string, { value: string | number; count: number }>();
  for (const token of tokens) {
    const key = String(token.value);
    const existing = counts.get(key);
    counts.set(key, { value: token.value, count: (existing?.count ?? 0) + 1 });
  }
  return [...counts.values()].sort((left, right) => right.count - left.count || String(left.value).localeCompare(String(right.value)))[0]?.value;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function boundsSimilarity(left?: NodeProfile["bounds"], right?: NodeProfile["bounds"]): number {
  if (!left || !right) return left === right ? 1 : 0;
  const diffs = [
    normalizedDelta(left.x, right.x),
    normalizedDelta(left.y, right.y),
    normalizedDelta(left.width, right.width),
    normalizedDelta(left.height, right.height)
  ];
  return Math.max(0, 1 - diffs.reduce((sum, diff) => sum + diff, 0) / diffs.length);
}

function normalizedDelta(left: number, right: number): number {
  return Math.abs(left - right) / Math.max(1, Math.abs(left), Math.abs(right));
}

function stringSimilarity(left: string, right: string): number {
  if (left === right) return 1;
  if (!left || !right) return 0;
  const distance = levenshtein(left, right);
  return Math.max(0, 1 - distance / Math.max(left.length, right.length));
}

function levenshtein(left: string, right: string): number {
  const dp = Array.from({ length: left.length + 1 }, () => new Array<number>(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[left.length][right.length];
}

function withHash(overrideSet: OverrideSet): OverrideSet {
  const copy = { ...overrideSet, hash: "" };
  return {
    ...copy,
    hash: hashStable(copy)
  };
}

function hashStable(value: unknown): string {
  return `sha256_${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || "generated";
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
