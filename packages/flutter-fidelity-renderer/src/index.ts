import type {
  AssetManifest,
  AssetManifestEntry,
  CanonicalNode,
  CanonicalScene,
  FidelityGenerationManifest,
  FidelityRenderDecision,
  FlutterFidelityResult,
  FlutterPreviewProject,
  NodePixelMapEntry,
  RawEffect,
  RawPaint,
  VisualIR,
  VisualNode,
  VisualImageNode,
  VisualPositionedNode,
  VisualRectNode,
  VisualShadow,
  VisualTextNode
} from "@uxcompiler/ir-schemas";

interface Renderable {
  node: CanonicalNode;
  visual: VisualNode;
  decision: FidelityRenderDecision;
}

export interface FlutterFidelityOptions {
  assetManifest?: AssetManifest;
  materializedAssetSourceNodeIds?: readonly string[];
  frameScreenshotAssetPath?: string;
}

export function generateFlutterFidelity(canonicalScene: CanonicalScene, options: FlutterFidelityOptions = {}): FlutterFidelityResult {
  if (options.frameScreenshotAssetPath) {
    return generateFrameScreenshotFidelity(canonicalScene, options.frameScreenshotAssetPath);
  }

  const renderables: Renderable[] = [];
  const decisions: FidelityRenderDecision[] = [];
  const warnings: FidelityGenerationManifest["warnings"] = [];
  const materializedAssetPaths = buildMaterializedAssetPathMap(options.assetManifest, options.materializedAssetSourceNodeIds);

  for (const child of canonicalScene.root.children) {
    collectRenderables(child, renderables, decisions, warnings, materializedAssetPaths);
  }

  const positionedChildren = renderables.map<VisualPositionedNode>(({ node, visual }) => ({
    type: "positioned",
    sourceNodeId: node.sourceNodeId,
    x: node.bounds.x,
    y: node.bounds.y,
    w: node.bounds.w,
    h: node.bounds.h,
    child: visual
  }));

  const visualIR: VisualIR = {
    version: "2.0",
    source: canonicalScene.source,
    root: {
      type: "scene",
      size: {
        w: canonicalScene.source.viewport.width,
        h: canonicalScene.source.viewport.height
      },
      children: positionedChildren
    }
  };

  const nodePixelMap = positionedChildren.map<NodePixelMapEntry>((node, index) => ({
    sourceNodeId: node.sourceNodeId,
    widgetPath: `UxcPreviewPage/Stack/Positioned_${index}`,
    bounds: { x: node.x, y: node.y, w: node.w, h: node.h }
  }));

  const flutterPreviewProject = renderFlutterPreviewProject(visualIR);
  const files = Object.keys(flutterPreviewProject.files).sort();

  return {
    visualIR,
    fidelityGenerationManifest: {
      version: "2.0",
      generatedAt: new Date().toISOString(),
      viewport: canonicalScene.source.viewport,
      files,
      renderDecisions: decisions,
      warnings
    },
    nodePixelMap,
    flutterPreviewProject
  };
}

