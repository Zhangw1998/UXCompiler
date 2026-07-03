import { createHash } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type {
  CodegenBuildRecord,
  OverrideSet,
  OverrideSetRecord,
  PipelineArtifacts,
  PreviewArtifactRecord,
  ProjectRecord,
  ProjectStatus,
  ProjectStoreIndex,
  RawFigmaScene,
  ReviewTask,
  ReviewTaskSetRecord,
  ReviewTaskStatusReport,
  SourceSnapshotRecord,
  WorkspaceRecord
} from "@uxcompiler/ir-schemas";

export interface LocalProjectStoreOptions {
  rootDir: string;
  now?: () => Date;
}

export interface CreateProjectInput {
  id?: string;
  name: string;
  figma?: ProjectRecord["figma"];
  flutter?: ProjectRecord["flutter"];
  status?: ProjectStatus;
}

export interface SaveSourceSnapshotInput {
  snapshotId?: string;
  rawFigmaScene: RawFigmaScene;
  canonicalScene?: unknown;
  referenceScreenshotPath?: string;
  assetDir?: string;
}

export interface SaveOverrideSetInput {
  snapshotId?: string;
  overrideSet: OverrideSet;
  conflictReport?: unknown;
  staleReport?: unknown;
  actor?: string;
}

export interface SaveReviewTasksInput {
  id?: string;
  snapshotId?: string;
  reviewTasks: ReviewTask[];
  taskStatusReport: ReviewTaskStatusReport;
}

export interface SavePreviewArtifactsInput {
  id?: string;
  snapshotId?: string;
  previewPngPath?: string;
  visualDiffReportPath?: string;
  heatmapPath?: string;
  flutterPreviewDir?: string;
}

export interface SaveCodegenBuildInput {
  id?: string;
  snapshotId?: string;
  status: CodegenBuildRecord["status"];
  artifacts: unknown;
}

export interface SavePipelineArtifactsInput {
  snapshotId?: string;
  normalizedIrId?: string;
  reviewTaskSetId?: string;
  artifacts: PipelineArtifacts;
}

export interface SaveArtifactDirectoryInput {
  snapshotId?: string;
  normalizedIrId?: string;
  reviewTaskSetId?: string;
  previewArtifactId?: string;
  artifactDir: string;
}

export interface ExportProjectResult {
  projectId: string;
  archivePath: string;
  entries: number;
}

export interface ImportProjectOptions {
  newProjectId?: string;
  replace?: boolean;
}

export interface ImportProjectResult {
  projectId: string;
  projectDir: string;
  entries: number;
}

export interface SavePipelineArtifactsResult {
  snapshot: SourceSnapshotRecord;
  overrideSet: OverrideSetRecord;
  reviewTaskSet: ReviewTaskSetRecord;
}

