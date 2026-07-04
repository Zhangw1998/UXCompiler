import { createHash } from "node:crypto";
import type {
  AssetManifest,
  CodegenAnalyzeSummary,
  CodegenArbPatch,
  CodegenAssetPlan,
  CodegenFilePatch,
  CodegenFilePlan,
  CodegenFormatSummary,
  CodegenGeneratedFile,
  CodegenGateIssue,
  CodegenGateStatus,
  CodegenMergeReport,
  CodegenPubspecPatch,
  CodegenReviewManifest,
  CodegenReviewResult,
  FidelityGenerationManifest,
  I18nManifest,
  IncrementalFileChange,
  IncrementalSyncReport,
  NodePixelMapEntry,
  NormalizedDesignIR,
  NormalizedNode,
  OverrideSet,
  ReviewTask,
  ReviewTaskStatusReport,
  StaleOverride,
  StaleOverrideReport,
  VisualDiffReport
} from "@uxcompiler/ir-schemas";

export interface CreateCodegenReviewInput {
  normalizedDesignIR: NormalizedDesignIR;
  assetManifest: AssetManifest;
  i18nManifest: I18nManifest;
  flutterPreviewFiles: Record<string, string>;
  existingProjectFiles?: Record<string, string>;
  existingArbFile?: Record<string, unknown>;
  existingPubspecAssets?: string[];
  previousManifest?: CodegenReviewManifest;
  reviewTasks?: ReviewTask[];
  taskStatusReport?: ReviewTaskStatusReport;
  visualDiffReport?: VisualDiffReport;
  fidelityGenerationManifest?: FidelityGenerationManifest;
  nodePixelMap?: NodePixelMapEntry[];
  overrideSet?: OverrideSet;
  staleOverrideReport?: StaleOverrideReport;
  format?: CodegenFormatSummary;
  analyze?: CodegenAnalyzeSummary;
  projectId?: string;
  buildId?: string;
  normalizedIrId?: string;
  allowLowVisualScore?: boolean;
  now?: () => Date;
}

interface PlannedFile {
  path: string;
  content: string;
  regionHash: string;
  sourceNodeIds: string[];
  strategy: string;
}

const assetFileStrategies = new Set(["svg_icon", "image_asset", "frame_screenshot", "decorative_slice"]);

export function createCodegenReview(input: CreateCodegenReviewInput): CodegenReviewResult {
  const now = input.now ?? (() => new Date());
  const generatedAt = now().toISOString();
  const buildId = input.buildId ?? makeBuildId(input.normalizedDesignIR, generatedAt);
  const generatedFiles = planGeneratedFiles(input);
  const filePlans = generatedFiles.map((file) => toFilePlan(file, input));
  const filePatches = filePlans
    .filter((plan) => plan.action === "modify" || plan.action === "conflict")
    .map((plan) => {
      const file = generatedFiles.find((candidate) => candidate.path === plan.path);
      return {
        path: plan.path,
        patchPath: plan.patchPath ?? patchPathFor(plan.path),
        patch: buildUnifiedDiff(plan.path, input.existingProjectFiles?.[plan.path] ?? "", file?.content ?? "")
      };
    });
  const assetPlans = buildAssetPlans(input.assetManifest, new Set(input.existingPubspecAssets ?? []));
  const arbPatch = buildArbPatch(input.i18nManifest, input.existingArbFile);
  const pubspecPatch = buildPubspecPatch(assetPlans);
  const format = input.format ?? { status: "unknown" };
  const analyze = input.analyze ?? { errors: 0, warnings: 0 };
  const gates = buildGateStatus({
    input,
    filePlans,
    assetPlans,
    arbPatch,
    format,
    analyze
  });
  const filesToCreate = filePlans.filter((plan) => plan.action === "create");
  const filesToModify = filePlans.filter((plan) => plan.action === "modify" || plan.action === "conflict");
  const codegenReview: CodegenReviewManifest = {
    version: "0.1.0",
    buildId,
    projectId: input.projectId,
    normalizedIrId: input.normalizedIrId,
    generatedAt,
    visualScore: input.visualDiffReport?.page.score.visualScore,
    format,
    analyze,
    files: filePlans,
    filesToCreate: filesToCreate.map((plan) => plan.path),
    filesToModify: filesToModify.map((plan) => ({
      path: plan.path,
      patch: plan.patchPath ?? patchPathFor(plan.path),
      action: plan.action
    })),
    assetsToAdd: assetPlans.filter((asset) => asset.action === "add"),
    arbKeysToAdd: arbPatch.keysToAdd.map((message) => message.key),
    blockingTasks: input.reviewTasks?.filter((task) => task.status === "open" && task.priority === "P0").map((task) => task.id) ?? [],
    gates
  };
  const mergeReport = buildMergeReport(filePlans, generatedAt);
  const incrementalSyncReport = buildIncrementalSyncReport({
    currentManifest: codegenReview,
    previousManifest: input.previousManifest,
    overrideSet: input.overrideSet,
    staleOverrideReport: input.staleOverrideReport,
    generatedAt
  });

  return {
    version: "0.1.0",
    codegenReview,
    filesToCreate,
    filesToModify,
    assetsToAdd: codegenReview.assetsToAdd,
    arbPatch,
    pubspecPatch,
    mergeReport,
    incrementalSyncReport,
    generatedFiles: generatedFiles.map(({ path, content }) => ({ path, content })),
    filePatches
  };
}

