import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { writeCodegenToProject } from "../packages/project-writer/dist/index.js";

const root = "artifacts/project-writer-smoke";
const baseDir = resolve(root, "base");
const reviewDir = resolve(root, "review");
const projectDir = resolve(root, "flutter-project");
const dryProjectDir = resolve(root, "dry-project");
const conflictProjectDir = resolve(root, "conflict-project");
const conflictReviewDir = resolve(root, "conflict-review");
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });

execFileSync(
  "node",
  [
    "apps/cli/dist/index.js",
    "compile",
    "--input",
    "examples/fixtures/login_raw_figma_scene.json",
    "--out",
    baseDir
  ],
  { stdio: "pipe" }
);

execFileSync(
  "node",
  ["apps/cli/dist/index.js", "codegen", "review", "--artifacts", baseDir, "--out", reviewDir, "--project-id", "proj_login"],
  { stdio: "pipe" }
);
writeFile(resolve(reviewDir, "assets/assets/icons/divider_dot.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\" />\n");
writeFile(resolve(projectDir, "pubspec.yaml"), "name: smoke_app\npublish_to: none\nflutter:\n  uses-material-design: true\n");

const direct = await writeCodegenToProject({
  projectPath: projectDir,
  codegenReview: readJson(reviewDir, "codegen_review.json"),
  generatedFiles: readGeneratedFiles(resolve(reviewDir, "generated")),
  arbPatch: readJson(reviewDir, "arb_patch.json"),
  pubspecPatch: readJson(reviewDir, "pubspec_patch.json"),
  assetRoots: [resolve(reviewDir, "assets")],
  now: () => new Date("2026-07-04T00:00:00.000Z")
});
assert.equal(direct.report.wrote, true);
assert.ok(direct.report.files.some((file) => file.path === "lib/main.dart" && file.status === "created"));
assert.equal(existsSync(resolve(projectDir, "lib/main.dart")), true);
assert.equal(existsSync(resolve(projectDir, "lib/generated/fidelity/preview_page.dart")), true);
assert.equal(existsSync(resolve(projectDir, "assets/icons/divider_dot.svg")), true);
assert.match(readFileSync(resolve(projectDir, "pubspec.yaml"), "utf8"), /assets\/icons\/divider_dot\.svg/);
const arb = readJson(projectDir, "lib/l10n/app_en.arb");
assert.equal(arb.button_label, "Sign in");

const second = await writeCodegenToProject({
  projectPath: projectDir,
  codegenReview: readJson(reviewDir, "codegen_review.json"),
  generatedFiles: readGeneratedFiles(resolve(reviewDir, "generated")),
  arbPatch: readJson(reviewDir, "arb_patch.json"),
  pubspecPatch: readJson(reviewDir, "pubspec_patch.json"),
  assetRoots: [resolve(reviewDir, "assets")]
});
assert.equal(second.report.files.every((file) => file.status === "unchanged"), true);

execFileSync(
  "node",
  [
    "apps/cli/dist/index.js",
    "codegen",
    "write",
    "--review",
    reviewDir,
    "--project-path",
    dryProjectDir,
    "--asset-root",
    resolve(reviewDir, "assets"),
    "--dry-run"
  ],
  { stdio: "pipe" }
);
const dryReport = readJson(reviewDir, "project_write_report.json");
assert.equal(dryReport.mode, "dry_run");
assert.equal(dryReport.wrote, false);
assert.equal(existsSync(resolve(dryProjectDir, "lib/main.dart")), false);
assert.ok(dryReport.files.some((file) => file.status === "created"));

writeFile(resolve(conflictProjectDir, "pubspec.yaml"), "name: conflict_app\npublish_to: none\n");
writeFile(resolve(conflictProjectDir, "lib/main.dart"), "void main() {}\n");
execFileSync(
  "node",
  [
    "apps/cli/dist/index.js",
    "codegen",
    "review",
    "--artifacts",
    baseDir,
    "--out",
    conflictReviewDir,
    "--project-path",
    conflictProjectDir
  ],
  { stdio: "pipe" }
);
execFileSync(
  "node",
  ["apps/cli/dist/index.js", "codegen", "write", "--review", conflictReviewDir, "--project-path", conflictProjectDir],
  { stdio: "pipe" }
);
const conflictReport = readJson(conflictReviewDir, "project_write_report.json");
assert.equal(conflictReport.wrote, false);
assert.equal(conflictReport.files.some((file) => file.path === "lib/main.dart" && file.status === "blocked"), true);
assert.equal(readFileSync(resolve(conflictProjectDir, "lib/main.dart"), "utf8"), "void main() {}\n");

console.log("project writer verification passed");

function readJson(base, file) {
  return JSON.parse(readFileSync(resolve(base, file), "utf8"));
}

function readGeneratedFiles(rootDir) {
  const files = readTextFiles(rootDir);
  return Object.entries(files)
    .map(([path, content]) => ({ path, content }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function readTextFiles(rootDir, prefix = "") {
  const files = {};
  for (const entry of readdirSync(rootDir, { withFileTypes: true })) {
    const fullPath = resolve(rootDir, entry.name);
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      Object.assign(files, readTextFiles(fullPath, relativePath));
    } else if (entry.isFile()) {
      files[relativePath] = readFileSync(fullPath, "utf8");
    }
  }
  return files;
}

function writeFile(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}
