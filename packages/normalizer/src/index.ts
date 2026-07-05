import type {
  AssetManifest,
  AiDecisionReportArtifact,
  ComponentConfidenceReportArtifact,
  ComponentInstanceMapArtifact,
  I18nManifest,
  I18nKeySuggestionsArtifact,
  InferredComponentsArtifact,
  NamingMapArtifact,
  NormalizedDesignIR,
  NormalizedNode,
  NormalizationReportArtifact,
  OverrideSet,
  PipelineArtifacts,
  RawFigmaScene,
  Region,
  RenderStrategyManifestArtifact,
  SemanticIRArtifact,
  SemanticLabelsArtifact,
  UpliftDecisionArtifact,
  UpliftDiffReportArtifact
} from "@uxcompiler/ir-schemas";
import { normalizeAssetsAndI18n } from "@uxcompiler/asset-i18n-normalizer";
import { validateAiProtocolOutput, type AiProtocolDecision } from "@uxcompiler/ai-protocol";
import { generateFlutterFidelity } from "@uxcompiler/flutter-fidelity-renderer";
import { canonicalizeRawScene } from "@uxcompiler/scene-canonicalizer";
import { inferLayout } from "@uxcompiler/layout-inferencer";
import { mineTokens } from "@uxcompiler/token-miner";
import { generateReviewTasks } from "@uxcompiler/review-task-engine";
import { applyOverrides } from "@uxcompiler/override-engine";

export interface CompileRawSceneOptions {
  materializedAssetSourceNodeIds?: readonly string[];
  frameScreenshotAssetPath?: string;
  overrideSet?: OverrideSet;
  aiSemanticOutput?: unknown;
}

