import type { RawBounds, RawEffect, RawFigmaNode, RawFigmaScene, RawPaint } from "@uxcompiler/ir-schemas";

export interface ParsedFigmaTarget {
  fileKey: string;
  nodeId?: string;
  sourceUrl?: string;
}

export interface FigmaExtractOptions {
  file: string;
  nodeId?: string;
  token: string;
  scale?: number;
  format?: "png" | "jpg" | "svg" | "pdf";
  apiBaseUrl?: string;
  screenshot?: boolean;
}

export interface FigmaExtractionReport {
  source: {
    fileKey: string;
    frameNodeId?: string;
    fileName?: string;
    apiBaseUrl: string;
  };
  stats: {
    nodes: number;
    textNodes: number;
    vectorNodes: number;
    imageNodes: number;
    componentInstances: number;
  };
  screenshot: {
    requested: boolean;
    status: "success" | "failed" | "skipped";
    format: string;
    scale: number;
    bytes?: number;
    urlExpires?: string;
    message?: string;
  };
  warnings: Array<{ nodeId?: string; type: string; message: string }>;
}

export interface FigmaExtractionResult {
  rawFigmaScene: RawFigmaScene;
  referenceImage?: Uint8Array;
  referenceImageExtension: string;
  extractionReport: FigmaExtractionReport;
}

export interface FigmaFrameSummary {
  id: string;
  urlNodeId: string;
  name: string;
  type: string;
  path: string;
  width?: number;
  height?: number;
}

export interface FigmaFramesResult {
  fileKey: string;
  fileName?: string;
  lastModified?: string;
  editorType?: string;
  frames: FigmaFrameSummary[];
}

interface FigmaFileResponse {
  name?: string;
  lastModified?: string;
  editorType?: string;
  version?: string;
  document: FigmaApiNode;
}

interface FigmaNodesResponse {
  name?: string;
  lastModified?: string;
  editorType?: string;
  version?: string;
  nodes: Record<string, { document?: FigmaApiNode } | null>;
}

interface FigmaImagesResponse {
  err?: string;
  images?: Record<string, string | null>;
  status?: number;
}

interface FigmaApiNode {
  id: string;
  name: string;
  type: string;
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
  style?: Record<string, unknown>;
  vectorNetwork?: unknown;
  imageHash?: string;
  componentId?: string;
  componentKey?: string;
  variantProperties?: Record<string, string>;
  overrides?: unknown[];
  children?: FigmaApiNode[];
  [key: string]: unknown;
}

const DEFAULT_API_BASE_URL = "https://api.figma.com";

export async function extractFigmaScene(options: FigmaExtractOptions): Promise<FigmaExtractionResult> {
  const target = parseFigmaTarget(options.file);
  const fileKey = target.fileKey;
  const nodeId = normalizeNodeId(options.nodeId ?? target.nodeId);
  const apiBaseUrl = trimTrailingSlash(options.apiBaseUrl ?? DEFAULT_API_BASE_URL);
  const warnings: FigmaExtractionReport["warnings"] = [];
  const scale = options.scale ?? 1;
  const format = options.format ?? "png";
  const shouldExportScreenshot = options.screenshot ?? true;

  const fileData = nodeId
    ? await fetchFigmaNode({ apiBaseUrl, token: options.token, fileKey, nodeId })
    : await fetchFigmaFile({ apiBaseUrl, token: options.token, fileKey });

  const selectedRoot = nodeId ? pickNodeResponseRoot(fileData, nodeId) : pickFirstRenderableRoot(fileData.document, warnings);
  const rawRoot = serializeFigmaNode(selectedRoot);
  const rawBounds = rawRoot.absoluteBoundingBox ?? rawRoot.absoluteRenderBounds ?? undefined;
  const rawFigmaScene: RawFigmaScene = {
    version: "2.0",
    source: {
      fileKey,
      frameNodeId: rawRoot.id,
      exportedAt: new Date().toISOString(),
      viewport: rawBounds ? { width: rawBounds.width, height: rawBounds.height, scale } : undefined,
      fileName: fileData.name,
      lastModified: fileData.lastModified,
      version: fileData.version,
      editorType: fileData.editorType,
      sourceUrl: target.sourceUrl,
      apiBaseUrl
    },
    root: rawRoot
  };

  const report: FigmaExtractionReport = {
    source: {
      fileKey,
      frameNodeId: rawRoot.id,
      fileName: fileData.name,
      apiBaseUrl
    },
    stats: countRawNodes(rawRoot),
    screenshot: {
      requested: true,
      status: "skipped",
      format,
      scale
    },
    warnings
  };

  let referenceImage: Uint8Array | undefined;
  if (shouldExportScreenshot) {
    try {
      const imageUrl = await fetchFigmaImageUrl({ apiBaseUrl, token: options.token, fileKey, nodeId: rawRoot.id, scale, format });
      referenceImage = await downloadBinary(imageUrl);
      report.screenshot = {
        requested: true,
        status: "success",
        format,
        scale,
        bytes: referenceImage.byteLength
      };
    } catch (error) {
      report.screenshot = {
        requested: true,
        status: "failed",
        format,
        scale,
        message: error instanceof Error ? error.message : String(error)
      };
      warnings.push({
        nodeId: rawRoot.id,
        type: "reference_screenshot_failed",
        message: report.screenshot.message ?? "Reference screenshot export failed."
      });
    }
  } else {
    report.screenshot = {
      requested: false,
      status: "skipped",
      format,
      scale,
      message: "Screenshot export skipped by caller."
    };
  }

  return {
    rawFigmaScene,
    referenceImage,
    referenceImageExtension: format,
    extractionReport: report
  };
}

