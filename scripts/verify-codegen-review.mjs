import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createCodegenReview } from "../packages/codegen-review/dist/index.js";

const root = "artifacts/codegen-review-smoke";
const baseDir = resolve(root, "base");
const reviewDir = resolve(root, "review");
const conflictDir = resolve(root, "conflict-review");
const projectDir = resolve(root, "existing-project");
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

const input = {
  normalizedDesignIR: readJson(baseDir, "reviewed_normalized_design_ir.json"),
  assetManifest: readJson(baseDir, "reviewed_asset_manifest.json"),
  i18nManifest: withPlaceholder(readJson(baseDir, "reviewed_i18n_manifest.json")),
  flutterPreviewFiles: readTextFiles(resolve(baseDir, "flutter_preview")),
  reviewTasks: readJson(baseDir, "review_tasks.json"),
  taskStatusReport: readJson(baseDir, "task_status_report.json"),
  fidelityGenerationManifest: readJson(baseDir, "fidelity_generation_manifest.json"),
  nodePixelMap: readJson(baseDir, "node_pixel_map.json"),
  overrideSet: readJson(baseDir, "override_set.json"),
  staleOverrideReport: readJson(baseDir, "stale_override_report.json"),
  projectId: "proj_login",
  normalizedIrId: "nir_login",
  now: () => new Date("2026-07-04T00:00:00.000Z")
};

const result = createCodegenReview(input);
assert.equal(result.codegenReview.projectId, "proj_login");
assert.equal(result.codegenReview.normalizedIrId, "nir_login");
assert.equal(result.codegenReview.gates.status, "ready");
assert.equal(result.codegenReview.format.status, "unknown");
assert.ok(result.filesToCreate.some((file) => file.path === "lib/generated/fidelity/preview_page.dart"));
assert.ok(result.filesToCreate.some((file) => file.path === "lib/features/login_mobile/presentation/pages/login_mobile_page.dart"));
assert.ok(result.filesToCreate.some((file) => file.path === "lib/features/login_mobile/presentation/widgets/login_mobile_content.dart"));
assert.ok(result.filesToCreate.some((file) => file.path === "lib/theme/app_colors.dart"));
assert.ok(result.filesToCreate.some((file) => file.path === "lib/generated/assets.gen.dart"));
assert.ok(result.generatedFiles.every((file) => file.content.includes("@uxc-generated:start")));
assert.ok(
  result.codegenReview.files.some((file) =>
    file.path === "lib/features/login_mobile/presentation/pages/login_mobile_page.dart" &&
    file.generatedRegions.some((region) => region.strategy === "semantic_page_facade")
  )
);
assert.ok(result.assetsToAdd.some((asset) => asset.path === "assets/icons/divider_dot.svg"));
assert.ok(result.arbPatch.keysToAdd.some((message) => message.key === "button_label"));
assert.equal(result.arbPatch.patch["@button_label"].placeholders.ctaLabel.type, "String");
assert.match(result.pubspecPatch.patch, /assets\/icons\/divider_dot\.svg/);
assert.equal(result.incrementalSyncReport.mode, "initial_generation");

const incremental = createCodegenReview({
  ...input,
  previousManifest: result.codegenReview
});
assert.equal(incremental.incrementalSyncReport.mode, "incremental_review");
assert.equal(incremental.incrementalSyncReport.fileChanges.every((change) => change.change === "unchanged"), true);

const formatBlocked = createCodegenReview({
  ...input,
  format: { status: "failed", source: "flutter_preview_format_report.json" }
});
assert.equal(formatBlocked.codegenReview.gates.status, "blocked");
assert.ok(formatBlocked.codegenReview.gates.blockers.some((blocker) => blocker.type === "dart_format_failed"));

const scaffoldConflict = createCodegenReview({
  ...input,
  existingProjectFiles: {
    "lib/features/login_mobile/presentation/pages/login_mobile_page.dart": "class HandWrittenLoginPage {}\n"
  }
});
assert.equal(scaffoldConflict.codegenReview.gates.status, "blocked");
assert.ok(
  scaffoldConflict.codegenReview.gates.blockers.some(
    (blocker) =>
      blocker.type === "manual_file_conflict" &&
      blocker.filePath === "lib/features/login_mobile/presentation/pages/login_mobile_page.dart"
  )
);

const staleBlocked = createCodegenReview({
  ...input,
  reviewTasks: [
    {
      id: "task_incremental_remap_ovr_title",
      type: "stale_override",
      priority: "P1",
      target: { sourceNodeIds: ["2:3"] },
      title: "Confirm remapped override",
      description: "A low-confidence incremental remap needs review before codegen write.",
      confidence: 0.62,
      evidence: { overrideId: "ovr_title" },
      suggestedActions: [],
      status: "open"
    }
  ]
});
assert.equal(staleBlocked.codegenReview.gates.status, "blocked");
assert.ok(staleBlocked.codegenReview.gates.blockers.some((blocker) => blocker.type === "stale_override_unresolved"));

