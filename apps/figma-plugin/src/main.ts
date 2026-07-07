figma.showUI(__html__, { width: 380, height: 430 });

type SerializableNode = Record<string, unknown> & {
  id: string;
  name: string;
  type: string;
  children?: SerializableNode[];
};

type ExportedAsset = {
  sourceNodeId: string;
  name: string;
  status: "success" | "failed";
  format: "png";
  contentType?: "image/png";
  pngBase64?: string;
  bytes?: number;
  width?: number;
  height?: number;
  reason?: string;
};

type SnapshotPayload = {
  root: SceneNode;
  rawFigmaScene: ReturnType<typeof buildRawFigmaScene>;
  png: Uint8Array;
  assets: ExportedAsset[];
  extractionReport: Record<string, unknown>;
};

type SelectionNames = {
  projectName?: string;
  pageName?: string;
};

figma.ui.onmessage = async (message: { type?: string; endpoint?: string; projectName?: string; pageName?: string }) => {
  if (message.type === "read-selection-context") {
    postSelectionContext();
    return;
  }
  if (message.type === "check-health") {
    await checkLocalApi(message.endpoint || "http://localhost:8787/api/snapshots");
    return;
  }
  if (message.type === "export-snapshot-zip") {
    await exportSnapshotZip();
    return;
  }
  if (message.type !== "sync-selection") return;
  try {
    const endpoint = message.endpoint || "http://localhost:8787/api/snapshots";
    const names = {
      projectName: normalizeName(message.projectName) ?? readPluginProjectName(),
      pageName: normalizeName(message.pageName) ?? readSelectedPageName()
    };
    const { root, rawFigmaScene, png, assets, extractionReport } = await collectSnapshotPayload(names);
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sourceKind: "figma_plugin",
        projectId: rawFigmaScene.source.projectName,
        rawFigmaScene,
        figmaReferencePngBase64: uint8ToBase64(png),
        preferFrameScreenshotFallback: true,
        assets,
        extractionReport
      })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || `Local API returned ${response.status}`);
    }
    figma.ui.postMessage({
      type: "sync-result",
      kind: "sync",
      ok: true,
      artifactDir: result.artifactDir,
      artifactRootPath: result.artifactRootPath,
      projectName: result.projectName,
      pageName: result.pageName,
      workbenchUrl: result.workbenchUrl,
      normalizedConfidence: result.normalizedConfidence,
      message: `已同步 ${result.projectName ?? rawFigmaScene.source.projectName}/${result.pageName ?? rawFigmaScene.source.pageName}\n产物路径：${result.artifactRootPath ?? result.artifactDir}\n置信度：${result.normalizedConfidence}`
    });
  } catch (error) {
    figma.ui.postMessage({
      type: "sync-result",
      kind: "sync",
      ok: false,
      message: error instanceof Error ? error.message : String(error)
    });
  }
};

figma.on("selectionchange", () => {
  postSelectionContext();
});

function postSelectionContext(): void {
  const selected = figma.currentPage.selection[0];
  figma.ui.postMessage({
    type: "selection-context",
    projectName: readPluginProjectName(),
    pageName: selected?.name ?? figma.currentPage.name,
    selectedNodeName: selected?.name,
    figmaPageName: figma.currentPage.name,
    hasSelection: Boolean(selected),
    message: selected ? `当前选择：${selected.name}` : "请选择一个 Frame、Component、Instance、Section、Group 或可见节点。"
  });
}

postSelectionContext();

async function collectSnapshotPayload(names: SelectionNames = {}): Promise<SnapshotPayload> {
  const root = resolveSelectedRoot();
  const projectName = normalizeName(names.projectName) ?? readPluginProjectName();
  const pageName = normalizeName(names.pageName) ?? root.name;
  const rawFigmaScene = buildRawFigmaScene(root, { projectName, pageName });
  const [png, assets] = await Promise.all([
    root.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 1 } }),
    exportNodeAssets(root)
  ]);
  const extractionReport = {
    source: {
      fileKey: figma.fileKey ?? "plugin_file",
      frameNodeId: root.id,
      fileName: projectName,
      projectName,
      pageName,
      figmaPageName: figma.currentPage.name,
      selectedNodeName: root.name,
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
      exported: assets.filter((asset) => asset.status === "success").length,
      failed: assets.filter((asset) => asset.status === "failed").length,
      bytes: assets.reduce((sum, asset) => sum + (asset.bytes ?? 0), 0)
    },
    warnings: assets
      .filter((asset) => asset.status === "failed")
      .map((asset) => ({
        type: "asset_export_failed",
        sourceNodeId: asset.sourceNodeId,
        name: asset.name,
        message: asset.reason ?? "Figma node asset export failed."
      }))
  };
  return { root, rawFigmaScene, png, assets, extractionReport };
}