export async function listFigmaFrames(options: {
  file: string;
  token: string;
  apiBaseUrl?: string;
}): Promise<FigmaFramesResult> {
  const target = parseFigmaTarget(options.file);
  const apiBaseUrl = trimTrailingSlash(options.apiBaseUrl ?? DEFAULT_API_BASE_URL);
  const fileData = await fetchFigmaFile({ apiBaseUrl, token: options.token, fileKey: target.fileKey });
  const frames: FigmaFrameSummary[] = [];
  collectRenderableFrames(fileData.document, [], frames);
  return {
    fileKey: target.fileKey,
    fileName: fileData.name,
    lastModified: fileData.lastModified,
    editorType: fileData.editorType,
    frames
  };
}

export function parseFigmaTarget(input: string): ParsedFigmaTarget {
  if (!input.startsWith("http://") && !input.startsWith("https://")) {
    return { fileKey: input };
  }

  const url = new URL(input);
  const parts = url.pathname.split("/").filter(Boolean);
  const fileTypeIndex = parts.findIndex((part) => ["file", "design", "proto", "board", "slides"].includes(part));
  const fileKey = fileTypeIndex >= 0 ? parts[fileTypeIndex + 1] : undefined;
  if (!fileKey) {
    throw new Error("Could not parse Figma file key from URL.");
  }

  return {
    fileKey,
    nodeId: normalizeNodeId(url.searchParams.get("node-id") ?? undefined),
    sourceUrl: input
  };
}

export function normalizeNodeId(nodeId?: string): string | undefined {
  return nodeId ? nodeId.replace(/-/g, ":") : undefined;
}

async function fetchFigmaFile({
  apiBaseUrl,
  token,
  fileKey
}: {
  apiBaseUrl: string;
  token: string;
  fileKey: string;
}): Promise<FigmaFileResponse> {
  const url = new URL(`${apiBaseUrl}/v1/files/${encodeURIComponent(fileKey)}`);
  url.searchParams.set("geometry", "paths");
  return figmaJsonRequest<FigmaFileResponse>(url, token);
}

async function fetchFigmaNode({
  apiBaseUrl,
  token,
  fileKey,
  nodeId
}: {
  apiBaseUrl: string;
  token: string;
  fileKey: string;
  nodeId: string;
}): Promise<FigmaFileResponse> {
  const url = new URL(`${apiBaseUrl}/v1/files/${encodeURIComponent(fileKey)}/nodes`);
  url.searchParams.set("ids", nodeId);
  url.searchParams.set("geometry", "paths");
  const response = await figmaJsonRequest<FigmaNodesResponse>(url, token);
  const document = pickNodeResponseRoot(response, nodeId);
  return {
    name: response.name,
    lastModified: response.lastModified,
    editorType: response.editorType,
    version: response.version,
    document
  };
}

function pickNodeResponseRoot(response: FigmaNodesResponse | FigmaFileResponse, nodeId: string): FigmaApiNode {
  if ("document" in response) return response.document;
  const exact = response.nodes[nodeId] ?? response.nodes[normalizeNodeId(nodeId) ?? nodeId];
  const document = exact?.document;
  if (!document) {
    throw new Error(`Figma node "${nodeId}" was not found or returned null.`);
  }
  return document;
}

function pickFirstRenderableRoot(document: FigmaApiNode, warnings: FigmaExtractionReport["warnings"]): FigmaApiNode {
  const queue = [document];
  while (queue.length > 0) {
    const node = queue.shift()!;
    if (isRenderableRoot(node)) {
      warnings.push({
        nodeId: node.id,
        type: "auto_selected_root",
        message: "No node id was provided; selected the first renderable frame/component-like node."
      });
      return node;
    }
    queue.push(...(node.children ?? []));
  }
  return document;
}

function isRenderableRoot(node: FigmaApiNode): boolean {
  return ["FRAME", "COMPONENT", "INSTANCE", "SECTION"].includes(node.type) && !!node.absoluteBoundingBox;
}

