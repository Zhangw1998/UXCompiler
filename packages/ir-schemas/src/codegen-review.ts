import type { AssetManifestEntry, I18nMessage } from "./asset-i18n.js";
import type { ReviewTaskPriority } from "./review-task.js";
import type { StaleOverride } from "./override.js";

export type CodegenFileAction = "create" | "modify" | "unchanged" | "conflict";

export interface CodegenGeneratedRegion {
  id: string;
  sourceNodeIds: string[];
  hash: string;
  strategy: string;
}

export interface CodegenFilePlan {
  path: string;
  action: CodegenFileAction;
  hash: string;
  previousHash?: string;
  existingHash?: string;
  patchPath?: string;
  generatedRegions: CodegenGeneratedRegion[];
  reason: string;
}

export interface CodegenAssetPlan {
  assetId: string;
  sourceNodeId: string;
  sourceName: string;
  strategy: AssetManifestEntry["strategy"];
  format?: AssetManifestEntry["format"];
  path?: string;
  action: "add" | "already_declared" | "missing_path" | "ignored";
  reason: string;
}

export interface CodegenArbPatch {
  locale: string;
  keysToAdd: I18nMessage[];
  keysToModify: I18nMessage[];
  keysUnchanged: string[];
  patch: Record<string, unknown>;
  warnings: Array<{ key?: string; type: string; message: string }>;
}

export interface CodegenPubspecPatch {
  path: "pubspec.yaml";
  assets: string[];
  patch: string;
  warnings: Array<{ type: string; message: string }>;
}

export interface CodegenGateIssue {
  type:
    | "blocking_review_task"
    | "task_status_blocked"
    | "visual_diff_failed"
    | "dart_format_failed"
    | "flutter_analyze_failed"
    | "stale_override_unresolved"
    | "asset_missing_path"
    | "i18n_missing_key"
    | "manual_file_conflict";
  message: string;
  taskId?: string;
  priority?: ReviewTaskPriority;
  filePath?: string;
  sourceNodeId?: string;
}

export interface CodegenGateStatus {
  canWrite: boolean;
  status: "ready" | "blocked";
  blockers: CodegenGateIssue[];
  warnings: Array<{ type: string; message: string; filePath?: string }>;
}

export interface CodegenAnalyzeSummary {
  errors: number;
  warnings: number;
  source?: string;
  stdout?: string;
  stderr?: string;
  raw?: Record<string, unknown>;
}

export interface CodegenFormatSummary {
  status: "success" | "failed" | "skipped" | "unknown";
  source?: string;
  command?: string;
  stdout?: string;
  stderr?: string;
  raw?: Record<string, unknown>;
}

export interface CodegenReviewManifest {
  version: string;
  buildId: string;
  projectId?: string;
  normalizedIrId?: string;
  generatedAt: string;
  visualScore?: number;
  format: CodegenFormatSummary;
  analyze: CodegenAnalyzeSummary;
  files: CodegenFilePlan[];
  filesToCreate: string[];
  filesToModify: Array<{ path: string; patch: string; action: CodegenFileAction }>;
  assetsToAdd: CodegenAssetPlan[];
  arbKeysToAdd: string[];
  blockingTasks: string[];
  gates: CodegenGateStatus;
}

export interface CodegenMergeReport {
  version: string;
  generatedAt: string;
  files: Array<{
    path: string;
    action: CodegenFileAction;
    patchPath?: string;
    reason: string;
  }>;
  conflicts: Array<{ path: string; reason: string; patchPath?: string }>;
}

export interface IncrementalFileChange {
  path: string;
  change: "added" | "changed" | "removed" | "unchanged";
  previousHash?: string;
  currentHash?: string;
}

export interface IncrementalSyncReport {
  version: string;
  generatedAt: string;
  mode: "initial_generation" | "incremental_review";
  nodeRemapReport: {
    exactSourceNodeIds: string[];
    addedSourceNodeIds: string[];
    removedSourceNodeIds: string[];
  };
  reappliedOverrides: Array<{ overrideId: string; reason: string }>;
  staleOverrides: StaleOverride[];
  fileChanges: IncrementalFileChange[];
  reviewRequired: boolean;
  warnings: Array<{ type: string; message: string }>;
}

export interface CodegenGeneratedFile {
  path: string;
  content: string;
}

export interface CodegenFilePatch {
  path: string;
  patchPath: string;
  patch: string;
}

export interface CodegenReviewResult {
  version: string;
  codegenReview: CodegenReviewManifest;
  filesToCreate: CodegenFilePlan[];
  filesToModify: CodegenFilePlan[];
  assetsToAdd: CodegenAssetPlan[];
  arbPatch: CodegenArbPatch;
  pubspecPatch: CodegenPubspecPatch;
  mergeReport: CodegenMergeReport;
  incrementalSyncReport: IncrementalSyncReport;
  generatedFiles: CodegenGeneratedFile[];
  filePatches: CodegenFilePatch[];
}