function generateFrameScreenshotFidelity(canonicalScene: CanonicalScene, frameScreenshotAssetPath: string): FlutterFidelityResult {
  const frameNodeId = canonicalScene.root.sourceNodeId;
  const viewport = canonicalScene.source.viewport;
  const positionedFrame: VisualPositionedNode = {
    type: "positioned",
    sourceNodeId: frameNodeId,
    x: 0,
    y: 0,
    w: viewport.width,
    h: viewport.height,
    child: {
      type: "image",
      sourceNodeId: frameNodeId,
      w: viewport.width,
      h: viewport.height,
      mode: "asset",
      assetPath: frameScreenshotAssetPath
    }
  };
  const visualIR: VisualIR = {
    version: "2.0",
    source: canonicalScene.source,
    root: {
      type: "scene",
      size: {
        w: viewport.width,
        h: viewport.height
      },
      children: [positionedFrame]
    }
  };
  const coveredNodes = collectVisibleCoverageNodes(canonicalScene.root);
  const nodePixelMap = coveredNodes.map<NodePixelMapEntry>((node, index) => ({
    sourceNodeId: node.sourceNodeId,
    widgetPath: index === 0 ? "UxcPreviewPage/FrameScreenshot" : `UxcPreviewPage/FrameScreenshot/Covered_${index}`,
    bounds: node === canonicalScene.root ? { x: 0, y: 0, w: viewport.width, h: viewport.height } : node.bounds
  }));
  const decisions: FidelityRenderDecision[] = coveredNodes.map((node, index) =>
    index === 0
      ? {
          sourceNodeId: node.sourceNodeId,
          strategy: "frame_screenshot_asset",
          editable: false,
          reason: "Full-frame reference screenshot is rendered as a fidelity fallback asset."
        }
      : {
          sourceNodeId: node.sourceNodeId,
          strategy: "covered_by_frame_screenshot",
          editable: false,
          reason: "Node is visually covered by the full-frame screenshot fidelity fallback."
        }
  );
  const warnings: FidelityGenerationManifest["warnings"] = [
    {
      sourceNodeId: frameNodeId,
      type: "frame_screenshot_fallback",
      message: "The preview uses the exported Figma frame screenshot as an exact non-editable fidelity fallback."
    }
  ];
  const flutterPreviewProject = renderFlutterPreviewProject(visualIR);
  const files = Object.keys(flutterPreviewProject.files).sort();

  return {
    visualIR,
    fidelityGenerationManifest: {
      version: "2.0",
      generatedAt: new Date().toISOString(),
      viewport,
      files,
      renderDecisions: decisions,
      warnings
    },
    nodePixelMap,
    flutterPreviewProject
  };
}

function collectVisibleCoverageNodes(root: CanonicalNode): CanonicalNode[] {
  const nodes: CanonicalNode[] = [];
  const walkCoverage = (node: CanonicalNode): void => {
    if (node.flags.isInvisible || node.flags.isZeroSize) return;
    nodes.push(node);
    for (const child of node.children) walkCoverage(child);
  };
  walkCoverage(root);
  return nodes;
}

function collectRenderables(
  node: CanonicalNode,
  renderables: Renderable[],
  decisions: FidelityRenderDecision[],
  warnings: FidelityGenerationManifest["warnings"],
  materializedAssetPaths: ReadonlyMap<string, string>
): void {
  if (node.flags.isInvisible || node.flags.isZeroSize) {
    decisions.push({
      sourceNodeId: node.sourceNodeId,
      strategy: "ignored_wrapper",
      editable: false,
      reason: "Invisible or zero-size node is ignored in fidelity render."
    });
    return;
  }

  const visual = toVisualNode(node, warnings, materializedAssetPaths);
  if (visual) {
    const decision = decisionFor(node, visual);
    renderables.push({ node, visual, decision });
    decisions.push(decision);
  } else {
    decisions.push({
      sourceNodeId: node.sourceNodeId,
      strategy: "ignored_wrapper",
      editable: true,
      reason: "Wrapper/container has no direct visual paint; descendants are rendered independently."
    });
  }

  for (const child of node.children) {
    collectRenderables(child, renderables, decisions, warnings, materializedAssetPaths);
  }
}

function toVisualNode(
  node: CanonicalNode,
  warnings: FidelityGenerationManifest["warnings"],
  materializedAssetPaths: ReadonlyMap<string, string>
): VisualNode | undefined {
  if (node.canonicalType === "text") {
    return toVisualText(node);
  }

  if (node.canonicalType === "image" || node.flags.recommendAssetSlice) {
    const assetPath = materializedAssetPaths.get(node.sourceNodeId);
    if (assetPath) {
      return {
        type: "image",
        sourceNodeId: node.sourceNodeId,
        w: node.bounds.w,
        h: node.bounds.h,
        mode: "asset",
        assetPath
      };
    }
    warnings.push({
      sourceNodeId: node.sourceNodeId,
      type: "placeholder_asset",
      message: "No concrete exported asset is available yet; rendering a placeholder box in preview."
    });
    return {
      type: "image",
      sourceNodeId: node.sourceNodeId,
      w: node.bounds.w,
      h: node.bounds.h,
      mode: "placeholder"
    };
  }

  if (node.canonicalType === "rect" || node.canonicalType === "vector" || hasVisualPaint(node)) {
    return toVisualRect(node);
  }

  return undefined;
}