execFileSync(
  "node",
  [
    "apps/cli/dist/index.js",
    "codegen",
    "review",
    "--artifacts",
    baseDir,
    "--out",
    reviewDir,
    "--project-id",
    "proj_login",
    "--normalized-ir-id",
    "nir_login"
  ],
  { stdio: "pipe" }
);

for (const file of [
  "codegen_review.json",
  "flutter_generation_manifest.json",
  "files_to_create.json",
  "files_to_modify.json",
  "assets_to_add.json",
  "arb_patch.json",
  "pubspec.yaml.patch",
  "pubspec_patch.json",
  "merge_report.json",
  "incremental_sync_report.json",
  "generated/lib/features/login_mobile/presentation/pages/login_mobile_page.dart",
  "generated/lib/features/login_mobile/presentation/widgets/login_mobile_content.dart",
  "generated/lib/theme/app_colors.dart",
  "generated/lib/theme/app_spacing.dart",
  "generated/lib/theme/app_radii.dart",
  "generated/lib/theme/app_text_styles.dart",
  "generated/lib/theme/app_shadows.dart",
  "generated/lib/generated/assets.gen.dart",
  "generated/lib/generated/fidelity/preview_page.dart"
]) {
  assert.equal(existsSync(resolve(reviewDir, file)), true, `Missing ${file}`);
}
const cliReview = readJson(reviewDir, "codegen_review.json");
assert.equal(cliReview.gates.status, "ready");
assert.equal(cliReview.format.status, "success");
assert.equal(cliReview.analyze.source, "flutter_preview_analyze_report.json");
assert.ok(cliReview.filesToCreate.includes("lib/main.dart"));
assert.ok(cliReview.filesToCreate.includes("lib/features/login_mobile/presentation/pages/login_mobile_page.dart"));
assert.match(readFileSync(resolve(reviewDir, "generated/lib/features/login_mobile/presentation/pages/login_mobile_page.dart"), "utf8"), /class LoginMobilePage/);
assert.match(readFileSync(resolve(reviewDir, "generated/lib/features/login_mobile/presentation/widgets/login_mobile_content.dart"), "utf8"), /return const UxcPreviewPage\(\);/);
assert.match(readFileSync(resolve(reviewDir, "generated/lib/features/login_mobile/presentation/widgets/login_mobile_content.dart"), "utf8"), /generated\/fidelity\/preview_page\.dart/);
assert.match(readFileSync(resolve(reviewDir, "generated/lib/generated/assets.gen.dart"), "utf8"), /static const dividerDot/);
const textStyles = readFileSync(resolve(reviewDir, "generated/lib/theme/app_text_styles.dart"), "utf8");
assert.equal(new Set([...textStyles.matchAll(/static const (\w+) = TextStyle/g)].map((match) => match[1])).size, 4);
assert.match(textStyles, /static const textBodyMedium2 = TextStyle/);
if (commandExists("dart")) {
  execFileSync("dart", ["format", "--set-exit-if-changed", resolve(reviewDir, "generated")], { stdio: "pipe" });
}

writeFile(resolve(projectDir, "lib/main.dart"), "void main() {}\n");
writeFile(resolve(projectDir, "lib/features/login_mobile/presentation/pages/login_mobile_page.dart"), "class HandWrittenLoginPage {}\n");
execFileSync(
  "node",
  [
    "apps/cli/dist/index.js",
    "codegen",
    "review",
    "--artifacts",
    baseDir,
    "--out",
    conflictDir,
    "--project-path",
    projectDir
  ],
  { stdio: "pipe" }
);
const conflictReview = readJson(conflictDir, "codegen_review.json");
assert.equal(conflictReview.gates.status, "blocked");
assert.ok(conflictReview.gates.blockers.some((blocker) => blocker.type === "manual_file_conflict" && blocker.filePath === "lib/main.dart"));
assert.ok(
  conflictReview.gates.blockers.some(
    (blocker) =>
      blocker.type === "manual_file_conflict" &&
      blocker.filePath === "lib/features/login_mobile/presentation/pages/login_mobile_page.dart"
  )
);
assert.equal(existsSync(resolve(conflictDir, "patches/lib_main_dart.patch")), true);
assert.equal(existsSync(resolve(conflictDir, "patches/lib_features_login_mobile_presentation_pages_login_mobile_page_dart.patch")), true);

console.log("codegen review verification passed");

function readJson(base, file) {
  return JSON.parse(readFileSync(resolve(base, file), "utf8"));
}

function withPlaceholder(manifest) {
  const copy = JSON.parse(JSON.stringify(manifest));
  const message = copy.messages.find((entry) => entry.key === "button_label");
  assert.ok(message, "Expected button_label i18n message");
  message.placeholders = {
    ctaLabel: {
      type: "String",
      example: "Sign in",
      description: "Button label placeholder metadata."
    }
  };
  return copy;
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

function commandExists(command) {
  try {
    execFileSync("sh", ["-c", `command -v ${command}`], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}
