#!/usr/bin/env node

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { createCodegenReview } from "@uxcompiler/codegen-review";
import { promoteGeneratedWidget } from "@uxcompiler/component-promoter";
import { extractFigmaScene, listFigmaFrames, type FigmaExtractionResult } from "@uxcompiler/figma-extractor";
import { runIncrementalSync } from "@uxcompiler/incremental-sync";
import {
  assertRawFigmaScene,
  type ComponentPromotionRule,
  type ComponentRegistry,
  type CodegenAnalyzeSummary,
  type CodegenArbPatch,
  type CodegenFormatSummary,
  type CodegenGeneratedFile,
  type CodegenPubspecPatch,
  type CodegenReviewResult,
  type CodegenReviewManifest,
  type OverrideSet,
  type PipelineArtifacts,
  type RawFigmaScene,
  type StudioOperation,
  type TreeEditOperation,
  type VisualDiffReport
} from "@uxcompiler/ir-schemas";
import { compileRawScene } from "@uxcompiler/normalizer";
import { applyOverrides } from "@uxcompiler/override-engine";
import { createProjectStore } from "@uxcompiler/project-store";
import { writeCodegenToProject } from "@uxcompiler/project-writer";
import { generateReviewTasks } from "@uxcompiler/review-task-engine";
import { applyStudioOperations } from "@uxcompiler/studios";
import { applyTreeEdits } from "@uxcompiler/tree-editor";
import { runVisualDiff } from "@uxcompiler/visual-diff";

const execFileAsync = promisify(execFile);

interface CompileOptions {
  input: string;
  out: string;
  overrideSet?: string;
  aiSemanticOutput?: string;
}

interface FigmaOptions {
  file: string;
  node?: string;
  out: string;
  token?: string;
  scale?: number;
  format?: "png" | "jpg" | "svg" | "pdf";
  apiBaseUrl?: string;
  overrideSet?: string;
}

interface FigmaRunReport {
  version: string;
  generatedAt: string;
  artifactsDir: string;
  source: {
    fileKey?: string;
    fileName?: string;
    frameNodeId?: string;
  };
  steps: {
    figmaFetch: {
      status: string;
      screenshotStatus: string;
      nodes: number;
      warnings: number;
    };
    compile: {
      status: string;
      normalizedConfidence: number;
    };
    flutterCapture: {
      status: string;
      output?: string;
      report?: string;
    };
    visualDiff: {
      status: string;
      pass?: boolean;
      visualScore?: number;
      pixelDiffRatio?: number;
      report?: string;
      heatmap?: string;
      reason?: string;
    };
  };
}

interface FigmaCheckOptions {
  file: string;
  node?: string;
  token?: string;
  apiBaseUrl?: string;
}

interface FigmaFramesOptions {
  file: string;
  token?: string;
  apiBaseUrl?: string;
  json?: boolean;
}

interface PreviewDiffOptions {
  reference: string;
  candidate: string;
  out: string;
  nodePixelMap?: string;
  viewport?: { width: number; height: number };
  dpr?: number;
}

interface PreviewCaptureOptions {
  project: string;
  out: string;
}

interface WriteVisualDiffOptions {
  referencePath: string;
  candidatePath: string;
  outDir: string;
  nodePixelMapPath?: string;
  viewport?: { width: number; height: number };
  dpr?: number;
  fonts?: string[];
  flutterVersion?: string;
}

interface ProjectCliOptions {
  root?: string;
  id?: string;
  name?: string;
  project?: string;
  artifacts?: string;
  snapshotId?: string;
  out?: string;
  input?: string;
  figmaFileKey?: string;
  figmaPageId?: string;
  figmaFrameId?: string;
  figmaFrameName?: string;
  flutterProjectPath?: string;
  packageName?: string;
  status?: "draft" | "reviewing" | "ready" | "invalid" | "archived";
  newProjectId?: string;
  replace?: boolean;
  json?: boolean;
}

interface TreeApplyOptions {
  artifacts: string;
  operations: string;
  out: string;
  actor?: "user" | "agent" | "system";
}

interface StudioApplyOptions {
  artifacts: string;
  operations: string;
  out: string;
  actor?: "user" | "agent" | "system";
}

interface CodegenReviewOptions {
  artifacts: string;
  out: string;
  projectPath?: string;
  previousManifest?: string;
  projectId?: string;
  buildId?: string;
  normalizedIrId?: string;
  allowLowVisualScore?: boolean;
}

interface CodegenWriteOptions {
  review: string;
  projectPath: string;
  out?: string;
  assetRoots: string[];
  backupRoot?: string;
  dryRun?: boolean;
  allowBlocked?: boolean;
}

interface CodegenPromoteOptions {
  review: string;
  file: string;
  componentId: string;
  name: string;
  sourceNodeIds: string[];
  import: string;
  flutterConstructor: string;
  out?: string;
  registry?: string;
  rules?: string;
  reason: string;
  allowManualFile?: boolean;
}

interface SyncRemapOptions {
  oldRaw: string;
  newRaw: string;
  overrideSet: string;
  out: string;
  oldSnapshotId?: string;
  newSnapshotId?: string;
  oldVisualDiff?: string;
  newVisualDiff?: string;
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "figma") {
    await runFigmaCommand(args);
    return;
  }

  if (command === "preview") {
    await runPreviewCommand(args);
    return;
  }

  if (command === "project") {
    await runProjectCommand(args);
    return;
  }

  if (command === "tree") {
    await runTreeCommand(args);
    return;
  }

  if (command === "studio") {
    await runStudioCommand(args);
    return;
  }

  if (command === "codegen") {
    await runCodegenCommand(args);
    return;
  }

  if (command === "sync") {
    await runSyncCommand(args);
    return;
  }

  if (command === "doctor") {
    await runDoctorCommand();
    return;
  }

  if (command !== "compile") {
    throw new Error(`Unknown command "${command}".`);
  }

  const options = parseCompileOptions(args);
  const inputPath = resolve(process.cwd(), options.input);
  const outDir = resolve(process.cwd(), options.out);
  const raw = JSON.parse(await readFile(inputPath, "utf8")) as unknown;
  assertRawFigmaScene(raw);

  const overrideSet = options.overrideSet ? await readOverrideSet(options.overrideSet) : undefined;
  const aiSemanticOutput = options.aiSemanticOutput ? await readJsonFile<unknown>(resolve(process.cwd(), options.aiSemanticOutput)) : undefined;
  const artifacts = compileRawScene(raw, { overrideSet, aiSemanticOutput });
  await writeArtifacts(outDir, artifacts, inputPath);

  console.log(`UXCompiler compile completed.`);
  console.log(`Input: ${inputPath}`);
  console.log(`Artifacts: ${outDir}`);
  console.log(`Normalized confidence: ${artifacts.normalizedDesignIR.confidence.overall}`);
}

async function runStudioCommand(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printStudioHelp();
    return;
  }
  if (subcommand !== "apply") throw new Error(`Unknown studio subcommand "${subcommand}".`);
  const options = parseStudioApplyOptions(rest);
  const artifactDir = resolve(process.cwd(), options.artifacts);
  const outDir = resolve(process.cwd(), options.out);
  const operations = await readJsonFile<StudioOperation[]>(options.operations);
  const result = applyStudioOperations({
    normalizedDesignIR: await readJsonFile(resolve(artifactDir, "normalized_design_ir.json")),
    assetManifest: await readJsonFile(resolve(artifactDir, "asset_manifest.json")),
    i18nManifest: await readJsonFile(resolve(artifactDir, "i18n_manifest.json")),
    inferredTokens: await readJsonFile(resolve(artifactDir, "inferred_tokens.json")),
    overrideSet: (await readOptionalJsonFile(resolve(artifactDir, "override_set.json"))) as OverrideSet | undefined,
    operations,
    actor: options.actor ?? "user"
  });

  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeJsonFile(resolve(outDir, "studio_report.json"), {
      version: result.version,
      operations: result.operations,
      validationReport: result.validationReport,
      overrideMutations: result.overrideMutations
    }),
    writeJsonFile(resolve(outDir, "override_set.json"), result.overrideSet),
    writeJsonFile(resolve(outDir, "component_registry.json"), result.componentRegistry),
    writeJsonFile(resolve(outDir, "token_registry.json"), result.tokenRegistry),
    writeJsonFile(resolve(outDir, "final_asset_manifest.json"), result.finalAssetManifest),
    writeJsonFile(resolve(outDir, "final_i18n_manifest.json"), result.finalI18nManifest),
    writeJsonFile(resolve(outDir, "arb/app_en.arb"), result.finalArbFile),
    writeJsonFile(resolve(outDir, "override_conflict_report.json"), result.overrideConflictReport),
    writeJsonFile(resolve(outDir, "stale_override_report.json"), result.staleOverrideReport)
  ]);

  if (result.validationReport.rejectedOperationIds.length > 0) {
    throw new Error(
      `Studio validation rejected ${result.validationReport.rejectedOperationIds.length} operation(s). See ${resolve(
        outDir,
        "studio_report.json"
      )}.`
    );
  }
  console.log(`UXCompiler studio review completed.`);
  console.log(`Operations: ${result.validationReport.validOperationIds.length}`);
  console.log(`Artifacts: ${outDir}`);
  console.log(`Components: ${result.componentRegistry.components.length}`);
  console.log(`Tokens: ${result.tokenRegistry.tokens.length}`);
}

async function runCodegenCommand(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printCodegenHelp();
    return;
  }
  if (subcommand !== "review" && subcommand !== "write" && subcommand !== "promote") throw new Error(`Unknown codegen subcommand "${subcommand}".`);
  if (subcommand === "write") {
    await runCodegenWriteCommand(rest);
    return;
  }
  if (subcommand === "promote") {
    await runCodegenPromoteCommand(rest);
    return;
  }
  const options = parseCodegenReviewOptions(rest);
  const artifactDir = resolve(process.cwd(), options.artifacts);
  const outDir = resolve(process.cwd(), options.out);
  const flutterPreviewFiles = await readTextFilesRecursively(resolve(artifactDir, "flutter_preview"));
  const existingProjectFiles = options.projectPath
    ? await readExistingProjectFiles(resolve(process.cwd(), options.projectPath), Object.keys(flutterPreviewFiles))
    : undefined;
  const result = createCodegenReview({
    normalizedDesignIR: await readFirstJsonFile([
      resolve(artifactDir, "reviewed_normalized_design_ir.json"),
      resolve(artifactDir, "normalized_design_ir.json")
    ]),
    assetManifest: await readFirstJsonFile([
      resolve(artifactDir, "final_asset_manifest.json"),
      resolve(artifactDir, "reviewed_asset_manifest.json"),
      resolve(artifactDir, "asset_manifest.json")
    ]),
    i18nManifest: await readFirstJsonFile([
      resolve(artifactDir, "final_i18n_manifest.json"),
      resolve(artifactDir, "reviewed_i18n_manifest.json"),
      resolve(artifactDir, "i18n_manifest.json")
    ]),
    existingArbFile: await readOptionalJsonFile(resolve(artifactDir, "existing_arb/app_en.arb")),
    flutterPreviewFiles,
    existingProjectFiles,
    previousManifest: options.previousManifest ? await readJsonFile<CodegenReviewManifest>(options.previousManifest) : undefined,
    reviewTasks: await readOptionalJsonFile(resolve(artifactDir, "review_tasks.json")),
    taskStatusReport: await readOptionalJsonFile(resolve(artifactDir, "task_status_report.json")),
    visualDiffReport: await readOptionalJsonFile(resolve(artifactDir, "visual_diff_report.json")),
    fidelityGenerationManifest: await readOptionalJsonFile(resolve(artifactDir, "fidelity_generation_manifest.json")),
    nodePixelMap: await readOptionalJsonFile(resolve(artifactDir, "node_pixel_map.json")),
    overrideSet: await readOptionalJsonFile(resolve(artifactDir, "override_set.json")),
    staleOverrideReport: await readOptionalJsonFile(resolve(artifactDir, "stale_override_report.json")),
    promotionRules: await readOptionalJsonFile(resolve(artifactDir, "codegen_promotion_rules.json")),
    format: await readCodegenFormatSummary(artifactDir),
    analyze: await readCodegenAnalyzeSummary(artifactDir),
    projectId: options.projectId,
    buildId: options.buildId,
    normalizedIrId: options.normalizedIrId,
    allowLowVisualScore: options.allowLowVisualScore
  });

  await writeCodegenReviewArtifacts(outDir, result);

  console.log(`UXCompiler codegen review completed.`);
  console.log(`Write gate: ${result.codegenReview.gates.status}`);
  console.log(`Files to create: ${result.filesToCreate.length}`);
  console.log(`Files to modify: ${result.filesToModify.length}`);
  console.log(`Artifacts: ${outDir}`);
}