export function compileRawScene(rawFigmaScene: RawFigmaScene, options: CompileRawSceneOptions = {}): PipelineArtifacts {
  const canonicalResult = canonicalizeRawScene(rawFigmaScene);
  const tokenResult = mineTokens(canonicalResult.canonicalScene);
  const assetI18nResult = normalizeAssetsAndI18n(canonicalResult.canonicalScene);
  const fidelityResult = generateFlutterFidelity(canonicalResult.canonicalScene, {
    assetManifest: assetI18nResult.assetManifest,
    materializedAssetSourceNodeIds: options.materializedAssetSourceNodeIds,
    frameScreenshotAssetPath: options.frameScreenshotAssetPath
  });
  const layoutResult = inferLayout(canonicalResult.canonicalScene, tokenResult.inferredTokens);
  const overrideResult = applyOverrides({
    normalizedDesignIR: layoutResult.normalizedDesignIR,
    assetManifest: assetI18nResult.assetManifest,
    i18nManifest: assetI18nResult.i18nManifest,
    inferredTokens: tokenResult.inferredTokens,
    overrideSet: options.overrideSet
  });
  const inferredComponents = createInferredComponentsArtifact(layoutResult.normalizedDesignIR, assetI18nResult.i18nManifest);
  const componentInstanceMap = createComponentInstanceMapArtifact(inferredComponents, layoutResult.normalizedDesignIR);
  const componentConfidenceReport = createComponentConfidenceReportArtifact(inferredComponents);
  const fallbackSemanticLabels = createSemanticLabelsArtifact({
    normalizedDesignIR: layoutResult.normalizedDesignIR,
    regions: layoutResult.regions,
    assetManifest: assetI18nResult.assetManifest,
    i18nManifest: assetI18nResult.i18nManifest
  });
  const aiSemanticResult = applyAiSemanticOutput({
    fallbackSemanticLabels,
    aiSemanticOutput: options.aiSemanticOutput,
    regions: layoutResult.regions,
    normalizedDesignIR: layoutResult.normalizedDesignIR,
    assetManifest: assetI18nResult.assetManifest,
    i18nManifest: assetI18nResult.i18nManifest
  });
  const semanticLabels = aiSemanticResult.semanticLabels;
  const aiDecisionReport = aiSemanticResult.aiDecisionReport;
  const namingMap = createNamingMapArtifact(semanticLabels);
  const i18nKeySuggestions = createI18nKeySuggestionsArtifact(assetI18nResult.i18nManifest, semanticLabels);
  const semanticIR = createSemanticIRArtifact(layoutResult.normalizedDesignIR, inferredComponents, semanticLabels);
  const upliftDecisions = createUpliftDecisionArtifact({
    regions: layoutResult.regions,
    layoutDecisions: layoutResult.layoutDecisions,
    semanticLabels,
    inferredComponents,
    fidelityGenerationManifest: fidelityResult.fidelityGenerationManifest
  });
  const upliftDiffReport = createUpliftDiffReportArtifact();
  const reviewTaskResult = generateReviewTasks({
    normalizedDesignIR: overrideResult.reviewedNormalizedDesignIR,
    layoutCandidates: layoutResult.layoutCandidates,
    layoutDecisions: layoutResult.layoutDecisions,
    inferredTokens: overrideResult.reviewedInferredTokens,
    tokenConfidenceReport: tokenResult.confidenceReport,
    assetManifest: overrideResult.reviewedAssetManifest,
    i18nManifest: overrideResult.reviewedI18nManifest,
    fidelityGenerationManifest: fidelityResult.fidelityGenerationManifest,
    staleOverrideReport: overrideResult.staleOverrideReport,
    upliftDecisions
  });
  const normalizationReport = createNormalizationReportArtifact({
    rawFigmaScene,
    normalizedDesignIR: layoutResult.normalizedDesignIR,
    canonicalWarnings: canonicalResult.report.warnings,
    tokenWarnings: tokenResult.confidenceReport.warnings,
    assetWarnings: assetI18nResult.assetManifest.warnings,
    i18nWarnings: assetI18nResult.i18nManifest.warnings,
    reviewTasks: reviewTaskResult.reviewTasks
  });
  const renderStrategyManifest = createRenderStrategyManifestArtifact({
    rawFigmaScene,
    regions: layoutResult.regions,
    normalizedDesignIR: layoutResult.normalizedDesignIR,
    renderDecisions: fidelityResult.fidelityGenerationManifest.renderDecisions
  });

  return {
    rawFigmaScene,
    canonicalScene: canonicalResult.canonicalScene,
    canonicalizationReport: canonicalResult.report,
    nodeMapping: canonicalResult.nodeMapping,
    inferredTokens: tokenResult.inferredTokens,
    tokenUsageMap: tokenResult.tokenUsageMap,
    tokenConfidenceReport: tokenResult.confidenceReport,
    dartTokenFile: tokenResult.dartTokenFile,
    assetManifest: assetI18nResult.assetManifest,
    i18nManifest: assetI18nResult.i18nManifest,
    arbFile: assetI18nResult.arbFile,
    overrideSet: overrideResult.overrideSet,
    reviewedNormalizedDesignIR: overrideResult.reviewedNormalizedDesignIR,
    reviewedAssetManifest: overrideResult.reviewedAssetManifest,
    reviewedI18nManifest: overrideResult.reviewedI18nManifest,
    reviewedInferredTokens: overrideResult.reviewedInferredTokens,
    reviewedArbFile: overrideResult.reviewedArbFile,
    overrideConflictReport: overrideResult.overrideConflictReport,
    staleOverrideReport: overrideResult.staleOverrideReport,
    visualIR: fidelityResult.visualIR,
    fidelityGenerationManifest: fidelityResult.fidelityGenerationManifest,
    nodePixelMap: fidelityResult.nodePixelMap,
    reviewTasks: reviewTaskResult.reviewTasks,
    taskStatusReport: reviewTaskResult.taskStatusReport,
    flutterPreviewProject: fidelityResult.flutterPreviewProject,
    regions: layoutResult.regions,
    layoutCandidates: layoutResult.layoutCandidates,
    layoutDecisions: layoutResult.layoutDecisions,
    inferredComponents,
    componentInstanceMap,
    componentConfidenceReport,
    semanticLabels,
    aiDecisionReport,
    namingMap,
    i18nKeySuggestions,
    semanticIR,
    upliftDecisions,
    upliftDiffReport,
    normalizationReport,
    renderStrategyManifest,
    normalizedDesignIR: layoutResult.normalizedDesignIR
  };
}

function createInferredComponentsArtifact(normalizedDesignIR: NormalizedDesignIR, i18nManifest: I18nManifest): InferredComponentsArtifact {
  const carriedCandidates = Array.isArray(normalizedDesignIR.components) ? normalizedDesignIR.components : [];
  const minedCandidates = mineComponentCandidates(normalizedDesignIR.tree, i18nManifest);
  const candidates = [...carriedCandidates, ...minedCandidates];
  const confidence = candidates.length > 0 ? averageComponentConfidence(candidates) : normalizedDesignIR.confidence.components;
  return {
    version: "2.0",
    status: candidates.length > 0 ? "candidates_detected" : "no_reusable_components_detected",
    candidates,
    confidence,
    fallback: candidates.length > 0 ? undefined : "generate_separate_widgets"
  };
}