function planGeneratedFiles(input: CreateCodegenReviewInput): PlannedFile[] {
  const rootSourceNodeId = input.normalizedDesignIR.source.frameNodeId ?? input.normalizedDesignIR.tree.sourceNodeIds[0] ?? "generated";
  const allSourceNodeIds = collectSourceNodeIds(input.normalizedDesignIR.tree);
  const pixelMapSourceNodeIds = unique((input.nodePixelMap ?? []).map((entry) => entry.sourceNodeId));
  const dartFiles = Object.entries(input.flutterPreviewFiles)
    .filter(([path]) => path.startsWith("lib/") && path.endsWith(".dart"))
    .sort(([left], [right]) => left.localeCompare(right));

  return dartFiles.map(([path, rawContent]) => {
    const sourceNodeIds = path.includes("preview_page")
      ? unique(pixelMapSourceNodeIds.length > 0 ? pixelMapSourceNodeIds : allSourceNodeIds)
      : [rootSourceNodeId];
    const strategy = path.includes("preview_page") ? "fidelity_preview" : "generated_flutter_entrypoint";
    const regionHash = hashText(`${path}\n${sourceNodeIds.join("\n")}\n${rawContent}`);
    const content = wrapDartGeneratedFile(rawContent, rootSourceNodeId, regionHash, strategy);
    return {
      path,
      content,
      regionHash,
      sourceNodeIds,
      strategy
    };
  });
}

function toFilePlan(file: PlannedFile, input: CreateCodegenReviewInput): CodegenFilePlan {
  const hash = hashText(file.content);
  const existing = input.existingProjectFiles?.[file.path];
  const previous = input.previousManifest?.files.find((candidate) => candidate.path === file.path);
  const patchPath = patchPathFor(file.path);
  if (existing === undefined) {
    return {
      path: file.path,
      action: "create",
      hash,
      previousHash: previous?.hash,
      generatedRegions: toGeneratedRegions(file),
      reason: "Generated file does not exist in the target project."
    };
  }
  const existingHash = hashText(existing);
  if (existingHash === hash) {
    return {
      path: file.path,
      action: "unchanged",
      hash,
      previousHash: previous?.hash,
      existingHash,
      generatedRegions: toGeneratedRegions(file),
      reason: "Existing file already matches the generated output."
    };
  }
  if (hasGeneratedMarker(existing)) {
    return {
      path: file.path,
      action: "modify",
      hash,
      previousHash: previous?.hash,
      existingHash,
      patchPath,
      generatedRegions: toGeneratedRegions(file),
      reason: "Existing file contains UXCompiler generated markers and can be updated through patch review."
    };
  }
  return {
    path: file.path,
    action: "conflict",
    hash,
    previousHash: previous?.hash,
    existingHash,
    patchPath,
    generatedRegions: toGeneratedRegions(file),
    reason: "Existing file has no UXCompiler generated marker, so it must be reviewed as manual code."
  };
}