const storeVersion = "0.1.0";
const schemaSql = `-- UXCompiler local project store catalog schema.
-- The MVP stores canonical JSON files on disk and keeps this SQL schema as the
-- target catalog contract for the future SQLite index.
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  project_json_path TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS source_snapshots (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  raw_scene_hash TEXT NOT NULL,
  raw_scene_path TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS override_sets (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  snapshot_id TEXT,
  hash TEXT NOT NULL,
  override_set_path TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS review_tasks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  snapshot_id TEXT,
  task_path TEXT NOT NULL,
  status_report_path TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS preview_artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  snapshot_id TEXT,
  preview_png_path TEXT,
  visual_diff_report_path TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS codegen_builds (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  snapshot_id TEXT,
  status TEXT NOT NULL,
  build_artifacts_path TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

export function createProjectStore(options: LocalProjectStoreOptions): LocalProjectStore {
  return new LocalProjectStore(options);
}

export class LocalProjectStore {
  readonly rootDir: string;
  private readonly now: () => Date;

  constructor(options: LocalProjectStoreOptions) {
    this.rootDir = resolve(options.rootDir);
    this.now = options.now ?? (() => new Date());
  }

  async init(): Promise<WorkspaceRecord> {
    const stamp = this.timestamp();
    await mkdir(this.projectsDir(), { recursive: true });
    await writeFile(resolve(this.rootDir, "schema.sql"), schemaSql, "utf8");
    await this.initializeCatalog();
    const workspacePath = this.workspacePath();
    if (await exists(workspacePath)) return this.readWorkspace();
    const workspace: WorkspaceRecord = {
      version: storeVersion,
      createdAt: stamp,
      updatedAt: stamp,
      projects: []
    };
    await writeJson(workspacePath, workspace);
    return workspace;
  }

  async readWorkspace(): Promise<WorkspaceRecord> {
    return readJson<WorkspaceRecord>(this.workspacePath());
  }

  async listProjects(): Promise<ProjectRecord[]> {
    await this.init();
    const workspace = await this.readWorkspace();
    return Promise.all(workspace.projects.map((project) => this.readProject(project.id)));
  }

  async createProject(input: CreateProjectInput): Promise<ProjectRecord> {
    await this.init();
    const stamp = this.timestamp();
    const id = input.id ?? makeId("proj", input.name, stamp);
    const projectDir = this.projectDir(id);
    if (await exists(projectDir)) throw new Error(`Project already exists: ${id}`);
    const project: ProjectRecord = {
      id,
      name: input.name,
      figma: input.figma,
      flutter: input.flutter,
      status: input.status ?? "draft",
      createdAt: stamp,
      updatedAt: stamp
    };
    await mkdir(projectDir, { recursive: true });
    await Promise.all([
      writeJson(resolve(projectDir, "project.json"), project),
      writeJson(resolve(projectDir, "settings.json"), { version: storeVersion }),
      writeJson(this.projectIndexPath(id), emptyIndex(id))
    ]);
    this.upsertProjectCatalog(project);
    await this.upsertWorkspaceSummary(project);
    return project;
  }

  async readProject(projectId: string): Promise<ProjectRecord> {
    return readJson<ProjectRecord>(resolve(this.projectDir(projectId), "project.json"));
  }

  async updateProject(projectId: string, patch: Partial<Omit<ProjectRecord, "id" | "createdAt">>): Promise<ProjectRecord> {
    const project = await this.readProject(projectId);
    const updated: ProjectRecord = {
      ...project,
      ...patch,
      figma: patch.figma ?? project.figma,
      flutter: patch.flutter ?? project.flutter,
      updatedAt: this.timestamp()
    };
    await writeJson(resolve(this.projectDir(projectId), "project.json"), updated);
    this.upsertProjectCatalog(updated);
    await this.upsertWorkspaceSummary(updated);
    return updated;
  }

  async readProjectIndex(projectId: string): Promise<ProjectStoreIndex> {
    return readJson<ProjectStoreIndex>(this.projectIndexPath(projectId));
  }

  async saveSourceSnapshot(projectId: string, input: SaveSourceSnapshotInput): Promise<SourceSnapshotRecord> {
    await this.ensureProject(projectId);
    const projectDir = this.projectDir(projectId);
    const stamp = this.timestamp();
    const snapshotId = input.snapshotId ?? makeId("snap", input.rawFigmaScene.root.id, stamp);
    const snapshotDir = resolve(projectDir, "snapshots", snapshotId);
    await mkdir(snapshotDir, { recursive: true });
    await writeJson(resolve(snapshotDir, "raw_figma_scene.json"), input.rawFigmaScene);
    if (input.canonicalScene) await writeJson(resolve(snapshotDir, "canonical_scene.json"), input.canonicalScene);
    const rawSceneHash = hashJson(input.rawFigmaScene);
    let referenceScreenshotPath: string | undefined;
    if (input.referenceScreenshotPath && (await exists(input.referenceScreenshotPath))) {
      const target = resolve(snapshotDir, basename(input.referenceScreenshotPath));
      await cp(input.referenceScreenshotPath, target);
      referenceScreenshotPath = toStorePath(projectDir, target);
    }
    let assetDir: string | undefined;
    if (input.assetDir && (await exists(input.assetDir))) {
      const target = resolve(snapshotDir, "assets");
      await cp(input.assetDir, target, { recursive: true });
      assetDir = toStorePath(projectDir, target);
    }
    const record: SourceSnapshotRecord = {
      id: snapshotId,
      projectId,
      figmaFileKey: input.rawFigmaScene.source.fileKey,
      frameId: input.rawFigmaScene.source.frameNodeId ?? input.rawFigmaScene.root.id,
      figmaVersion: input.rawFigmaScene.source.version,
      rawSceneHash,
      rawScenePath: toStorePath(projectDir, resolve(snapshotDir, "raw_figma_scene.json")),
      canonicalScenePath: input.canonicalScene ? toStorePath(projectDir, resolve(snapshotDir, "canonical_scene.json")) : undefined,
      referenceScreenshotPath,
      assetDir,
      createdAt: stamp
    };
    await this.updateIndex(projectId, (index) => {
      index.sourceSnapshots = upsertById(index.sourceSnapshots, record);
    });
    this.upsertSnapshotCatalog(record);
    await this.updateProject(projectId, { currentSnapshotId: snapshotId, status: "reviewing" });
    return record;
  }

  async saveOverrideSet(projectId: string, input: SaveOverrideSetInput): Promise<OverrideSetRecord> {
    await this.ensureProject(projectId);
    const projectDir = this.projectDir(projectId);
    const stamp = this.timestamp();
    const overrideSet = input.overrideSet;
    const overrideDir = resolve(projectDir, "overrides", overrideSet.id);
    await mkdir(overrideDir, { recursive: true });
    await writeJson(resolve(overrideDir, "override_set.json"), overrideSet);
    if (input.conflictReport) await writeJson(resolve(overrideDir, "override_conflict_report.json"), input.conflictReport);
    if (input.staleReport) await writeJson(resolve(overrideDir, "stale_override_report.json"), input.staleReport);
    const historyPath = resolve(projectDir, "overrides", "override_history.ndjson");
    await mkdir(dirname(historyPath), { recursive: true });
    await writeFile(
      historyPath,
      overrideSet.overrides
        .map((override) =>
          `${JSON.stringify({
            event: "saved",
            overrideId: override.id,
            overrideSetId: overrideSet.id,
            actor: input.actor ?? "system",
            timestamp: stamp
          })}\n`
        )
        .join(""),
      { flag: "a" }
    );
    const record: OverrideSetRecord = {
      id: overrideSet.id,
      projectId,
      snapshotId: input.snapshotId,
      hash: overrideSet.hash,
      overrideSetPath: toStorePath(projectDir, resolve(overrideDir, "override_set.json")),
      conflictReportPath: input.conflictReport ? toStorePath(projectDir, resolve(overrideDir, "override_conflict_report.json")) : undefined,
      staleReportPath: input.staleReport ? toStorePath(projectDir, resolve(overrideDir, "stale_override_report.json")) : undefined,
      historyPath: toStorePath(projectDir, historyPath),
      createdAt: stamp,
      updatedAt: stamp
    };
    await this.updateIndex(projectId, (index) => {
      const previous = index.overrideSets.find((candidate) => candidate.id === record.id);
      index.overrideSets = upsertById(index.overrideSets, {
        ...record,
        createdAt: previous?.createdAt ?? record.createdAt
      });
    });
    this.upsertOverrideCatalog(record);
    await this.updateProject(projectId, { currentOverrideSetId: overrideSet.id, status: "reviewing" });
    return record;
  }

  async saveReviewTasks(projectId: string, input: SaveReviewTasksInput): Promise<ReviewTaskSetRecord> {
    await this.ensureProject(projectId);
    const projectDir = this.projectDir(projectId);
    const stamp = this.timestamp();
    const id = input.id ?? makeId("tasks", input.snapshotId ?? projectId, stamp);
    const taskDir = resolve(projectDir, "review_tasks", id);
    await mkdir(taskDir, { recursive: true });
    await writeJson(resolve(taskDir, "review_tasks.json"), input.reviewTasks);
    await writeJson(resolve(taskDir, "task_status_report.json"), input.taskStatusReport);
    const record: ReviewTaskSetRecord = {
      id,
      projectId,
      snapshotId: input.snapshotId,
      taskPath: toStorePath(projectDir, resolve(taskDir, "review_tasks.json")),
      statusReportPath: toStorePath(projectDir, resolve(taskDir, "task_status_report.json")),
      createdAt: stamp
    };
    await this.updateIndex(projectId, (index) => {
      index.reviewTaskSets = upsertById(index.reviewTaskSets, record);
    });
    this.upsertReviewTaskCatalog(record);
    return record;
  }

  async savePreviewArtifacts(projectId: string, input: SavePreviewArtifactsInput): Promise<PreviewArtifactRecord> {
    await this.ensureProject(projectId);
    const projectDir = this.projectDir(projectId);
    const stamp = this.timestamp();
    const id = input.id ?? makeId("preview", input.snapshotId ?? projectId, stamp);
    const previewDir = resolve(projectDir, "previews", id);
    await mkdir(previewDir, { recursive: true });
    const previewPngPath = await copyOptional(projectDir, input.previewPngPath, resolve(previewDir, "flutter_preview.png"));
    const visualDiffReportPath = await copyOptional(projectDir, input.visualDiffReportPath, resolve(previewDir, "visual_diff_report.json"));
    const heatmapPath = await copyOptional(projectDir, input.heatmapPath, resolve(previewDir, "diff_heatmap.png"));
    let flutterPreviewDir: string | undefined;
    if (input.flutterPreviewDir && (await exists(input.flutterPreviewDir))) {
      const target = resolve(previewDir, "flutter_preview");
      await cp(input.flutterPreviewDir, target, { recursive: true });
      flutterPreviewDir = toStorePath(projectDir, target);
    }
    const record: PreviewArtifactRecord = {
      id,
      projectId,
      snapshotId: input.snapshotId,
      previewPngPath,
      visualDiffReportPath,
      heatmapPath,
      flutterPreviewDir,
      createdAt: stamp
    };
    await this.updateIndex(projectId, (index) => {
      index.previewArtifacts = upsertById(index.previewArtifacts, record);
    });
    this.upsertPreviewCatalog(record);
    return record;
  }

  async saveCodegenBuild(projectId: string, input: SaveCodegenBuildInput): Promise<CodegenBuildRecord> {
    await this.ensureProject(projectId);
    const projectDir = this.projectDir(projectId);
    const stamp = this.timestamp();
    const id = input.id ?? makeId("codegen", input.snapshotId ?? projectId, stamp);
    const codegenDir = resolve(projectDir, "codegen", id);
    await mkdir(codegenDir, { recursive: true });
    await writeJson(resolve(codegenDir, "build_artifacts.json"), input.artifacts);
    const record: CodegenBuildRecord = {
      id,
      projectId,
      snapshotId: input.snapshotId,
      status: input.status,
      buildArtifactsPath: toStorePath(projectDir, resolve(codegenDir, "build_artifacts.json")),
      createdAt: stamp
    };
    await this.updateIndex(projectId, (index) => {
      index.codegenBuilds = upsertById(index.codegenBuilds, record);
    });
    this.upsertCodegenCatalog(record);
    return record;
  }

  async savePipelineArtifacts(projectId: string, input: SavePipelineArtifactsInput): Promise<SavePipelineArtifactsResult> {
    const { artifacts } = input;
    const snapshot = await this.saveSourceSnapshot(projectId, {
      snapshotId: input.snapshotId,
      rawFigmaScene: artifacts.rawFigmaScene,
      canonicalScene: artifacts.canonicalScene
    });
    const projectDir = this.projectDir(projectId);
    const normalizedIrId = input.normalizedIrId ?? makeId("nir", snapshot.id, this.timestamp());
    const normalizedDir = resolve(projectDir, "normalized", normalizedIrId);
    await mkdir(normalizedDir, { recursive: true });
    await Promise.all([
      writeJson(resolve(normalizedDir, "normalized_design_ir.json"), artifacts.normalizedDesignIR),
      writeJson(resolve(normalizedDir, "reviewed_normalized_design_ir.json"), artifacts.reviewedNormalizedDesignIR),
      writeJson(resolve(normalizedDir, "override_conflict_report.json"), artifacts.overrideConflictReport),
      writeJson(resolve(normalizedDir, "stale_override_report.json"), artifacts.staleOverrideReport)
    ]);
    await this.updateIndex(projectId, (index) => {
      index.normalizedIrVersions = upsertById(index.normalizedIrVersions, {
        id: normalizedIrId,
        projectId,
        snapshotId: snapshot.id,
        overrideSetId: artifacts.overrideSet.id,
        normalizedIrPath: toStorePath(projectDir, resolve(normalizedDir, "normalized_design_ir.json")),
        reviewedNormalizedIrPath: toStorePath(projectDir, resolve(normalizedDir, "reviewed_normalized_design_ir.json")),
        overrideConflictReportPath: toStorePath(projectDir, resolve(normalizedDir, "override_conflict_report.json")),
        staleOverrideReportPath: toStorePath(projectDir, resolve(normalizedDir, "stale_override_report.json")),
        createdAt: this.timestamp()
      });
    });
    const overrideSet = await this.saveOverrideSet(projectId, {
      snapshotId: snapshot.id,
      overrideSet: artifacts.overrideSet,
      conflictReport: artifacts.overrideConflictReport,
      staleReport: artifacts.staleOverrideReport
    });
    const reviewTaskSet = await this.saveReviewTasks(projectId, {
      id: input.reviewTaskSetId,
      snapshotId: snapshot.id,
      reviewTasks: artifacts.reviewTasks,
      taskStatusReport: artifacts.taskStatusReport
    });
    await this.updateProject(projectId, { currentNormalizedIrId: normalizedIrId, status: "reviewing" });
    return { snapshot, overrideSet, reviewTaskSet };
  }

  async saveArtifactDirectory(projectId: string, input: SaveArtifactDirectoryInput): Promise<SavePipelineArtifactsResult> {
    const artifactDir = resolve(input.artifactDir);
    const rawFigmaScene = await readJson<RawFigmaScene>(resolve(artifactDir, "raw_figma_scene.json"));
    const canonicalScene = await readOptionalJson(resolve(artifactDir, "canonical_scene.json"));
    const snapshot = await this.saveSourceSnapshot(projectId, {
      snapshotId: input.snapshotId,
      rawFigmaScene,
      canonicalScene,
      referenceScreenshotPath: (await firstExisting([resolve(artifactDir, "figma_reference.png"), resolve(artifactDir, "figma_reference.jpg")])) ?? undefined,
      assetDir: (await exists(resolve(artifactDir, "assets"))) ? resolve(artifactDir, "assets") : undefined
    });
    const projectDir = this.projectDir(projectId);
    const normalizedIrId = input.normalizedIrId ?? makeId("nir", snapshot.id, this.timestamp());
    const normalizedDir = resolve(projectDir, "normalized", normalizedIrId);
    await mkdir(normalizedDir, { recursive: true });
    await copyNamedJson(artifactDir, normalizedDir, [
      "normalized_design_ir.json",
      "reviewed_normalized_design_ir.json",
      "override_conflict_report.json",
      "stale_override_report.json"
    ]);
    await this.updateIndex(projectId, (index) => {
      index.normalizedIrVersions = upsertById(index.normalizedIrVersions, {
        id: normalizedIrId,
        projectId,
        snapshotId: snapshot.id,
        overrideSetId: undefined,
        normalizedIrPath: toStorePath(projectDir, resolve(normalizedDir, "normalized_design_ir.json")),
        reviewedNormalizedIrPath: toStorePath(projectDir, resolve(normalizedDir, "reviewed_normalized_design_ir.json")),
        overrideConflictReportPath: toStorePath(projectDir, resolve(normalizedDir, "override_conflict_report.json")),
        staleOverrideReportPath: toStorePath(projectDir, resolve(normalizedDir, "stale_override_report.json")),
        createdAt: this.timestamp()
      });
    });
    const overrideSetJson = await readJson<OverrideSet>(resolve(artifactDir, "override_set.json"));
    const overrideSet = await this.saveOverrideSet(projectId, {
      snapshotId: snapshot.id,
      overrideSet: overrideSetJson,
      conflictReport: await readOptionalJson(resolve(artifactDir, "override_conflict_report.json")),
      staleReport: await readOptionalJson(resolve(artifactDir, "stale_override_report.json"))
    });
    await this.updateIndex(projectId, (index) => {
      const record = index.normalizedIrVersions.find((candidate) => candidate.id === normalizedIrId);
      if (record) record.overrideSetId = overrideSet.id;
    });
    const reviewTaskSet = await this.saveReviewTasks(projectId, {
      id: input.reviewTaskSetId,
      snapshotId: snapshot.id,
      reviewTasks: await readJson<ReviewTask[]>(resolve(artifactDir, "review_tasks.json")),
      taskStatusReport: await readJson<ReviewTaskStatusReport>(resolve(artifactDir, "task_status_report.json"))
    });
    if (
      (await exists(resolve(artifactDir, "flutter_preview.png"))) ||
      (await exists(resolve(artifactDir, "diff", "visual_diff_report.json"))) ||
      (await exists(resolve(artifactDir, "flutter_preview")))
    ) {
      await this.savePreviewArtifacts(projectId, {
        id: input.previewArtifactId,
        snapshotId: snapshot.id,
        previewPngPath: resolve(artifactDir, "flutter_preview.png"),
        visualDiffReportPath: resolve(artifactDir, "diff", "visual_diff_report.json"),
        heatmapPath: resolve(artifactDir, "diff", "diff_heatmap.png"),
        flutterPreviewDir: resolve(artifactDir, "flutter_preview")
      });
    }
    await this.updateProject(projectId, { currentNormalizedIrId: normalizedIrId, status: "reviewing" });
    return { snapshot, overrideSet, reviewTaskSet };
  }

  async exportProject(projectId: string, outPath: string): Promise<ExportProjectResult> {
    await this.ensureProject(projectId);
    const projectDir = this.projectDir(projectId);
    const files = await listFiles(projectDir);
    const entries: ZipEntryInput[] = [
      {
        name: ".uxcproj_manifest.json",
        data: Buffer.from(
          `${JSON.stringify({ version: storeVersion, projectId, exportedAt: this.timestamp(), fileCount: files.length }, null, 2)}\n`
        )
      },
      ...(await Promise.all(
        files.map(async (path) => ({
          name: toPosix(relative(projectDir, path)),
          data: await readFile(path)
        }))
      ))
    ];
    const archivePath = resolve(outPath);
    await mkdir(dirname(archivePath), { recursive: true });
    await writeFile(archivePath, writeStoredZip(entries));
    return { projectId, archivePath, entries: entries.length };
  }

  async importProject(archivePath: string, options: ImportProjectOptions = {}): Promise<ImportProjectResult> {
    await this.init();
    const entries = readStoredZip(await readFile(resolve(archivePath))).filter((entry) => entry.name !== ".uxcproj_manifest.json");
    const projectEntry = entries.find((entry) => entry.name === "project.json");
    if (!projectEntry) throw new Error("Invalid UXCompiler project archive: missing project.json.");
    const sourceProject = JSON.parse(projectEntry.data.toString("utf8")) as ProjectRecord;
    const projectId = options.newProjectId ?? sourceProject.id;
    const targetDir = this.projectDir(projectId);
    if ((await exists(targetDir)) && !options.replace) throw new Error(`Project already exists: ${projectId}`);
    if (options.replace) await rm(targetDir, { recursive: true, force: true });
    await mkdir(targetDir, { recursive: true });
    for (const entry of entries) {
      assertSafeArchivePath(entry.name);
      const target = resolve(targetDir, entry.name);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, rewriteImportedJson(entry.name, entry.data, sourceProject.id, projectId));
    }
    const imported = await this.readProject(projectId);
    await this.upsertWorkspaceSummary({ ...imported, id: projectId });
    await this.rebuildProjectCatalog(projectId);
    return { projectId, projectDir: targetDir, entries: entries.length };
  }

  private workspacePath(): string {
    return resolve(this.rootDir, "workspace.json");
  }

  private projectsDir(): string {
    return resolve(this.rootDir, "projects");
  }

  private projectDir(projectId: string): string {
    return resolve(this.projectsDir(), projectId);
  }

  private projectIndexPath(projectId: string): string {
    return resolve(this.projectDir(projectId), "project_index.json");
  }

  private dbPath(): string {
    return resolve(this.rootDir, "db.sqlite");
  }

  private timestamp(): string {
    return this.now().toISOString();
  }

  private async ensureProject(projectId: string): Promise<ProjectRecord> {
    await this.init();
    return this.readProject(projectId);
  }

  private async updateIndex(projectId: string, mutate: (index: ProjectStoreIndex) => void): Promise<ProjectStoreIndex> {
    const path = this.projectIndexPath(projectId);
    const index = (await exists(path)) ? await readJson<ProjectStoreIndex>(path) : emptyIndex(projectId);
    mutate(index);
    await writeJson(path, index);
    return index;
  }

  private async upsertWorkspaceSummary(project: ProjectRecord): Promise<void> {
    const workspace = await this.readWorkspace();
    workspace.updatedAt = this.timestamp();
    workspace.projects = upsertById(workspace.projects, {
      id: project.id,
      name: project.name,
      status: project.status,
      projectPath: toStorePath(this.rootDir, this.projectDir(project.id)),
      updatedAt: project.updatedAt
    });
    await writeJson(this.workspacePath(), workspace);
  }

  private async initializeCatalog(): Promise<void> {
    try {
      this.withCatalog((db) => db.exec(schemaSql));
    } catch {
      await rm(this.dbPath(), { force: true });
      this.withCatalog((db) => db.exec(schemaSql));
    }
  }

  private withCatalog<T>(operation: (db: DatabaseSync) => T): T {
    const db = new DatabaseSync(this.dbPath());
    try {
      db.exec(schemaSql);
      return operation(db);
    } finally {
      db.close();
    }
  }

  private upsertProjectCatalog(project: ProjectRecord): void {
    this.withCatalog((db) => {
      db.prepare(
        `INSERT OR REPLACE INTO projects (id, name, status, project_json_path, updated_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(project.id, project.name, project.status, `projects/${project.id}/project.json`, project.updatedAt);
    });
  }

  private upsertSnapshotCatalog(record: SourceSnapshotRecord): void {
    this.withCatalog((db) => {
      db.prepare(
        `INSERT OR REPLACE INTO source_snapshots (id, project_id, raw_scene_hash, raw_scene_path, created_at)
         VALUES (?, ?, ?, ?, ?)`
      ).run(record.id, record.projectId, record.rawSceneHash, record.rawScenePath, record.createdAt);
    });
  }

  private upsertOverrideCatalog(record: OverrideSetRecord): void {
    this.withCatalog((db) => {
      db.prepare(
        `INSERT OR REPLACE INTO override_sets (id, project_id, snapshot_id, hash, override_set_path, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(record.id, record.projectId, record.snapshotId ?? null, record.hash, record.overrideSetPath, record.updatedAt);
    });
  }

  private upsertReviewTaskCatalog(record: ReviewTaskSetRecord): void {
    this.withCatalog((db) => {
      db.prepare(
        `INSERT OR REPLACE INTO review_tasks (id, project_id, snapshot_id, task_path, status_report_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(record.id, record.projectId, record.snapshotId ?? null, record.taskPath, record.statusReportPath, record.createdAt);
    });
  }

  private upsertPreviewCatalog(record: PreviewArtifactRecord): void {
    this.withCatalog((db) => {
      db.prepare(
        `INSERT OR REPLACE INTO preview_artifacts (id, project_id, snapshot_id, preview_png_path, visual_diff_report_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(
        record.id,
        record.projectId,
        record.snapshotId ?? null,
        record.previewPngPath ?? null,
        record.visualDiffReportPath ?? null,
        record.createdAt
      );
    });
  }

  private upsertCodegenCatalog(record: CodegenBuildRecord): void {
    this.withCatalog((db) => {
      db.prepare(
        `INSERT OR REPLACE INTO codegen_builds (id, project_id, snapshot_id, status, build_artifacts_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(record.id, record.projectId, record.snapshotId ?? null, record.status, record.buildArtifactsPath, record.createdAt);
    });
  }

  private async rebuildProjectCatalog(projectId: string): Promise<void> {
    const project = await this.readProject(projectId);
    const index = await this.readProjectIndex(projectId);
    this.upsertProjectCatalog(project);
    for (const record of index.sourceSnapshots) this.upsertSnapshotCatalog(record);
    for (const record of index.overrideSets) this.upsertOverrideCatalog(record);
    for (const record of index.reviewTaskSets) this.upsertReviewTaskCatalog(record);
    for (const record of index.previewArtifacts) this.upsertPreviewCatalog(record);
    for (const record of index.codegenBuilds) this.upsertCodegenCatalog(record);
  }
}

function emptyIndex(projectId: string): ProjectStoreIndex {
  return {
    version: storeVersion,
    projectId,
    sourceSnapshots: [],
    normalizedIrVersions: [],
    overrideSets: [],
    reviewTaskSets: [],
    previewArtifacts: [],
    codegenBuilds: []
  };
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

async function readOptionalJson(path: string): Promise<unknown | undefined> {
  return (await exists(path)) ? readJson<unknown>(path) : undefined;
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    const candidate = error as NodeJS.ErrnoException;
    if (candidate.code === "ENOENT") return false;
    throw error;
  }
}

function upsertById<T extends { id: string }>(items: T[], item: T): T[] {
  const index = items.findIndex((candidate) => candidate.id === item.id);
  if (index === -1) return [...items, item];
  return [...items.slice(0, index), item, ...items.slice(index + 1)];
}

function makeId(prefix: string, seed: string, stamp: string): string {
  return `${prefix}_${safeId(seed)}_${createHash("sha256").update(`${seed}:${stamp}`).digest("hex").slice(0, 8)}`;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || "unknown";
}

function hashJson(value: unknown): string {
  return `sha256_${createHash("sha256").update(stableStringify(value)).digest("hex")}`;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function toStorePath(root: string, path: string): string {
  return toPosix(relative(root, path));
}

function toPosix(path: string): string {
  return path.split(sep).join("/");
}

async function copyOptional(projectDir: string, source: string | undefined, target: string): Promise<string | undefined> {
  if (!source || !(await exists(source))) return undefined;
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { recursive: true });
  return toStorePath(projectDir, target);
}

async function copyNamedJson(sourceDir: string, targetDir: string, names: string[]): Promise<void> {
  for (const name of names) {
    const source = resolve(sourceDir, name);
    if (await exists(source)) await cp(source, resolve(targetDir, name));
  }
}

async function firstExisting(paths: string[]): Promise<string | undefined> {
  for (const path of paths) {
    if (await exists(path)) return path;
  }
  return undefined;
}

async function listFiles(root: string): Promise<string[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(root, entry.name);
      if (entry.isDirectory()) return listFiles(path);
      return [path];
    })
  );
  return files.flat().sort();
}