function mineComponentCandidates(normalizedRoot: NormalizedNode, i18nManifest: I18nManifest): Array<Record<string, unknown>> {
  const textBySourceNodeId = new Map(i18nManifest.messages.map((message) => [message.sourceNodeId, message.value]));
  const groups = new Map<string, Array<{ node: NormalizedNode; kind: ComponentKind; signature: string }>>();

  walkNormalized(normalizedRoot, (node) => {
    if (node.type === "page" || node.children.length === 0) return;
    const kind = classifyComponentKind(node);
    if (!kind) return;
    const signature = componentSignature(node, kind);
    const key = `${kind}:${signature}`;
    const group = groups.get(key) ?? [];
    group.push({ node, kind, signature });
    groups.set(key, group);
  });

  return [...groups.values()]
    .filter((group) => group.length >= 2)
    .map((group) => {
      const kind = group[0].kind;
      const instances = group.map((entry) => entry.node);
      const confidence = round(Math.min(0.94, 0.82 + Math.min(0.08, (instances.length - 2) * 0.03) + componentNameBoost(instances)));
      return {
        componentId: componentIdFor(kind, group[0].signature),
        name: componentNameFor(kind),
        kind,
        sourceInstances: instances.flatMap((node) => node.sourceNodeIds).filter(Boolean),
        props: componentPropsFor(kind, instances, textBySourceNodeId),
        layout: {
          type: instances[0].layout.type,
          gap: instances[0].layout.gap
        },
        confidence,
        similarity: confidence,
        evidence: [
          `${instances.length} matching ${kind} structures share signature ${group[0].signature}.`,
          "Reusable candidates require at least two instances."
        ],
        fallback: confidence < 0.9 ? "generate_separate_widgets_until_reviewed" : undefined
      };
    })
    .sort((left, right) => String(left.componentId).localeCompare(String(right.componentId)));
}

type ComponentKind = "Button" | "Card" | "ListItem";

function classifyComponentKind(node: NormalizedNode): ComponentKind | undefined {
  const name = node.name.toLowerCase();
  const textCount = descendantCount(node, "text");
  const hasSurface = node.children.some((child) => child.type === "rect" || child.type === "image");
  if (name.includes("button") && textCount >= 1 && hasSurface) return "Button";
  if (name.includes("card") && textCount >= 1 && hasSurface) return "Card";
  if ((name.includes("listitem") || name.includes("list item") || name.includes("item")) && node.layout.type === "row" && textCount >= 1) {
    return "ListItem";
  }
  return undefined;
}

function componentSignature(node: NormalizedNode, kind: ComponentKind): string {
  const childTypes = node.children.map((child) => componentChildType(child)).join("_");
  const textCount = descendantCount(node, "text");
  const assetCount = descendantCount(node, "image") + descendantCount(node, "vector");
  const surfaceCount = descendantCount(node, "rect");
  const widthBucket = Math.max(1, Math.round(node.bounds.w / 24));
  const heightBucket = Math.max(1, Math.round(node.bounds.h / 16));
  return lowerSnake(`${kind}_${node.layout.type}_${childTypes}_${textCount}t_${assetCount}a_${surfaceCount}s_${widthBucket}w_${heightBucket}h`);
}

function componentChildType(node: NormalizedNode): string {
  if (node.type === "text") return "text";
  if (node.type === "image" || node.type === "vector") return "asset";
  if (node.type === "rect") return "surface";
  if (descendantCount(node, "text") > 0) return "content";
  return node.type;
}

function componentPropsFor(
  kind: ComponentKind,
  instances: NormalizedNode[],
  textBySourceNodeId: Map<string, string>
): Array<Record<string, unknown>> {
  const textSlots = instances.map((node) => textDescendants(node));
  const maxSlots = Math.max(...textSlots.map((slots) => slots.length), 0);
  const props: Array<Record<string, unknown>> = [];
  for (let index = 0; index < maxSlots; index += 1) {
    const slotNodes = textSlots.map((slots) => slots[index]).filter((node): node is NormalizedNode => Boolean(node));
    const values = new Set(
      slotNodes
        .flatMap((node) => node.sourceNodeIds)
        .map((sourceNodeId) => textBySourceNodeId.get(sourceNodeId))
        .filter((value): value is string => Boolean(value))
    );
    if (kind === "Button" || values.size > 1) {
      props.push({
        name: textPropName(kind, index),
        type: "text",
        source: `text[${index}]`,
        sourceNodeIds: Array.from(new Set(slotNodes.flatMap((node) => node.sourceNodeIds))).sort()
      });
    }
  }
  return props;
}

function textPropName(kind: ComponentKind, index: number): string {
  if (kind === "Button") return index === 0 ? "label" : `label${index + 1}`;
  if (kind === "Card") return index === 0 ? "title" : index === 1 ? "subtitle" : `text${index + 1}`;
  return index === 0 ? "title" : `detail${index + 1}`;
}

function textDescendants(node: NormalizedNode): NormalizedNode[] {
  const nodes: NormalizedNode[] = [];
  walkNormalized(node, (candidate) => {
    if (candidate.type === "text") nodes.push(candidate);
  });
  return nodes;
}

function descendantCount(node: NormalizedNode, type: NormalizedNode["type"]): number {
  let count = 0;
  walkNormalized(node, (candidate) => {
    if (candidate !== node && candidate.type === type) count += 1;
  });
  return count;
}

function componentNameFor(kind: ComponentKind): string {
  if (kind === "Button") return "PrimaryButton";
  if (kind === "Card") return "ProductCard";
  return "ListItem";
}