function toGeneratedRegions(file: PlannedFile): CodegenFilePlan["generatedRegions"] {
  return [
    {
      id: `generated_${safeId(file.path)}`,
      sourceNodeIds: file.sourceNodeIds,
      hash: file.regionHash,
      strategy: file.strategy
    }
  ];
}

function buildAssetPlans(assetManifest: AssetManifest, existingPubspecAssets: ReadonlySet<string>): CodegenAssetPlan[] {
  return assetManifest.assets.map((asset) => {
    if (!assetFileStrategies.has(asset.strategy)) {
      return {
        assetId: asset.id,
        sourceNodeId: asset.sourceNodeId,
        sourceName: asset.sourceName,
        strategy: asset.strategy,
        format: asset.format,
        path: asset.path,
        action: "ignored",
        reason: `Asset strategy ${asset.strategy} does not require a project file.`
      };
    }
    if (!asset.path) {
      return {
        assetId: asset.id,
        sourceNodeId: asset.sourceNodeId,
        sourceName: asset.sourceName,
        strategy: asset.strategy,
        format: asset.format,
        action: "missing_path",
        reason: `Asset ${asset.id} needs an output path before codegen write.`
      };
    }
    return {
      assetId: asset.id,
      sourceNodeId: asset.sourceNodeId,
      sourceName: asset.sourceName,
      strategy: asset.strategy,
      format: asset.format,
      path: asset.path,
      action: existingPubspecAssets.has(asset.path) ? "already_declared" : "add",
      reason: existingPubspecAssets.has(asset.path) ? "Asset path is already declared." : "Asset path must be added to the Flutter project."
    };
  });
}

function buildArbPatch(i18nManifest: I18nManifest, existingArbFile?: Record<string, unknown>): CodegenArbPatch {
  const keysToAdd = [];
  const keysToModify = [];
  const keysUnchanged = [];
  const warnings: CodegenArbPatch["warnings"] = [];
  const patch: Record<string, unknown> = {};

  for (const message of i18nManifest.messages) {
    if (!message.key.trim()) {
      warnings.push({ type: "missing_key", message: `Message for source node ${message.sourceNodeId} has no i18n key.` });
      continue;
    }
    const current = existingArbFile?.[message.key];
    patch[message.key] = message.value;
    patch[`@${message.key}`] = { description: message.description };
    if (current === undefined) {
      keysToAdd.push(message);
    } else if (current !== message.value) {
      keysToModify.push(message);
    } else {
      keysUnchanged.push(message.key);
    }
  }

  return {
    locale: i18nManifest.locale,
    keysToAdd,
    keysToModify,
    keysUnchanged,
    patch,
    warnings
  };
}

function buildPubspecPatch(assetPlans: CodegenAssetPlan[]): CodegenPubspecPatch {
  const assets = assetPlans.filter((asset) => asset.action === "add" && asset.path).map((asset) => asset.path as string).sort();
  const lines = ["flutter:", "  assets:", ...assets.map((path) => `    - ${path}`)];
  return {
    path: "pubspec.yaml",
    assets,
    patch: assets.length === 0 ? "" : buildUnifiedDiff("pubspec.yaml", "", `${lines.join("\n")}\n`),
    warnings: assets.length === 0 ? [{ type: "no_asset_patch", message: "No new asset paths need to be declared." }] : []
  };
}

