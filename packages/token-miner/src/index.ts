import type {
  CanonicalNode,
  CanonicalScene,
  ColorToken,
  InferredTokens,
  RadiusToken,
  RawPaint,
  ShadowToken,
  SpacingToken,
  TokenConfidenceReport,
  TokenMiningResult,
  TokenUsage,
  TypographyToken
} from "@uxcompiler/ir-schemas";

interface ColorSample {
  value: string;
  usage: TokenUsage;
  sourceNodeId: string;
}

interface NumberSample {
  value: number;
  sourceNodeId: string;
}

interface TypographySample {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
  sourceNodeId: string;
}

export function mineTokens(canonicalScene: CanonicalScene): TokenMiningResult {
  const colorSamples: ColorSample[] = [];
  const spacingSamples: NumberSample[] = [];
  const radiusSamples: NumberSample[] = [];
  const typographySamples: TypographySample[] = [];

  walk(canonicalScene.root, (node) => {
    if (node.flags.isInvisible) return;

    const fillUsage = node.canonicalType === "text" ? "text" : node.canonicalType === "vector" ? "icon" : "surface";
    for (const paint of node.style.fills) {
      const color = paintToHex(paint);
      if (color) colorSamples.push({ value: color, usage: fillUsage, sourceNodeId: node.sourceNodeId });
    }
    for (const paint of node.style.strokes) {
      const color = paintToHex(paint);
      if (color) colorSamples.push({ value: color, usage: "border", sourceNodeId: node.sourceNodeId });
    }
    for (const effect of node.style.effects) {
      const color = effect.color ? colorToHex(effect.color) : undefined;
      if (color) colorSamples.push({ value: color, usage: "shadow", sourceNodeId: node.sourceNodeId });
    }

    const radiusValues = [
      node.style.cornerRadius,
      ...(Array.isArray(node.style.rectangleCornerRadii) ? node.style.rectangleCornerRadii : [])
    ].filter((value): value is number => typeof value === "number" && value > 0);
    for (const radius of radiusValues) {
      radiusSamples.push({ value: radius, sourceNodeId: node.sourceNodeId });
    }

    const typography = typographySampleFromNode(node);
    if (typography) typographySamples.push(typography);

    collectSpacingFromChildren(node, spacingSamples);
  });

  const colors = clusterColors(colorSamples);
  const spacing = clusterNumbers(spacingSamples, "space").map<SpacingToken>((token) => ({
    ...token,
    snapTolerance: 1
  }));
  const radii = clusterNumbers(radiusSamples, "radius").map<RadiusToken>((token) => token);
  const typography = clusterTypography(typographySamples);

  const inferredTokens: InferredTokens = {
    version: "2.0",
    colors,
    spacing,
    typography,
    radii,
    shadows: []
  };

  return {
    inferredTokens,
    tokenUsageMap: {
      colors: buildValueMap(colors),
      spacing: buildNumberMap(spacing),
      typography: buildTypographyMap(typography),
      radii: buildNumberMap(radii)
    },
    confidenceReport: {
      warnings: buildWarnings(inferredTokens, colorSamples, spacingSamples, typographySamples)
    },
    dartTokenFile: renderDartTokens(inferredTokens)
  };
}

function walk(node: CanonicalNode, visit: (node: CanonicalNode) => void): void {
  visit(node);
  for (const child of node.children) walk(child, visit);
}

function collectSpacingFromChildren(node: CanonicalNode, samples: NumberSample[]): void {
  const visibleChildren = node.children.filter((child) => !child.flags.isInvisible && !child.flags.isZeroSize);
  if (visibleChildren.length === 0) return;

  const minX = Math.min(...visibleChildren.map((child) => child.bounds.x));
  const minY = Math.min(...visibleChildren.map((child) => child.bounds.y));
  const maxX = Math.max(...visibleChildren.map((child) => child.bounds.x + child.bounds.w));
  const maxY = Math.max(...visibleChildren.map((child) => child.bounds.y + child.bounds.h));
  for (const value of [minX - node.bounds.x, minY - node.bounds.y, node.bounds.x + node.bounds.w - maxX, node.bounds.y + node.bounds.h - maxY]) {
    if (value > 0 && value < 256) samples.push({ value: round(value), sourceNodeId: node.sourceNodeId });
  }

  const byY = [...visibleChildren].sort((a, b) => a.bounds.y - b.bounds.y);
  for (let index = 1; index < byY.length; index += 1) {
    const previous = byY[index - 1];
    const current = byY[index];
    const gap = current.bounds.y - (previous.bounds.y + previous.bounds.h);
    if (gap > 0 && gap < 256) samples.push({ value: round(gap), sourceNodeId: current.sourceNodeId });
  }

  const byX = [...visibleChildren].sort((a, b) => a.bounds.x - b.bounds.x);
  for (let index = 1; index < byX.length; index += 1) {
    const previous = byX[index - 1];
    const current = byX[index];
    const gap = current.bounds.x - (previous.bounds.x + previous.bounds.w);
    if (gap > 0 && gap < 256) samples.push({ value: round(gap), sourceNodeId: current.sourceNodeId });
  }
}

