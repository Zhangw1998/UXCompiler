import type {
  Bounds,
  CanonicalNode,
  CanonicalScene,
  InferredTokens,
  LayoutCandidate,
  LayoutDecision,
  LayoutInferenceResult,
  LayoutType,
  NormalizedDesignIR,
  NormalizedNode,
  Region
} from "@uxcompiler/ir-schemas";

export function inferLayout(canonicalScene: CanonicalScene, inferredTokens: InferredTokens): LayoutInferenceResult {
  const layoutCandidates: LayoutCandidate[] = [];
  const layoutDecisions: LayoutDecision[] = [];
  const fallbacks: Array<{ nodeId: string; reason: string; strategy: string }> = [];

  const tree = normalizeNode(canonicalScene.root, "page", inferredTokens, layoutCandidates, layoutDecisions, fallbacks);
  const layoutConfidence = average(layoutDecisions.map((decision) => decision.confidence), 0.75);
  const tokenConfidence = average(
    [
      ...inferredTokens.colors.map((token) => token.confidence),
      ...inferredTokens.spacing.map((token) => token.confidence),
      ...inferredTokens.typography.map((token) => token.confidence),
      ...inferredTokens.radii.map((token) => token.confidence)
    ],
    0.75
  );

  const normalizedDesignIR: NormalizedDesignIR = {
    version: "2.0",
    source: canonicalScene.source,
    tokens: inferredTokens,
    components: [],
    tree,
    fallbacks,
    confidence: {
      overall: round((layoutConfidence + tokenConfidence) / 2),
      tokens: round(tokenConfidence),
      layout: round(layoutConfidence),
      components: 0
    }
  };

  return {
    regions: segmentRegions(canonicalScene.root),
    layoutCandidates,
    layoutDecisions,
    normalizedDesignIR
  };
}

function normalizeNode(
  node: CanonicalNode,
  rootKind: "page" | "node",
  inferredTokens: InferredTokens,
  layoutCandidates: LayoutCandidate[],
  layoutDecisions: LayoutDecision[],
  fallbacks: Array<{ nodeId: string; reason: string; strategy: string }>
): NormalizedNode {
  const visibleChildren = node.children.filter((child) => !child.flags.isInvisible && !child.flags.isZeroSize);
  const decision = decideLayout(node, visibleChildren);
  layoutCandidates.push({
    nodeId: node.id,
    candidates: decision.candidates
  });
  layoutDecisions.push(decision.decision);

  if (decision.decision.fallback) {
    fallbacks.push({
      nodeId: node.id,
      reason: decision.decision.evidence.join(" "),
      strategy: decision.decision.fallback
    });
  }

  return {
    id: normalizedId(node.id),
    sourceNodeIds: [node.sourceNodeId],
    type: rootKind === "page" ? "page" : toNormalizedType(node),
    name: normalizedName(node),
    layout: {
      type: decision.decision.layout,
      gap: inferGapToken(visibleChildren, inferredTokens)
    },
    bounds: node.bounds,
    tokenRefs: inferTokenRefs(node, inferredTokens),
    children: visibleChildren.map((child) =>
      normalizeNode(child, "node", inferredTokens, layoutCandidates, layoutDecisions, fallbacks)
    ),
    confidence: decision.decision.confidence
  };
}

function decideLayout(
  node: CanonicalNode,
  children: CanonicalNode[]
): {
  candidates: Array<{ layout: LayoutType; score: number; evidence: string[] }>;
  decision: LayoutDecision;
} {
  if (children.length === 0) {
    const leaf = { layout: "leaf" as const, score: 1, evidence: ["Node has no visible children."] };
    return {
      candidates: [leaf],
      decision: {
        nodeId: node.id,
        sourceNodeIds: [node.sourceNodeId],
        layout: "leaf",
        score: 1,
        confidence: 1,
        evidence: leaf.evidence
      }
    };
  }

  const candidates: Array<{ layout: LayoutType; score: number; evidence: string[] }> = [];
  const overlapRatio = maxOverlapRatio(children);
  if (overlapRatio > 0.02) {
    candidates.push({
      layout: "stack",
      score: round(0.85 + Math.min(0.1, overlapRatio)),
      evidence: [`Children overlap with max area ratio ${round(overlapRatio)}.`]
    });
  }

  const columnScore = scoreColumn(children);
  candidates.push(columnScore);
  const rowScore = scoreRow(children);
  candidates.push(rowScore);
  const gridScore = scoreGrid(children);
  if (gridScore.score > 0.55) candidates.push(gridScore);

  candidates.push({
    layout: "absolute",
    score: 0.55,
    evidence: ["Absolute fallback is always available for fidelity."]
  });

  const sorted = candidates.sort((a, b) => b.score - a.score);
  const winner = sorted[0];
  const fallbackNeeded = winner.score < 0.7 || winner.layout === "absolute";

  return {
    candidates: sorted,
    decision: {
      nodeId: node.id,
      sourceNodeIds: [node.sourceNodeId],
      layout: winner.layout,
      score: winner.score,
      confidence: fallbackNeeded ? Math.min(winner.score, 0.68) : Math.min(0.98, winner.score),
      evidence: winner.evidence,
      fallback: fallbackNeeded && winner.layout !== "absolute" ? "absolute" : undefined
    }
  };
}