async function runCodegenWriteCommand(args: string[]): Promise<void> {
  const options = parseCodegenWriteOptions(args);
  const reviewDir = resolve(process.cwd(), options.review);
  const projectPath = resolve(process.cwd(), options.projectPath);
  const result = await writeCodegenToProject({
    projectPath,
    codegenReview: await readJsonFile(resolve(reviewDir, "codegen_review.json")),
    generatedFiles: await readGeneratedFiles(resolve(reviewDir, "generated")),
    arbPatch: await readOptionalJsonFile<CodegenArbPatch>(resolve(reviewDir, "arb_patch.json")),
    pubspecPatch: await readOptionalJsonFile<CodegenPubspecPatch>(resolve(reviewDir, "pubspec_patch.json")),
    assetRoots: [resolve(reviewDir, "assets"), ...options.assetRoots.map((root) => resolve(process.cwd(), root))],
    dryRun: options.dryRun,
    allowBlocked: options.allowBlocked,
    backupRoot: options.backupRoot ? resolve(process.cwd(), options.backupRoot) : undefined
  });
  const reportPath = resolve(process.cwd(), options.out ?? resolve(reviewDir, "project_write_report.json"));
  await writeJsonFile(reportPath, result.report);

  console.log(`UXCompiler codegen write completed.`);
  console.log(`Mode: ${result.report.mode}`);
  console.log(`Wrote: ${result.report.wrote}`);
  console.log(`Files written: ${result.report.files.filter((file) => file.status === "created" || file.status === "updated").length}`);
  console.log(`Report: ${reportPath}`);
}

async function runCodegenPromoteCommand(args: string[]): Promise<void> {
  const options = parseCodegenPromoteOptions(args);
  const reviewDir = resolve(process.cwd(), options.review);
  const outDir = resolve(process.cwd(), options.out ?? options.review);
  const generatedFilePath = normalizeGeneratedFilePath(options.file);
  const generatedFileContent = await readFile(resolve(reviewDir, "generated", generatedFilePath), "utf8");
  const componentRegistry =
    (options.registry
      ? await readOptionalJsonFile<ComponentRegistry>(options.registry)
      : await readOptionalJsonFile<ComponentRegistry>(resolve(reviewDir, "component_registry.json"))) ?? undefined;
  const promotionRules =
    (options.rules
      ? await readOptionalJsonFile<ComponentPromotionRule[]>(options.rules)
      : await readOptionalJsonFile<ComponentPromotionRule[]>(resolve(reviewDir, "codegen_promotion_rules.json"))) ?? [];
  const result = promoteGeneratedWidget({
    componentRegistry,
    promotionRules,
    generatedFileContent,
    request: {
      componentId: options.componentId,
      name: options.name,
      generatedFilePath,
      sourceNodeIds: options.sourceNodeIds,
      flutter: {
        import: options.import,
        constructor: options.flutterConstructor
      },
      reason: options.reason,
      allowManualFile: options.allowManualFile
    }
  });

  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeJsonFile(resolve(outDir, "promote_report.json"), result.promoteReport),
    writeJsonFile(resolve(outDir, "component_registry.json"), result.componentRegistry),
    writeJsonFile(resolve(outDir, "codegen_promotion_rules.json"), result.promotionRules)
  ]);
  if (!result.promoteReport.promoted) {
    throw new Error(`Generated widget promotion was rejected. See ${resolve(outDir, "promote_report.json")}.`);
  }

  console.log(`UXCompiler generated widget promotion completed.`);
  console.log(`Component: ${options.name}`);
  console.log(`Generated file: ${generatedFilePath}`);
  console.log(`Artifacts: ${outDir}`);
}

async function runSyncCommand(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printSyncHelp();
    return;
  }
  if (subcommand !== "remap") throw new Error(`Unknown sync subcommand "${subcommand}".`);
  const options = parseSyncRemapOptions(rest);
  const outDir = resolve(process.cwd(), options.out);
  const oldRaw = await readJsonFile<RawFigmaScene>(options.oldRaw);
  const newRaw = await readJsonFile<RawFigmaScene>(options.newRaw);
  assertRawFigmaScene(oldRaw);
  assertRawFigmaScene(newRaw);
  const result = runIncrementalSync({
    oldRawScene: oldRaw,
    newRawScene: newRaw,
    overrideSet: await readJsonFile<OverrideSet>(options.overrideSet),
    oldSnapshotId: options.oldSnapshotId,
    newSnapshotId: options.newSnapshotId,
    oldVisualDiffReport: options.oldVisualDiff ? await readJsonFile<VisualDiffReport>(options.oldVisualDiff) : undefined,
    newVisualDiffReport: options.newVisualDiff ? await readJsonFile<VisualDiffReport>(options.newVisualDiff) : undefined
  });

  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeJsonFile(resolve(outDir, "override_set.json"), result.overrideSet),
    writeJsonFile(resolve(outDir, "node_remap_report.json"), result.nodeRemapReport),
    writeJsonFile(resolve(outDir, "reapplied_overrides.json"), result.reappliedOverrides),
    writeJsonFile(resolve(outDir, "stale_overrides.json"), result.staleOverrides),
    writeJsonFile(resolve(outDir, "incremental_review_tasks.json"), result.incrementalReviewTasks)
  ]);

  console.log(`UXCompiler incremental sync remap completed.`);
  console.log(`Reapplied overrides: ${result.reappliedOverrides.length}`);
  console.log(`Stale overrides: ${result.staleOverrides.length}`);
  console.log(`Review tasks: ${result.incrementalReviewTasks.length}`);
  console.log(`Artifacts: ${outDir}`);
}

async function runTreeCommand(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printTreeHelp();
    return;
  }
  if (subcommand !== "apply") throw new Error(`Unknown tree subcommand "${subcommand}".`);
  const options = parseTreeApplyOptions(rest);
  const artifactDir = resolve(process.cwd(), options.artifacts);
  const outDir = resolve(process.cwd(), options.out);
  const operations = await readJsonFile<TreeEditOperation[]>(options.operations);
  const result = applyTreeEdits({
    normalizedDesignIR: await readJsonFile(resolve(artifactDir, "normalized_design_ir.json")),
    assetManifest: await readJsonFile(resolve(artifactDir, "asset_manifest.json")),
    i18nManifest: await readJsonFile(resolve(artifactDir, "i18n_manifest.json")),
    inferredTokens: await readJsonFile(resolve(artifactDir, "inferred_tokens.json")),
    overrideSet: (await readOptionalJsonFile(resolve(artifactDir, "override_set.json"))) as OverrideSet | undefined,
    operations,
    actor: options.actor ?? "user"
  });

  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeJsonFile(resolve(outDir, "tree_edit_report.json"), {
      version: result.version,
      operations: result.operations,
      validationReport: result.validationReport,
      overrideMutations: result.overrideMutations
    }),
    writeJsonFile(resolve(outDir, "override_set.json"), result.overrideSet),
    writeJsonFile(resolve(outDir, "reviewed_normalized_design_ir.json"), result.draftNormalizedDesignIR),
    writeJsonFile(resolve(outDir, "override_conflict_report.json"), result.overrideConflictReport),
    writeJsonFile(resolve(outDir, "stale_override_report.json"), result.staleOverrideReport)
  ]);

  if (result.validationReport.rejectedOperationIds.length > 0) {
    throw new Error(
      `Tree edit validation rejected ${result.validationReport.rejectedOperationIds.length} operation(s). See ${resolve(
        outDir,
        "tree_edit_report.json"
      )}.`
    );
  }
  console.log(`UXCompiler tree edit preview completed.`);
  console.log(`Operations: ${result.validationReport.validOperationIds.length}`);
  console.log(`Artifacts: ${outDir}`);
  console.log(`OverrideSet: ${result.overrideSet.id}`);
}

async function runDoctorCommand(): Promise<void> {
  const checks = [
    await commandVersion("node", ["--version"]),
    await commandVersion("pnpm", ["--version"]),
    await commandVersion("dart", ["--version"]),
    await commandVersion("flutter", ["--version"])
  ];
  const token = await readFigmaTokenFromEnvironment();
  console.log("UXCompiler doctor");
  for (const check of checks) {
    console.log(`${check.ok ? "ok" : "missing"} ${check.command}: ${check.summary}`);
  }
  console.log(`${token ? "ok" : "missing"} FIGMA_ACCESS_TOKEN: ${token ? "configured" : "not configured"}`);
}

async function commandVersion(command: string, args: string[]): Promise<{ command: string; ok: boolean; summary: string }> {
  try {
    const result = await execFileAsync(command, args);
    return {
      command,
      ok: true,
      summary: (result.stdout || result.stderr).split(/\r?\n/)[0] || "available"
    };
  } catch {
    return {
      command,
      ok: false,
      summary: "not found"
    };
  }
}

async function runPreviewCommand(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printPreviewHelp();
    return;
  }
  if (subcommand !== "diff" && subcommand !== "capture") {
    throw new Error(`Unknown preview subcommand "${subcommand}".`);
  }

  if (subcommand === "capture") {
    const options = parsePreviewCaptureOptions(rest);
    const projectDir = resolve(process.cwd(), options.project);
    const outPath = resolve(process.cwd(), options.out);
    const result = await captureFlutterPreview(projectDir, outPath);
    console.log(`UXCompiler preview capture completed.`);
    console.log(`Screenshot: ${outPath}`);
    console.log(`Golden source: ${result.goldenPath}`);
    return;
  }

  const options = parsePreviewDiffOptions(rest);
  const outDir = resolve(process.cwd(), options.out);
  const result = await writeVisualDiffArtifacts({
    referencePath: resolve(process.cwd(), options.reference),
    candidatePath: resolve(process.cwd(), options.candidate),
    outDir,
    nodePixelMapPath: options.nodePixelMap ? resolve(process.cwd(), options.nodePixelMap) : undefined,
    viewport: options.viewport,
    dpr: options.dpr
  });

  console.log(`UXCompiler preview diff completed.`);
  console.log(`Report: ${resolve(outDir, "visual_diff_report.json")}`);
  console.log(`Pass: ${result.page.pass}`);
  console.log(`Visual score: ${result.page.score.visualScore}`);
}