function buildGateStatus(options: {
  input: CreateCodegenReviewInput;
  filePlans: CodegenFilePlan[];
  assetPlans: CodegenAssetPlan[];
  arbPatch: CodegenArbPatch;
  format: CodegenFormatSummary;
  analyze: CodegenAnalyzeSummary;
}): CodegenGateStatus {
  const blockers: CodegenGateIssue[] = [];
  const warnings: CodegenGateStatus["warnings"] = [];
  const { input } = options;

  for (const task of input.reviewTasks ?? []) {
    if (task.status === "open" && task.type === "stale_override") {
      blockers.push({
        type: "stale_override_unresolved",
        message: task.title,
        taskId: task.id,
        priority: task.priority
      });
    } else if (task.status === "open" && task.priority === "P0") {
      blockers.push({
        type: "blocking_review_task",
        message: task.title,
        taskId: task.id,
        priority: task.priority
      });
    } else if (task.status === "open") {
      warnings.push({ type: "open_review_task", message: `${task.priority} task remains open: ${task.title}` });
    }
  }
  const staleTaskIds = new Set(
    (input.reviewTasks ?? [])
      .filter((task) => task.type === "stale_override")
      .map((task) => String(task.evidence?.overrideId ?? task.id))
  );
  for (const staleOverride of input.staleOverrideReport?.staleOverrides ?? []) {
    if (staleTaskIds.has(staleOverride.overrideId)) continue;
    blockers.push({
      type: "stale_override_unresolved",
      message: `Stale override ${staleOverride.overrideId} must be reviewed before codegen write.`
    });
  }

  if (input.taskStatusReport?.codegenWriteBlocked) {
    blockers.push({
      type: "task_status_blocked",
      message: input.taskStatusReport.blockedReasons.join("; ") || "Review task status report blocks codegen write."
    });
  }
  if (input.visualDiffReport && !input.visualDiffReport.page.pass && !input.allowLowVisualScore) {
    blockers.push({
      type: "visual_diff_failed",
      message: `Visual score ${input.visualDiffReport.page.score.visualScore} is below the configured threshold.`
    });
  } else if (!input.visualDiffReport) {
    warnings.push({ type: "visual_diff_missing", message: "No visual_diff_report.json was provided for the codegen review." });
  }
  if (options.format.status === "failed") {
    blockers.push({
      type: "dart_format_failed",
      message: `Dart format failed${options.format.source ? ` in ${options.format.source}` : ""}.`
    });
  }
  if (options.analyze.errors > 0) {
    blockers.push({
      type: "flutter_analyze_failed",
      message: `Flutter analyze reported ${options.analyze.errors} error(s).`
    });
  }
  for (const asset of options.assetPlans) {
    if (asset.action === "missing_path") {
      blockers.push({
        type: "asset_missing_path",
        sourceNodeId: asset.sourceNodeId,
        message: `Asset ${asset.assetId} requires an output path before codegen write.`
      });
    }
  }
  for (const warning of options.arbPatch.warnings) {
    if (warning.type === "missing_key") {
      blockers.push({
        type: "i18n_missing_key",
        message: warning.message
      });
    }
  }
  for (const plan of options.filePlans) {
    if (plan.action === "conflict") {
      blockers.push({
        type: "manual_file_conflict",
        filePath: plan.path,
        message: `${plan.path} exists without UXCompiler generated markers.`
      });
    }
  }

  return {
    canWrite: blockers.length === 0,
    status: blockers.length === 0 ? "ready" : "blocked",
    blockers,
    warnings
  };
}

function buildMergeReport(filePlans: CodegenFilePlan[], generatedAt: string): CodegenMergeReport {
  return {
    version: "0.1.0",
    generatedAt,
    files: filePlans.map((plan) => ({
      path: plan.path,
      action: plan.action,
      patchPath: plan.patchPath,
      reason: plan.reason
    })),
    conflicts: filePlans
      .filter((plan) => plan.action === "conflict")
      .map((plan) => ({
        path: plan.path,
        reason: plan.reason,
        patchPath: plan.patchPath
      }))
  };
}

function buildIncrementalSyncReport(options: {
  currentManifest: CodegenReviewManifest;
  previousManifest?: CodegenReviewManifest;
  overrideSet?: OverrideSet;
  staleOverrideReport?: StaleOverrideReport;
  generatedAt: string;
}): IncrementalSyncReport {
  const currentSourceIds = new Set(sourceNodeIdsForManifest(options.currentManifest));
  const previousSourceIds = new Set(options.previousManifest ? sourceNodeIdsForManifest(options.previousManifest) : []);
  const staleOverrides = options.staleOverrideReport?.staleOverrides ?? [];
  const staleIds = new Set(staleOverrides.map((override) => override.overrideId));
  const reappliedOverrides =
    options.overrideSet?.overrides
      .filter((override) => override.status === "active" && !staleIds.has(override.id))
      .map((override) => ({ overrideId: override.id, reason: "Active override is still present after review generation." })) ?? [];
  const fileChanges = buildFileChanges(options.currentManifest, options.previousManifest);

  return {
    version: "0.1.0",
    generatedAt: options.generatedAt,
    mode: options.previousManifest ? "incremental_review" : "initial_generation",
    nodeRemapReport: {
      exactSourceNodeIds: [...currentSourceIds].filter((sourceNodeId) => previousSourceIds.has(sourceNodeId)).sort(),
      addedSourceNodeIds: [...currentSourceIds].filter((sourceNodeId) => !previousSourceIds.has(sourceNodeId)).sort(),
      removedSourceNodeIds: [...previousSourceIds].filter((sourceNodeId) => !currentSourceIds.has(sourceNodeId)).sort()
    },
    reappliedOverrides,
    staleOverrides,
    fileChanges,
    reviewRequired:
      options.currentManifest.gates.status === "blocked" ||
      staleOverrides.length > 0 ||
      fileChanges.some((change) => change.change === "added" || change.change === "changed" || change.change === "removed"),
    warnings: options.previousManifest
      ? []
      : [{ type: "no_previous_manifest", message: "No previous flutter_generation_manifest.json was provided; generated initial review." }]
  };
}

