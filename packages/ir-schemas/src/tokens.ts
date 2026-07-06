export type TokenUsage = "background" | "surface" | "text" | "border" | "icon" | "shadow" | "unknown";

export interface ColorToken {
  name: string;
  value: string;
  aliases: string[];
  usage: TokenUsage;
  confidence: number;
  usageCount: number;
  sourceNodeIds: string[];
}

export interface SpacingToken {
  name: string;
  value: number;
  aliases: number[];
  snapTolerance: number;
  confidence: number;
  usageCount: number;
  sourceNodeIds: string[];
}

export interface TypographyToken {
  name: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  letterSpacing: number;
  confidence: number;
  usageCount: number;
  sourceNodeIds: string[];
}

export interface RadiusToken {
  name: string;
  value: number;
  aliases: number[];
  confidence: number;
  usageCount: number;
  sourceNodeIds: string[];
}

export interface ShadowToken {
  name: string;
  value: unknown;
  confidence: number;
  usageCount: number;
  sourceNodeIds: string[];
}

export interface InferredTokens {
  version: string;
  colors: ColorToken[];
  spacing: SpacingToken[];
  typography: TypographyToken[];
  radii: RadiusToken[];
  shadows: ShadowToken[];
}

export interface TokenUsageMapEntry {
  tokenName: string;
  sourceNodeIds: string[];
}

export interface TokenUsageMap {
  colors: Record<string, TokenUsageMapEntry>;
  spacing: Record<string, TokenUsageMapEntry>;
  typography: Record<string, TokenUsageMapEntry>;
  radii: Record<string, TokenUsageMapEntry>;
}

export interface TokenConfidenceReport {
  warnings: Array<{
    type: string;
    message: string;
    sourceNodeIds?: string[];
    tokenName?: string;
    category?: "colors" | "spacing" | "typography" | "radii" | "shadows";
    confidence?: number;
  }>;
}

export interface TokenMiningResult {
  inferredTokens: InferredTokens;
  tokenUsageMap: TokenUsageMap;
  confidenceReport: TokenConfidenceReport;
  dartTokenFile: string;
}
