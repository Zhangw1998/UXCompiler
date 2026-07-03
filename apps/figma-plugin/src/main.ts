figma.showUI(__html__, { width: 340, height: 260 });

type SerializableNode = Record<string, unknown> & {
  id: string;
  name: string;
  type: string;
  children?: SerializableNode[];
};

type ExportedAsset = {
  sourceNodeId: string;
  name: string;
  format: "png";
  contentType: "image/png";
  pngBase64: string;
  bytes: number;
  width?: number;
  height?: number;
};

figma.ui.onmessage = async (message: { type?: string; endpoint?: string }) => {
  if (message.type === "check-health") {
    await checkLocalApi(message.endpoint || "http://localhost:8787/api/snapshots");
    return;
  }
  if (message.type !== "sync-selection") return;
  try {
    const endpoint = message.endpoint || "http://localhost:8787/api/snapshots";
    const root = resolveSelectedRoot();
    const rawFigmaScene = buildRawFigmaScene(root);
    const [png, assets] = await Promise.all([
      root.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 1 } }),
      exportNodeAssets(root)
    ]);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceKind: "figma_plugin",
        rawFigmaScene,
        figmaReferencePngBase64: uint8ToBase64(png),
        preferFrameScreenshotFallback: true,
        assets,
        extractionReport: {
          source: {
            fileKey: figma.fileKey ?? "plugin_file",
            frameNodeId: root.id,
            fileName: readPluginFileName(),
            apiBaseUrl: "figma-plugin"
          },
          stats: countNodes(rawFigmaScene.root),
          screenshot: {
            requested: true,
            status: "success",
            format: "png",
            scale: 1,
            bytes: png.byteLength
          },
          assets: {
            requested: assets.length,
            format: "png",
            bytes: assets.reduce((sum, asset) => sum + asset.bytes, 0)
          },
          warnings: []
        }
      })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || `Local API returned ${response.status}`);
    }
    figma.ui.postMessage({
      type: "success",
      message: `Synced ${root.name}\nArtifacts: ${result.artifactDir}\nConfidence: ${result.normalizedConfidence}`
    });
  } catch (error) {
    figma.ui.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
};