function componentIdFor(kind: ComponentKind, signature: string): string {
  return lowerSnake(`${kind}_${signature}`).slice(0, 96);
}

function componentNameBoost(instances: NormalizedNode[]): number {
  return instances.every((node) => /button|card|item/i.test(node.name)) ? 0.04 : 0;
}

function averageComponentConfidence(candidates: unknown[]): number {
  const scores = candidates
    .map((candidate) => numberValue(recordValue(candidate)?.confidence))
    .filter((score): score is number => score !== undefined);
  return scores.length > 0 ? round(scores.reduce((sum, score) => sum + score, 0) / scores.length) : 0;
}

function createSemanticLabelsArtifact(input: {
  normalizedDesignIR: NormalizedDesignIR;
  regions: Region[];
  assetManifest: AssetManifest;
  i18nManifest: I18nManifest;
}): SemanticLabelsArtifact {
  const nodes: SemanticLabelsArtifact["nodes"] = [];
  walkNormalized(input.normalizedDesignIR.tree, (node) => {
    nodes.push({
      nodeId: node.id,
      sourceNodeIds: node.sourceNodeIds,
      suggestedName: lowerCamel(node.name || node.id),
      role: node.role ?? node.type,
      confidence: node.confidence,
      reason: "Deterministic semantic fallback derived from normalized node role, type, and source name."
    });
  });

  return {
    version: "2.0",
    source: "deterministic_fallback",
    status: "needs_ai_review",
    regions: input.regions.map((region) => ({
      regionId: region.id,
      suggestedName: region.name,
      role: region.role,
      sourceNodeIds: region.sourceNodeIds,
      confidence: 0.78,
      reason: "Region role inferred from vertical segmentation and frame position."
    })),
    nodes,
    assets: input.assetManifest.assets
      .filter((asset) => asset.strategy !== "real_text" && asset.strategy !== "ignored")
      .map((asset) => ({
        sourceNodeId: asset.sourceNodeId,
        suggestedName: asset.path ? fileStem(asset.path) : lowerSnake(asset.sourceName || asset.id),
        assetKind: asset.strategy,
        confidence: asset.confidence
      })),
    i18n: input.i18nManifest.messages.map((message) => ({
      sourceNodeId: message.sourceNodeId,
      text: message.value,
      suggestedKey: message.key,
      confidence: message.confidence
    })),
    warnings: [
      {
        type: "ai_labeling_not_run",
        message: "Semantic labels were generated by deterministic fallback rules; run AI semantic labeling before automatic semantic uplift."
      }
    ]
  };
}

function applyAiSemanticOutput(input: {
  fallbackSemanticLabels: SemanticLabelsArtifact;
  aiSemanticOutput?: unknown;
  regions: Region[];
  normalizedDesignIR: NormalizedDesignIR;
  assetManifest: AssetManifest;
  i18nManifest: I18nManifest;
}): { semanticLabels: SemanticLabelsArtifact; aiDecisionReport: AiDecisionReportArtifact } {
  if (input.aiSemanticOutput === undefined) {
    return {
      semanticLabels: input.fallbackSemanticLabels,
      aiDecisionReport: createAiDecisionReportArtifact()
    };
  }

  const allowedSourceIds = semanticAllowedSourceIds(input);
  const validation = validateAiProtocolOutput({
    output: input.aiSemanticOutput,
    allowedSourceIds
  });
  const acceptedDecisions = [...validation.accepted, ...validation.review];
  const semanticLabels: SemanticLabelsArtifact = {
    ...input.fallbackSemanticLabels,
    source: acceptedDecisions.length > 0 ? "ai" : input.fallbackSemanticLabels.source,
    status: validation.status === "accepted" ? "ready" : "needs_ai_review",
    regions: input.fallbackSemanticLabels.regions.map((region) => ({ ...region })),
    nodes: input.fallbackSemanticLabels.nodes.map((node) => ({ ...node, sourceNodeIds: [...node.sourceNodeIds] })),
    assets: input.fallbackSemanticLabels.assets.map((asset) => ({ ...asset })),
    i18n: input.fallbackSemanticLabels.i18n.map((message) => ({ ...message })),
    warnings: [
      ...input.fallbackSemanticLabels.warnings.filter((warning) => warning.type !== "ai_labeling_not_run"),
      ...validation.issues.map((issue) => ({
        type: `ai_${issue.code}`,
        message: `${issue.path}: ${issue.message}`
      })),
      ...validation.review.map((decision) => ({
        type: "ai_review_required",
        message: `${decision.sourceId} was applied but remains below auto-accept confidence.`
      })),
      ...validation.rejected.map((decision) => ({
        type: "ai_rejected",
        message: `${decision.sourceId} was rejected by the semantic AI gate.`
      }))
    ]
  };

  for (const decision of acceptedDecisions) applyAiSemanticDecision(semanticLabels, decision);

  return {
    semanticLabels,
    aiDecisionReport: {
      version: "2.0",
      status: validation.status,
      decisions: [...validation.accepted, ...validation.review, ...validation.rejected],
      accepted: validation.accepted,
      rejected: validation.rejected,
      warnings: [
        ...validation.issues.map((issue) => ({
          type: issue.code,
          message: `${issue.path}: ${issue.message}`
        })),
        ...validation.review.map((decision) => ({
          type: "review_required",
          message: `${decision.sourceId} applied with confidence ${decision.confidence}.`
        }))
      ]
    }
  };
}

