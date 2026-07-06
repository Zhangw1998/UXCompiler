import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { writeCodegenToProject } from "../packages/project-writer/dist/index.js";

const root = "artifacts/project-writer-smoke";
const baseDir = resolve(root, "base");
const reviewDir = resolve(root, "review");
const projectDir = resolve(root, "flutter-project");
const dryProjectDir = resolve(root, "dry-project");
const missingAssetProjectDir = resolve(root, "missing-asset-project");
const conflictProjectDir = resolve(root, "conflict-project");
const conflictReviewDir = resolve(root, "conflict-review");
const driftReviewDir = resolve(root, "drift-review");
const arbUpdateBaseDir = resolve(root, "arb-update-base");
const arbUpdateReviewDir = resolve(root, "arb-update-review");
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
assert.equal(existsSync(resolve(baseDir, "assets/icons/divider_dot.svg")), true);
assert.equal(existsSync(resolve(reviewDir, "assets/icons/divider_dot.svg")), true);
writeFile(resolve(projectDir, "pubspec.yaml"), "name: smoke_app\npublish_to: none\nflutter:\n  uses-material-design: true\n");

const direct = await writeCodegenToProject({
  projectPath: projectDir,
  codegenReview: readJson(reviewDir, "codegen_review.json"),
  generatedFiles: readGeneratedFiles(resolve(reviewDir, "generated")),
  arbPatch: readJson(reviewDir, "arb_patch.json"),
  pubspecPatch: readJson(reviewDir, "pubspec_patch.json"),
  assetRoots: [reviewDir],
  now: () => new Date("2026-07-04T00:00:00.000Z")
});
assert.equal(direct.report.wrote, true);
assert.ok(direct.report.files.some((file) => file.path === "lib/main.dart" && file.status === "created"));
assert.equal(existsSync(resolve(projectDir, "lib/main.dart")), true);
assert.equal(existsSync(resolve(projectDir, "lib/features/login_mobile/presentation/pages/login_mobile_page.dart")), true);
assert.equal(existsSync(resolve(projectDir, "lib/features/login_mobile/presentation/widgets/login_mobile_content.dart")), true);
assert.equal(existsSync(resolve(projectDir, "lib/generated/fidelity/preview_page.dart")), true);
assert.equal(existsSync(resolve(projectDir, "assets/icons/divider_dot.svg")), true);
assert.match(readFileSync(resolve(projectDir, "lib/features/login_mobile/presentation/widgets/login_mobile_content.dart"), "utf8"), /UxcPreviewPage/);
assert.match(readFileSync(resolve(projectDir, "pubspec.yaml"), "utf8"), /assets\/icons\/divider_dot\.svg/);
const arb = readJson(projectDir, "lib/l10n/app_en.arb");
assert.equal(arb.button_label, "Sign in");
const generatedArb = readJson(projectDir, "lib/l10n/intl_en.arb");
assert.equal(generatedArb.button_label, "Sign in");
assert.equal(generatedArb["@@uxcGenerated"].strategy, "i18n_arb");

const second = await writeCodegenToProject({
  projectPath: projectDir,
  codegenReview: readJson(reviewDir, "codegen_review.json"),
  generatedFiles: readGeneratedFiles(resolve(reviewDir, "generated")),
  arbPatch: readJson(reviewDir, "arb_patch.json"),
  pubspecPatch: readJson(reviewDir, "pubspec_patch.json"),
  assetRoots: [reviewDir]
});
assert.equal(second.report.files.every((file) => file.status === "unchanged"), true);

cpSync(baseDir, arbUpdateBaseDir, { recursive: true });
const updatedI18nManifest = withMessageValue(readJson(arbUpdateBaseDir, "final_i18n_manifest.json"), "button_label", "Continue");
writeJson(resolve(arbUpdateBaseDir, "final_i18n_manifest.json"), updatedI18nManifest);
writeJson(resolve(arbUpdateBaseDir, "reviewed_i18n_manifest.json"), updatedI18nManifest);
execFileSync(
  "node",
  [
    "apps/cli/dist/index.js",
    "codegen",
    "review",
    "--artifacts",
    arbUpdateBaseDir,
    "--out",
    arbUpdateReviewDir,
    "--project-path",
    projectDir
  ],
  { stdio: "pipe" }
);
const arbUpdateReview = readJson(arbUpdateReviewDir, "codegen_review.json");
const generatedArbPlan = arbUpdateReview.files.find((file) => file.path === "lib/l10n/intl_en.arb");
assert.equal(generatedArbPlan.action, "modify");
const arbUpdate = await writeCodegenToProject({
  projectPath: projectDir,
  codegenReview: arbUpdateReview,
  generatedFiles: readGeneratedFiles(resolve(arbUpdateReviewDir, "generated")),
  arbPatch: readJson(arbUpdateReviewDir, "arb_patch.json"),
  pubspecPatch: readJson(arbUpdateReviewDir, "pubspec_patch.json"),
  assetRoots: [arbUpdateReviewDir]
});
const arbUpdateFile = arbUpdate.report.files.find((file) => file.path === "lib/l10n/intl_en.arb");
assert.equal(arbUpdateFile.status, "updated");
assert.equal(readJson(projectDir, "lib/l10n/intl_en.arb").button_label, "Continue");
assert.equal(readJson(projectDir, "lib/l10n/app_en.arb").button_label, "Continue");

