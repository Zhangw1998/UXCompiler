import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type {
  CodegenArbPatch,
  CodegenFilePlan,
  CodegenGeneratedFile,
  CodegenPubspecPatch,
  CodegenReviewManifest,
  ProjectWriteArbResult,
  ProjectWriteAssetResult,
  ProjectWriteFileResult,
  ProjectWritePubspecResult,
  ProjectWriteReport,
  ProjectWriterResult
} from "@uxcompiler/ir-schemas";

export interface WriteCodegenToProjectInput {
  projectPath: string;
  codegenReview: CodegenReviewManifest;
  generatedFiles: CodegenGeneratedFile[];
  arbPatch?: CodegenArbPatch;
  pubspecPatch?: CodegenPubspecPatch;
  assetRoots?: string[];
  dryRun?: boolean;
  allowBlocked?: boolean;
  backupRoot?: string;
  now?: () => Date;
}

const generatedStartMarker = "@uxc-generated:start";
const generatedEndMarker = "@uxc-generated:end";

export async function writeCodegenToProject(input: WriteCodegenToProjectInput): Promise<ProjectWriterResult> {
  const now = input.now ?? (() => new Date());
  const generatedAt = now().toISOString();
  const mode = input.dryRun ? "dry_run" : "write";
  const backupRoot = input.backupRoot ?? resolve(input.projectPath, ".uxcompiler", "backups", safeId(`${input.codegenReview.buildId}_${generatedAt}`));
  const warnings: ProjectWriteReport["warnings"] = [];
  const generatedFileMap = new Map(input.generatedFiles.map((file) => [file.path, file.content]));
  const gateBlocksWrite = input.codegenReview.gates.status === "blocked" && !input.allowBlocked;
  const files: ProjectWriteFileResult[] = [];
  let wrote = false;

  if (gateBlocksWrite) {
    for (const plan of input.codegenReview.files) {
      files.push({
        path: plan.path,
        action: plan.action,
        status: "blocked",
        reason: "Codegen review gate is blocked; no project files were written."
      });
    }
  } else {
    for (const plan of input.codegenReview.files) {
      const result = await writeOneGeneratedFile({
        projectPath: input.projectPath,
        plan,
        content: generatedFileMap.get(plan.path),
        backupRoot,
        dryRun: !!input.dryRun
      });
      files.push(result);
      if (!input.dryRun && (result.status === "created" || result.status === "updated")) wrote = true;
      if (result.status === "blocked") warnings.push({ type: "file_blocked", path: plan.path, message: result.reason });
    }
  }

  const assets = gateBlocksWrite
    ? blockedAssets(input.codegenReview)
    : await writeAssets({
        projectPath: input.projectPath,
        assets: input.codegenReview.assetsToAdd,
        assetRoots: input.assetRoots ?? [],
        dryRun: !!input.dryRun
      });
  if (!input.dryRun && assets.some((asset) => asset.status === "copied")) wrote = true;
  for (const asset of assets) {
    if (asset.status === "missing_source") warnings.push({ type: "asset_missing_source", path: asset.path, message: asset.reason });
  }

  const arb = gateBlocksWrite
    ? blockedArb(input.arbPatch)
    : await writeArb({
        projectPath: input.projectPath,
        arbPatch: input.arbPatch,
        backupRoot,
        dryRun: !!input.dryRun
      });
  if (!input.dryRun && (arb.status === "created" || arb.status === "updated")) wrote = true;

  const pubspec = gateBlocksWrite
    ? blockedPubspec(input.pubspecPatch)
    : await writePubspec({
        projectPath: input.projectPath,
        pubspecPatch: input.pubspecPatch,
        backupRoot,
        dryRun: !!input.dryRun
      });
  if (!input.dryRun && (pubspec.status === "created" || pubspec.status === "updated")) wrote = true;

  return {
    version: "0.1.0",
    report: {
      version: "0.1.0",
      generatedAt,
      buildId: input.codegenReview.buildId,
      projectPath: input.projectPath,
      mode,
      gate: input.codegenReview.gates,
      wrote,
      files,
      assets,
      arb,
      pubspec,
      blockers: gateBlocksWrite ? input.codegenReview.gates.blockers : filesToBlockers(files),
      warnings
    }
  };
}