function scoreColumn(children: CanonicalNode[]): { layout: LayoutType; score: number; evidence: string[] } {
  if (children.length < 2) return { layout: "column", score: 0.2, evidence: ["Need at least two children for column."] };
  const byY = [...children].sort((a, b) => a.bounds.y - b.bounds.y);
  const nonOverlapping = countNonOverlappingOnAxis(byY, "y");
  const xSpread = spread(byY.map((child) => child.bounds.x));
  const maxWidth = Math.max(...byY.map((child) => child.bounds.w), 1);
  const score = clamp(0.25 + nonOverlapping * 0.45 + (1 - Math.min(1, xSpread / maxWidth)) * 0.3);
  return {
    layout: "column",
    score: round(score),
    evidence: [
      `${Math.round(nonOverlapping * 100)}% of children are vertically ordered without overlap.`,
      `Left edge spread is ${round(xSpread)} px.`
    ]
  };
}

function scoreRow(children: CanonicalNode[]): { layout: LayoutType; score: number; evidence: string[] } {
  if (children.length < 2) return { layout: "row", score: 0.2, evidence: ["Need at least two children for row."] };
  const byX = [...children].sort((a, b) => a.bounds.x - b.bounds.x);
  const nonOverlapping = countNonOverlappingOnAxis(byX, "x");
  const yCenterSpread = spread(byX.map((child) => child.bounds.y + child.bounds.h / 2));
  const maxHeight = Math.max(...byX.map((child) => child.bounds.h), 1);
  const score = clamp(0.25 + nonOverlapping * 0.45 + (1 - Math.min(1, yCenterSpread / maxHeight)) * 0.3);
  return {
    layout: "row",
    score: round(score),
    evidence: [
      `${Math.round(nonOverlapping * 100)}% of children are horizontally ordered without overlap.`,
      `Vertical center spread is ${round(yCenterSpread)} px.`
    ]
  };
}

function scoreGrid(children: CanonicalNode[]): { layout: LayoutType; score: number; evidence: string[] } {
  if (children.length < 4) return { layout: "grid", score: 0.2, evidence: ["Need at least four children for grid."] };
  const rows = clusterPositions(children.map((child) => child.bounds.y));
  const cols = clusterPositions(children.map((child) => child.bounds.x));
  const balanced = rows.length > 1 && cols.length > 1 && rows.length * cols.length >= children.length;
  return {
    layout: "grid",
    score: balanced ? 0.76 : 0.35,
    evidence: [`Detected ${rows.length} row bands and ${cols.length} column bands.`]
  };
}

function segmentRegions(root: CanonicalNode): Region[] {
  const children = root.children
    .filter((child) => !child.flags.isInvisible && !child.flags.isZeroSize && !isFullFrameBackground(child, root.bounds))
    .sort((a, b) => a.bounds.y - b.bounds.y);
  if (children.length === 0) {
    return [
      {
        id: "region_root",
        name: "RootRegion",
        role: "content",
        bounds: root.bounds,
        sourceNodeIds: [root.sourceNodeId]
      }
    ];
  }

  const threshold = Math.max(40, root.bounds.h * 0.06);
  const groups: CanonicalNode[][] = [];
  for (const child of children) {
    const lastGroup = groups[groups.length - 1];
    if (!lastGroup) {
      groups.push([child]);
      continue;
    }
    const previous = lastGroup[lastGroup.length - 1];
    const gap = child.bounds.y - (previous.bounds.y + previous.bounds.h);
    if (gap > threshold) groups.push([child]);
    else lastGroup.push(child);
  }

  return groups.map((group, index) => {
    const bounds = unionBounds(group.map((child) => child.bounds));
    return {
      id: `region_${index + 1}`,
      name: regionName(index, groups.length),
      role: regionRole(bounds, root.bounds),
      bounds,
      sourceNodeIds: group.map((child) => child.sourceNodeId)
    };
  });
}

function isFullFrameBackground(node: CanonicalNode, rootBounds: Bounds): boolean {
  const rootArea = Math.max(1, areaOf(rootBounds));
  const nodeArea = areaOf(node.bounds);
  const coversMostFrame = nodeArea / rootArea > 0.8;
  const startsAtOrigin = Math.abs(node.bounds.x - rootBounds.x) <= 1 && Math.abs(node.bounds.y - rootBounds.y) <= 1;
  const isVisualBackdrop = node.canonicalType === "rect" || node.canonicalType === "image" || node.sourceName.toLowerCase().includes("background");
  return coversMostFrame && startsAtOrigin && isVisualBackdrop;
}