function paintToHex(paint: RawPaint): string | undefined {
  if (!paint || paint.visible === false || paint.opacity === 0 || paint.type === "NONE") return undefined;
  return paint.color ? colorToHex(paint.color) : undefined;
}

function colorToHex(color: { r: number; g: number; b: number }): string {
  const channels = [color.r, color.g, color.b].map((channel) => {
    const normalized = channel <= 1 ? channel * 255 : channel;
    return Math.max(0, Math.min(255, Math.round(normalized))).toString(16).padStart(2, "0");
  });
  return `#${channels.join("")}`.toUpperCase();
}

function typographySampleFromNode(node: CanonicalNode): TypographySample | undefined {
  if (node.canonicalType !== "text" || !node.text?.style) return undefined;
  const style = node.text.style;
  const fontName = style.fontName;
  const fontFamily =
    style.fontFamily ??
    (typeof fontName === "object" && fontName?.family ? fontName.family : undefined) ??
    (typeof fontName === "string" ? fontName : "System");
  const fontSize = numeric(style.fontSize, 14);
  const fontWeight = numeric(style.fontWeight, 400);
  const lineHeight = numeric(style.lineHeightPx, numeric(style.lineHeight, fontSize * 1.2));
  const letterSpacing = numeric(style.letterSpacing, 0);
  return {
    fontFamily,
    fontSize,
    fontWeight,
    lineHeight,
    letterSpacing,
    sourceNodeId: node.sourceNodeId
  };
}

function numeric(value: unknown, fallback: number): number {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "value" in value && typeof value.value === "number") {
    return value.value;
  }
  return fallback;
}

function clusterColors(samples: ColorSample[]): ColorToken[] {
  const groups = new Map<string, ColorSample[]>();
  for (const sample of samples) {
    const key = `${sample.usage}:${sample.value}`;
    groups.set(key, [...(groups.get(key) ?? []), sample]);
  }
  return [...groups.entries()]
    .map(([key, group]) => {
      const [usage, value] = key.split(":") as [TokenUsage, string];
      const name = colorTokenName(usage, value);
      return {
        name,
        value,
        aliases: [value],
        usage,
        confidence: group.length >= 2 ? 0.92 : 0.78,
        usageCount: group.length,
        sourceNodeIds: unique(group.map((sample) => sample.sourceNodeId))
      };
    })
    .sort((a, b) => b.usageCount - a.usageCount || a.name.localeCompare(b.name));
}

function clusterNumbers<TPrefix extends "space" | "radius">(
  samples: NumberSample[],
  prefix: TPrefix
): Array<{
  name: string;
  value: number;
  aliases: number[];
  confidence: number;
  usageCount: number;
  sourceNodeIds: string[];
}> {
  const common = [0, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 56, 64, 80, 96, 120];
  const groups = new Map<number, NumberSample[]>();
  for (const sample of samples) {
    const snapped = common.find((value) => Math.abs(value - sample.value) <= 1.5) ?? Math.round(sample.value);
    groups.set(snapped, [...(groups.get(snapped) ?? []), sample]);
  }

  return [...groups.entries()]
    .filter(([value]) => value > 0)
    .map(([value, group]) => ({
      name: `${prefix}_${value}`,
      value,
      aliases: unique(group.map((sample) => sample.value)).sort((a, b) => a - b),
      confidence: group.length >= 2 ? 0.9 : 0.72,
      usageCount: group.length,
      sourceNodeIds: unique(group.map((sample) => sample.sourceNodeId))
    }))
    .sort((a, b) => a.value - b.value);
}

function clusterTypography(samples: TypographySample[]): TypographyToken[] {
  const groups = new Map<string, TypographySample[]>();
  for (const sample of samples) {
    const key = [
      sample.fontFamily,
      sample.fontSize,
      sample.fontWeight,
      sample.lineHeight,
      sample.letterSpacing
    ].join("|");
    groups.set(key, [...(groups.get(key) ?? []), sample]);
  }

  return [...groups.values()]
    .map((group) => {
      const sample = group[0];
      return {
        name: typographyName(sample),
        fontFamily: sample.fontFamily,
        fontSize: sample.fontSize,
        fontWeight: sample.fontWeight,
        lineHeight: sample.lineHeight,
        letterSpacing: sample.letterSpacing,
        confidence: group.length >= 2 ? 0.9 : 0.78,
        usageCount: group.length,
        sourceNodeIds: unique(group.map((item) => item.sourceNodeId))
      };
    })
    .sort((a, b) => b.fontSize - a.fontSize || b.fontWeight - a.fontWeight);
}