function semanticAllowedSourceIds(input: {
  regions: Region[];
  normalizedDesignIR: NormalizedDesignIR;
  assetManifest: AssetManifest;
  i18nManifest: I18nManifest;
}): string[] {
  const ids = new Set<string>();
  for (const region of input.regions) {
    ids.add(region.id);
    for (const sourceNodeId of region.sourceNodeIds) ids.add(sourceNodeId);
  }
  walkNormalized(input.normalizedDesignIR.tree, (node) => {
    ids.add(node.id);
    for (const sourceNodeId of node.sourceNodeIds) ids.add(sourceNodeId);
  });
  for (const asset of input.assetManifest.assets) ids.add(asset.sourceNodeId);
  for (const message of input.i18nManifest.messages) ids.add(message.sourceNodeId);
  return [...ids].sort();
}

function applyAiSemanticDecision(semanticLabels: SemanticLabelsArtifact, decision: AiProtocolDecision): void {
  const suggestion = decision.suggestion;
  const suggestedName = stringValue(suggestion.suggestedName) ?? stringValue(suggestion.name) ?? stringValue(suggestion.selectedName);
  const role = stringValue(suggestion.role);
  const suggestedKey = stringValue(suggestion.suggestedKey) ?? stringValue(suggestion.key);
  const assetKind = stringValue(suggestion.assetKind) ?? stringValue(suggestion.kind);

  for (const region of semanticLabels.regions) {
    if (region.regionId !== decision.sourceId && !region.sourceNodeIds.includes(decision.sourceId)) continue;
    if (suggestedName) region.suggestedName = suggestedName;
    if (role) region.role = role;
    region.confidence = decision.confidence;
    region.reason = decision.reason;
  }

  for (const node of semanticLabels.nodes) {
    if (node.nodeId !== decision.sourceId && !node.sourceNodeIds.includes(decision.sourceId)) continue;
    if (suggestedName) node.suggestedName = lowerCamel(suggestedName);
    if (role) node.role = role;
    node.confidence = decision.confidence;
    node.reason = decision.reason;
  }

  for (const asset of semanticLabels.assets) {
    if (asset.sourceNodeId !== decision.sourceId) continue;
    if (suggestedName) asset.suggestedName = lowerSnake(suggestedName);
    if (assetKind) asset.assetKind = assetKind;
    asset.confidence = decision.confidence;
  }

  for (const message of semanticLabels.i18n) {
    if (message.sourceNodeId !== decision.sourceId) continue;
    if (suggestedKey) message.suggestedKey = lowerCamel(suggestedKey);
    message.confidence = decision.confidence;
  }
}

function createSemanticIRArtifact(
  normalizedDesignIR: NormalizedDesignIR,
  inferredComponents: InferredComponentsArtifact,
  semanticLabels: SemanticLabelsArtifact
): SemanticIRArtifact {
  return {
    version: "2.0",
    status: "fidelity_preserved",
    normalizedDesignIR,
    semanticLabels,
    inferredComponents,
    upliftDecisions: [],
    fallbackReason: "No diff-verified semantic uplift decisions have been accepted yet, so fidelity rendering remains authoritative."
  };
}

function createComponentInstanceMapArtifact(
  inferredComponents: InferredComponentsArtifact,
  normalizedDesignIR: NormalizedDesignIR
): ComponentInstanceMapArtifact {
  const components = inferredComponents.candidates.map((candidate, index) => {
    const record = recordValue(candidate);
    const componentId = stringValue(record?.componentId) ?? stringValue(record?.id) ?? `component_${index + 1}`;
    const instances = stringArrayValue(record?.sourceInstances) ?? stringArrayValue(record?.instances) ?? [];
    return {
      componentId,
      name: stringValue(record?.name),
      instances: instances.map((sourceNodeId) => ({ sourceNodeIds: [sourceNodeId] })),
      status: "candidate" as const
    };
  });
  const mappedSourceNodeIds = new Set(components.flatMap((component) => component.instances.flatMap((instance) => instance.sourceNodeIds)));
  return {
    version: "2.0",
    components,
    unmappedSourceNodeIds: collectNormalizedSourceNodeIds(normalizedDesignIR.tree).filter((sourceNodeId) => !mappedSourceNodeIds.has(sourceNodeId))
  };
}

