#!/usr/bin/env node

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { extractFigmaScene, listFigmaFrames, type FigmaExtractionResult } from "@uxcompiler/figma-extractor";
import { assertRawFigmaScene, type OverrideSet, type PipelineArtifacts, type VisualDiffReport } from "@uxcompiler/ir-schemas";
import { compileRawScene } from "@uxcompiler/normalizer";
import { applyOverrides } from "@uxcompiler/override-engine";
import { createProjectStore } from "@uxcompiler/project-store";
import { generateReviewTasks } from "@uxcompiler/review-task-engine";
import { runVisualDiff } from "@uxcompiler/visual-diff";

const execFileAsync = promisify(execFile);

interface CompileOptions {
  input: string;
  out: string;
  overrideSet?: string;
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
  const artifacts = compileRawScene(raw, { overrideSet });
  await writeArtifacts(outDir, artifacts, inputPath);

  console.log(`UXCompiler compile completed.`);
  console.log(`Input: ${inputPath}`);
  console.log(`Artifacts: ${outDir}`);
  console.log(`Normalized confidence: ${artifacts.normalizedDesignIR.confidence.overall}`);
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
    dpr: options.dpr
  });

  await mkdir(options.outDir, { recursive: true });
  await writeFile(resolve(options.outDir, "visual_diff_report.json"), `${JSON.stringify(result.visualDiffReport, null, 2)}\n`, "utf8");
  await writeFile(resolve(options.outDir, "node_diff_report.json"), `${JSON.stringify(result.nodeDiffReport, null, 2)}\n`, "utf8");
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
      dpr: extraction.rawFigmaScene.source.viewport?.scale ?? 1
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
    ["fidelity_generation_manifest.json", artifacts.fidelityGenerationManifest],
    ["node_pixel_map.json", artifacts.nodePixelMap],
    ["review_tasks.json", artifacts.reviewTasks],
    ["task_status_report.json", artifacts.taskStatusReport],
    ["regions.json", artifacts.regions],
    ["layout_candidates.json", artifacts.layoutCandidates],
    ["layout_decisions.json", artifacts.layoutDecisions],
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
          "regions.json",
          "layout_candidates.json",
          "layout_decisions.json",
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
  await writeFile(resolve(outDir, "flutter_preview_format_report.json"), `${JSON.stringify(formatReport, null, 2)}\n`, "utf8");
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
    assetManifest: overrideResult.reviewedAssetManifest,
    i18nManifest: overrideResult.reviewedI18nManifest,
    fidelityGenerationManifest: artifacts.fidelityGenerationManifest,
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
  uxc doctor

Commands:
  compile   Run RawFigmaScene -> CanonicalScene -> Tokens -> Layout -> NormalizedDesignIR
  figma     Fetch a Figma frame through the REST API, optionally compiling it
  preview   Build preview-related artifacts such as visual diff reports
  project   Manage the local Project Store and export/import .uxcproj.zip archives
  doctor    Check local tools and Figma token configuration
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

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`UXCompiler error: ${message}`);
  process.exitCode = 1;
});