function inferGapToken(children: CanonicalNode[], inferredTokens: InferredTokens): string | number | undefined {
  if (children.length < 2) return undefined;
  const gaps: number[] = [];
  const byY = [...children].sort((a, b) => a.bounds.y - b.bounds.y);
  for (let index = 1; index < byY.length; index += 1) {
    const gap = byY[index].bounds.y - (byY[index - 1].bounds.y + byY[index - 1].bounds.h);
    if (gap > 0) gaps.push(gap);
  }
  if (gaps.length === 0) return undefined;
  const medianGap = median(gaps);
  const token = inferredTokens.spacing.find((candidate) => Math.abs(candidate.value - medianGap) <= 1.5);
  return token?.name ?? round(medianGap);
}

function inferTokenRefs(node: CanonicalNode, inferredTokens: InferredTokens): Record<string, string> | undefined {
  const refs: Record<string, string> = {};
  const radius = node.style.cornerRadius;
  if (typeof radius === "number") {
    const token = inferredTokens.radii.find((candidate) => candidate.aliases.includes(radius) || candidate.value === radius);
    if (token) refs.radius = token.name;
  }
  return Object.keys(refs).length > 0 ? refs : undefined;
}

function toNormalizedType(node: CanonicalNode): NormalizedNode["type"] {
  switch (node.canonicalType) {
    case "text":
      return "text";
    case "rect":
      return "rect";
    case "image":
      return "image";
    case "vector":
      return "vector";
    default:
      return "container";
  }
}

function normalizedName(node: CanonicalNode): string {
  const words = node.sourceName
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  const base = words.length > 0 ? words.map((word) => word[0].toUpperCase() + word.slice(1)).join("") : "Node";
  return `${base}${node.canonicalType === "text" ? "Text" : ""}`;
}

function normalizedId(canonicalId: string): string {
  return canonicalId.replace(/^c_/, "n_");
}

function maxOverlapRatio(children: CanonicalNode[]): number {
  let maxRatio = 0;
  for (let left = 0; left < children.length; left += 1) {
    for (let right = left + 1; right < children.length; right += 1) {
      const area = intersectionArea(children[left].bounds, children[right].bounds);
      const smallerArea = Math.min(areaOf(children[left].bounds), areaOf(children[right].bounds));
      if (smallerArea > 0) maxRatio = Math.max(maxRatio, area / smallerArea);
    }
  }
  return maxRatio;
}

function countNonOverlappingOnAxis(children: CanonicalNode[], axis: "x" | "y"): number {
  let ordered = 0;
  for (let index = 1; index < children.length; index += 1) {
    const previous = children[index - 1].bounds;
    const current = children[index].bounds;
    const previousEnd = axis === "x" ? previous.x + previous.w : previous.y + previous.h;
    const currentStart = axis === "x" ? current.x : current.y;
    if (currentStart >= previousEnd - 1) ordered += 1;
  }
  return ordered / Math.max(1, children.length - 1);
}

function clusterPositions(values: number[]): number[] {
  const sorted = [...values].sort((a, b) => a - b);
  const clusters: number[] = [];
  for (const value of sorted) {
    const last = clusters[clusters.length - 1];
    if (last === undefined || Math.abs(last - value) > 8) clusters.push(value);
  }
  return clusters;
}

function regionName(index: number, total: number): string {
  if (index === 0) return "HeaderRegion";
  if (index === total - 1 && total > 1) return "FooterRegion";
  return `ContentRegion${index}`;
}

function regionRole(bounds: Bounds, root: Bounds): Region["role"] {
  if (bounds.y <= root.h * 0.12) return "header";
  if (bounds.y + bounds.h >= root.h * 0.88) return "footer";
  return "content";
}

function unionBounds(boundsList: Bounds[]): Bounds {
  const minX = Math.min(...boundsList.map((bounds) => bounds.x));
  const minY = Math.min(...boundsList.map((bounds) => bounds.y));
  const maxX = Math.max(...boundsList.map((bounds) => bounds.x + bounds.w));
  const maxY = Math.max(...boundsList.map((bounds) => bounds.y + bounds.h));
  return { x: minX, y: minY, w: round(maxX - minX), h: round(maxY - minY) };
}

function intersectionArea(left: Bounds, right: Bounds): number {
  const x = Math.max(0, Math.min(left.x + left.w, right.x + right.w) - Math.max(left.x, right.x));
  const y = Math.max(0, Math.min(left.y + left.h, right.y + right.h) - Math.max(left.y, right.y));
  return x * y;
}

function areaOf(bounds: Bounds): number {
  return bounds.w * bounds.h;
}

function spread(values: number[]): number {
  return Math.max(...values) - Math.min(...values);
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

function average(values: number[], fallback: number): number {
  if (values.length === 0) return fallback;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
