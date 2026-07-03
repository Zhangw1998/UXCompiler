import type {
  Bounds,
  CanonicalFlags,
  CanonicalNode,
  CanonicalScene,
  CanonicalType,
  CanonicalizationReport,
  CanonicalizationResult,
  NodeMapping,
  RawBounds,
  RawFigmaNode,
  RawFigmaScene
} from "@uxcompiler/ir-schemas";

interface BuildContext {
  rootBounds: RawBounds;
  mapping: NodeMapping;
  report: CanonicalizationReport;
  rawNodeCount: number;
  canonicalNodeCount: number;
}

export function canonicalizeRawScene(rawScene: RawFigmaScene): CanonicalizationResult {
  const rootRawBounds = readBounds(rawScene.root);
  if (!rootRawBounds) {
    throw new Error("Cannot canonicalize scene: root node is missing absoluteBoundingBox/absoluteRenderBounds.");
  }

  const report: CanonicalizationReport = {
    stats: {
      rawNodes: 0,
      canonicalNodes: 0,
      flattenedWrappers: 0,
      invalidBounds: 0
    },
    flattenedNodes: [],
    warnings: []
  };

  const context: BuildContext = {
    rootBounds: rootRawBounds,
    mapping: { rawToCanonical: {}, canonicalToRaw: {} },
    report,
    rawNodeCount: 0,
    canonicalNodeCount: 0
  };

  const canonicalRoots = canonicalizeNode(rawScene.root, context, 0, true);
  const root = canonicalRoots[0];
  if (!root) {
    throw new Error("Cannot canonicalize scene: root node produced no canonical node.");
  }

  report.stats.rawNodes = context.rawNodeCount;
  report.stats.canonicalNodes = context.canonicalNodeCount;

  const canonicalScene: CanonicalScene = {
    version: "2.0",
    source: {
      frameNodeId: rawScene.source.frameNodeId ?? rawScene.root.id,
      viewport: { width: root.bounds.w, height: root.bounds.h }
    },
    root
  };

  return {
    canonicalScene,
    nodeMapping: context.mapping,
    report
  };
}

function canonicalizeNode(
  rawNode: RawFigmaNode,
  context: BuildContext,
  zIndex: number,
  isRoot = false
): CanonicalNode[] {
  context.rawNodeCount += 1;
  const bounds = readBounds(rawNode);
  if (!bounds) {
    context.report.stats.invalidBounds += 1;
    context.report.warnings.push({
      sourceNodeId: rawNode.id,
      type: "invalid_bounds",
      message: "Node is missing absolute bounds and was preserved with a zero-size canonical box."
    });
  }

  const canonicalBounds = bounds ? toRootRelativeBounds(bounds, context.rootBounds) : { x: 0, y: 0, w: 0, h: 0 };
  const childNodes = rawNode.children ?? [];
  const canonicalChildren = childNodes.flatMap((child, index) => canonicalizeNode(child, context, index, false));
  const flags = buildFlags(rawNode, canonicalBounds, canonicalChildren);
  const canFlatten = !isRoot && shouldFlattenWrapper(rawNode, flags, canonicalChildren);

  if (canFlatten) {
    context.report.stats.flattenedWrappers += 1;
    const replacementIds = canonicalChildren.map((child) => child.id);
    context.report.flattenedNodes.push({
      sourceNodeId: rawNode.id,
      reason: "Empty wrapper with a single child and no visual/layout effect.",
      replacementCanonicalIds: replacementIds
    });
    context.mapping.rawToCanonical[rawNode.id] = replacementIds;
    return canonicalChildren;
  }

  const canonicalNode: CanonicalNode = {
    id: canonicalId(rawNode.id),
    sourceNodeId: rawNode.id,
    sourceName: rawNode.name,
    canonicalType: toCanonicalType(rawNode),
    bounds: canonicalBounds,
    zIndex,
    style: {
      fills: rawNode.fills ?? [],
      strokes: rawNode.strokes ?? [],
      effects: rawNode.effects ?? [],
      opacity: typeof rawNode.opacity === "number" ? rawNode.opacity : 1,
      cornerRadius: typeof rawNode.cornerRadius === "number" ? rawNode.cornerRadius : undefined,
      rectangleCornerRadii: Array.isArray(rawNode.rectangleCornerRadii) ? rawNode.rectangleCornerRadii : undefined,
      blendMode: rawNode.blendMode
    },
    text:
      rawNode.type === "TEXT"
        ? {
            content: rawNode.characters ?? "",
            style: rawNode.style
          }
        : undefined,
    layout: {
      mode: rawNode.layoutMode,
      positioning: rawNode.layoutPositioning,
      itemSpacing: rawNode.itemSpacing,
      padding: {
        left: rawNode.paddingLeft ?? 0,
        right: rawNode.paddingRight ?? 0,
        top: rawNode.paddingTop ?? 0,
        bottom: rawNode.paddingBottom ?? 0
      }
    },
    flags,
    children: canonicalChildren
  };

  context.canonicalNodeCount += 1;
  context.mapping.rawToCanonical[rawNode.id] = [canonicalNode.id];
  context.mapping.canonicalToRaw[canonicalNode.id] = [rawNode.id];
  return [canonicalNode];
}