async function writeVisualDiffArtifacts(options: WriteVisualDiffOptions): Promise<ReturnType<typeof runVisualDiff>["visualDiffReport"]> {
  const heatmapPath = resolve(options.outDir, "diff_heatmap.png");
  const nodePixelMap = options.nodePixelMapPath
    ? (JSON.parse(await readFile(options.nodePixelMapPath, "utf8")) as [])
    : undefined;
  const result = runVisualDiff({
    referencePng: await readFile(options.referencePath),
    candidatePng: await readFile(options.candidatePath),
    referencePath: options.referencePath,
    candidatePath: options.candidatePath,
    heatmapPath,
    nodePixelMap,
    viewport: options.viewport,
    dpr: options.dpr,
    fonts: options.fonts,
    flutterVersion: options.flutterVersion
  });

  await mkdir(options.outDir, { recursive: true });
  await writeFile(resolve(options.outDir, "visual_diff_report.json"), `${JSON.stringify(result.visualDiffReport, null, 2)}\n`, "utf8");
  await writeFile(resolve(options.outDir, "node_diff_report.json"), `${JSON.stringify(result.nodeDiffReport, null, 2)}\n`, "utf8");
  await writeFile(resolve(options.outDir, "diff_issues.json"), `${JSON.stringify(result.nodeDiffReport, null, 2)}\n`, "utf8");
  if (result.manualReviewReport) {
    await writeFile(resolve(options.outDir, "manual_review_report.json"), `${JSON.stringify(result.manualReviewReport, null, 2)}\n`, "utf8");
  }
  await writeFile(heatmapPath, result.heatmapPng);
  return result.visualDiffReport;
}

async function runProjectCommand(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printProjectHelp();
    return;
  }
  if (!["init", "create", "list", "show", "save-artifacts", "export", "import"].includes(subcommand)) {
    throw new Error(`Unknown project subcommand "${subcommand}".`);
  }

  const options = parseProjectOptions(rest);
  const rootDir = resolve(process.cwd(), options.root ?? ".uxcompiler");
  const store = createProjectStore({ rootDir });

  if (subcommand === "init") {
    const workspace = await store.init();
    console.log(`UXCompiler project store initialized.`);
    console.log(`Root: ${rootDir}`);
    console.log(`Projects: ${workspace.projects.length}`);
    return;
  }

  if (subcommand === "create") {
    if (!options.name) throw new Error("Missing required option --name.");
    const project = await store.createProject({
      id: options.id,
      name: options.name,
      status: options.status,
      figma: {
        fileKey: options.figmaFileKey,
        pageId: options.figmaPageId,
        frameId: options.figmaFrameId,
        frameName: options.figmaFrameName
      },
      flutter: {
        projectPath: options.flutterProjectPath,
        packageName: options.packageName
      }
    });
    console.log(`UXCompiler project created.`);
    console.log(`Project: ${project.id}`);
    console.log(`Root: ${rootDir}`);
    return;
  }

  if (subcommand === "list") {
    const projects = await store.listProjects();
    if (options.json) {
      console.log(JSON.stringify(projects, null, 2));
      return;
    }
    console.log(`UXCompiler projects`);
    for (const project of projects) {
      console.log(`${project.id}\t${project.status}\t${project.name}`);
    }
    return;
  }

  if (subcommand === "show") {
    const projectId = requiredProject(options);
    const project = await store.readProject(projectId);
    const index = await store.readProjectIndex(projectId);
    console.log(
      JSON.stringify(
        {
          project,
          index
        },
        null,
        2
      )
    );
    return;
  }

  if (subcommand === "save-artifacts") {
    const projectId = requiredProject(options);
    if (!options.artifacts) throw new Error("Missing required option --artifacts.");
    const result = await store.saveArtifactDirectory(projectId, {
      artifactDir: resolve(process.cwd(), options.artifacts),
      snapshotId: options.snapshotId
    });
    console.log(`UXCompiler project artifacts saved.`);
    console.log(`Project: ${projectId}`);
    console.log(`Snapshot: ${result.snapshot.id}`);
    console.log(`OverrideSet: ${result.overrideSet.id}`);
    console.log(`ReviewTasks: ${result.reviewTaskSet.id}`);
    return;
  }

  if (subcommand === "export") {
    const projectId = requiredProject(options);
    if (!options.out) throw new Error("Missing required option --out.");
    const result = await store.exportProject(projectId, resolve(process.cwd(), options.out));
    console.log(`UXCompiler project exported.`);
    console.log(`Project: ${result.projectId}`);
    console.log(`Archive: ${result.archivePath}`);
    console.log(`Entries: ${result.entries}`);
    return;
  }

  const input = options.input ?? options.out;
  if (!input) throw new Error("Missing required option --input.");
  const result = await store.importProject(resolve(process.cwd(), input), {
    newProjectId: options.newProjectId,
    replace: options.replace
  });
  console.log(`UXCompiler project imported.`);
  console.log(`Project: ${result.projectId}`);
  console.log(`Directory: ${result.projectDir}`);
  console.log(`Entries: ${result.entries}`);
}

