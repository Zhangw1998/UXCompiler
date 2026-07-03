import type { CodegenFileAction, CodegenGateIssue, CodegenGateStatus } from "./codegen-review.js";

export type ProjectWriteMode = "dry_run" | "write";

export type ProjectWriteStatus = "created" | "updated" | "unchanged" | "skipped" | "blocked";

export interface ProjectWriteFileResult {
  path: string;
  action: CodegenFileAction;
  status: ProjectWriteStatus;
  backupPath?: string;
  reason: string;
}

export interface ProjectWriteAssetResult {
  path: string;
  status: "copied" | "already_exists" | "missing_source" | "skipped";
  sourcePath?: string;
  reason: string;
}

export interface ProjectWriteArbResult {
  path: string;
  status: ProjectWriteStatus;
  backupPath?: string;
  keysWritten: string[];
  reason: string;
}

export interface ProjectWritePubspecResult {
  path: "pubspec.yaml";
  status: ProjectWriteStatus;
  backupPath?: string;
  assetsDeclared: string[];
  reason: string;
}

export interface ProjectWriteReport {
  version: string;
  generatedAt: string;
  buildId: string;
  projectPath: string;
  mode: ProjectWriteMode;
  gate: CodegenGateStatus;
  wrote: boolean;
  files: ProjectWriteFileResult[];
  assets: ProjectWriteAssetResult[];
  arb: ProjectWriteArbResult;
  pubspec: ProjectWritePubspecResult;
  blockers: CodegenGateIssue[];
  warnings: Array<{ type: string; message: string; path?: string }>;
}

export interface ProjectWriterResult {
  version: string;
  report: ProjectWriteReport;
}
