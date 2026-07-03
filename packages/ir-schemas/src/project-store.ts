export type ProjectStatus = "draft" | "reviewing" | "ready" | "invalid" | "archived";

export interface ProjectFigmaBinding {
  fileKey?: string;
  pageId?: string;
  frameId?: string;
  frameName?: string;
}

export interface ProjectFlutterBinding {
  projectPath?: string;
  packageName?: string;
}

export interface ProjectRecord {
  id: string;
  name: string;
  figma?: ProjectFigmaBinding;
  flutter?: ProjectFlutterBinding;
  currentSnapshotId?: string;
  currentOverrideSetId?: string;
  currentNormalizedIrId?: string;
  status: ProjectStatus;
  createdAt: string;
  updatedAt: string;
}

export interface WorkspaceProjectSummary {
  id: string;
  name: string;
  status: ProjectStatus;
  projectPath: string;
  updatedAt: string;
}

export interface WorkspaceRecord {
  version: string;
  createdAt: string;
  updatedAt: string;
  projects: WorkspaceProjectSummary[];
}

export interface SourceSnapshotRecord {
  id: string;
  projectId: string;
  figmaFileKey?: string;
  frameId?: string;
  figmaVersion?: string;
  rawSceneHash: string;
  rawScenePath: string;
  canonicalScenePath?: string;
  referenceScreenshotPath?: string;
  assetDir?: string;
  createdAt: string;
}

export interface NormalizedIrRecord {
  id: string;
  projectId: string;
  snapshotId: string;
  overrideSetId?: string;
  normalizedIrPath: string;
  reviewedNormalizedIrPath?: string;
  overrideConflictReportPath?: string;
  staleOverrideReportPath?: string;
  createdAt: string;
}

export interface OverrideSetRecord {
  id: string;
  projectId: string;
  snapshotId?: string;
  hash: string;
  overrideSetPath: string;
  conflictReportPath?: string;
  staleReportPath?: string;
  historyPath: string;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewTaskSetRecord {
  id: string;
  projectId: string;
  snapshotId?: string;
  taskPath: string;
  statusReportPath: string;
  createdAt: string;
}

export interface PreviewArtifactRecord {
  id: string;
  projectId: string;
  snapshotId?: string;
  previewPngPath?: string;
  visualDiffReportPath?: string;
  heatmapPath?: string;
  flutterPreviewDir?: string;
  createdAt: string;
}

export interface CodegenBuildRecord {
  id: string;
  projectId: string;
  snapshotId?: string;
  status: "draft" | "blocked" | "ready" | "promoted" | "failed";
  buildArtifactsPath: string;
  createdAt: string;
}

export interface ProjectStoreIndex {
  version: string;
  projectId: string;
  sourceSnapshots: SourceSnapshotRecord[];
  normalizedIrVersions: NormalizedIrRecord[];
  overrideSets: OverrideSetRecord[];
  reviewTaskSets: ReviewTaskSetRecord[];
  previewArtifacts: PreviewArtifactRecord[];
  codegenBuilds: CodegenBuildRecord[];
}