function createComponentConfidenceReportArtifact(inferredComponents: InferredComponentsArtifact): ComponentConfidenceReportArtifact {
  const candidates = inferredComponents.candidates.map((candidate, index) => {
    const record = recordValue(candidate);
    const componentId = stringValue(record?.componentId) ?? stringValue(record?.id) ?? `component_${index + 1}`;
    const confidence = numberValue(record?.confidence) ?? numberValue(record?.similarity) ?? inferredComponents.confidence;
    const instanceCount = (stringArrayValue(record?.sourceInstances) ?? stringArrayValue(record?.instances) ?? []).length;
    return {
      componentId,
      name: stringValue(record?.name),
      confidence,
      instanceCount,
      gate: confidence >= 0.9 && instanceCount >= 2 ? "auto_reusable" as const : confidence >= 0.75 ? "needs_review" as const : "fallback" as const,
      reason:
        instanceCount >= 2
          ? "Component candidate was carried from normalized IR for Studio review."
          : "Reusable component promotion requires at least two stable source instances."
    };
  });
  return {
    version: "2.0",
    status: candidates.length > 0 ? "ready" : "no_candidates",
    candidates,
    warnings:
      candidates.length > 0
        ? []
        : [
            {
              type: "no_reusable_components_detected",
              message: "No repeated component structures met the conservative reusable-component threshold."
            }
          ]
  };
}

function createAiDecisionReportArtifact(): AiDecisionReportArtifact {
  return {
    version: "2.0",
    status: "not_run",
    decisions: [],
    accepted: [],
    rejected: [],
    warnings: [
      {
        type: "ai_adapter_not_configured",
        message: "No AI semantic labeling pass was run; deterministic naming artifacts are used instead."
      }
    ]
  };
}

function createNamingMapArtifact(semanticLabels: SemanticLabelsArtifact): NamingMapArtifact {
  const regions: Record<string, string> = {};
  const nodes: Record<string, string> = {};
  const assets: Record<string, string> = {};
  const i18n: Record<string, string> = {};
  for (const region of semanticLabels.regions) regions[region.regionId] = region.suggestedName;
  for (const node of semanticLabels.nodes) nodes[node.nodeId] = node.suggestedName;
  for (const asset of semanticLabels.assets) assets[asset.sourceNodeId] = asset.suggestedName;
  for (const message of semanticLabels.i18n) i18n[message.sourceNodeId] = message.suggestedKey;
  return {
    version: "2.0",
    regions,
    nodes,
    assets,
    i18n
  };
}

function createI18nKeySuggestionsArtifact(i18nManifest: I18nManifest, semanticLabels: SemanticLabelsArtifact): I18nKeySuggestionsArtifact {
  const labelsBySourceNodeId = new Map(semanticLabels.i18n.map((entry) => [entry.sourceNodeId, entry]));
  return {
    version: "2.0",
    locale: i18nManifest.locale,
    suggestions: i18nManifest.messages.map((message) => {
      const label = labelsBySourceNodeId.get(message.sourceNodeId);
      const confidence = label?.confidence ?? message.confidence;
      return {
        sourceNodeId: message.sourceNodeId,
        text: message.value,
        suggestedKey: label?.suggestedKey ?? message.key,
        confidence,
        status: confidence >= 0.8 ? "accepted_fallback" as const : "needs_review" as const
      };
    })
  };
}

function createUpliftDecisionArtifact(input: {
  regions: Region[];
  layoutDecisions: Array<{ sourceNodeIds: string[]; layout: string; confidence: number; fallback: string }>;
  semanticLabels: SemanticLabelsArtifact;
  inferredComponents: InferredComponentsArtifact;
  fidelityGenerationManifest: { warnings: Array<{ sourceNodeId?: string; type: string }>; renderDecisions: Array<{ sourceNodeId: string; strategy: string; editable: boolean }> };
}): UpliftDecisionArtifact {
  return {
    version: "2.0",
    decisions: input.regions.map((region) => {
      const semanticConfidence = regionSemanticConfidence(region, input.semanticLabels);
      const layout = regionLayoutSignal(region, input.layoutDecisions);
      const componentConfidence = regionComponentConfidence(region, input.inferredComponents);
      const expectedDiffSafety = regionDiffSafety(region, input.fidelityGenerationManifest);
      const confidence = round(
        semanticConfidence * 0.3 +
          layout.confidence * 0.25 +
          componentConfidence * 0.25 +
          expectedDiffSafety * 0.2
      );
      const gate = confidence >= 0.9 ? "auto_diff_required" as const : confidence >= 0.75 ? "review_diff_required" as const : "keep_fidelity" as const;
      const strategy = upliftStrategyFor(region, layout.layout);
      return {
        regionId: region.id,
        sourceNodeIds: region.sourceNodeIds,
        from: "absolute_widget",
        to: strategy === "keep_fidelity_region" ? "fidelity_region" : "semantic_layout",
        strategy,
        gate,
        scoreBreakdown: {
          semanticConfidence,
          layoutConfidence: layout.confidence,
          componentConfidence,
          expectedDiffSafety
        },
        confidence,
        accepted: false,
        reason:
          gate === "keep_fidelity"
            ? "Uplift score is below review threshold, so the fidelity region remains authoritative."
            : "Uplift candidate is scored but not accepted until before/after visual diff evidence passes."
      };
    })
  };
}