function decisionFor(node: CanonicalNode, visual: VisualNode): FidelityRenderDecision {
  if (visual.type === "text") {
    return {
      sourceNodeId: node.sourceNodeId,
      strategy: "real_text",
      editable: true,
      reason: "Text is rendered as Flutter Text for editability and i18n compatibility."
    };
  }
  if (visual.type === "image") {
    if (visual.mode === "asset") {
      return {
        sourceNodeId: node.sourceNodeId,
        strategy: "image_asset",
        editable: false,
        reason: "Exported bitmap asset is rendered with Flutter Image.asset for fidelity."
      };
    }
    return {
      sourceNodeId: node.sourceNodeId,
      strategy: "placeholder_asset",
      editable: false,
      reason: "Asset/slice export is not materialized yet, so preview uses a placeholder."
    };
  }
  return {
    sourceNodeId: node.sourceNodeId,
    strategy: "flutter_shape",
    editable: true,
    reason: "Visual shape is rendered as Flutter decoration."
  };
}

function toVisualText(node: CanonicalNode): VisualTextNode {
  const style = node.text?.style;
  const fontName = style?.fontName;
  const fontFamily =
    style?.fontFamily ??
    (typeof fontName === "object" && fontName?.family ? fontName.family : undefined) ??
    (typeof fontName === "string" ? fontName : undefined);
  const fontSize = numeric(style?.fontSize, 14);
  const lineHeight = numeric(style?.lineHeightPx, numeric(style?.lineHeight, fontSize * 1.2));
  return {
    type: "text",
    sourceNodeId: node.sourceNodeId,
    text: node.text?.content ?? "",
    w: node.bounds.w,
    h: node.bounds.h,
    color: firstPaintColor(node.style.fills) ?? "#111111",
    fontFamily,
    fontSize,
    fontWeight: numeric(style?.fontWeight, 400),
    lineHeight,
    letterSpacing: numeric(style?.letterSpacing, 0)
  };
}

function toVisualRect(node: CanonicalNode): VisualRectNode {
  return {
    type: "rect",
    sourceNodeId: node.sourceNodeId,
    w: node.bounds.w,
    h: node.bounds.h,
    fill: firstPaintColor(node.style.fills),
    stroke: firstPaintColor(node.style.strokes),
    strokeWidth: node.style.strokes.length > 0 ? 1 : undefined,
    radius: node.style.cornerRadius,
    opacity: node.style.opacity,
    shadow: node.style.effects.map(toVisualShadow).filter((shadow): shadow is VisualShadow => !!shadow)
  };
}

function hasVisualPaint(node: CanonicalNode): boolean {
  return node.style.fills.length > 0 || node.style.strokes.length > 0 || node.style.effects.length > 0;
}

function firstPaintColor(paints: RawPaint[]): string | undefined {
  const paint = paints.find((candidate) => candidate.visible !== false && candidate.type !== "NONE" && candidate.color);
  return paint?.color ? colorToHex(paint.color) : undefined;
}

function toVisualShadow(effect: RawEffect): VisualShadow | undefined {
  if (effect.visible === false || effect.type !== "DROP_SHADOW" || !effect.color) return undefined;
  return {
    color: colorToHex(effect.color, effect.color.a),
    blur: effect.radius ?? 0,
    offsetX: effect.offset?.x ?? 0,
    offsetY: effect.offset?.y ?? 0
  };
}