async function exportSnapshotZip(): Promise<void> {
  try {
    const { root, rawFigmaScene, png, assets, extractionReport } = await collectSnapshotPayload();
    const snapshotId = `snap_${safeId(root.id)}_${new Date().toISOString().replace(/[^0-9A-Za-z]+/g, "_")}`;
    const sourceSnapshot = {
      id: snapshotId,
      figmaFileKey: rawFigmaScene.source.fileKey,
      frameId: rawFigmaScene.source.frameNodeId,
      viewport: rawFigmaScene.source.viewport
        ? {
            width: rawFigmaScene.source.viewport.width,
            height: rawFigmaScene.source.viewport.height,
            devicePixelRatio: rawFigmaScene.source.viewport.scale ?? 1
          }
        : undefined,
      rawScenePath: "raw_figma_scene.json",
      referenceScreenshotPath: "figma_reference.png",
      assetDir: "raw_assets",
      createdAt: rawFigmaScene.source.exportedAt
    };
    const entries: ZipEntryInput[] = [
      jsonZipEntry("source_snapshot.json", sourceSnapshot),
      jsonZipEntry("raw_figma_scene.json", rawFigmaScene),
      jsonZipEntry("extraction_report.json", extractionReport),
      jsonZipEntry(
        "raw_assets_manifest.json",
        assets.map((asset) => ({
          sourceNodeId: asset.sourceNodeId,
          name: asset.name,
          status: asset.status,
          format: asset.format,
          contentType: asset.contentType,
          path: `raw_assets/${safeId(asset.sourceNodeId || asset.name)}.png`,
          bytes: asset.bytes,
          width: asset.width,
          height: asset.height,
          reason: asset.reason
        }))
      ),
      { name: "figma_reference.png", data: png },
      ...assets
        .filter((asset) => asset.status === "success" && asset.pngBase64)
        .map((asset) => ({
          name: `raw_assets/${safeId(asset.sourceNodeId || asset.name)}.png`,
          data: base64ToUint8(asset.pngBase64 || "")
        }))
    ];
    const zip = writeStoredZip(entries);
    figma.ui.postMessage({
      type: "snapshot-zip",
      fileName: "uxcompiler_snapshot.zip",
      bytesBase64: uint8ToBase64(zip),
      message: `Offline snapshot ZIP ready\nFrame: ${root.name}\nAssets: ${assets.length}`
    });
  } catch (error) {
    figma.ui.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error)
    });
  }
}

async function checkLocalApi(endpoint: string): Promise<void> {
  try {
    const healthUrl = toHealthUrl(endpoint);
    const response = await fetch(healthUrl);
    const result = await response.json();
    if (!response.ok || !result.ok) {
      throw new Error(result.error || `Local API returned ${response.status}`);
    }
    figma.ui.postMessage({
      type: "connection",
      kind: "health",
      ok: true,
      artifactRoot: result.artifactRoot,
      workbenchUrl: result.workbenchUrl,
      message: `本地服务在线\n${healthUrl}\n产物根目录：${result.artifactRoot}`
    });
  } catch (error) {
    figma.ui.postMessage({
      type: "connection",
      kind: "health",
      ok: false,
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

function buildRawFigmaScene(root: SceneNode, names: Required<SelectionNames>) {
  const bounds = readBounds(root);
  return {
    version: "2.0",
    source: {
      fileKey: figma.fileKey ?? "plugin_file",
      pageId: figma.currentPage.id,
      frameNodeId: root.id,
      exportedAt: new Date().toISOString(),
      viewport: bounds ? { width: bounds.width, height: bounds.height, scale: 1 } : undefined,
      fileName: names.projectName,
      projectName: names.projectName,
      pageName: names.pageName,
      figmaPageName: figma.currentPage.name,
      selectedNodeName: root.name,
      editorType: "figma",
      apiBaseUrl: "figma-plugin"
    },
    root: serializeNode(root)
  };
}

function readPluginProjectName(): string {
  const fileName = typeof figma.root?.name === "string" ? figma.root.name : "";
  if (fileName.trim()) return fileName.trim();
  return figma.fileKey ? `figma_${figma.fileKey}` : `figma_plugin_${figma.currentPage.name}`;
}

function readSelectedPageName(): string {
  return figma.currentPage.selection[0]?.name ?? figma.currentPage.name;
}

function normalizeName(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
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
    const bounds = readBounds(node);
    try {
      const png = await node.exportAsync({ format: "PNG", constraint: { type: "SCALE", value: 1 } });
      assets.push({
        sourceNodeId: node.id,
        name: node.name,
        status: "success",
        format: "png",
        contentType: "image/png",
        pngBase64: uint8ToBase64(png),
        bytes: png.byteLength,
        width: bounds?.width,
        height: bounds?.height
      });
    } catch (error) {
      assets.push({
        sourceNodeId: node.id,
        name: node.name,
        status: "failed",
        format: "png",
        width: bounds?.width,
        height: bounds?.height,
        reason: error instanceof Error ? error.message : String(error)
      });
    }
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

function base64ToUint8(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || "node";
}

type ZipEntryInput = {
  name: string;
  data: Uint8Array;
};

function jsonZipEntry(name: string, value: unknown): ZipEntryInput {
  return {
    name,
    data: encodeText(`${JSON.stringify(value, null, 2)}\n`)
  };
}

function writeStoredZip(entries: ZipEntryInput[]): Uint8Array {
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encodeText(entry.name);
    const crc = crc32(entry.data);
    const local = concatBytes([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(crc),
      u32(entry.data.length),
      u32(entry.data.length),
      u16(name.length),
      u16(0),
      name,
      entry.data
    ]);
    localParts.push(local);
    centralParts.push(
      concatBytes([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(crc),
        u32(entry.data.length),
        u32(entry.data.length),
        u16(name.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        name
      ])
    );
    offset += local.length;
  }
  const centralDirectory = concatBytes(centralParts);
  const end = concatBytes([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(entries.length),
    u16(entries.length),
    u32(centralDirectory.length),
    u32(offset),
    u16(0)
  ]);
  return concatBytes([...localParts, centralDirectory, end]);
}

function encodeText(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function u16(value: number): Uint8Array {
  const out = new Uint8Array(2);
  new DataView(out.buffer).setUint16(0, value, true);
  return out;
}

function u32(value: number): Uint8Array {
  const out = new Uint8Array(4);
  new DataView(out.buffer).setUint32(0, value >>> 0, true);
  return out;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ crc32Table[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const crc32Table = (() => {
  const table: number[] = [];
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();