writeFile(resolve(missingAssetProjectDir, "pubspec.yaml"), "name: missing_asset_app\npublish_to: none\n");
const missingAssetWrite = await writeCodegenToProject({
  projectPath: missingAssetProjectDir,
  codegenReview: readJson(reviewDir, "codegen_review.json"),
  generatedFiles: readGeneratedFiles(resolve(reviewDir, "generated")),
  arbPatch: readJson(reviewDir, "arb_patch.json"),
  pubspecPatch: readJson(reviewDir, "pubspec_patch.json"),
  assetRoots: [],
  now: () => new Date("2026-07-04T00:00:00.000Z")
});
assert.equal(missingAssetWrite.report.wrote, false);
assert.equal(missingAssetWrite.report.files.every((file) => file.status === "blocked"), true);
assert.equal(missingAssetWrite.report.arb.status, "blocked");
assert.equal(missingAssetWrite.report.pubspec.status, "blocked");
assert.equal(existsSync(resolve(missingAssetProjectDir, "lib/main.dart")), false);
assert.equal(readFileSync(resolve(missingAssetProjectDir, "pubspec.yaml"), "utf8").includes("assets/icons/divider_dot.svg"), false);
assert.ok(missingAssetWrite.report.assets.some((asset) => asset.path === "assets/icons/divider_dot.svg" && asset.status === "missing_source"));
assert.ok(missingAssetWrite.report.blockers.some((blocker) => blocker.type === "asset_missing_source" && blocker.filePath === "assets/icons/divider_dot.svg"));

execFileSync(
  "node",
  [
    "apps/cli/dist/index.js",
    "codegen",
    "review",
    "--artifacts",
    baseDir,
    "--out",
    driftReviewDir,
    "--project-path",
    projectDir
  ],
  { stdio: "pipe" }
);
const mainPath = resolve(projectDir, "lib/main.dart");
const reviewedMain = readFileSync(mainPath, "utf8");
writeFile(mainPath, reviewedMain.replace("// @uxc-generated:end", "  // manual generated-region tweak\n// @uxc-generated:end"));
const drift = await writeCodegenToProject({
  projectPath: projectDir,
  codegenReview: readJson(driftReviewDir, "codegen_review.json"),
  generatedFiles: readGeneratedFiles(resolve(driftReviewDir, "generated")),
  arbPatch: readJson(driftReviewDir, "arb_patch.json"),
  pubspecPatch: readJson(driftReviewDir, "pubspec_patch.json"),
  assetRoots: [driftReviewDir]
});
const driftFile = drift.report.files.find((file) => file.path === "lib/main.dart");
assert.equal(driftFile.status, "blocked");
assert.equal(driftFile.action, "unchanged");
assert.equal(driftFile.mergeStatus, "conflict_patch");
assert.match(driftFile.mergeBaseHash, /^sha256_[a-f0-9]{64}$/);
assert.match(driftFile.currentHash, /^sha256_[a-f0-9]{64}$/);
assert.match(driftFile.generatedHash, /^sha256_[a-f0-9]{64}$/);
assert.match(driftFile.patch, /manual generated-region tweak/);
assert.match(driftFile.patch, /# mergeBaseHash: sha256_[a-f0-9]{64}/);
assert.match(driftFile.patch, /# currentHash: sha256_[a-f0-9]{64}/);
assert.match(driftFile.patch, /# generatedHash: sha256_[a-f0-9]{64}/);
assert.match(driftFile.patch, /--- a\/lib\/main\.dart/);
assert.equal(readFileSync(mainPath, "utf8").includes("manual generated-region tweak"), true);

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

function writeJson(path, value) {
  writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

function withMessageValue(manifest, key, value) {
  const copy = JSON.parse(JSON.stringify(manifest));
  const message = copy.messages.find((entry) => entry.key === key);
  assert.ok(message, `Missing i18n message ${key}`);
  message.value = value;
  return copy;
}