async function captureFlutterPreview(projectDir: string, outPath: string): Promise<Record<string, unknown>> {
  const goldenPath = resolve(projectDir, "test/goldens/flutter_preview.png");
  const flutterVersion = await commandVersion("flutter", ["--version"]);
  await execFileAsync("flutter", ["pub", "get"], { cwd: projectDir });
  const testResult = await execFileAsync("flutter", ["test", "--update-goldens", "test/golden_preview_test.dart"], {
    cwd: projectDir
  });
  const golden = await readFile(goldenPath);
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, golden);
  const report = {
    status: "success",
    command: "flutter test --update-goldens test/golden_preview_test.dart",
    projectDir,
    output: outPath,
    goldenPath,
    flutterVersion: flutterVersion.ok ? flutterVersion.summary : undefined,
    stdout: testResult.stdout,
    stderr: testResult.stderr,
    generatedAt: new Date().toISOString()
  };
  await writeFile(resolve(dirname(outPath), "flutter_preview_capture_report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return report;
}

async function runFigmaCommand(args: string[]): Promise<void> {
  const [subcommand, ...rest] = args;
  if (!subcommand || subcommand === "--help" || subcommand === "-h") {
    printFigmaHelp();
    return;
  }
  if (subcommand !== "fetch" && subcommand !== "compile" && subcommand !== "check" && subcommand !== "run" && subcommand !== "frames") {
    throw new Error(`Unknown figma subcommand "${subcommand}".`);
  }

  if (subcommand === "frames") {
    const options = parseFigmaFramesOptions(rest);
    const token = options.token ?? (await readFigmaTokenFromEnvironment());
    if (!token) {
      throw new Error("Missing Figma token. Pass --token, set FIGMA_ACCESS_TOKEN, or add FIGMA_ACCESS_TOKEN to .env.");
    }
    const result = await listFigmaFrames({
      file: options.file,
      token,
      apiBaseUrl: options.apiBaseUrl
    });
    if (options.json) {
      console.log(JSON.stringify(result, null, 2));
      return;
    }
    console.log(`UXCompiler Figma frames`);
    console.log(`File: ${result.fileName ?? result.fileKey}`);
    console.log(`Frames: ${result.frames.length}`);
    for (const [index, frame] of result.frames.entries()) {
      const size = frame.width && frame.height ? `${Math.round(frame.width)}x${Math.round(frame.height)}` : "?x?";
      console.log(`${index + 1}. [${frame.type}] ${frame.id} (${size}) ${frame.path}`);
    }
    return;
  }

  if (subcommand === "check") {
    const options = parseFigmaCheckOptions(rest);
    const token = options.token ?? (await readFigmaTokenFromEnvironment());
    if (!token) {
      throw new Error("Missing Figma token. Pass --token, set FIGMA_ACCESS_TOKEN, or add FIGMA_ACCESS_TOKEN to .env.");
    }
    const extraction = await extractFigmaScene({
      file: options.file,
      nodeId: options.node,
      token,
      apiBaseUrl: options.apiBaseUrl,
      screenshot: false
    });
    console.log(`UXCompiler Figma check completed.`);
    console.log(`File key: ${extraction.rawFigmaScene.source.fileKey}`);
    console.log(`File name: ${extraction.rawFigmaScene.source.fileName ?? "(unknown)"}`);
    console.log(`Frame node: ${extraction.rawFigmaScene.source.frameNodeId}`);
    console.log(
      `Viewport: ${extraction.rawFigmaScene.source.viewport?.width ?? "?"}x${
        extraction.rawFigmaScene.source.viewport?.height ?? "?"
      }`
    );
    console.log(`Nodes: ${extraction.extractionReport.stats.nodes}`);
    console.log(`Text nodes: ${extraction.extractionReport.stats.textNodes}`);
    console.log(`Warnings: ${extraction.extractionReport.warnings.length}`);
    return;
  }

  const options = parseFigmaOptions(rest);
  const token = options.token ?? (await readFigmaTokenFromEnvironment());
  if (!token) {
    throw new Error("Missing Figma token. Pass --token, set FIGMA_ACCESS_TOKEN, or add FIGMA_ACCESS_TOKEN to .env.");
  }

  const outDir = resolve(process.cwd(), options.out);
  const extraction = await extractFigmaScene({
    file: options.file,
    nodeId: options.node,
    token,
    scale: options.scale,
    format: options.format,
    apiBaseUrl: options.apiBaseUrl
  });
  await writeFigmaSnapshot(outDir, extraction);

  if (subcommand === "compile" || subcommand === "run") {
    const overrideSet = options.overrideSet ? await readOverrideSet(options.overrideSet) : undefined;
    const artifacts = compileRawScene(extraction.rawFigmaScene, { overrideSet });
    await writeArtifacts(outDir, artifacts, resolve(outDir, "raw_figma_scene.json"));
    await writeFigmaSnapshot(outDir, extraction);
    if (subcommand === "run") {
      const runReport = await runEndToEndPreview(outDir, extraction, artifacts);
      await writePreviewArtifact(outDir, runReport);
      await writeFile(resolve(outDir, "pipeline_run_report.json"), `${JSON.stringify(runReport, null, 2)}\n`, "utf8");
      await writeRuntimeReviewTaskArtifacts(outDir, artifacts, runReport);
      console.log(`UXCompiler Figma run completed.`);
      console.log(`Artifacts: ${outDir}`);
      console.log(`Frame node: ${extraction.rawFigmaScene.source.frameNodeId}`);
      console.log(`Normalized confidence: ${artifacts.normalizedDesignIR.confidence.overall}`);
      console.log(`Flutter preview: ${runReport.steps.flutterCapture.output ?? "(not generated)"}`);
      console.log(`Diff pass: ${runReport.steps.visualDiff.pass ?? "skipped"}`);
      console.log(`Visual score: ${runReport.steps.visualDiff.visualScore ?? "n/a"}`);
      return;
    }
    console.log(`UXCompiler Figma compile completed.`);
    console.log(`Snapshot + artifacts: ${outDir}`);
    console.log(`Frame node: ${extraction.rawFigmaScene.source.frameNodeId}`);
    console.log(`Normalized confidence: ${artifacts.normalizedDesignIR.confidence.overall}`);
    return;
  }

  console.log(`UXCompiler Figma fetch completed.`);
  console.log(`Snapshot: ${outDir}`);
  console.log(`Frame node: ${extraction.rawFigmaScene.source.frameNodeId}`);
  console.log(`Screenshot: ${extraction.extractionReport.screenshot.status}`);
}

async function runEndToEndPreview(
  outDir: string,
  extraction: FigmaExtractionResult,
  artifacts: PipelineArtifacts
): Promise<FigmaRunReport> {
  const previewPath = resolve(outDir, "flutter_preview.png");
  const captureReport = await captureFlutterPreview(resolve(outDir, "flutter_preview"), previewPath);
  const referencePath = resolve(outDir, `figma_reference.${extraction.referenceImageExtension}`);
  const diffDir = resolve(outDir, "diff");
  let diffStep: FigmaRunReport["steps"]["visualDiff"];

  if (extraction.referenceImage) {
    const diffReport = await writeVisualDiffArtifacts({
      referencePath,
      candidatePath: previewPath,
      outDir: diffDir,
      nodePixelMapPath: resolve(outDir, "node_pixel_map.json"),
      viewport: extraction.rawFigmaScene.source.viewport
        ? {
            width: extraction.rawFigmaScene.source.viewport.width,
            height: extraction.rawFigmaScene.source.viewport.height
          }
        : undefined,
      dpr: extraction.rawFigmaScene.source.viewport?.scale ?? 1,
      fonts: collectFontFamilies(artifacts),
      flutterVersion: stringValue(captureReport.flutterVersion)
    });
    diffStep = {
      status: "success",
      pass: diffReport.page.pass,
      visualScore: diffReport.page.score.visualScore,
      pixelDiffRatio: diffReport.page.score.pixelDiffRatio,
      report: resolve(diffDir, "visual_diff_report.json"),
      heatmap: resolve(diffDir, "diff_heatmap.png")
    };
  } else {
    diffStep = {
      status: "skipped",
      reason: "Figma reference screenshot was not available."
    };
  }

  return {
    version: "0.1.0",
    generatedAt: new Date().toISOString(),
    artifactsDir: outDir,
    source: {
      fileKey: extraction.rawFigmaScene.source.fileKey,
      fileName: extraction.rawFigmaScene.source.fileName,
      frameNodeId: extraction.rawFigmaScene.source.frameNodeId
    },
    steps: {
      figmaFetch: {
        status: "success",
        screenshotStatus: extraction.extractionReport.screenshot.status,
        nodes: extraction.extractionReport.stats.nodes,
        warnings: extraction.extractionReport.warnings.length
      },
      compile: {
        status: "success",
        normalizedConfidence: artifacts.normalizedDesignIR.confidence.overall
      },
      flutterCapture: {
        status: "success",
        output: previewPath,
        report: resolve(outDir, "flutter_preview_capture_report.json")
      },
      visualDiff: diffStep
    }
  };
}

async function writePreviewArtifact(outDir: string, runReport: FigmaRunReport): Promise<void> {
  const diffDir = runReport.steps.visualDiff.report ? dirname(runReport.steps.visualDiff.report) : undefined;
  const artifact = {
    version: "0.1.0",
    generatedAt: new Date().toISOString(),
    artifactsDir: outDir,
    source: runReport.source,
    status: {
      flutterCapture: runReport.steps.flutterCapture.status,
      visualDiff: runReport.steps.visualDiff.status,
      pass: runReport.steps.visualDiff.pass,
      visualScore: runReport.steps.visualDiff.visualScore,
      pixelDiffRatio: runReport.steps.visualDiff.pixelDiffRatio
    },
    files: {
      flutterPreview: runReport.steps.flutterCapture.output,
      flutterCaptureReport: runReport.steps.flutterCapture.report,
      webPreviewState: resolve(outDir, "web_preview_state.json"),
      visualDiffReport: runReport.steps.visualDiff.report,
      diffIssues: diffDir ? resolve(diffDir, "diff_issues.json") : undefined,
      nodeDiffReport: diffDir ? resolve(diffDir, "node_diff_report.json") : undefined,
      heatmap: runReport.steps.visualDiff.heatmap
    }
  };
  await writeFile(resolve(outDir, "preview_artifact.json"), `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
}

function parseCompileOptions(args: string[]): CompileOptions {
  const options: Partial<CompileOptions> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--input" || arg === "-i") {
      if (!next) throw new Error("Missing value for --input.");
      options.input = next;
      index += 1;
    } else if (arg === "--out" || arg === "-o") {
      if (!next) throw new Error("Missing value for --out.");
      options.out = next;
      index += 1;
    } else if (arg === "--override-set") {
      if (!next) throw new Error("Missing value for --override-set.");
      options.overrideSet = next;
      index += 1;
    } else if (arg === "--ai-semantic-output") {
      if (!next) throw new Error("Missing value for --ai-semantic-output.");
      options.aiSemanticOutput = next;
      index += 1;
    } else {
      throw new Error(`Unknown compile option "${arg}".`);
    }
  }

  if (!options.input) throw new Error("Missing required option --input.");
  if (!options.out) throw new Error("Missing required option --out.");
  return options as CompileOptions;
}

function parseFigmaOptions(args: string[]): FigmaOptions {
  const options: Partial<FigmaOptions> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--file" || arg === "--url" || arg === "-f") {
      if (!next) throw new Error(`Missing value for ${arg}.`);
      options.file = next;
      index += 1;
    } else if (arg === "--node" || arg === "--node-id" || arg === "-n") {
      if (!next) throw new Error(`Missing value for ${arg}.`);
      options.node = next;
      index += 1;
    } else if (arg === "--out" || arg === "-o") {
      if (!next) throw new Error("Missing value for --out.");
      options.out = next;
      index += 1;
    } else if (arg === "--token") {
      if (!next) throw new Error("Missing value for --token.");
      options.token = next;
      index += 1;
    } else if (arg === "--scale") {
      if (!next) throw new Error("Missing value for --scale.");
      options.scale = Number(next);
      if (!Number.isFinite(options.scale) || options.scale <= 0 || options.scale > 4) {
        throw new Error("--scale must be a number between 0.01 and 4.");
      }
      index += 1;
    } else if (arg === "--format") {
      if (!next) throw new Error("Missing value for --format.");
      if (!["png", "jpg", "svg", "pdf"].includes(next)) {
        throw new Error("--format must be one of png, jpg, svg, pdf.");
      }
      options.format = next as FigmaOptions["format"];
      index += 1;
    } else if (arg === "--api-base-url") {
      if (!next) throw new Error("Missing value for --api-base-url.");
      options.apiBaseUrl = next;
      index += 1;
    } else if (arg === "--override-set") {
      if (!next) throw new Error("Missing value for --override-set.");
      options.overrideSet = next;
      index += 1;
    } else {
      throw new Error(`Unknown figma option "${arg}".`);
    }
  }

  if (!options.file) throw new Error("Missing required option --file. This may be a Figma URL or file key.");
  if (!options.out) throw new Error("Missing required option --out.");
  return options as FigmaOptions;
}

function parseFigmaCheckOptions(args: string[]): FigmaCheckOptions {
  const options: Partial<FigmaCheckOptions> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--file" || arg === "--url" || arg === "-f") {
      if (!next) throw new Error(`Missing value for ${arg}.`);
      options.file = next;
      index += 1;
    } else if (arg === "--node" || arg === "--node-id" || arg === "-n") {
      if (!next) throw new Error(`Missing value for ${arg}.`);
      options.node = next;
      index += 1;
    } else if (arg === "--token") {
      if (!next) throw new Error("Missing value for --token.");
      options.token = next;
      index += 1;
    } else if (arg === "--api-base-url") {
      if (!next) throw new Error("Missing value for --api-base-url.");
      options.apiBaseUrl = next;
      index += 1;
    } else {
      throw new Error(`Unknown figma check option "${arg}".`);
    }
  }

  if (!options.file) throw new Error("Missing required option --file. This may be a Figma URL or file key.");
  return options as FigmaCheckOptions;
}

function parseFigmaFramesOptions(args: string[]): FigmaFramesOptions {
  const options: Partial<FigmaFramesOptions> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--file" || arg === "--url" || arg === "-f") {
      if (!next) throw new Error(`Missing value for ${arg}.`);
      options.file = next;
      index += 1;
    } else if (arg === "--token") {
      if (!next) throw new Error("Missing value for --token.");
      options.token = next;
      index += 1;
    } else if (arg === "--api-base-url") {
      if (!next) throw new Error("Missing value for --api-base-url.");
      options.apiBaseUrl = next;
      index += 1;
    } else if (arg === "--json") {
      options.json = true;
    } else {
      throw new Error(`Unknown figma frames option "${arg}".`);
    }
  }

  if (!options.file) throw new Error("Missing required option --file. This may be a Figma URL or file key.");
  return options as FigmaFramesOptions;
}

async function readFigmaTokenFromEnvironment(): Promise<string | undefined> {
  if (process.env.FIGMA_ACCESS_TOKEN) return process.env.FIGMA_ACCESS_TOKEN;
  try {
    const dotenv = await readFile(resolve(process.cwd(), ".env"), "utf8");
    for (const line of dotenv.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^FIGMA_ACCESS_TOKEN\s*=\s*(.*)$/);
      if (!match) continue;
      const value = match[1].replace(/^['"]|['"]$/g, "").trim();
      return value || undefined;
    }
  } catch (error) {
    const candidate = error as NodeJS.ErrnoException;
    if (candidate.code !== "ENOENT") throw error;
  }
  return undefined;
}

function parsePreviewDiffOptions(args: string[]): PreviewDiffOptions {
  const options: Partial<PreviewDiffOptions> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--reference" || arg === "--ref") {
      if (!next) throw new Error(`Missing value for ${arg}.`);
      options.reference = next;
      index += 1;
    } else if (arg === "--candidate" || arg === "--flutter" || arg === "--actual") {
      if (!next) throw new Error(`Missing value for ${arg}.`);
      options.candidate = next;
      index += 1;
    } else if (arg === "--node-pixel-map") {
      if (!next) throw new Error("Missing value for --node-pixel-map.");
      options.nodePixelMap = next;
      index += 1;
    } else if (arg === "--out" || arg === "-o") {
      if (!next) throw new Error("Missing value for --out.");
      options.out = next;
      index += 1;
    } else if (arg === "--viewport") {
      if (!next) throw new Error("Missing value for --viewport.");
      const match = next.match(/^(\d+)x(\d+)$/);
      if (!match) throw new Error("--viewport must use WIDTHxHEIGHT, for example 390x844.");
      options.viewport = { width: Number(match[1]), height: Number(match[2]) };
      index += 1;
    } else if (arg === "--dpr") {
      if (!next) throw new Error("Missing value for --dpr.");
      options.dpr = Number(next);
      if (!Number.isFinite(options.dpr) || options.dpr <= 0) throw new Error("--dpr must be a positive number.");
      index += 1;
    } else {
      throw new Error(`Unknown preview diff option "${arg}".`);
    }
  }

  if (!options.reference) throw new Error("Missing required option --reference.");
  if (!options.candidate) throw new Error("Missing required option --candidate.");
  if (!options.out) throw new Error("Missing required option --out.");
  return options as PreviewDiffOptions;
}

function parsePreviewCaptureOptions(args: string[]): PreviewCaptureOptions {
  const options: Partial<PreviewCaptureOptions> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--project") {
      if (!next) throw new Error("Missing value for --project.");
      options.project = next;
      index += 1;
    } else if (arg === "--out" || arg === "-o") {
      if (!next) throw new Error("Missing value for --out.");
      options.out = next;
      index += 1;
    } else {
      throw new Error(`Unknown preview capture option "${arg}".`);
    }
  }
  if (!options.project) throw new Error("Missing required option --project.");
  if (!options.out) throw new Error("Missing required option --out.");
  return options as PreviewCaptureOptions;
}

function parseProjectOptions(args: string[]): ProjectCliOptions {
  const options: ProjectCliOptions = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--root") {
      if (!next) throw new Error("Missing value for --root.");
      options.root = next;
      index += 1;
    } else if (arg === "--id") {
      if (!next) throw new Error("Missing value for --id.");
      options.id = next;
      index += 1;
    } else if (arg === "--name") {
      if (!next) throw new Error("Missing value for --name.");
      options.name = next;
      index += 1;
    } else if (arg === "--project" || arg === "--project-id") {
      if (!next) throw new Error(`Missing value for ${arg}.`);
      options.project = next;
      index += 1;
    } else if (arg === "--artifacts") {
      if (!next) throw new Error("Missing value for --artifacts.");
      options.artifacts = next;
      index += 1;
    } else if (arg === "--snapshot-id") {
      if (!next) throw new Error("Missing value for --snapshot-id.");
      options.snapshotId = next;
      index += 1;
    } else if (arg === "--out" || arg === "-o") {
      if (!next) throw new Error("Missing value for --out.");
      options.out = next;
      index += 1;
    } else if (arg === "--input" || arg === "-i") {
      if (!next) throw new Error("Missing value for --input.");
      options.input = next;
      index += 1;
    } else if (arg === "--figma-file-key") {
      if (!next) throw new Error("Missing value for --figma-file-key.");
      options.figmaFileKey = next;
      index += 1;
    } else if (arg === "--figma-page-id") {
      if (!next) throw new Error("Missing value for --figma-page-id.");
      options.figmaPageId = next;
      index += 1;
    } else if (arg === "--figma-frame-id") {
      if (!next) throw new Error("Missing value for --figma-frame-id.");
      options.figmaFrameId = next;
      index += 1;
    } else if (arg === "--figma-frame-name") {
      if (!next) throw new Error("Missing value for --figma-frame-name.");
      options.figmaFrameName = next;
      index += 1;
    } else if (arg === "--flutter-project-path") {
      if (!next) throw new Error("Missing value for --flutter-project-path.");
      options.flutterProjectPath = next;
      index += 1;
    } else if (arg === "--package-name") {
      if (!next) throw new Error("Missing value for --package-name.");
      options.packageName = next;
      index += 1;
    } else if (arg === "--status") {
      if (!next) throw new Error("Missing value for --status.");
      if (!["draft", "reviewing", "ready", "invalid", "archived"].includes(next)) {
        throw new Error("--status must be one of draft, reviewing, ready, invalid, archived.");
      }
      options.status = next as ProjectCliOptions["status"];
      index += 1;
    } else if (arg === "--new-project-id") {
      if (!next) throw new Error("Missing value for --new-project-id.");
      options.newProjectId = next;
      index += 1;
    } else if (arg === "--replace") {
      options.replace = true;
    } else if (arg === "--json") {
      options.json = true;
    } else {
      throw new Error(`Unknown project option "${arg}".`);
    }
  }
  return options;
}

function requiredProject(options: ProjectCliOptions): string {
  if (!options.project) throw new Error("Missing required option --project.");
  return options.project;
}

function parseTreeApplyOptions(args: string[]): TreeApplyOptions {
  const options: Partial<TreeApplyOptions> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--artifacts") {
      if (!next) throw new Error("Missing value for --artifacts.");
      options.artifacts = next;
      index += 1;
    } else if (arg === "--operations") {
      if (!next) throw new Error("Missing value for --operations.");
      options.operations = next;
      index += 1;
    } else if (arg === "--out" || arg === "-o") {
      if (!next) throw new Error("Missing value for --out.");
      options.out = next;
      index += 1;
    } else if (arg === "--actor") {
      if (!next) throw new Error("Missing value for --actor.");
      if (!["user", "agent", "system"].includes(next)) throw new Error("--actor must be one of user, agent, system.");
      options.actor = next as TreeApplyOptions["actor"];
      index += 1;
    } else {
      throw new Error(`Unknown tree apply option "${arg}".`);
    }
  }
  if (!options.artifacts) throw new Error("Missing required option --artifacts.");
  if (!options.operations) throw new Error("Missing required option --operations.");
  if (!options.out) throw new Error("Missing required option --out.");
  return options as TreeApplyOptions;
}

function parseStudioApplyOptions(args: string[]): StudioApplyOptions {
  const options: Partial<StudioApplyOptions> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--artifacts") {
      if (!next) throw new Error("Missing value for --artifacts.");
      options.artifacts = next;
      index += 1;
    } else if (arg === "--operations") {
      if (!next) throw new Error("Missing value for --operations.");
      options.operations = next;
      index += 1;
    } else if (arg === "--out" || arg === "-o") {
      if (!next) throw new Error("Missing value for --out.");
      options.out = next;
      index += 1;
    } else if (arg === "--actor") {
      if (!next) throw new Error("Missing value for --actor.");
      if (!["user", "agent", "system"].includes(next)) throw new Error("--actor must be one of user, agent, system.");
      options.actor = next as StudioApplyOptions["actor"];
      index += 1;
    } else {
      throw new Error(`Unknown studio apply option "${arg}".`);
    }
  }
  if (!options.artifacts) throw new Error("Missing required option --artifacts.");
  if (!options.operations) throw new Error("Missing required option --operations.");
  if (!options.out) throw new Error("Missing required option --out.");
  return options as StudioApplyOptions;
}

function parseCodegenReviewOptions(args: string[]): CodegenReviewOptions {
  const options: Partial<CodegenReviewOptions> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--artifacts") {
      if (!next) throw new Error("Missing value for --artifacts.");
      options.artifacts = next;
      index += 1;
    } else if (arg === "--out" || arg === "-o") {
      if (!next) throw new Error("Missing value for --out.");
      options.out = next;
      index += 1;
    } else if (arg === "--project-path") {
      if (!next) throw new Error("Missing value for --project-path.");
      options.projectPath = next;
      index += 1;
    } else if (arg === "--previous-manifest") {
      if (!next) throw new Error("Missing value for --previous-manifest.");
      options.previousManifest = next;
      index += 1;
    } else if (arg === "--project-id") {
      if (!next) throw new Error("Missing value for --project-id.");
      options.projectId = next;
      index += 1;
    } else if (arg === "--build-id") {
      if (!next) throw new Error("Missing value for --build-id.");
      options.buildId = next;
      index += 1;
    } else if (arg === "--normalized-ir-id") {
      if (!next) throw new Error("Missing value for --normalized-ir-id.");
      options.normalizedIrId = next;
      index += 1;
    } else if (arg === "--allow-low-visual-score") {
      options.allowLowVisualScore = true;
    } else {
      throw new Error(`Unknown codegen review option "${arg}".`);
    }
  }
  if (!options.artifacts) throw new Error("Missing required option --artifacts.");
  if (!options.out) throw new Error("Missing required option --out.");
  return options as CodegenReviewOptions;
}

function parseCodegenWriteOptions(args: string[]): CodegenWriteOptions {
  const options: Partial<CodegenWriteOptions> & { assetRoots: string[] } = { assetRoots: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--review") {
      if (!next) throw new Error("Missing value for --review.");
      options.review = next;
      index += 1;
    } else if (arg === "--project-path") {
      if (!next) throw new Error("Missing value for --project-path.");
      options.projectPath = next;
      index += 1;
    } else if (arg === "--out" || arg === "-o") {
      if (!next) throw new Error("Missing value for --out.");
      options.out = next;
      index += 1;
    } else if (arg === "--asset-root") {
      if (!next) throw new Error("Missing value for --asset-root.");
      options.assetRoots.push(next);
      index += 1;
    } else if (arg === "--backup-root") {
      if (!next) throw new Error("Missing value for --backup-root.");
      options.backupRoot = next;
      index += 1;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--allow-blocked") {
      options.allowBlocked = true;
    } else {
      throw new Error(`Unknown codegen write option "${arg}".`);
    }
  }
  if (!options.review) throw new Error("Missing required option --review.");
  if (!options.projectPath) throw new Error("Missing required option --project-path.");
  return options as CodegenWriteOptions;
}

function parseCodegenPromoteOptions(args: string[]): CodegenPromoteOptions {
  const options: Partial<CodegenPromoteOptions> & { sourceNodeIds: string[] } = { sourceNodeIds: [] };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--review") {
      if (!next) throw new Error("Missing value for --review.");
      options.review = next;
      index += 1;
    } else if (arg === "--file") {
      if (!next) throw new Error("Missing value for --file.");
      options.file = next;
      index += 1;
    } else if (arg === "--component-id") {
      if (!next) throw new Error("Missing value for --component-id.");
      options.componentId = next;
      index += 1;
    } else if (arg === "--name") {
      if (!next) throw new Error("Missing value for --name.");
      options.name = next;
      index += 1;
    } else if (arg === "--source-node-id" || arg === "--source-node") {
      if (!next) throw new Error(`Missing value for ${arg}.`);
      options.sourceNodeIds.push(next);
      index += 1;
    } else if (arg === "--import") {
      if (!next) throw new Error("Missing value for --import.");
      options.import = next;
      index += 1;
    } else if (arg === "--constructor") {
      if (!next) throw new Error("Missing value for --constructor.");
      options.flutterConstructor = next;
      index += 1;
    } else if (arg === "--out" || arg === "-o") {
      if (!next) throw new Error("Missing value for --out.");
      options.out = next;
      index += 1;
    } else if (arg === "--registry") {
      if (!next) throw new Error("Missing value for --registry.");
      options.registry = next;
      index += 1;
    } else if (arg === "--rules") {
      if (!next) throw new Error("Missing value for --rules.");
      options.rules = next;
      index += 1;
    } else if (arg === "--reason") {
      if (!next) throw new Error("Missing value for --reason.");
      options.reason = next;
      index += 1;
    } else if (arg === "--allow-manual-file") {
      options.allowManualFile = true;
    } else {
      throw new Error(`Unknown codegen promote option "${arg}".`);
    }
  }
  if (!options.review) throw new Error("Missing required option --review.");
  if (!options.file) throw new Error("Missing required option --file.");
  if (!options.componentId) throw new Error("Missing required option --component-id.");
  if (!options.name) throw new Error("Missing required option --name.");
  if (!options.import) throw new Error("Missing required option --import.");
  if (!options.flutterConstructor) throw new Error("Missing required option --constructor.");
  if (!options.reason) throw new Error("Missing required option --reason.");
  return options as CodegenPromoteOptions;
}

function parseSyncRemapOptions(args: string[]): SyncRemapOptions {
  const options: Partial<SyncRemapOptions> = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--old-raw") {
      if (!next) throw new Error("Missing value for --old-raw.");
      options.oldRaw = next;
      index += 1;
    } else if (arg === "--new-raw") {
      if (!next) throw new Error("Missing value for --new-raw.");
      options.newRaw = next;
      index += 1;
    } else if (arg === "--override-set") {
      if (!next) throw new Error("Missing value for --override-set.");
      options.overrideSet = next;
      index += 1;
    } else if (arg === "--out" || arg === "-o") {
      if (!next) throw new Error("Missing value for --out.");
      options.out = next;
      index += 1;
    } else if (arg === "--old-snapshot-id") {
      if (!next) throw new Error("Missing value for --old-snapshot-id.");
      options.oldSnapshotId = next;
      index += 1;
    } else if (arg === "--new-snapshot-id") {
      if (!next) throw new Error("Missing value for --new-snapshot-id.");
      options.newSnapshotId = next;
      index += 1;
    } else if (arg === "--old-visual-diff") {
      if (!next) throw new Error("Missing value for --old-visual-diff.");
      options.oldVisualDiff = next;
      index += 1;
    } else if (arg === "--new-visual-diff") {
      if (!next) throw new Error("Missing value for --new-visual-diff.");
      options.newVisualDiff = next;
      index += 1;
    } else {
      throw new Error(`Unknown sync remap option "${arg}".`);
    }
  }
  if (!options.oldRaw) throw new Error("Missing required option --old-raw.");
  if (!options.newRaw) throw new Error("Missing required option --new-raw.");
  if (!options.overrideSet) throw new Error("Missing required option --override-set.");
  if (!options.out) throw new Error("Missing required option --out.");
  return options as SyncRemapOptions;
}

async function writeFigmaSnapshot(outDir: string, extraction: FigmaExtractionResult): Promise<void> {
  await mkdir(resolve(outDir, "raw_assets"), { recursive: true });
  await writeFile(resolve(outDir, "raw_figma_scene.json"), `${JSON.stringify(extraction.rawFigmaScene, null, 2)}\n`, "utf8");
  await writeFile(resolve(outDir, "extraction_report.json"), `${JSON.stringify(extraction.extractionReport, null, 2)}\n`, "utf8");
  if (extraction.referenceImage) {
    await writeFile(resolve(outDir, `figma_reference.${extraction.referenceImageExtension}`), extraction.referenceImage);
  }
}

async function writeArtifacts(outDir: string, artifacts: PipelineArtifacts, inputPath: string): Promise<void> {
  const files: Array<[string, unknown | string]> = [
    ["raw_figma_scene.json", artifacts.rawFigmaScene],
    ["canonical_scene.json", artifacts.canonicalScene],
    ["canonicalization_report.json", artifacts.canonicalizationReport],
    ["node_mapping.json", artifacts.nodeMapping],
    ["inferred_tokens.json", artifacts.inferredTokens],
    ["token_usage_map.json", artifacts.tokenUsageMap],
    ["token_confidence_report.json", artifacts.tokenConfidenceReport],
    ["dart_tokens.dart", artifacts.dartTokenFile],
    ["asset_manifest.json", artifacts.assetManifest],
    ["i18n_manifest.json", artifacts.i18nManifest],
    ["arb/app_en.arb", artifacts.arbFile],
    ["override_set.json", artifacts.overrideSet],
    ["reviewed_normalized_design_ir.json", artifacts.reviewedNormalizedDesignIR],
    ["reviewed_asset_manifest.json", artifacts.reviewedAssetManifest],
    ["reviewed_i18n_manifest.json", artifacts.reviewedI18nManifest],
    ["reviewed_inferred_tokens.json", artifacts.reviewedInferredTokens],
    ["reviewed_arb/app_en.arb", artifacts.reviewedArbFile],
    ["override_conflict_report.json", artifacts.overrideConflictReport],
    ["stale_override_report.json", artifacts.staleOverrideReport],
    ["visual_ir.json", artifacts.visualIR],
    ["web_preview_state.json", createWebPreviewState(artifacts.visualIR)],
    ["fidelity_generation_manifest.json", artifacts.fidelityGenerationManifest],
    ["node_pixel_map.json", artifacts.nodePixelMap],
    ["review_tasks.json", artifacts.reviewTasks],
    ["task_status_report.json", artifacts.taskStatusReport],
    ["regions.json", artifacts.regions],
    ["layout_candidates.json", artifacts.layoutCandidates],
    ["layout_decisions.json", artifacts.layoutDecisions],
    ["inferred_components.json", artifacts.inferredComponents],
    ["component_instance_map.json", artifacts.componentInstanceMap],
    ["component_confidence_report.json", artifacts.componentConfidenceReport],
    ["semantic_labels.json", artifacts.semanticLabels],
    ["ai_decision_report.json", artifacts.aiDecisionReport],
    ["naming_map.json", artifacts.namingMap],
    ["i18n_key_suggestions.json", artifacts.i18nKeySuggestions],
    ["semantic_ir.json", artifacts.semanticIR],
    ["uplift_decisions.json", artifacts.upliftDecisions],
    ["uplift_diff_report.json", artifacts.upliftDiffReport],
    ["normalization_report.json", artifacts.normalizationReport],
    ["render_strategy_manifest.json", artifacts.renderStrategyManifest],
    ["normalized_design_ir.json", artifacts.normalizedDesignIR],
    [
      "compile_manifest.json",
      {
        version: "0.1.0",
        input: inputPath,
        generatedAt: new Date().toISOString(),
        artifacts: [
          "raw_figma_scene.json",
          "canonical_scene.json",
          "canonicalization_report.json",
          "node_mapping.json",
          "inferred_tokens.json",
          "token_usage_map.json",
          "token_confidence_report.json",
          "dart_tokens.dart",
          "asset_manifest.json",
          "i18n_manifest.json",
          "arb/app_en.arb",
          "override_set.json",
          "reviewed_normalized_design_ir.json",
          "reviewed_asset_manifest.json",
          "reviewed_i18n_manifest.json",
          "reviewed_inferred_tokens.json",
          "reviewed_arb/app_en.arb",
          "override_conflict_report.json",
          "stale_override_report.json",
          "visual_ir.json",
          "web_preview_state.json",
          "fidelity_generation_manifest.json",
          "node_pixel_map.json",
          "review_tasks.json",
          "task_status_report.json",
          "flutter_preview/pubspec.yaml",
          "flutter_preview/lib/main.dart",
          "flutter_preview/lib/generated/fidelity/preview_page.dart",
          "flutter_preview/test/preview_test.dart",
          "flutter_preview/test/golden_preview_test.dart",
          "flutter_preview_format_report.json",
          "flutter_preview_analyze_report.json",
          "regions.json",
          "layout_candidates.json",
          "layout_decisions.json",
          "inferred_components.json",
          "component_instance_map.json",
          "component_confidence_report.json",
          "semantic_labels.json",
          "ai_decision_report.json",
          "naming_map.json",
          "i18n_key_suggestions.json",
          "semantic_ir.json",
          "uplift_decisions.json",
          "uplift_diff_report.json",
          "normalization_report.json",
          "render_strategy_manifest.json",
          "normalized_design_ir.json"
        ]
      }
    ]
  ];

  await mkdir(outDir, { recursive: true });
  await Promise.all(
    files.map(async ([name, content]) => {
      const target = resolve(outDir, name);
      await mkdir(dirname(target), { recursive: true });
      const body = typeof content === "string" ? content : `${JSON.stringify(content, null, 2)}\n`;
      await writeFile(target, body, "utf8");
    })
  );
  const previewDir = resolve(outDir, "flutter_preview");
  await rm(previewDir, { recursive: true, force: true });
  await Promise.all(
    Object.entries(artifacts.flutterPreviewProject.files).map(async ([name, content]) => {
      const target = resolve(previewDir, name);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, content, "utf8");
    })
  );
  const formatReport = await formatFlutterPreview(previewDir);
  const analyzeReport = await analyzeFlutterPreview(previewDir);
  await Promise.all([
    writeFile(resolve(outDir, "flutter_preview_format_report.json"), `${JSON.stringify(formatReport, null, 2)}\n`, "utf8"),
    writeFile(resolve(outDir, "flutter_preview_analyze_report.json"), `${JSON.stringify(analyzeReport, null, 2)}\n`, "utf8")
  ]);
}

async function writeRuntimeReviewTaskArtifacts(outDir: string, artifacts: PipelineArtifacts, runReport: FigmaRunReport): Promise<void> {
  const visualDiffReport = await readVisualDiffReport(runReport.steps.visualDiff.report);
  const overrideResult = applyOverrides({
    normalizedDesignIR: artifacts.normalizedDesignIR,
    assetManifest: artifacts.assetManifest,
    i18nManifest: artifacts.i18nManifest,
    inferredTokens: artifacts.inferredTokens,
    overrideSet: artifacts.overrideSet
  });
  const result = generateReviewTasks({
    normalizedDesignIR: overrideResult.reviewedNormalizedDesignIR,
    layoutCandidates: artifacts.layoutCandidates,
    layoutDecisions: artifacts.layoutDecisions,
    inferredTokens: overrideResult.reviewedInferredTokens,
    tokenConfidenceReport: artifacts.tokenConfidenceReport,
    assetManifest: overrideResult.reviewedAssetManifest,
    i18nManifest: overrideResult.reviewedI18nManifest,
    fidelityGenerationManifest: artifacts.fidelityGenerationManifest,
    overrideSet: overrideResult.overrideSet,
    staleOverrideReport: overrideResult.staleOverrideReport,
    visualDiffReport,
    flutterCapture: {
      status: runReport.steps.flutterCapture.status
    }
  });
  await writeFile(resolve(outDir, "review_tasks.json"), `${JSON.stringify(result.reviewTasks, null, 2)}\n`, "utf8");
  await writeFile(resolve(outDir, "task_status_report.json"), `${JSON.stringify(result.taskStatusReport, null, 2)}\n`, "utf8");
  await writeFile(resolve(outDir, "reviewed_normalized_design_ir.json"), `${JSON.stringify(overrideResult.reviewedNormalizedDesignIR, null, 2)}\n`, "utf8");
  await writeFile(resolve(outDir, "reviewed_asset_manifest.json"), `${JSON.stringify(overrideResult.reviewedAssetManifest, null, 2)}\n`, "utf8");
  await writeFile(resolve(outDir, "reviewed_i18n_manifest.json"), `${JSON.stringify(overrideResult.reviewedI18nManifest, null, 2)}\n`, "utf8");
  await writeFile(resolve(outDir, "reviewed_inferred_tokens.json"), `${JSON.stringify(overrideResult.reviewedInferredTokens, null, 2)}\n`, "utf8");
  await mkdir(resolve(outDir, "reviewed_arb"), { recursive: true });
  await writeFile(resolve(outDir, "reviewed_arb/app_en.arb"), `${JSON.stringify(overrideResult.reviewedArbFile, null, 2)}\n`, "utf8");
  await writeFile(resolve(outDir, "override_conflict_report.json"), `${JSON.stringify(overrideResult.overrideConflictReport, null, 2)}\n`, "utf8");
  await writeFile(resolve(outDir, "stale_override_report.json"), `${JSON.stringify(overrideResult.staleOverrideReport, null, 2)}\n`, "utf8");
}

async function readVisualDiffReport(path: string | undefined): Promise<VisualDiffReport | undefined> {
  if (!path) return undefined;
  try {
    return JSON.parse(await readFile(path, "utf8")) as VisualDiffReport;
  } catch {
    return undefined;
  }
}

async function readOverrideSet(path: string): Promise<OverrideSet> {
  return JSON.parse(await readFile(resolve(process.cwd(), path), "utf8")) as OverrideSet;
}

async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(resolve(process.cwd(), path), "utf8")) as T;
}

async function readOptionalJsonFile<T>(path: string): Promise<T | undefined> {
  try {
    return await readJsonFile<T>(path);
  } catch (error) {
    const candidate = error as NodeJS.ErrnoException;
    if (candidate.code === "ENOENT") return undefined;
    throw error;
  }
}

async function readCodegenFormatSummary(artifactDir: string): Promise<CodegenFormatSummary | undefined> {
  const candidates: Array<[string, string]> = [
    ["flutter_preview_format_report.json", "flutter_preview_format_report.json"],
    ["format_report.json", "format_report.json"],
    ["dart_format_report.json", "dart_format_report.json"]
  ];
  for (const [file, source] of candidates) {
    const summary = normalizeFormatSummary(await readOptionalJsonFile<Record<string, unknown>>(resolve(artifactDir, file)), source);
    if (summary) return summary;
  }
  return undefined;
}

async function readCodegenAnalyzeSummary(artifactDir: string): Promise<CodegenAnalyzeSummary | undefined> {
  const candidates: Array<[string, string]> = [
    ["flutter_analyze_report.json", "flutter_analyze_report.json"],
    ["analyze_report.json", "analyze_report.json"],
    ["flutter_preview_analyze_report.json", "flutter_preview_analyze_report.json"],
    ["flutter_preview_capture_report.json", "flutter_preview_capture_report.json"]
  ];
  for (const [file, source] of candidates) {
    const summary = normalizeAnalyzeSummary(await readOptionalJsonFile<Record<string, unknown>>(resolve(artifactDir, file)), source);
    if (summary) return summary;
  }
  return undefined;
}

function normalizeFormatSummary(value: Record<string, unknown> | undefined, source: string): CodegenFormatSummary | undefined {
  if (!value) return undefined;
  const statusValue = stringValue(value.status)?.toLowerCase();
  const exitCode = numberValue(value.exitCode);
  const status: CodegenFormatSummary["status"] =
    statusValue === "success" || exitCode === 0
      ? "success"
      : statusValue === "skipped"
        ? "skipped"
        : statusValue === "failed" || statusValue === "error" || statusValue === "failure" || (exitCode ?? 0) > 0
          ? "failed"
          : "unknown";
  return {
    status,
    source,
    command: stringValue(value.command),
    stdout: stringValue(value.stdout),
    stderr: stringValue(value.stderr),
    raw: value
  };
}

function normalizeAnalyzeSummary(value: Record<string, unknown> | undefined, source: string): CodegenAnalyzeSummary | undefined {
  if (!value) return undefined;
  const summary = objectValue(value.summary) ?? objectValue(value.analyze) ?? value;
  const diagnostics = arrayValue(value.diagnostics) ?? arrayValue(value.issues) ?? [];
  const diagnosticErrors = diagnostics.filter((entry) => severityValue(entry) === "error").length;
  const diagnosticWarnings = diagnostics.filter((entry) => severityValue(entry) === "warning").length;
  const output = [value.stdout, value.stderr, value.output, value.analyzerOutput, value.analyzeOutput]
    .map((entry) => (typeof entry === "string" ? entry : ""))
    .filter(Boolean)
    .join("\n");
  const parsed = parseAnalyzeOutput(output);
  return {
    errors:
      numberValue(summary.errors) ??
      numberValue(summary.errorCount) ??
      numberValue(value.errorCount) ??
      (diagnostics.length > 0 ? diagnosticErrors : parsed.errors),
    warnings:
      numberValue(summary.warnings) ??
      numberValue(summary.warningCount) ??
      numberValue(value.warningCount) ??
      (diagnostics.length > 0 ? diagnosticWarnings : parsed.warnings),
    source,
    stdout: stringValue(value.stdout),
    stderr: stringValue(value.stderr),
    raw: value
  };
}

function parseAnalyzeOutput(output: string): { errors: number; warnings: number } {
  const result = { errors: 0, warnings: 0 };
  if (!output.trim()) return result;
  for (const line of output.split(/\r?\n/)) {
    const lower = line.toLowerCase();
    const errorSummary = lower.match(/\b(\d+)\s+errors?\b/);
    const warningSummary = lower.match(/\b(\d+)\s+warnings?\b/);
    if (errorSummary) result.errors = Math.max(result.errors, Number(errorSummary[1]));
    if (warningSummary) result.warnings = Math.max(result.warnings, Number(warningSummary[1]));
    if (/\berror\s*[•:-]/.test(lower) || /:\s*error\s*$/.test(lower)) result.errors += 1;
    if (/\bwarning\s*[•:-]/.test(lower) || /:\s*warning\s*$/.test(lower)) result.warnings += 1;
  }
  return result;
}

function createWebPreviewState(visualIR: unknown): Record<string, unknown> {
  const root = objectValue(objectValue(visualIR)?.root);
  const size = objectValue(root?.size);
  const viewport = {
    width: numberValue(size?.w) ?? 0,
    height: numberValue(size?.h) ?? 0
  };
  const warnings: Array<{ type: string; message: string; sourceNodeId?: string }> = [];
  const commands: Array<Record<string, unknown>> = [];
  for (const child of arrayValue(root?.children) ?? []) {
    collectWebPreviewCommands(child, 0, 0, commands, warnings);
  }
  if (commands.length === 0) {
    warnings.push({ type: "empty_preview", message: "VisualIR did not contain drawable web preview nodes." });
  }
  return {
    version: "0.1.0",
    generatedAt: new Date().toISOString(),
    renderer: "web_canvas_state",
    viewport,
    commands,
    warnings
  };
}

function collectWebPreviewCommands(
  nodeValue: unknown,
  offsetX: number,
  offsetY: number,
  commands: Array<Record<string, unknown>>,
  warnings: Array<{ type: string; message: string; sourceNodeId?: string }>
): void {
  const node = objectValue(nodeValue);
  if (!node) return;
  const type = stringValue(node.type);
  if (type === "positioned") {
    const x = offsetX + (numberValue(node.x) ?? 0);
    const y = offsetY + (numberValue(node.y) ?? 0);
    collectWebPreviewCommands(node.child, x, y, commands, warnings);
    return;
  }
  if (type === "stack" || type === "scene") {
    for (const child of arrayValue(node.children) ?? []) collectWebPreviewCommands(child, offsetX, offsetY, commands, warnings);
    return;
  }
  const sourceNodeId = stringValue(node.sourceNodeId);
  const w = numberValue(node.w) ?? 0;
  const h = numberValue(node.h) ?? 0;
  if (w <= 0 || h <= 0) {
    warnings.push({ type: "invalid_bounds", message: "Skipped a web preview node with non-positive bounds.", sourceNodeId });
    return;
  }
  if (type === "rect") {
    commands.push({
      type: "rect",
      sourceNodeId,
      x: offsetX,
      y: offsetY,
      w,
      h,
      fill: stringValue(node.fill) ?? "#ffffff",
      stroke: stringValue(node.stroke),
      strokeWidth: numberValue(node.strokeWidth),
      radius: numberValue(node.radius),
      opacity: numberValue(node.opacity)
    });
    return;
  }
  if (type === "text") {
    commands.push({
      type: "text",
      sourceNodeId,
      x: offsetX,
      y: offsetY,
      w,
      h,
      text: stringValue(node.text) ?? "",
      color: stringValue(node.color) ?? "#111111",
      fontFamily: stringValue(node.fontFamily) ?? "Inter, system-ui, sans-serif",
      fontSize: numberValue(node.fontSize) ?? 14,
      fontWeight: numberValue(node.fontWeight) ?? 400,
      lineHeight: numberValue(node.lineHeight)
    });
    return;
  }
  if (type === "image") {
    commands.push({
      type: "image",
      sourceNodeId,
      x: offsetX,
      y: offsetY,
      w,
      h,
      mode: stringValue(node.mode) ?? "placeholder",
      assetPath: stringValue(node.assetPath)
    });
    return;
  }
  warnings.push({ type: "unsupported_node", message: `Skipped unsupported VisualIR node type: ${type ?? "unknown"}.`, sourceNodeId });
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function arrayValue(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function severityValue(value: unknown): string | undefined {
  const severity = objectValue(value)?.severity;
  return typeof severity === "string" ? severity.toLowerCase() : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function collectFontFamilies(artifacts: PipelineArtifacts): string[] {
  const typography = artifacts.reviewedNormalizedDesignIR.tokens?.typography ?? artifacts.normalizedDesignIR.tokens?.typography ?? [];
  return [...new Set(typography.map((token) => token.fontFamily).filter((fontFamily) => typeof fontFamily === "string" && fontFamily.length > 0))].sort(
    (left, right) => left.localeCompare(right)
  );
}

async function writeJsonFile(path: string, value: unknown): Promise<void> {
  const target = resolve(process.cwd(), path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeCodegenReviewArtifacts(outDir: string, result: CodegenReviewResult): Promise<void> {
  await mkdir(outDir, { recursive: true });
  await Promise.all([
    writeJsonFile(resolve(outDir, "codegen_review.json"), result.codegenReview),
    writeJsonFile(resolve(outDir, "flutter_generation_manifest.json"), result.codegenReview),
    writeJsonFile(resolve(outDir, "files_to_create.json"), result.filesToCreate),
    writeJsonFile(resolve(outDir, "files_to_modify.json"), result.filesToModify),
    writeJsonFile(resolve(outDir, "assets_to_add.json"), result.assetsToAdd),
    writeJsonFile(resolve(outDir, "arb_patch.json"), result.arbPatch),
    writeFileWithDirs(resolve(outDir, "pubspec.yaml.patch"), result.pubspecPatch.patch),
    writeJsonFile(resolve(outDir, "pubspec_patch.json"), result.pubspecPatch),
    writeJsonFile(resolve(outDir, "merge_report.json"), result.mergeReport),
    writeJsonFile(resolve(outDir, "incremental_sync_report.json"), result.incrementalSyncReport),
    ...result.generatedFiles.map((file) => writeFileWithDirs(resolve(outDir, "generated", file.path), file.content)),
    ...result.filePatches.map((patch) => writeFileWithDirs(resolve(outDir, patch.patchPath), patch.patch))
  ]);
}

async function readFirstJsonFile<T>(paths: string[]): Promise<T> {
  const attempted: string[] = [];
  for (const path of paths) {
    attempted.push(path);
    try {
      return await readJsonFile<T>(path);
    } catch (error) {
      const candidate = error as NodeJS.ErrnoException;
      if (candidate.code !== "ENOENT") throw error;
    }
  }
  throw new Error(`Missing required JSON artifact. Tried: ${attempted.join(", ")}`);
}

async function readTextFilesRecursively(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const walk = async (dir: string, prefix: string): Promise<void> => {
    const entries = await readdir(dir, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = resolve(dir, entry.name);
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(fullPath, relativePath);
        } else if (entry.isFile()) {
          files[relativePath] = await readFile(fullPath, "utf8");
        }
      })
    );
  };
  await walk(root, "");
  return files;
}

async function readExistingProjectFiles(projectRoot: string, paths: string[]): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  await Promise.all(
    paths.map(async (path) => {
      try {
        files[path] = await readFile(resolve(projectRoot, path), "utf8");
      } catch (error) {
        const candidate = error as NodeJS.ErrnoException;
        if (candidate.code !== "ENOENT") throw error;
      }
    })
  );
  return files;
}

async function readGeneratedFiles(root: string): Promise<CodegenGeneratedFile[]> {
  const files = await readTextFilesRecursively(root);
  return Object.entries(files)
    .map(([path, content]) => ({ path, content }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function normalizeGeneratedFilePath(path: string): string {
  return path.replace(/^generated\//, "").replace(/^\/+/, "");
}

async function writeFileWithDirs(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

async function formatFlutterPreview(previewDir: string): Promise<Record<string, unknown>> {
  try {
    const result = await execFileAsync("dart", ["format", "lib", "test"], {
      cwd: previewDir
    });
    return {
      status: "success",
      command: "dart format lib test",
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    const candidate = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: string | number };
    if (candidate.code === "ENOENT") {
      return {
        status: "skipped",
        command: "dart format lib test",
        reason: "dart command was not found"
      };
    }
    throw new Error(`dart format failed: ${candidate.stderr ?? candidate.message}`);
  }
}

async function analyzeFlutterPreview(previewDir: string): Promise<Record<string, unknown>> {
  const command = "flutter pub get && flutter analyze";
  try {
    const pubGet = await execFileAsync("flutter", ["pub", "get"], { cwd: previewDir });
    const analyze = await execFileAsync("flutter", ["analyze"], { cwd: previewDir });
    const parsed = parseAnalyzeOutput(`${analyze.stdout}\n${analyze.stderr}`);
    return {
      status: "success",
      command,
      errors: parsed.errors,
      warnings: parsed.warnings,
      pubGet: {
        stdout: pubGet.stdout,
        stderr: pubGet.stderr
      },
      stdout: analyze.stdout,
      stderr: analyze.stderr
    };
  } catch (error) {
    const candidate = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string; code?: string | number };
    if (candidate.code === "ENOENT") {
      return {
        status: "skipped",
        command,
        reason: "flutter command was not found"
      };
    }
    const parsed = parseAnalyzeOutput(`${candidate.stdout ?? ""}\n${candidate.stderr ?? ""}`);
    return {
      status: "failed",
      command,
      exitCode: candidate.code,
      errors: parsed.errors,
      warnings: parsed.warnings,
      stdout: candidate.stdout,
      stderr: candidate.stderr
    };
  }
}

function printHelp(): void {
  console.log(`UXCompiler CLI

Usage:
  uxc compile --input <raw_figma_scene.json> --out <artifacts_dir>
  uxc figma check --file <figma_url_or_file_key>
  uxc figma frames --file <figma_url_or_file_key>
  uxc figma fetch --file <figma_url_or_file_key> --out <snapshot_dir>
  uxc figma compile --file <figma_url_or_file_key> --out <artifacts_dir>
  uxc figma run --file <figma_url_or_file_key> --out <artifacts_dir>
  uxc preview capture --project <flutter_preview_dir> --out <flutter_preview.png>
  uxc preview diff --reference <figma_reference.png> --candidate <flutter_preview.png> --out <diff_dir>
  uxc project init --root .uxcompiler
  uxc tree apply --artifacts <artifacts_dir> --operations <operations.json> --out <draft_dir>
  uxc studio apply --artifacts <artifacts_dir> --operations <operations.json> --out <studio_dir>
  uxc codegen review --artifacts <artifacts_dir> --out <codegen_dir>
  uxc codegen write --review <codegen_dir> --project-path <flutter_project>
  uxc codegen promote --review <codegen_dir> --file <generated_dart> --component-id <id> --name <PascalCase>
  uxc sync remap --old-raw <old_raw.json> --new-raw <new_raw.json> --override-set <override_set.json> --out <sync_dir>
  uxc doctor

Commands:
  compile   Run RawFigmaScene -> CanonicalScene -> Tokens -> Layout -> NormalizedDesignIR
  figma     Fetch a Figma frame through the REST API, optionally compiling it
  preview   Build preview-related artifacts such as visual diff reports
  project   Manage the local Project Store and export/import .uxcproj.zip archives
  tree      Apply headless Normalized Tree Editor operations as overrides
  studio    Apply headless Component/Token/Asset/i18n Studio operations
  codegen   Generate codegen review manifests and patches before writing Flutter code
  sync      Remap overrides between Figma snapshots for incremental sync
  doctor    Check local tools and Figma token configuration

Compile options:
  --ai-semantic-output  Optional AI protocol JSON output for semantic labels.
`);
}

function printFigmaHelp(): void {
  console.log(`UXCompiler Figma commands

Usage:
  uxc figma check --file <figma_url_or_file_key> [--node <node_id>]
  uxc figma frames --file <figma_url_or_file_key> [--json]
  uxc figma fetch --file <figma_url_or_file_key> --out <snapshot_dir> [--node <node_id>]
  uxc figma compile --file <figma_url_or_file_key> --out <artifacts_dir> [--node <node_id>]
  uxc figma run --file <figma_url_or_file_key> --out <artifacts_dir> [--node <node_id>]

Auth:
  Set FIGMA_ACCESS_TOKEN, add it to .env, or pass --token <token>.

Options:
  --file, --url       Figma URL or file key. URLs may include ?node-id=...
  --node, --node-id   Optional node id. Hyphenated URL ids are accepted.
  --scale             Screenshot scale, 0.01-4. Defaults to 1.
  --format            png, jpg, svg, or pdf. Defaults to png.
  --api-base-url      Defaults to https://api.figma.com.
`);
}

function printPreviewHelp(): void {
  console.log(`UXCompiler preview commands

Usage:
  uxc preview capture --project <flutter_preview_dir> --out <flutter_preview.png>
  uxc preview diff --reference <figma_reference.png> --candidate <flutter_preview.png> --out <diff_dir>

Options:
  --node-pixel-map  Optional node_pixel_map.json for node-level attribution.
  --viewport        Optional WIDTHxHEIGHT metadata, for example 390x844.
  --dpr             Optional device pixel ratio metadata.
`);
}

function printProjectHelp(): void {
  console.log(`UXCompiler project commands

Usage:
  uxc project init --root .uxcompiler
  uxc project create --root .uxcompiler --id <project_id> --name <name>
  uxc project save-artifacts --root .uxcompiler --project <project_id> --artifacts <artifacts_dir>
  uxc project export --root .uxcompiler --project <project_id> --out <project.uxcproj.zip>
  uxc project import --root .uxcompiler --input <project.uxcproj.zip> [--new-project-id <project_id>]
  uxc project list --root .uxcompiler [--json]
  uxc project show --root .uxcompiler --project <project_id>

Options:
  --snapshot-id            Optional stable snapshot id when saving artifacts.
  --figma-file-key         Optional Figma file key for project metadata.
  --figma-page-id          Optional Figma page id for project metadata.
  --figma-frame-id         Optional Figma frame id for project metadata.
  --figma-frame-name       Optional Figma frame name for project metadata.
  --flutter-project-path   Optional linked Flutter project path.
  --package-name           Optional Flutter package name.
  --replace                Allow import to replace an existing project id.
`);
}

function printTreeHelp(): void {
  console.log(`UXCompiler tree commands

Usage:
  uxc tree apply --artifacts <artifacts_dir> --operations <operations.json> --out <draft_dir>

Operation kinds:
  create_region, merge_regions, split_region, move_node, rename_node,
  force_layout, force_render, ignore_node

Outputs:
  tree_edit_report.json
  override_set.json
  reviewed_normalized_design_ir.json
  override_conflict_report.json
  stale_override_report.json
`);
}

function printStudioHelp(): void {
  console.log(`UXCompiler studio commands

Usage:
  uxc studio apply --artifacts <artifacts_dir> --operations <operations.json> --out <studio_dir>

Operation kinds:
  approve_component, reject_component, define_component_prop,
  define_component_variant, map_flutter_component, rename_token,
  merge_tokens, split_token, set_asset_strategy, rename_i18n_key,
  accept_i18n_key, define_i18n_placeholder, merge_i18n_messages,
  mark_non_i18n

Outputs:
  studio_report.json
  override_set.json
  component_registry.json
  token_registry.json
  final_asset_manifest.json
  final_i18n_manifest.json
  arb/app_en.arb
  override_conflict_report.json
  stale_override_report.json
`);
}

function printCodegenHelp(): void {
  console.log(`UXCompiler codegen commands

Usage:
  uxc codegen review --artifacts <artifacts_dir> --out <codegen_dir>
  uxc codegen write --review <codegen_dir> --project-path <flutter_project>
  uxc codegen promote --review <codegen_dir> --file <generated_dart> --component-id <id> --name <PascalCase>

Review options:
  --project-path             Optional Flutter project root. Existing files are read for conflict detection only.
  --previous-manifest        Optional prior flutter_generation_manifest.json for incremental sync reports.
  --project-id               Optional project id written into codegen_review.json.
  --build-id                 Optional stable build id.
  --normalized-ir-id         Optional normalized IR id written into codegen_review.json.
  --allow-low-visual-score   Do not block the write gate for a failing visual diff.

Write options:
  --asset-root               Optional asset source root. May be repeated.
  --backup-root              Optional backup root for modified project files.
  --dry-run                  Produce project_write_report.json without writing files.
  --allow-blocked            Attempt safe writes even when non-file review gates are blocked; manual conflicts remain blocked.

Promote options:
  --source-node-id           Source node id covered by the promoted component. May be repeated.
  --import                   Flutter import for the promoted handwritten widget.
  --constructor              Flutter constructor or static constructor.
  --registry                 Optional existing component_registry.json.
  --rules                    Optional existing codegen_promotion_rules.json.
  --reason                   Required human-readable promotion reason.
  --allow-manual-file        Allow promotion when the file no longer has generated markers.

Outputs:
  codegen_review.json
  flutter_generation_manifest.json
  files_to_create.json
  files_to_modify.json
  assets_to_add.json
  arb_patch.json
  pubspec.yaml.patch
  merge_report.json
  incremental_sync_report.json
  generated/
  patches/
  project_write_report.json
  promote_report.json
  component_registry.json
  codegen_promotion_rules.json
`);
}

function printSyncHelp(): void {
  console.log(`UXCompiler sync commands

Usage:
  uxc sync remap --old-raw <old_raw.json> --new-raw <new_raw.json> --override-set <override_set.json> --out <sync_dir>

Options:
  --old-snapshot-id   Optional id for the previous source snapshot.
  --new-snapshot-id   Optional id for the new source snapshot.
  --old-visual-diff   Optional previous visual_diff_report.json.
  --new-visual-diff   Optional current visual_diff_report.json.

Outputs:
  override_set.json
  node_remap_report.json
  reapplied_overrides.json
  stale_overrides.json
  incremental_review_tasks.json
`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`UXCompiler error: ${message}`);
  process.exitCode = 1;
});
