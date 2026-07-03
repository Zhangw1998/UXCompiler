import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createProjectStore } from "../packages/project-store/dist/index.js";

const root = resolve("artifacts/project-store-smoke");
const compiledDir = resolve(root, "compiled");
const storeRoot = resolve(root, ".uxcompiler");
const importRoot = resolve(root, "imported-store");
const archivePath = resolve(root, "login_page.uxcproj.zip");
rmSync(root, { recursive: true, force: true });

execFileSync(
  "node",
  [
    "apps/cli/dist/index.js",
    "compile",
    "--input",
    "examples/fixtures/login_raw_figma_scene.json",
    "--out",
    compiledDir
  ],
  { stdio: "pipe" }
);

const store = createProjectStore({
  rootDir: storeRoot,
  now: () => new Date("2026-07-04T00:00:00.000Z")
});
const workspace = await store.init();
assert.equal(workspace.version, "0.1.0");
assert.equal(existsSync(resolve(storeRoot, "workspace.json")), true);
assert.equal(existsSync(resolve(storeRoot, "db.sqlite")), true);
assert.equal(existsSync(resolve(storeRoot, "schema.sql")), true);

const project = await store.createProject({
  id: "proj_login",
  name: "Login Page",
  figma: {
    fileKey: "fixture",
    frameId: "1:1",
    frameName: "LoginMobile"
  },
  flutter: {
    projectPath: "/tmp/uxcompiler-login",
    packageName: "login_app"
  }
});
assert.equal(project.id, "proj_login");

const saveResult = await store.saveArtifactDirectory("proj_login", {
  artifactDir: compiledDir,
  snapshotId: "snap_login_fixture",
  normalizedIrId: "nir_login_fixture",
  reviewTaskSetId: "tasks_login_fixture",
  previewArtifactId: "preview_login_fixture"
});
assert.equal(saveResult.snapshot.id, "snap_login_fixture");
assert.equal(saveResult.overrideSet.id, "ovset_default");
assert.equal(saveResult.reviewTaskSet.id, "tasks_login_fixture");

const updated = await store.updateProject("proj_login", {
  status: "reviewing",
  flutter: {
    projectPath: "/tmp/uxcompiler-login-updated",
    packageName: "login_app"
  }
});
assert.equal(updated.flutter.projectPath, "/tmp/uxcompiler-login-updated");

const index = await store.readProjectIndex("proj_login");
assert.equal(index.sourceSnapshots.length, 1);
assert.equal(index.normalizedIrVersions.length, 1);
assert.equal(index.overrideSets.length, 1);
assert.equal(index.reviewTaskSets.length, 1);
assert.equal(index.previewArtifacts.length, 1);
assert.equal(index.sourceSnapshots[0].rawSceneHash.startsWith("sha256_"), true);
const db = new DatabaseSync(resolve(storeRoot, "db.sqlite"));
try {
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM projects").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM source_snapshots").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM override_sets").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM review_tasks").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM preview_artifacts").get().count, 1);
} finally {
  db.close();
}
assert.equal(existsSync(resolve(storeRoot, "projects/proj_login/project.json")), true);
assert.equal(existsSync(resolve(storeRoot, "projects/proj_login/snapshots/snap_login_fixture/raw_figma_scene.json")), true);
assert.equal(existsSync(resolve(storeRoot, "projects/proj_login/normalized/nir_login_fixture/reviewed_normalized_design_ir.json")), true);
assert.equal(existsSync(resolve(storeRoot, "projects/proj_login/overrides/ovset_default/override_set.json")), true);
assert.equal(existsSync(resolve(storeRoot, "projects/proj_login/overrides/override_history.ndjson")), true);
assert.equal(existsSync(resolve(storeRoot, "projects/proj_login/review_tasks/tasks_login_fixture/review_tasks.json")), true);
assert.equal(existsSync(resolve(storeRoot, "projects/proj_login/previews/preview_login_fixture/flutter_preview")), true);

const exportResult = await store.exportProject("proj_login", archivePath);
assert.equal(exportResult.projectId, "proj_login");
assert.equal(existsSync(archivePath), true);
assert.equal(readFileSync(archivePath).subarray(0, 4).toString("hex"), "504b0304");

const importStore = createProjectStore({
  rootDir: importRoot,
  now: () => new Date("2026-07-04T00:00:00.000Z")
});
const importResult = await importStore.importProject(archivePath, { newProjectId: "proj_login_imported" });
assert.equal(importResult.projectId, "proj_login_imported");
const importedProject = await importStore.readProject("proj_login_imported");
assert.equal(importedProject.id, "proj_login_imported");
assert.equal(importedProject.name, "Login Page");
const importedIndex = await importStore.readProjectIndex("proj_login_imported");
assert.equal(importedIndex.projectId, "proj_login_imported");
assert.equal(importedIndex.sourceSnapshots[0].projectId, "proj_login_imported");
assert.equal(importedIndex.overrideSets[0].projectId, "proj_login_imported");
assert.equal(existsSync(resolve(importRoot, "projects/proj_login_imported/project_index.json")), true);

execFileSync("node", ["apps/cli/dist/index.js", "project", "init", "--root", resolve(root, "cli-store")], { stdio: "pipe" });
execFileSync(
  "node",
  [
    "apps/cli/dist/index.js",
    "project",
    "create",
    "--root",
    resolve(root, "cli-store"),
    "--id",
    "proj_cli",
    "--name",
    "CLI Project"
  ],
  { stdio: "pipe" }
);
execFileSync(
  "node",
  [
    "apps/cli/dist/index.js",
    "project",
    "save-artifacts",
    "--root",
    resolve(root, "cli-store"),
    "--project",
    "proj_cli",
    "--artifacts",
    compiledDir,
    "--snapshot-id",
    "snap_cli"
  ],
  { stdio: "pipe" }
);
assert.equal(existsSync(resolve(root, "cli-store/projects/proj_cli/review_tasks")), true);

console.log("project store verification passed");