function buildFileChanges(currentManifest: CodegenReviewManifest, previousManifest?: CodegenReviewManifest): IncrementalFileChange[] {
  const current = new Map(currentManifest.files.map((file) => [file.path, file]));
  const previous = new Map(previousManifest?.files.map((file) => [file.path, file]) ?? []);
  const changes: IncrementalFileChange[] = [];
  for (const file of current.values()) {
    const previousFile = previous.get(file.path);
    changes.push({
      path: file.path,
      change: previousFile ? (previousFile.hash === file.hash ? "unchanged" : "changed") : "added",
      previousHash: previousFile?.hash,
      currentHash: file.hash
    });
  }
  for (const file of previous.values()) {
    if (!current.has(file.path)) {
      changes.push({
        path: file.path,
        change: "removed",
        previousHash: file.hash
      });
    }
  }
  return changes.sort((left, right) => left.path.localeCompare(right.path));
}

function sourceNodeIdsForManifest(manifest: CodegenReviewManifest): string[] {
  return unique(manifest.files.flatMap((file) => file.generatedRegions.flatMap((region) => region.sourceNodeIds)));
}

function collectSourceNodeIds(root: NormalizedNode): string[] {
  const ids: string[] = [];
  const walk = (node: NormalizedNode): void => {
    ids.push(...node.sourceNodeIds);
    for (const child of node.children) walk(child);
  };
  walk(root);
  return unique(ids);
}

function wrapDartGeneratedFile(content: string, sourceNodeId: string, hash: string, strategy: string): string {
  if (hasGeneratedMarker(content)) return ensureTrailingNewline(content);
  return [
    `// @uxc-generated:start nodeId=${sourceNodeId} hash=${hash} strategy=${strategy}`,
    content.trimEnd(),
    "// @uxc-generated:end",
    ""
  ].join("\n");
}

function hasGeneratedMarker(content: string): boolean {
  return /@uxc-generated:start/.test(content) && /@uxc-generated:end/.test(content);
}

function buildUnifiedDiff(path: string, before: string, after: string): string {
  const beforeLines = splitPatchLines(before);
  const afterLines = splitPatchLines(after);
  const oldPath = beforeLines.length === 0 ? "/dev/null" : `a/${path}`;
  return [
    `--- ${oldPath}`,
    `+++ b/${path}`,
    `@@ -1,${beforeLines.length} +1,${afterLines.length} @@`,
    ...beforeLines.map((line) => `-${line}`),
    ...afterLines.map((line) => `+${line}`),
    ""
  ].join("\n");
}

function splitPatchLines(value: string): string[] {
  if (!value) return [];
  return value.replace(/\n$/, "").split("\n");
}

function patchPathFor(path: string): string {
  return `patches/${safeId(path)}.patch`;
}

function hashText(value: string): string {
  return `sha256_${createHash("sha256").update(value).digest("hex")}`;
}

function makeBuildId(normalizedDesignIR: NormalizedDesignIR, generatedAt: string): string {
  const frame = normalizedDesignIR.source.frameNodeId ?? normalizedDesignIR.tree.id;
  return `build_${safeId(frame)}_${generatedAt.replace(/[-:.TZ]/g, "").slice(0, 14)}`;
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || "generated";
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}