async function checkLocalApi(endpoint: string): Promise<void> {
  try {
    const healthUrl = toHealthUrl(endpoint);
    const response = await fetch(healthUrl);
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || `Local API returned ${response.status}`);
    }
    figma.ui.postMessage({
      type: "success",
      message: `Local API online\n${healthUrl}\nArtifacts: ${result.artifactRoot}`
    });
  } catch (error) {
    figma.ui.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

function toHealthUrl(endpoint: string): string {
  const match = endpoint.trim().match(/^(https?:\/\/[^/?#]+)(?:[/?#].*)?$/);
  if (!match) throw new Error("Endpoint must start with http:// or https://.");
  return `${match[1]}/health`;
}

function resolveSelectedRoot(): SceneNode {
  const selected = figma.currentPage.selection[0];
  if (!selected) throw new Error("Select a Frame, Component, Instance, Section, Group, or visible node first.");
  return selected;
}

function buildRawFigmaScene(root: SceneNode) {
  const bounds = readBounds(root);
  return {
    version: "2.0",
    source: {
      fileKey: figma.fileKey ?? "plugin_file",
      pageId: figma.currentPage.id,
      frameNodeId: root.id,
      exportedAt: new Date().toISOString(),
      viewport: bounds ? { width: bounds.width, height: bounds.height, scale: 1 } : undefined,
      fileName: readPluginFileName(),
      editorType: "figma",
      apiBaseUrl: "figma-plugin"
    },
    root: serializeNode(root)
  };
}

function readPluginFileName(): string {
  return figma.fileKey ? `figma_${figma.fileKey}` : `figma_plugin_${figma.currentPage.name}`;
}

function serializeNode(node: SceneNode): SerializableNode {
  const serialized: SerializableNode = {
    id: node.id,
    name: node.name,
    type: node.type,
    visible: node.visible,
    locked: node.locked,
    opacity: "opacity" in node ? node.opacity : undefined,
    absoluteBoundingBox: clone(readBounds(node)),
    absoluteRenderBounds: clone("absoluteRenderBounds" in node ? node.absoluteRenderBounds : undefined),
    relativeTransform: clone("relativeTransform" in node ? node.relativeTransform : undefined),
    constraints: clone("constraints" in node ? node.constraints : undefined),
    layoutMode: read(node, "layoutMode"),
    layoutPositioning: read(node, "layoutPositioning"),
    itemSpacing: read(node, "itemSpacing"),
    paddingLeft: read(node, "paddingLeft"),
    paddingRight: read(node, "paddingRight"),
    paddingTop: read(node, "paddingTop"),
    paddingBottom: read(node, "paddingBottom"),
    primaryAxisAlignItems: read(node, "primaryAxisAlignItems"),
    counterAxisAlignItems: read(node, "counterAxisAlignItems"),
    fills: clone(read(node, "fills")),
    strokes: clone(read(node, "strokes")),
    effects: clone(read(node, "effects")),
    blendMode: read(node, "blendMode"),
    clipsContent: read(node, "clipsContent"),
    isMask: read(node, "isMask"),
    cornerRadius: read(node, "cornerRadius"),
    rectangleCornerRadii: clone(read(node, "rectangleCornerRadii")),
    characters: read(node, "characters"),
    style: clone(read(node, "style")),
    vectorNetwork: clone(read(node, "vectorNetwork")),
    imageHash: read(node, "imageHash"),
    componentId: read(node, "componentId"),
    componentKey: read(node, "componentKey"),
    variantProperties: clone(read(node, "variantProperties")),
    overrides: clone(read(node, "overrides"))
  };

  if ("children" in node) {
    serialized.children = node.children.map((child) => serializeNode(child));
  }

  for (const key of Object.keys(serialized)) {
    if (serialized[key] === undefined) delete serialized[key];
  }
  return serialized;
}

async function exportNodeAssets(root: SceneNode): Promise<ExportedAsset[]> {
  const nodes: SceneNode[] = [];
  walkSceneNode(root, (node) => {
    if (hasNodeExportableAsset(node)) nodes.push(node);
  });

  const assets: ExportedAsset[] = [];
  for (const node of nodes) {
    const png = await node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 1 } });
    const bounds = readBounds(node);
    assets.push({
      sourceNodeId: node.id,
      name: node.name,
      format: "png",
      contentType: "image/png",
      pngBase64: uint8ToBase64(png),
      bytes: png.byteLength,
      width: bounds?.width,
      height: bounds?.height
    });
  }
  return assets;
}

function walkSceneNode(node: SceneNode, visit: (node: SceneNode) => void): void {
  visit(node);
  if ("children" in node) {
    for (const child of node.children) walkSceneNode(child, visit);
  }
}

function hasNodeImageAsset(node: SceneNode): boolean {
  return typeof read(node, "imageHash") === "string" || hasImageFill(read(node, "fills"));
}

function hasNodeExportableAsset(node: SceneNode): boolean {
  return hasNodeImageAsset(node) || hasNodeSliceAsset(node);
}

function hasNodeSliceAsset(node: SceneNode): boolean {
  return hasBlurEffect(read(node, "effects")) || read(node, "isMask") === true || isComplexVectorNode(node);
}

function hasBlurEffect(effects: unknown): boolean {
  if (!Array.isArray(effects)) return false;
  return effects.some((effect) => {
    if (!effect || typeof effect !== "object") return false;
    const candidate = effect as { type?: string; visible?: boolean };
    return candidate.visible !== false && String(candidate.type ?? "").includes("BLUR");
  });
}

function isComplexVectorNode(node: SceneNode): boolean {
  const vectorLikeTypes = ["VECTOR", "BOOLEAN_OPERATION", "STAR", "LINE", "POLYGON", "ELLIPSE"];
  return vectorLikeTypes.includes(node.type) && (read(node, "vectorNetwork") !== undefined || ("children" in node && node.children.length > 0));
}

function hasImageFill(fills: unknown): boolean {
  if (!Array.isArray(fills)) return false;
  return fills.some((fill) => {
    if (!fill || typeof fill !== "object") return false;
    const candidate = fill as { type?: string; visible?: boolean; opacity?: number };
    return candidate.type === "IMAGE" && candidate.visible !== false && candidate.opacity !== 0;
  });
}

function readBounds(node: SceneNode): Rect | undefined {
  return "absoluteBoundingBox" in node ? node.absoluteBoundingBox ?? undefined : undefined;
}

function read(node: SceneNode, key: string): unknown {
  return key in node ? (node as unknown as Record<string, unknown>)[key] : undefined;
}

function clone(value: unknown): unknown {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return undefined;
  }
}

function countNodes(root: SerializableNode) {
  const stats = {
    nodes: 0,
    textNodes: 0,
    vectorNodes: 0,
    imageNodes: 0,
    componentInstances: 0
  };
  walk(root, (node) => {
    stats.nodes += 1;
    if (node.type === "TEXT") stats.textNodes += 1;
    if (["VECTOR", "BOOLEAN_OPERATION", "STAR", "LINE", "POLYGON", "ELLIPSE"].includes(node.type)) stats.vectorNodes += 1;
    if (typeof node.imageHash === "string" || hasImageFill(node.fills)) stats.imageNodes += 1;
    if (node.type === "INSTANCE") stats.componentInstances += 1;
  });
  return stats;
}

function walk(node: SerializableNode, visit: (node: SerializableNode) => void): void {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }
  return btoa(binary);
}