function readBounds(node: RawFigmaNode): RawBounds | undefined {
  return node.absoluteBoundingBox ?? node.absoluteRenderBounds ?? undefined;
}

function toRootRelativeBounds(bounds: RawBounds, rootBounds: RawBounds): Bounds {
  return {
    x: round(bounds.x - rootBounds.x),
    y: round(bounds.y - rootBounds.y),
    w: round(bounds.width),
    h: round(bounds.height)
  };
}

function buildFlags(rawNode: RawFigmaNode, bounds: Bounds, children: CanonicalNode[]): CanonicalFlags {
  const effects = rawNode.effects ?? [];
  const hasBlur = effects.some((effect) => effect.visible !== false && String(effect.type ?? "").includes("BLUR"));
  const hasVisiblePaint = hasVisiblePaints(rawNode.fills) || hasVisiblePaints(rawNode.strokes);
  const hasEffect = effects.some((effect) => effect.visible !== false);
  const isVectorLike = ["VECTOR", "BOOLEAN_OPERATION", "STAR", "LINE", "POLYGON", "ELLIPSE"].includes(rawNode.type);
  const isComplexVector = isVectorLike && (!!rawNode.vectorNetwork || children.length > 0);

  return {
    isInvisible: rawNode.visible === false,
    isZeroSize: bounds.w <= 0 || bounds.h <= 0,
    isEmptyWrapper:
      (rawNode.type === "GROUP" || rawNode.type === "FRAME") &&
      !hasVisiblePaint &&
      !hasEffect &&
      (rawNode.opacity ?? 1) === 1 &&
      children.length > 0,
    hasClip: rawNode.clipsContent === true,
    hasMask: rawNode.isMask === true,
    hasBlendMode: !!rawNode.blendMode && rawNode.blendMode !== "PASS_THROUGH" && rawNode.blendMode !== "NORMAL",
    hasBlur,
    isComplexVector,
    recommendAssetSlice: hasBlur || rawNode.isMask === true || isComplexVector
  };
}

function shouldFlattenWrapper(rawNode: RawFigmaNode, flags: CanonicalFlags, children: CanonicalNode[]): boolean {
  return (
    flags.isEmptyWrapper &&
    children.length === 1 &&
    rawNode.layoutMode !== "HORIZONTAL" &&
    rawNode.layoutMode !== "VERTICAL" &&
    rawNode.clipsContent !== true &&
    rawNode.isMask !== true &&
    !rawNode.componentId &&
    !rawNode.componentKey
  );
}

function hasVisiblePaints(paints: unknown): boolean {
  if (!Array.isArray(paints)) return false;
  return paints.some((paint) => {
    if (!paint || typeof paint !== "object") return false;
    const candidate = paint as { visible?: boolean; opacity?: number; type?: string };
    return candidate.visible !== false && candidate.opacity !== 0 && candidate.type !== "NONE";
  });
}

function toCanonicalType(node: RawFigmaNode): CanonicalType {
  if (node.imageHash || node.type === "IMAGE" || hasImageFill(node.fills)) return "image";
  switch (node.type) {
    case "FRAME":
    case "SECTION":
      return "frame";
    case "GROUP":
      return "group";
    case "TEXT":
      return "text";
    case "RECTANGLE":
      return "rect";
    case "INSTANCE":
      return "instance";
    case "COMPONENT":
    case "COMPONENT_SET":
      return "component";
    default:
      return "vector";
  }
}

function hasImageFill(fills: unknown): boolean {
  if (!Array.isArray(fills)) return false;
  return fills.some((fill) => {
    if (!fill || typeof fill !== "object") return false;
    const candidate = fill as { type?: string; visible?: boolean; opacity?: number };
    return candidate.type === "IMAGE" && candidate.visible !== false && candidate.opacity !== 0;
  });
}

function canonicalId(sourceNodeId: string): string {
  return `c_${sourceNodeId.replace(/[^a-zA-Z0-9_]/g, "_")}`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