function colorTokenName(usage: TokenUsage, value: string): string {
  if (value === "#FFFFFF" && usage !== "text") return `color_${usage}_default`;
  if (["#000000", "#111111", "#101010", "#121212"].includes(value) && usage === "text") return "color_text_primary";
  return `color_${usage}_${value.slice(1).toLowerCase()}`;
}

function typographyName(sample: TypographySample): string {
  if (sample.fontSize >= 28) return "text_display";
  if (sample.fontSize >= 22 && sample.fontWeight >= 600) return "text_title_large";
  if (sample.fontSize >= 18 && sample.fontWeight >= 600) return "text_title_medium";
  if (sample.fontSize <= 13) return "text_label_small";
  return "text_body_medium";
}

function buildValueMap(tokens: Array<{ aliases: string[]; name: string; sourceNodeIds: string[] }>): TokenMiningResult["tokenUsageMap"]["colors"] {
  return Object.fromEntries(
    tokens.flatMap((token) =>
      token.aliases.map((alias) => [
        alias,
        {
          tokenName: token.name,
          sourceNodeIds: token.sourceNodeIds
        }
      ])
    )
  );
}

function buildNumberMap(
  tokens: Array<{ aliases: number[]; name: string; sourceNodeIds: string[] }>
): TokenMiningResult["tokenUsageMap"]["spacing"] {
  return Object.fromEntries(
    tokens.flatMap((token) =>
      token.aliases.map((alias) => [
        String(alias),
        {
          tokenName: token.name,
          sourceNodeIds: token.sourceNodeIds
        }
      ])
    )
  );
}

function buildTypographyMap(tokens: TypographyToken[]): TokenMiningResult["tokenUsageMap"]["typography"] {
  return Object.fromEntries(
    tokens.map((token) => [
      [token.fontFamily, token.fontSize, token.fontWeight, token.lineHeight, token.letterSpacing].join("|"),
      {
        tokenName: token.name,
        sourceNodeIds: token.sourceNodeIds
      }
    ])
  );
}

function buildWarnings(
  inferredTokens: InferredTokens,
  colorSamples: ColorSample[],
  spacingSamples: NumberSample[],
  typographySamples: TypographySample[]
): TokenConfidenceReport["warnings"] {
  const warnings: TokenConfidenceReport["warnings"] = [];
  if (colorSamples.length === 0) warnings.push({ type: "no_colors", message: "No color samples were discovered." });
  if (spacingSamples.length === 0) warnings.push({ type: "no_spacing", message: "No spacing samples were discovered." });
  if (typographySamples.length === 0) warnings.push({ type: "no_typography", message: "No text style samples were discovered." });
  warnings.push(...lowConfidenceWarnings("colors", inferredTokens.colors));
  warnings.push(...lowConfidenceWarnings("spacing", inferredTokens.spacing));
  warnings.push(...lowConfidenceWarnings("typography", inferredTokens.typography));
  warnings.push(...lowConfidenceWarnings("radii", inferredTokens.radii));
  warnings.push(...lowConfidenceWarnings("shadows", inferredTokens.shadows));
  return warnings;
}

function lowConfidenceWarnings(
  category: NonNullable<TokenConfidenceReport["warnings"][number]["category"]>,
  tokens: Array<ColorToken | SpacingToken | TypographyToken | RadiusToken | ShadowToken>
): TokenConfidenceReport["warnings"] {
  return tokens
    .filter((token) => token.confidence < 0.8)
    .map((token) => ({
      type: "low_confidence_token",
      tokenName: token.name,
      category,
      confidence: token.confidence,
      sourceNodeIds: token.sourceNodeIds,
      message: `${category} token ${token.name} has low confidence ${token.confidence}.`
    }));
}

function renderDartTokens(tokens: InferredTokens): string {
  const colorLines = tokens.colors.map((token) => {
    const value = token.value.replace("#", "0xFF");
    return `  static const ${toDartIdentifier(token.name)} = Color(${value});`;
  });
  const spacingLines = tokens.spacing.map((token) => `  static const ${toDartIdentifier(token.name)} = ${token.value};`);
  const radiusLines = tokens.radii.map((token) => `  static const ${toDartIdentifier(token.name)} = ${token.value};`);
  return [
    "import 'package:flutter/widgets.dart';",
    "",
    "class UxcColors {",
    ...colorLines,
    "}",
    "",
    "class UxcSpacing {",
    ...spacingLines,
    "}",
    "",
    "class UxcRadii {",
    ...radiusLines,
    "}",
    ""
  ].join("\n");
}

function toDartIdentifier(name: string): string {
  return name.replace(/_([a-z0-9])/g, (_, char: string) => char.toUpperCase());
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