function regionSemanticConfidence(region: Region, semanticLabels: SemanticLabelsArtifact): number {
  const label = semanticLabels.regions.find((entry) => entry.regionId === region.id);
  if (label) return label.confidence;
  const nodeScores = semanticLabels.nodes
    .filter((node) => node.sourceNodeIds.some((sourceNodeId) => region.sourceNodeIds.includes(sourceNodeId)))
    .map((node) => node.confidence);
  return nodeScores.length > 0 ? average(nodeScores) : 0.5;
}

function regionLayoutSignal(
  region: Region,
  layoutDecisions: Array<{ sourceNodeIds: string[]; layout: string; confidence: number; fallback: string }>
): { layout: string; confidence: number } {
  const direct = layoutDecisions.find((decision) => decision.sourceNodeIds.some((sourceNodeId) => region.sourceNodeIds.includes(sourceNodeId)));
  if (direct && direct.layout !== "leaf") {
    return {
      layout: direct.layout,
      confidence: direct.confidence
    };
  }
  const leafScores = layoutDecisions
    .filter((decision) => decision.sourceNodeIds.some((sourceNodeId) => region.sourceNodeIds.includes(sourceNodeId)))
    .map((decision) => decision.confidence);
  if (leafScores.length > 1) return { layout: region.role === "footer" ? "row" : "column", confidence: Math.min(0.78, average(leafScores)) };
  return { layout: "absolute", confidence: 0.55 };
}

function regionComponentConfidence(region: Region, inferredComponents: InferredComponentsArtifact): number {
  const sourceNodeIds = new Set(region.sourceNodeIds);
  const scores = inferredComponents.candidates
    .map((candidate) => recordValue(candidate))
    .filter((candidate): candidate is Record<string, unknown> => Boolean(candidate))
    .filter((candidate) => stringArrayValue(candidate.sourceInstances)?.some((sourceNodeId) => sourceNodeIds.has(sourceNodeId)))
    .map((candidate) => numberValue(candidate.confidence) ?? numberValue(candidate.similarity) ?? 0.75);
  if (scores.length > 0) return Math.max(...scores);
  return inferredComponents.status === "no_reusable_components_detected" ? 0.7 : Math.max(0.65, inferredComponents.confidence);
}

function regionDiffSafety(
  region: Region,
  fidelityGenerationManifest: { warnings: Array<{ sourceNodeId?: string; type: string }>; renderDecisions: Array<{ sourceNodeId: string; strategy: string; editable: boolean }> }
): number {
  const sourceNodeIds = new Set(region.sourceNodeIds);
  const warnings = fidelityGenerationManifest.warnings.filter((warning) => warning.sourceNodeId && sourceNodeIds.has(warning.sourceNodeId));
  if (warnings.some((warning) => warning.type === "placeholder_asset" || warning.type === "frame_screenshot_fallback")) return 0.45;
  const decisions = fidelityGenerationManifest.renderDecisions.filter((decision) => sourceNodeIds.has(decision.sourceNodeId));
  if (decisions.length === 0) return 0.75;
  if (decisions.some((decision) => decision.editable === false)) return 0.55;
  if (decisions.every((decision) => decision.strategy === "real_text" || decision.strategy === "flutter_shape")) return 0.88;
  return 0.8;
}

function upliftStrategyFor(region: Region, layout: string): string {
  if (layout === "column") return "semantic_column_region";
  if (layout === "row") return "semantic_row_region";
  if (layout === "grid") return "semantic_grid_region";
  if (region.role === "footer") return "semantic_row_region";
  if (region.role === "header") return "semantic_column_region";
  return "keep_fidelity_region";
}

function createUpliftDiffReportArtifact(): UpliftDiffReportArtifact {
  return {
    version: "2.0",
    status: "not_run",
    comparisons: [],
    reason: "No semantic uplift replacement was attempted, so no uplift-specific diff comparison exists."
  };
}

