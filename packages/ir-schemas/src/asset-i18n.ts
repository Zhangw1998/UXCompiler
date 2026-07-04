export type AssetStrategy =
  | "real_text"
  | "svg_icon"
  | "image_asset"
  | "frame_screenshot"
  | "decorative_slice"
  | "custom_painter"
  | "flutter_shape"
  | "ignored";

export interface AssetManifestEntry {
  id: string;
  sourceNodeId: string;
  sourceName: string;
  strategy: AssetStrategy;
  format?: "svg" | "png" | "webp" | "jpg";
  path?: string;
  scale?: number;
  cropBounds?: { x: number; y: number; w: number; h: number };
  excludeTextNodes?: boolean;
  reason: string;
  confidence: number;
}

export interface AssetManifest {
  version: string;
  assets: AssetManifestEntry[];
  warnings: Array<{ sourceNodeId?: string; type: string; message: string }>;
}

export interface I18nMessage {
  key: string;
  value: string;
  sourceNodeId: string;
  description: string;
  placeholders?: Record<string, I18nPlaceholder>;
  confidence: number;
}

export interface I18nPlaceholder {
  type: string;
  example?: string;
  description?: string;
}

export interface I18nManifest {
  version: string;
  locale: string;
  messages: I18nMessage[];
  warnings: Array<{ sourceNodeId?: string; type: string; message: string }>;
}

export interface AssetI18nResult {
  assetManifest: AssetManifest;
  i18nManifest: I18nManifest;
  arbFile: Record<string, unknown>;
}