function renderFlutterPreviewProject(visualIR: VisualIR): FlutterPreviewProject {
  const assetPaths = collectVisualAssetPaths(visualIR);
  return {
    files: {
      "pubspec.yaml": renderPubspec(assetPaths),
      "analysis_options.yaml": renderAnalysisOptions(),
      "lib/main.dart": renderMainDart(),
      "lib/generated/fidelity/preview_page.dart": renderPreviewPage(visualIR),
      "test/preview_test.dart": renderPreviewTest(),
      "test/golden_preview_test.dart": renderGoldenPreviewTest(visualIR)
    }
  };
}

function renderPubspec(assetPaths: readonly string[]): string {
  const lines = [
    "name: uxc_preview",
    "description: Generated UXCompiler Flutter fidelity preview.",
    "publish_to: none",
    "version: 0.1.0+1",
    "",
    "environment:",
    "  sdk: ^3.8.0",
    "",
    "dependencies:",
    "  flutter:",
    "    sdk: flutter",
    "",
    "dev_dependencies:",
    "  flutter_test:",
    "    sdk: flutter",
    "",
    "flutter:",
    "  uses-material-design: true"
  ];
  if (assetPaths.length > 0) {
    lines.push("  assets:", ...assetPaths.map((assetPath) => `    - ${assetPath}`));
  }
  lines.push("");
  return lines.join("\n");
}

function renderPreviewTest(): string {
  return [
    "import 'package:flutter_test/flutter_test.dart';",
    "import 'package:uxc_preview/main.dart';",
    "",
    "void main() {",
    "  testWidgets('renders generated fidelity preview', (tester) async {",
    "    await tester.pumpWidget(const UxcPreviewApp());",
    "    expect(find.byType(UxcPreviewApp), findsOneWidget);",
    "  });",
    "}",
    ""
  ].join("\n");
}

function renderGoldenPreviewTest(visualIR: VisualIR): string {
  const lines = [
    "import 'package:flutter/material.dart';",
    "import 'package:flutter_test/flutter_test.dart';",
    "import 'package:uxc_preview/generated/fidelity/preview_page.dart';",
    "",
    "void main() {",
    "  testWidgets('captures generated fidelity preview golden', (tester) async {",
    `    await tester.binding.setSurfaceSize(const Size(${dartNumber(visualIR.root.size.w)}, ${dartNumber(visualIR.root.size.h)}));`,
    "    addTearDown(() async {",
    "      await tester.binding.setSurfaceSize(null);",
    "    });",
    "    await tester.pumpWidget(const MaterialApp(home: UxcPreviewPage()));",
    "    await tester.runAsync(() async {",
    "      await Future<void>.delayed(const Duration(seconds: 2));",
    "    });",
    "    await tester.pump();",
    "    await expectLater(",
    "      find.byType(UxcPreviewPage),",
    "      matchesGoldenFile('goldens/flutter_preview.png'),",
    "    );",
    "  });",
    "}",
    ""
  ];
  return lines.join("\n");
}

function renderAnalysisOptions(): string {
  return ["analyzer:", "  errors:", "    unused_import: warning", ""].join("\n");
}

function renderMainDart(): string {
  return [
    "import 'package:flutter/material.dart';",
    "",
    "import 'generated/fidelity/preview_page.dart';",
    "",
    "void main() {",
    "  runApp(const UxcPreviewApp());",
    "}",
    "",
    "class UxcPreviewApp extends StatelessWidget {",
    "  const UxcPreviewApp({super.key});",
    "",
    "  @override",
    "  Widget build(BuildContext context) {",
    "    return const MaterialApp(",
    "      debugShowCheckedModeBanner: false,",
    "      home: UxcPreviewPage(),",
    "    );",
    "  }",
    "}",
    ""
  ].join("\n");
}