async function writeOneGeneratedFile(options: {
  projectPath: string;
  plan: CodegenFilePlan;
  content?: string;
  backupRoot: string;
  dryRun: boolean;
}): Promise<ProjectWriteFileResult> {
  const { plan } = options;
  const target = resolveSafe(options.projectPath, plan.path);
  if (plan.action === "conflict") {
    return {
      path: plan.path,
      action: plan.action,
      status: "blocked",
      reason: "Manual file conflict from codegen review; Project Writer will not overwrite it."
    };
  }
  if (!options.content) {
    return {
      path: plan.path,
      action: plan.action,
      status: "blocked",
      reason: "Generated file content is missing from the review directory."
    };
  }
  if (hashText(options.content) !== plan.hash) {
    return {
      path: plan.path,
      action: plan.action,
      status: "blocked",
      reason: "Generated file hash no longer matches codegen_review.json."
    };
  }

  const existing = await readOptionalText(target);
  if (plan.action === "unchanged") {
    return {
      path: plan.path,
      action: plan.action,
      status: "unchanged",
      reason: "Codegen review marked this file unchanged."
    };
  }
  if (plan.action === "create") {
    if (existing !== undefined && existing !== options.content) {
      return {
        path: plan.path,
        action: plan.action,
        status: "blocked",
        reason: "Target file appeared after review and differs from generated output."
      };
    }
    if (existing === options.content) {
      return {
        path: plan.path,
        action: plan.action,
        status: "unchanged",
        reason: "Target file already matches generated output."
      };
    }
    if (!options.dryRun) await writeText(target, options.content);
    return {
      path: plan.path,
      action: plan.action,
      status: "created",
      reason: options.dryRun ? "Dry run: file would be created." : "Generated file created."
    };
  }

  if (existing === undefined) {
    return {
      path: plan.path,
      action: plan.action,
      status: "blocked",
      reason: "Target file was missing during write, but review expected an update."
    };
  }
  if (plan.existingHash && hashText(existing) !== plan.existingHash) {
    return {
      path: plan.path,
      action: plan.action,
      status: "blocked",
      reason: "Target file changed after codegen review; regenerate review before writing."
    };
  }
  if (!hasGeneratedMarker(existing)) {
    return {
      path: plan.path,
      action: plan.action,
      status: "blocked",
      reason: "Target file has no UXCompiler generated markers."
    };
  }
  if (existing === options.content) {
    return {
      path: plan.path,
      action: plan.action,
      status: "unchanged",
      reason: "Target file already matches generated output."
    };
  }
  const backupPath = resolveSafe(options.backupRoot, plan.path);
  if (!options.dryRun) {
    await writeText(backupPath, existing);
    await writeText(target, options.content);
  }
  return {
    path: plan.path,
    action: plan.action,
    status: "updated",
    backupPath,
    reason: options.dryRun ? "Dry run: generated file would be updated with backup." : "Generated file updated with backup."
  };
}

async function writeAssets(options: {
  projectPath: string;
  assets: CodegenReviewManifest["assetsToAdd"];
  assetRoots: string[];
  dryRun: boolean;
}): Promise<ProjectWriteAssetResult[]> {
  const results: ProjectWriteAssetResult[] = [];
  for (const asset of options.assets) {
    if (!asset.path) {
      results.push({ path: "", status: "skipped", reason: `Asset ${asset.assetId} has no path.` });
      continue;
    }
    const target = resolveSafe(options.projectPath, asset.path);
    if ((await readOptionalBuffer(target)) !== undefined) {
      results.push({ path: asset.path, status: "already_exists", reason: "Asset already exists in target project." });
      continue;
    }
    const source = await findAssetSource(options.assetRoots, asset.path);
    if (!source) {
      results.push({ path: asset.path, status: "missing_source", reason: "Asset source was not found in the review asset roots." });
      continue;
    }
    if (!options.dryRun) {
      await mkdir(dirname(target), { recursive: true });
      await copyFile(source, target);
    }
    results.push({
      path: asset.path,
      sourcePath: source,
      status: "copied",
      reason: options.dryRun ? "Dry run: asset would be copied." : "Asset copied into target project."
    });
  }
  return results;
}

