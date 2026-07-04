import type {
  AssetI18nResult,
  AssetManifest,
  AssetManifestEntry,
  CanonicalNode,
  CanonicalScene,
  I18nManifest,
  I18nMessage
} from "@uxcompiler/ir-schemas";

export function normalizeAssetsAndI18n(canonicalScene: CanonicalScene, locale = "en"): AssetI18nResult {
  const assets: AssetManifestEntry[] = [];
  const messages: I18nMessage[] = [];
  const assetWarnings: AssetManifest["warnings"] = [];
  const i18nWarnings: I18nManifest["warnings"] = [];
  const usedKeys = new Set<string>();

  walk(canonicalScene.root, (node) => {
    if (node.flags.isInvisible || node.flags.isZeroSize) return;

    if (node.canonicalType === "text") {
      const value = node.text?.content?.trim() ?? "";
      if (!value) {
        i18nWarnings.push({
          sourceNodeId: node.sourceNodeId,
          type: "empty_text",
          message: "Text node has no visible string content."
        });
        return;
      }
      const key = uniqueKey(toI18nKey(node.sourceName || value), usedKeys);
      messages.push({
        key,
        value,
        sourceNodeId: node.sourceNodeId,
        description: `Text from Figma node "${node.sourceName}".`,
        confidence: 0.82
      });
      assets.push({
        id: `asset_${safeId(node.sourceNodeId)}`,
        sourceNodeId: node.sourceNodeId,
        sourceName: node.sourceName,
        strategy: "real_text",
        reason: "Text remains a real Flutter Text widget and is extracted to ARB.",
        confidence: 0.95
      });
      return;
    }

    if (node.canonicalType === "image") {
      assets.push({
        id: `asset_${safeId(node.sourceNodeId)}`,
        sourceNodeId: node.sourceNodeId,
        sourceName: node.sourceName,
        strategy: "image_asset",
        format: "png",
        path: `assets/images/${fileBase(node.sourceName, node.sourceNodeId)}.png`,
        reason: "Bitmap/image fill should be emitted as a Flutter image asset.",
        confidence: 0.84
      });
      return;
    }

    if (node.flags.recommendAssetSlice) {
      const textDescendants = visibleTextDescendants(node);
      assets.push({
        id: `asset_${safeId(node.sourceNodeId)}`,
        sourceNodeId: node.sourceNodeId,
        sourceName: node.sourceName,
        strategy: "decorative_slice",
        format: "png",
        path: `assets/slices/${fileBase(node.sourceName, node.sourceNodeId)}.png`,
        reason: "Complex vector/effect/mask is safer as a decorative slice for fidelity.",
        confidence: 0.72
      });
      assetWarnings.push({
        sourceNodeId: node.sourceNodeId,
        type: "decorative_slice_candidate",
        message: "Complex visual node requires later asset export or Studio confirmation."
      });
      if (textDescendants.length > 0) {
        assetWarnings.push({
          sourceNodeId: node.sourceNodeId,
          type: "decorative_slice_contains_text",
          message: `Decorative slice "${node.sourceName}" contains visible Text descendants: ${textDescendants
            .map((textNode) => `${textNode.sourceName} (${textNode.sourceNodeId})`)
            .join(", ")}. Confirm the text remains editable/i18n or explicitly exclude it from the slice.`
        });
      }
      return;
    }

    if (node.canonicalType === "vector") {
      assets.push({
        id: `asset_${safeId(node.sourceNodeId)}`,
        sourceNodeId: node.sourceNodeId,
        sourceName: node.sourceName,
        strategy: "svg_icon",
        format: "svg",
        path: `assets/icons/${fileBase(node.sourceName, node.sourceNodeId)}.svg`,
        reason: "Simple vector can be exported as an SVG icon candidate.",
        confidence: 0.76
      });
      return;
    }

    if (node.canonicalType === "rect" && hasVisualShape(node)) {
      assets.push({
        id: `asset_${safeId(node.sourceNodeId)}`,
        sourceNodeId: node.sourceNodeId,
        sourceName: node.sourceName,
        strategy: "flutter_shape",
        reason: "Rectangle can be represented as Flutter decoration/shape.",
        confidence: 0.9
      });
    }
  });

  const i18nManifest: I18nManifest = {
    version: "2.0",
    locale,
    messages,
    warnings: i18nWarnings
  };

  return {
    assetManifest: {
      version: "2.0",
      assets,
      warnings: assetWarnings
    },
    i18nManifest,
    arbFile: renderArb(i18nManifest)
  };
}

function walk(node: CanonicalNode, visit: (node: CanonicalNode) => void): void {
  visit(node);
  for (const child of node.children) walk(child, visit);
}

function visibleTextDescendants(node: CanonicalNode): CanonicalNode[] {
  const descendants: CanonicalNode[] = [];
  for (const child of node.children) {
    collectVisibleText(child, descendants);
  }
  return descendants;
}

function collectVisibleText(node: CanonicalNode, descendants: CanonicalNode[]): void {
  if (node.flags.isInvisible || node.flags.isZeroSize) return;
  if (node.canonicalType === "text" && (node.text?.content?.trim() ?? "").length > 0) {
    descendants.push(node);
  }
  for (const child of node.children) collectVisibleText(child, descendants);
}

function renderArb(manifest: I18nManifest): Record<string, unknown> {
  const arb: Record<string, unknown> = {
    "@@locale": manifest.locale
  };
  for (const message of manifest.messages) {
    arb[message.key] = message.value;
    arb[`@${message.key}`] = {
      description: message.description,
      sourceNodeId: message.sourceNodeId
    };
  }
  return arb;
}

function hasVisualShape(node: CanonicalNode): boolean {
  return node.style.fills.length > 0 || node.style.strokes.length > 0 || node.style.effects.length > 0;
}

function toI18nKey(input: string): string {
  const words = input
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  return words.length > 0 ? words.join("_") : "text";
}

function uniqueKey(base: string, used: Set<string>): string {
  let key = base;
  let index = 2;
  while (used.has(key)) {
    key = `${base}_${index}`;
    index += 1;
  }
  used.add(key);
  return key;
}

function fileBase(name: string, sourceNodeId: string): string {
  const slug = name
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toLowerCase();
  return slug || safeId(sourceNodeId);
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "_");
}
