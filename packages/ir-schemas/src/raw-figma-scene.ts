export type FigmaNodeType =
  | "DOCUMENT"
  | "CANVAS"
  | "FRAME"
  | "GROUP"
  | "SECTION"
  | "COMPONENT"
  | "COMPONENT_SET"
  | "INSTANCE"
  | "TEXT"
  | "RECTANGLE"
  | "ELLIPSE"
  | "VECTOR"
  | "BOOLEAN_OPERATION"
  | "STAR"
  | "LINE"
  | "POLYGON"
  | "IMAGE"
  | string;

export interface FigmaColor {
  r: number;
  g: number;
  b: number;
  a?: number;
}

export interface RawBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface RawPaint {
  type?: string;
  visible?: boolean;
  opacity?: number;
  color?: FigmaColor;
  imageHash?: string;
  scaleMode?: string;
  [key: string]: unknown;
}

export interface RawEffect {
  type?: string;
  visible?: boolean;
  radius?: number;
  offset?: { x: number; y: number };
  color?: FigmaColor;
  [key: string]: unknown;
}

export interface RawTextStyle {
  fontFamily?: string;
  fontName?: string | { family?: string; style?: string };
  fontSize?: number;
  fontWeight?: number;
  lineHeightPx?: number;
  lineHeight?: number | { value?: number; unit?: string };
  letterSpacing?: number | { value?: number; unit?: string };
  fills?: RawPaint[];
  [key: string]: unknown;
}

export interface RawFigmaNode {
  id: string;
  name: string;
  type: FigmaNodeType;
  visible?: boolean;
  locked?: boolean;
  opacity?: number;
  absoluteBoundingBox?: RawBounds;
  absoluteRenderBounds?: RawBounds | null;
  relativeTransform?: number[][];
  constraints?: Record<string, unknown>;
  layoutMode?: string;
  layoutPositioning?: string;
  itemSpacing?: number;
  paddingLeft?: number;
  paddingRight?: number;
  paddingTop?: number;
  paddingBottom?: number;
  primaryAxisAlignItems?: string;
  counterAxisAlignItems?: string;
  fills?: RawPaint[];
  strokes?: RawPaint[];
  effects?: RawEffect[];
  blendMode?: string;
  clipsContent?: boolean;
  isMask?: boolean;
  cornerRadius?: number;
  rectangleCornerRadii?: number[];
  characters?: string;
  style?: RawTextStyle;
  vectorNetwork?: unknown;
  imageHash?: string;
  componentId?: string;
  componentKey?: string;
  variantProperties?: Record<string, string>;
  overrides?: unknown[];
  children?: RawFigmaNode[];
  [key: string]: unknown;
}

export interface RawFigmaSceneSource {
  fileKey?: string;
  pageId?: string;
  frameNodeId?: string;
  exportedAt?: string;
  viewport?: { width: number; height: number; scale?: number };
  fileName?: string;
  lastModified?: string;
  version?: string;
  editorType?: string;
  sourceUrl?: string;
  apiBaseUrl?: string;
}

export interface RawFigmaScene {
  version: string;
  source: RawFigmaSceneSource;
  root: RawFigmaNode;
  roots?: RawFigmaNode[];
}

export interface RawExtractionReport {
  version: string;
  generatedAt: string;
  source: RawFigmaSceneSource & { rootNodeId?: string; rootNodeName?: string };
  stats: {
    nodes: number;
    textNodes: number;
    vectorNodes: number;
    imageNodes: number;
    componentInstances: number;
    invisibleNodes: number;
    missingBounds: number;
  };
  warnings: Array<{ nodeId: string; type: string; message: string }>;
}

export function isRawFigmaScene(value: unknown): value is RawFigmaScene {
  if (!value || typeof value !== "object") return false;
  const scene = value as Partial<RawFigmaScene>;
  return typeof scene.version === "string" && !!scene.source && isRawFigmaNode(scene.root);
}

export function assertRawFigmaScene(value: unknown): asserts value is RawFigmaScene {
  if (!isRawFigmaScene(value)) {
    throw new Error("Invalid RawFigmaScene: expected { version, source, root } with root node id/name/type.");
  }
}

export function isRawFigmaNode(value: unknown): value is RawFigmaNode {
  if (!value || typeof value !== "object") return false;
  const node = value as Partial<RawFigmaNode>;
  return typeof node.id === "string" && typeof node.name === "string" && typeof node.type === "string";
}

export function createRawExtractionReport(scene: RawFigmaScene, options: { generatedAt?: string } = {}): RawExtractionReport {
  const stats = {
    nodes: 0,
    textNodes: 0,
    vectorNodes: 0,
    imageNodes: 0,
    componentInstances: 0,
    invisibleNodes: 0,
    missingBounds: 0
  };
  const warnings: RawExtractionReport["warnings"] = [];
  const walk = (node: RawFigmaNode): void => {
    stats.nodes += 1;
    if (node.type === "TEXT") stats.textNodes += 1;
    if (node.type === "VECTOR" || node.type === "BOOLEAN_OPERATION" || node.type === "LINE" || node.type === "POLYGON" || node.type === "STAR") stats.vectorNodes += 1;
    if (node.type === "IMAGE" || node.imageHash || hasImagePaint(node)) stats.imageNodes += 1;
    if (node.type === "INSTANCE" || node.componentId || node.componentKey) stats.componentInstances += 1;
    if (node.visible === false) stats.invisibleNodes += 1;
    if (!node.absoluteBoundingBox && !node.absoluteRenderBounds) {
      stats.missingBounds += 1;
      warnings.push({
        nodeId: node.id,
        type: "invalid_bounds",
        message: `Node ${node.name} has no absoluteBoundingBox or absoluteRenderBounds.`
      });
    }
    if (node.type === "TEXT" && !node.style?.fontName && !node.style?.fontFamily) {
      warnings.push({
        nodeId: node.id,
        type: "missing_font_metadata",
        message: `Text node ${node.name} has no font metadata.`
      });
    }
    if (hasImagePaint(node) && !imagePaints(node).some((paint) => paint.imageHash)) {
      warnings.push({
        nodeId: node.id,
        type: "asset_missing",
        message: `Image node ${node.name} has no imageHash.`
      });
    }
    for (const child of node.children ?? []) walk(child);
  };
  walk(scene.root);
  return {
    version: "0.1.0",
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    source: {
      ...scene.source,
      rootNodeId: scene.root.id,
      rootNodeName: scene.root.name
    },
    stats,
    warnings
  };
}

function hasImagePaint(node: RawFigmaNode): boolean {
  return imagePaints(node).length > 0;
}

function imagePaints(node: RawFigmaNode): RawPaint[] {
  return [...(node.fills ?? []), ...(node.strokes ?? [])].filter((paint) => paint.visible !== false && (paint.type === "IMAGE" || !!paint.imageHash));
}
