import type { Bounds } from "./canonical-scene.js";

export type VisualNode =
  | VisualSceneNode
  | VisualPositionedNode
  | VisualStackNode
  | VisualRectNode
  | VisualTextNode
  | VisualImageNode;

export interface VisualSceneNode {
  type: "scene";
  size: { w: number; h: number };
  children: VisualNode[];
}

export interface VisualPositionedNode {
  type: "positioned";
  sourceNodeId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  child: VisualNode;
}

export interface VisualStackNode {
  type: "stack";
  children: VisualNode[];
}

export interface VisualRectNode {
  type: "rect";
  sourceNodeId: string;
  w: number;
  h: number;
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  radius?: number;
  opacity?: number;
  shadow?: VisualShadow[];
}

export interface VisualShadow {
  color: string;
  blur: number;
  offsetX: number;
  offsetY: number;
  spread?: number;
}

export interface VisualTextNode {
  type: "text";
  sourceNodeId: string;
  text: string;
  w: number;
  h: number;
  color?: string;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  lineHeight?: number;
  letterSpacing?: number;
}

export interface VisualImageNode {
  type: "image";
  sourceNodeId: string;
  w: number;
  h: number;
  mode: "placeholder" | "asset";
  assetPath?: string;
}

export interface VisualIR {
  version: string;
  source: {
    frameNodeId?: string;
    viewport: { width: number; height: number };
  };
  root: VisualSceneNode;
}

export interface NodePixelMapEntry {
  sourceNodeId: string;
  widgetPath: string;
  bounds: Bounds;
}

export interface FidelityRenderDecision {
  sourceNodeId: string;
  strategy:
    | "absolute_widget"
    | "real_text"
    | "flutter_shape"
    | "image_asset"
    | "frame_screenshot_asset"
    | "covered_by_frame_screenshot"
    | "placeholder_asset"
    | "ignored_wrapper";
  editable: boolean;
  reason: string;
}

export interface FidelityGenerationManifest {
  version: string;
  generatedAt: string;
  viewport: { width: number; height: number };
  files: string[];
  renderDecisions: FidelityRenderDecision[];
  warnings: Array<{ sourceNodeId?: string; type: string; message: string }>;
}

export interface FlutterPreviewProject {
  files: Record<string, string>;
}

export interface FlutterFidelityResult {
  visualIR: VisualIR;
  fidelityGenerationManifest: FidelityGenerationManifest;
  nodePixelMap: NodePixelMapEntry[];
  flutterPreviewProject: FlutterPreviewProject;
}