function renderPreviewPage(visualIR: VisualIR): string {
  const children = visualIR.root.children.map((child, index) => renderVisualNode(child, `node_${index}`, 3)).join(",\n");
  return [
    "import 'package:flutter/material.dart';",
    "",
    "class UxcPreviewPage extends StatelessWidget {",
    "  const UxcPreviewPage({super.key});",
    "",
    "  @override",
    "  Widget build(BuildContext context) {",
    "    return Scaffold(",
    "      backgroundColor: Colors.white,",
    "      body: Center(",
    "        child: SizedBox(",
    `          width: ${dartNumber(visualIR.root.size.w)},`,
    `          height: ${dartNumber(visualIR.root.size.h)},`,
    "          child: Stack(",
    "            clipBehavior: Clip.none,",
    "            children: [",
    children,
    "            ],",
    "          ),",
    "        ),",
    "      ),",
    "    );",
    "  }",
    "}",
    ""
  ].join("\n");
}

function renderVisualNode(node: VisualNode, key: string, indentLevel: number): string {
  const indent = "  ".repeat(indentLevel);
  switch (node.type) {
    case "positioned":
      return [
        `${indent}Positioned(`,
        `${indent}  left: ${dartNumber(node.x)},`,
        `${indent}  top: ${dartNumber(node.y)},`,
        `${indent}  width: ${dartNumber(node.w)},`,
        `${indent}  height: ${dartNumber(node.h)},`,
        `${indent}  child: ${renderVisualNode(node.child, key, indentLevel + 1).trimStart()}`,
        `${indent})`
      ].join("\n");
    case "rect":
      return renderRect(node, indentLevel);
    case "text":
      return renderText(node, indentLevel);
    case "image":
      return renderImage(node, indentLevel);
    case "stack":
      return [
        `${indent}Stack(`,
        `${indent}  clipBehavior: Clip.none,`,
        `${indent}  children: [`,
        node.children.map((child, index) => renderVisualNode(child, `${key}_${index}`, indentLevel + 2)).join(",\n"),
        `${indent}  ],`,
        `${indent})`
      ].join("\n");
    case "scene":
      return "const SizedBox.shrink()";
  }
}

function renderImage(node: VisualImageNode, indentLevel: number): string {
  if (node.mode === "asset" && node.assetPath) {
    const indent = "  ".repeat(indentLevel);
    return [
      `${indent}Image.asset(`,
      `${indent}  ${dartString(node.assetPath)},`,
      `${indent}  fit: BoxFit.fill,`,
      `${indent}  width: ${dartNumber(node.w)},`,
      `${indent}  height: ${dartNumber(node.h)},`,
      `${indent})`
    ].join("\n");
  }
  return renderImagePlaceholder(indentLevel);
}

function renderRect(node: VisualRectNode, indentLevel: number): string {
  const indent = "  ".repeat(indentLevel);
  const decorationParts = [
    node.fill ? `color: ${dartColor(node.fill)}` : undefined,
    node.stroke ? `border: Border.all(color: ${dartColor(node.stroke)}, width: ${dartNumber(node.strokeWidth ?? 1)})` : undefined,
    node.radius ? `borderRadius: BorderRadius.all(Radius.circular(${dartNumber(node.radius)}))` : undefined,
    node.shadow && node.shadow.length > 0 ? `boxShadow: [${node.shadow.map(renderShadow).join(", ")}]` : undefined
  ].filter(Boolean);
  return [
    `${indent}DecoratedBox(`,
    `${indent}  decoration: BoxDecoration(${decorationParts.join(", ")}),`,
    `${indent})`
  ].join("\n");
}

function renderText(node: VisualTextNode, indentLevel: number): string {
  const indent = "  ".repeat(indentLevel);
  const styleParts = [
    node.color ? `color: ${dartColor(node.color)}` : undefined,
    node.fontFamily ? `fontFamily: ${dartString(node.fontFamily)}` : undefined,
    node.fontSize ? `fontSize: ${dartNumber(node.fontSize)}` : undefined,
    node.fontWeight ? `fontWeight: FontWeight.w${nearestFontWeight(node.fontWeight)}` : undefined,
    node.lineHeight && node.fontSize ? `height: ${dartNumber(node.lineHeight / node.fontSize)}` : undefined,
    node.letterSpacing ? `letterSpacing: ${dartNumber(node.letterSpacing)}` : undefined
  ].filter(Boolean);
  return [
    `${indent}Text(`,
    `${indent}  ${dartString(node.text)},`,
    `${indent}  maxLines: 2,`,
    `${indent}  overflow: TextOverflow.visible,`,
    `${indent}  style: TextStyle(${styleParts.join(", ")}),`,
    `${indent})`
  ].join("\n");
}

