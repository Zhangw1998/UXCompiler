import type { RawEffect, RawPaint, RawTextStyle } from "./raw-figma-scene.js";

export type CanonicalType = "frame" | "group" | "text" | "rect" | "vector" | "image" | "instance" | "component";

export interface Bounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface CanonicalFlags {
  isInvisible: boolean;
  isZeroSize: boolean;
  isEmptyWrapper: boolean;
  hasClip: boolean;
  hasMask: boolean;
  hasBlendMode: boolean;
  hasBlur: boolean;
  isComplexVector: boolean;
  recommendAssetSlice: boolean;
}

export interface CanonicalStyle {
  fills: RawPaint[];
  strokes: RawPaint[];
  effects: RawEffect[];
  opacity: number;
  cornerRadius?: number;
  rectangleCornerRadii?: number[];
  blendMode?: string;
}

export interface CanonicalText {
  content: string;
  style?: RawTextStyle;
}

export interface CanonicalNode {
  id: string;
  sourceNodeId: string;
  sourceName: string;
  canonicalType: CanonicalType;
  bounds: Bounds;
  zIndex: number;
  style: CanonicalStyle;
  text?: CanonicalText;
  layout?: {
    mode?: string;
    positioning?: string;
    itemSpacing?: number;
    padding?: { left: number; right: number; top: number; bottom: number };
  };
  flags: CanonicalFlags;
  children: CanonicalNode[];
}

export interface CanonicalScene {
  version: string;
  source: {
    frameNodeId?: string;
    viewport: { width: number; height: number };
  };
  root: CanonicalNode;
}

export interface NodeMapping {
  rawToCanonical: Record<string, string[]>;
  canonicalToRaw: Record<string, string[]>;
}

export interface CanonicalizationWarning {
  sourceNodeId: string;
  type: string;
  message: string;
}

export interface CanonicalizationReport {
  stats: {
    rawNodes: number;
    canonicalNodes: number;
    flattenedWrappers: number;
    invalidBounds: number;
  };
  flattenedNodes: Array<{ sourceNodeId: string; reason: string; replacementCanonicalIds: string[] }>;
  warnings: CanonicalizationWarning[];
}

export interface CanonicalizationResult {
  canonicalScene: CanonicalScene;
  nodeMapping: NodeMapping;
  report: CanonicalizationReport;
}