async function writeArb(options: {
  projectPath: string;
  arbPatch?: CodegenArbPatch;
  backupRoot: string;
  dryRun: boolean;
}): Promise<ProjectWriteArbResult> {
  const locale = options.arbPatch?.locale ?? "en";
  const path = `lib/l10n/app_${locale.replace(/-/g, "_")}.arb`;
  if (!options.arbPatch || Object.keys(options.arbPatch.patch).length === 0) {
    return { path, status: "unchanged", keysWritten: [], reason: "No ARB patch was provided." };
  }
  const target = resolveSafe(options.projectPath, path);
  const existing = await readOptionalText(target);
  const existingJson = existing ? parseJsonObject(existing) : {};
  const next = { ...existingJson, ...options.arbPatch.patch };
  const keysWritten = Object.keys(options.arbPatch.patch).filter((key) => !key.startsWith("@"));
  const nextText = `${JSON.stringify(next, null, 2)}\n`;
  if (existing === nextText) {
    return { path, status: "unchanged", keysWritten, reason: "ARB file already contains the generated patch." };
  }
  let backupPath: string | undefined;
  if (existing !== undefined) backupPath = resolveSafe(options.backupRoot, path);
  if (!options.dryRun) {
    if (existing !== undefined && backupPath) await writeText(backupPath, existing);
    await writeText(target, nextText);
  }
  return {
    path,
    status: existing === undefined ? "created" : "updated",
    backupPath,
    keysWritten,
    reason: options.dryRun ? "Dry run: ARB patch would be written." : "ARB patch written."
  };
}

async function writePubspec(options: {
  projectPath: string;
  pubspecPatch?: CodegenPubspecPatch;
  backupRoot: string;
  dryRun: boolean;
}): Promise<ProjectWritePubspecResult> {
  const assets = options.pubspecPatch?.assets ?? [];
  if (assets.length === 0) {
    return { path: "pubspec.yaml", status: "unchanged", assetsDeclared: [], reason: "No new pubspec assets were requested." };
  }
  const target = resolve(options.projectPath, "pubspec.yaml");
  const existing = await readOptionalText(target);
  const base = existing ?? "name: uxc_generated_app\npublish_to: none\n";
  const next = mergePubspecAssets(base, assets);
  if (base === next.content) {
    return { path: "pubspec.yaml", status: "unchanged", assetsDeclared: [], reason: "All requested assets were already declared." };
  }
  const backupPath = existing === undefined ? undefined : resolveSafe(options.backupRoot, "pubspec.yaml");
  if (!options.dryRun) {
    if (existing !== undefined && backupPath) await writeText(backupPath, existing);
    await writeText(target, next.content);
  }
  return {
    path: "pubspec.yaml",
    status: existing === undefined ? "created" : "updated",
    backupPath,
    assetsDeclared: next.addedAssets,
    reason: options.dryRun ? "Dry run: pubspec assets would be declared." : "Pubspec asset declarations written."
  };
}