function createNormalizationReportArtifact(input: {
  rawFigmaScene: RawFigmaScene;
  normalizedDesignIR: NormalizedDesignIR;
  canonicalWarnings: Array<{ sourceNodeId?: string; type: string; message: string }>;
  tokenWarnings: Array<{ sourceNodeIds?: string[]; type: string; message: string }>;
  assetWarnings: Array<{ sourceNodeId?: string; type: string; message: string }>;
  i18nWarnings: Array<{ sourceNodeId?: string; type: string; message: string }>;
  reviewTasks: Array<{ type: string; target?: { sourceNodeIds?: string[] }; description?: string; title?: string; evidence?: unknown }>;
}): NormalizationReportArtifact {
  const issues: NormalizationReportArtifact["issues"] = [
    ...input.canonicalWarnings.map((warning) => ({
      type: warning.type,
      sourceNodeIds: warning.sourceNodeId ? [warning.sourceNodeId] : [],
      message: warning.message,
      fallback: "canonical_fallback"
    })),
    ...input.tokenWarnings.map((warning) => ({
      type: warning.type,
      sourceNodeIds: warning.sourceNodeIds ?? [],
      message: warning.message,
      fallback: "token_review"
    })),
    ...input.assetWarnings.map((warning) => ({
      type: warning.type,
      sourceNodeIds: warning.sourceNodeId ? [warning.sourceNodeId] : [],
      message: warning.message,
      fallback: "asset_studio_review"
    })),
    ...input.i18nWarnings.map((warning) => ({
      type: warning.type,
      sourceNodeIds: warning.sourceNodeId ? [warning.sourceNodeId] : [],
      message: warning.message,
      fallback: "i18n_studio_review"
    })),
    ...input.normalizedDesignIR.fallbacks.map((fallback) => ({
      type: "layout_fallback",
      sourceNodeIds: [fallback.nodeId],
      message: fallback.reason,
      fallback: fallback.strategy
    })),
    ...input.reviewTasks.map((task) => ({
      type: task.type,
      sourceNodeIds: task.target?.sourceNodeIds ?? [],
      message: task.description ?? task.title ?? "Review task generated during normalization.",
      fallback: "review_task"
    }))
  ];
  const assetsScore = scoreFromWarnings(input.assetWarnings.length + input.i18nWarnings.length);
  return {
    version: "2.0",
    source: {
      fileKey: input.rawFigmaScene.source.fileKey,
      fileName: input.rawFigmaScene.source.fileName,
      frameNodeId: input.rawFigmaScene.source.frameNodeId
    },
    score: {
      overall: input.normalizedDesignIR.confidence.overall,
      tokens: input.normalizedDesignIR.confidence.tokens,
      layout: input.normalizedDesignIR.confidence.layout,
      components: input.normalizedDesignIR.confidence.components,
      assets: assetsScore
    },
    issues
  };
}

function createRenderStrategyManifestArtifact(input: {
  rawFigmaScene: RawFigmaScene;
  regions: Region[];
  normalizedDesignIR: NormalizedDesignIR;
  renderDecisions: Array<{ sourceNodeId: string; strategy: string; editable: boolean; reason: string }>;
}): RenderStrategyManifestArtifact {
  const decisions = new Map(input.renderDecisions.map((decision) => [decision.sourceNodeId, decision]));
  return {
    version: "2.0",
    page: input.rawFigmaScene.root.name || "Page",
    viewport: input.normalizedDesignIR.source.viewport,
    regions: input.regions.map((region) => {
      const regionDecision = region.sourceNodeIds.map((sourceNodeId) => decisions.get(sourceNodeId)).find(Boolean);
      return {
        regionId: region.id,
        sourceNodeIds: region.sourceNodeIds,
        strategy: regionDecision?.strategy ?? "absolute_widget",
        reason: regionDecision?.reason ?? "Region currently renders through the fidelity renderer baseline.",
        editable: regionDecision?.editable ?? true,
        confidence: 0.78
      };
    })
  };
}

function walkNormalized(node: NormalizedNode, visit: (node: NormalizedNode) => void): void {
  visit(node);
  for (const child of node.children) walkNormalized(child, visit);
}

function collectNormalizedSourceNodeIds(root: NormalizedNode): string[] {
  const ids: string[] = [];
  walkNormalized(root, (node) => {
    ids.push(...node.sourceNodeIds);
  });
  return Array.from(new Set(ids)).sort();
}

function scoreFromWarnings(count: number): number {
  return Math.max(0, round(1 - Math.min(0.5, count * 0.05)));
}

function average(values: number[]): number {
  return values.length > 0 ? round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArrayValue(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  return values.length > 0 ? values : undefined;
}

function lowerCamel(value: string): string {
  const words = wordsFrom(value);
  if (words.length === 0) return "node";
  return words
    .map((word, index) => (index === 0 ? word.toLowerCase() : `${word[0].toUpperCase()}${word.slice(1).toLowerCase()}`))
    .join("");
}

function lowerSnake(value: string): string {
  const words = wordsFrom(value);
  return words.length > 0 ? words.map((word) => word.toLowerCase()).join("_") : "asset";
}

function fileStem(path: string): string {
  const name = path.split("/").pop() ?? path;
  return lowerSnake(name.replace(/\.[^.]+$/, ""));
}

function wordsFrom(value: string): string[] {
  return value
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}