interface ZipEntryInput {
  name: string;
  data: Buffer;
}

interface ZipEntryOutput {
  name: string;
  data: Buffer;
}

function writeStoredZip(entries: ZipEntryInput[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const crc = crc32(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, entry.data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(entry.data.length, 20);
    central.writeUInt32LE(entry.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + entry.data.length;
  }
  const centralOffset = offset;
  const central = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, central, eocd]);
}

function readStoredZip(buffer: Buffer): ZipEntryOutput[] {
  const eocdOffset = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocdOffset === -1) throw new Error("Invalid zip archive: missing end of central directory.");
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries: ZipEntryOutput[] = [];
  let cursor = centralOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (buffer.readUInt32LE(cursor) !== 0x02014b50) throw new Error("Invalid zip archive: corrupt central directory.");
    const method = buffer.readUInt16LE(cursor + 10);
    if (method !== 0) throw new Error("Unsupported project archive: only stored zip entries are supported.");
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString("utf8");
    if (buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new Error("Invalid zip archive: corrupt local entry.");
    const localNameLength = buffer.readUInt16LE(localOffset + 26);
    const localExtraLength = buffer.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLength + localExtraLength;
    entries.push({ name, data: buffer.subarray(dataStart, dataStart + compressedSize) });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const crcTable = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  return value >>> 0;
});

function assertSafeArchivePath(path: string): void {
  if (!path || path.startsWith("/") || path.includes("..") || path.includes("\\")) {
    throw new Error(`Unsafe project archive path: ${path}`);
  }
}

function rewriteImportedJson(name: string, data: Buffer, oldProjectId: string, newProjectId: string): Buffer {
  if (!name.endsWith(".json") || oldProjectId === newProjectId) return data;
  try {
    const parsed = replaceProjectId(JSON.parse(data.toString("utf8")), oldProjectId, newProjectId);
    if (name === "project.json" && parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const project = parsed as Record<string, unknown>;
      if (project.id === oldProjectId) project.id = newProjectId;
    }
    return Buffer.from(`${JSON.stringify(parsed, null, 2)}\n`);
  } catch {
    return data;
  }
}

function replaceProjectId(value: unknown, oldProjectId: string, newProjectId: string): unknown {
  if (Array.isArray(value)) return value.map((entry) => replaceProjectId(entry, oldProjectId, newProjectId));
  if (!value || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    result[key] = key === "projectId" && entry === oldProjectId ? newProjectId : replaceProjectId(entry, oldProjectId, newProjectId);
  }
  return result;
}