function mergePubspecAssets(content: string, assets: string[]): { content: string; addedAssets: string[] } {
  const lines = content.replace(/\n$/, "").split("\n");
  const existing = new Set<string>();
  for (const line of lines) {
    const match = line.match(/^\s*-\s+(.+?)\s*$/);
    if (match) existing.add(match[1]);
  }
  const addedAssets = unique(assets).filter((asset) => !existing.has(asset));
  if (addedAssets.length === 0) return { content, addedAssets: [] };

  const flutterIndex = lines.findIndex((line) => /^flutter:\s*$/.test(line));
  if (flutterIndex === -1) {
    return {
      content: `${lines.join("\n")}\n\nflutter:\n  assets:\n${addedAssets.map((asset) => `    - ${asset}`).join("\n")}\n`,
      addedAssets
    };
  }
  const nextTopLevel = findNextTopLevel(lines, flutterIndex + 1);
  const sectionEnd = nextTopLevel === -1 ? lines.length : nextTopLevel;
  const assetsIndex = lines.findIndex((line, index) => index > flutterIndex && index < sectionEnd && /^  assets:\s*$/.test(line));
  if (assetsIndex === -1) {
    const insert = ["  assets:", ...addedAssets.map((asset) => `    - ${asset}`)];
    return {
      content: [...lines.slice(0, flutterIndex + 1), ...insert, ...lines.slice(flutterIndex + 1)].join("\n") + "\n",
      addedAssets
    };
  }
  let insertIndex = assetsIndex + 1;
  while (insertIndex < sectionEnd && /^\s{4}-\s+/.test(lines[insertIndex])) insertIndex += 1;
  return {
    content: [...lines.slice(0, insertIndex), ...addedAssets.map((asset) => `    - ${asset}`), ...lines.slice(insertIndex)].join("\n") + "\n",
    addedAssets
  };
}

function findNextTopLevel(lines: string[], start: number): number {
  for (let index = start; index < lines.length; index += 1) {
    if (/^[A-Za-z0-9_]+:\s*$/.test(lines[index])) return index;
  }
  return -1;
}

function blockedAssets(codegenReview: CodegenReviewManifest): ProjectWriteAssetResult[] {
  return codegenReview.assetsToAdd.map((asset) => ({
    path: asset.path ?? "",
    status: "skipped",
    reason: "Codegen review gate is blocked; no assets were copied."
  }));
}

function blockedArb(arbPatch?: CodegenArbPatch): ProjectWriteArbResult {
  return {
    path: `lib/l10n/app_${(arbPatch?.locale ?? "en").replace(/-/g, "_")}.arb`,
    status: "blocked",
    keysWritten: [],
    reason: "Codegen review gate is blocked; ARB patch was not written."
  };
}

function blockedPubspec(pubspecPatch?: CodegenPubspecPatch): ProjectWritePubspecResult {
  return {
    path: "pubspec.yaml",
    status: "blocked",
    assetsDeclared: pubspecPatch?.assets ?? [],
    reason: "Codegen review gate is blocked; pubspec was not written."
  };
}

function filesToBlockers(files: ProjectWriteFileResult[]): ProjectWriteReport["blockers"] {
  return files
    .filter((file) => file.status === "blocked")
    .map((file) => ({
      type: "manual_file_conflict",
      filePath: file.path,
      message: file.reason
    }));
}

async function findAssetSource(assetRoots: string[], assetPath: string): Promise<string | undefined> {
  for (const root of assetRoots) {
    const candidate = resolve(root, assetPath);
    if ((await readOptionalBuffer(candidate)) !== undefined) return candidate;
  }
  return undefined;
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("ARB file must contain a JSON object.");
  return parsed as Record<string, unknown>;
}

function hasGeneratedMarker(content: string): boolean {
  return content.includes(generatedStartMarker) && content.includes(generatedEndMarker);
}

function resolveSafe(root: string, path: string): string {
  const target = resolve(root, path);
  const normalizedRoot = resolve(root);
  if (target !== normalizedRoot && !target.startsWith(`${normalizedRoot}/`)) {
    throw new Error(`Unsafe project write path: ${path}`);
  }
  return target;
}

async function writeText(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
}

async function readOptionalText(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const candidate = error as NodeJS.ErrnoException;
    if (candidate.code === "ENOENT") return undefined;
    throw error;
  }
}

async function readOptionalBuffer(path: string): Promise<Buffer | undefined> {
  try {
    return await readFile(path);
  } catch (error) {
    const candidate = error as NodeJS.ErrnoException;
    if (candidate.code === "ENOENT") return undefined;
    throw error;
  }
}

function hashText(value: string): string {
  return `sha256_${createHash("sha256").update(value).digest("hex")}`;
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || "generated";
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
