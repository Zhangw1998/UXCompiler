figma.showUI(__html__, { width: 340, height: 260 });

type SerializableNode = Record<string, unknown> & {
  id: string;
  name: string;
  type: string;
  children?: SerializableNode[];
};

figma.ui.onmessage = async (message: { type?: string; endpoint?: string }) => {
  if (message.type === "check-health") {
    await checkLocalApi(message.endpoint || "http://127.0.0.1:8787/api/snapshots");
    return;
  }
  if (message.type !== "sync-selection") return;
  try {
    const endpoint = message.endpoint || "http://127.0.0.1:8787/api/snapshots";
    const root = resolveSelectedRoot();
    const rawFigmaScene = buildRawFigmaScene(root);
    const png = await root.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 1 } });
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceKind: "figma_plugin",
        rawFigmaScene,
        figmaReferencePngBase64: uint8ToBase64(png),
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
  const url = new URL(endpoint);
  url.pathname = "/health";
  url.search = "";
  url.hash = "";
  return url.toString();
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
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