function renderImagePlaceholder(indentLevel: number): string {
  const indent = "  ".repeat(indentLevel);
  return [
    `${indent}DecoratedBox(`,
    `${indent}  decoration: BoxDecoration(`,
    `${indent}    color: const Color(0xFFE5E7EB),`,
    `${indent}    border: Border.all(color: const Color(0xFF9CA3AF)),`,
    `${indent}  ),`,
    `${indent}  child: const Center(`,
    `${indent}    child: Icon(Icons.image_outlined, color: Color(0xFF6B7280)),`,
    `${indent}  ),`,
    `${indent})`
  ].join("\n");
}

function buildMaterializedAssetPathMap(
  assetManifest: AssetManifest | undefined,
  materializedAssetSourceNodeIds: readonly string[] | undefined
): Map<string, string> {
  if (!assetManifest || !materializedAssetSourceNodeIds || materializedAssetSourceNodeIds.length === 0) {
    return new Map();
  }
  const materialized = new Set(materializedAssetSourceNodeIds);
  const paths = new Map<string, string>();
  for (const asset of assetManifest.assets) {
    if (isRenderableAsset(asset) && materialized.has(asset.sourceNodeId) && asset.path) {
      paths.set(asset.sourceNodeId, asset.path);
    }
  }
  return paths;
}

function isRenderableAsset(asset: AssetManifestEntry): boolean {
  return asset.strategy === "image_asset" || asset.strategy === "decorative_slice";
}

function collectVisualAssetPaths(visualIR: VisualIR): string[] {
  const paths = new Set<string>();
  const walk = (node: VisualNode): void => {
    if (node.type === "image" && node.mode === "asset" && node.assetPath) paths.add(node.assetPath);
    if (node.type === "positioned") walk(node.child);
    if (node.type === "stack" || node.type === "scene") {
      for (const child of node.children) walk(child);
    }
  };
  walk(visualIR.root);
  return Array.from(paths).sort();
}

function renderShadow(shadow: VisualShadow): string {
  return `BoxShadow(color: ${dartColor(shadow.color)}, blurRadius: ${dartNumber(shadow.blur)}, offset: Offset(${dartNumber(
    shadow.offsetX
  )}, ${dartNumber(shadow.offsetY)}))`;
}

function colorToHex(color: { r: number; g: number; b: number; a?: number }, alpha?: number): string {
  const channels = [alpha ?? color.a ?? 1, color.r, color.g, color.b].map((channel, index) => {
    const normalized = index === 0 || channel <= 1 ? channel * 255 : channel;
    return Math.max(0, Math.min(255, Math.round(normalized))).toString(16).padStart(2, "0");
  });
  return `#${channels.join("")}`.toUpperCase();
}

function dartColor(hex: string): string {
  const clean = hex.replace("#", "");
  const value = clean.length === 6 ? `FF${clean}` : clean;
  return `const Color(0x${value.toUpperCase()})`;
}

function dartString(value: string): string {
  return JSON.stringify(value);
}

function dartNumber(value: number): string {
  if (Number.isInteger(value)) return `${value}.0`;
  return `${Math.round(value * 10000) / 10000}`;
}

function nearestFontWeight(value: number): number {
  const weights = [100, 200, 300, 400, 500, 600, 700, 800, 900];
  return weights.reduce((best, candidate) => (Math.abs(candidate - value) < Math.abs(best - value) ? candidate : best), 400);
}

function numeric(value: unknown, fallback: number): number {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "value" in value && typeof value.value === "number") {
    return value.value;
  }
  return fallback;
}
