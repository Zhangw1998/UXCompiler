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