function collectRenderableFrames(node: FigmaApiNode, path: string[], frames: FigmaFrameSummary[]): void {
  const nextPath = [...path, node.name];
  if (isRenderableRoot(node)) {
    frames.push({
      id: node.id,
      urlNodeId: node.id.replace(/:/g, "-"),
      name: node.name,
      type: node.type,
      path: nextPath.join(" / "),
      width: node.absoluteBoundingBox?.width,
      height: node.absoluteBoundingBox?.height
    });
  }
  for (const child of node.children ?? []) {
    collectRenderableFrames(child, nextPath, frames);
  }
}

async function fetchFigmaImageUrl({
  apiBaseUrl,
  token,
  fileKey,
  nodeId,
  scale,
  format
}: {
  apiBaseUrl: string;
  token: string;
  fileKey: string;
  nodeId: string;
  scale: number;
  format: string;
}): Promise<string> {
  const url = new URL(`${apiBaseUrl}/v1/images/${encodeURIComponent(fileKey)}`);
  url.searchParams.set("ids", nodeId);
  url.searchParams.set("scale", String(scale));
  url.searchParams.set("format", format);
  url.searchParams.set("use_absolute_bounds", "true");
  const response = await figmaJsonRequest<FigmaImagesResponse>(url, token);
  const imageUrl = response.images?.[nodeId];
  if (!imageUrl) {
    throw new Error(response.err ?? `Figma did not return an image URL for node "${nodeId}".`);
  }
  return imageUrl;
}

async function figmaJsonRequest<T>(url: URL, token: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "X-Figma-Token": token
    }
  });
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Figma API ${response.status} ${response.statusText}: ${body.slice(0, 500)}`);
  }
  return (await response.json()) as T;
}

async function downloadBinary(url: string): Promise<Uint8Array> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Image download ${response.status} ${response.statusText}`);
  }
  return new Uint8Array(await response.arrayBuffer());
}

function serializeFigmaNode(node: FigmaApiNode): RawFigmaNode {
  const serialized: RawFigmaNode = {
    id: node.id,
    name: node.name,
    type: node.type,
    visible: node.visible,
    locked: node.locked,
    opacity: node.opacity,
    absoluteBoundingBox: node.absoluteBoundingBox,
    absoluteRenderBounds: node.absoluteRenderBounds,
    relativeTransform: node.relativeTransform,
    constraints: node.constraints,
    layoutMode: node.layoutMode,
    layoutPositioning: node.layoutPositioning,
    itemSpacing: node.itemSpacing,
    paddingLeft: node.paddingLeft,
    paddingRight: node.paddingRight,
    paddingTop: node.paddingTop,
    paddingBottom: node.paddingBottom,
    primaryAxisAlignItems: node.primaryAxisAlignItems,
    counterAxisAlignItems: node.counterAxisAlignItems,
    fills: node.fills,
    strokes: node.strokes,
    effects: node.effects,
    blendMode: node.blendMode,
    clipsContent: node.clipsContent,
    isMask: node.isMask,
    cornerRadius: node.cornerRadius,
    rectangleCornerRadii: node.rectangleCornerRadii,
    characters: node.characters,
    style: node.style,
    vectorNetwork: node.vectorNetwork,
    imageHash: node.imageHash,
    componentId: node.componentId,
    componentKey: node.componentKey,
    variantProperties: node.variantProperties,
    overrides: node.overrides,
    children: node.children?.map(serializeFigmaNode)
  };

  for (const key of Object.keys(serialized) as Array<keyof RawFigmaNode>) {
    if (serialized[key] === undefined) delete serialized[key];
  }
  return serialized;
}

function countRawNodes(root: RawFigmaNode): FigmaExtractionReport["stats"] {
  const stats = {
    nodes: 0,
    textNodes: 0,
    vectorNodes: 0,
    imageNodes: 0,
    componentInstances: 0
  };
  walkRaw(root, (node) => {
    stats.nodes += 1;
    if (node.type === "TEXT") stats.textNodes += 1;
    if (["VECTOR", "BOOLEAN_OPERATION", "STAR", "LINE", "POLYGON", "ELLIPSE"].includes(node.type)) stats.vectorNodes += 1;
    if (node.imageHash || hasImageFill(node.fills)) stats.imageNodes += 1;
    if (node.type === "INSTANCE") stats.componentInstances += 1;
  });
  return stats;
}

function walkRaw(node: RawFigmaNode, visit: (node: RawFigmaNode) => void): void {
  visit(node);
  for (const child of node.children ?? []) walkRaw(child, visit);
}

function hasImageFill(fills: unknown): boolean {
  return Array.isArray(fills) && fills.some((fill) => fill && typeof fill === "object" && (fill as { type?: string }).type === "IMAGE");
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
