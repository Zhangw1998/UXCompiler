import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { promoteGeneratedWidget } from "../packages/component-promoter/dist/index.js";

const root = "artifacts/component-promoter-smoke";
const baseDir = resolve(root, "base");
const reviewDir = resolve(root, "review");
const promoteDir = resolve(root, "promote");
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
  ["apps/cli/dist/index.js", "codegen", "review", "--artifacts", baseDir, "--out", reviewDir],
  { stdio: "pipe" }
);

const generatedFilePath = "lib/generated/fidelity/preview_page.dart";
const generatedFileContent = readFileSync(resolve(reviewDir, "generated", generatedFilePath), "utf8");
const direct = promoteGeneratedWidget({
  generatedFileContent,
  request: {
    componentId: "cmp_login_preview",
    name: "LoginPreview",
    generatedFilePath,
    sourceNodeIds: ["1:1", "1:12"],
    flutter: {
      import: "package:app/features/login/login_preview.dart",
      constructor: "LoginPreview"
    },
    reason: "Promote generated login preview into a handwritten Flutter component."
  },
  now: () => new Date("2026-07-04T00:00:00.000Z")
});
assert.equal(direct.promoteReport.promoted, true);
assert.equal(direct.componentRegistry.components[0].source, "user_defined");
assert.equal(direct.componentRegistry.components[0].verified, true);
assert.equal(direct.componentRegistry.components[0].flutter.constructor, "LoginPreview");
assert.equal(direct.promotionRules[0].skipGeneratedRegions, true);
assert.equal(direct.promotionRules[0].updateCallsitesOnly, true);

const duplicate = promoteGeneratedWidget({
  componentRegistry: direct.componentRegistry,
  promotionRules: direct.promotionRules,
  generatedFileContent,
  request: {
    componentId: "cmp_login_preview",
    name: "LoginPreview",
    generatedFilePath,
    sourceNodeIds: ["1:1"],
    flutter: {
      import: "package:app/features/login/login_preview.dart",
      constructor: "LoginPreview"
    },
    reason: "Refresh an existing promotion mapping."
  }
});
assert.equal(duplicate.promoteReport.promoted, true);
assert.ok(duplicate.promoteReport.issues.some((issue) => issue.severity === "warning" && issue.code === "duplicate_component"));
assert.equal(duplicate.promotionRules.length, 1);

const invalid = promoteGeneratedWidget({
  generatedFileContent,
  request: {
    componentId: "bad id",
    name: "loginPreview",
    generatedFilePath,
    sourceNodeIds: [],
    flutter: {
      import: "",
      constructor: ""
    },
    reason: ""
  }
});
assert.equal(invalid.promoteReport.promoted, false);
assert.ok(invalid.promoteReport.issues.some((issue) => issue.code === "missing_reason"));
assert.ok(invalid.promoteReport.issues.some((issue) => issue.code === "invalid_component"));

execFileSync(
  "node",
  [
    "apps/cli/dist/index.js",
    "codegen",
    "promote",
    "--review",
    reviewDir,
    "--file",
    generatedFilePath,
    "--component-id",
    "cmp_login_preview",
    "--name",
    "LoginPreview",
    "--source-node-id",
    "1:1",
    "--source-node-id",
    "1:12",
    "--import",
    "package:app/features/login/login_preview.dart",
    "--constructor",
    "LoginPreview",
    "--reason",
    "Promote generated login preview into a handwritten Flutter component.",
    "--out",
    promoteDir
  ],
  { stdio: "pipe" }
);

for (const file of ["promote_report.json", "component_registry.json", "codegen_promotion_rules.json"]) {
  assert.equal(existsSync(resolve(promoteDir, file)), true, `Missing ${file}`);
}
const cliReport = readJson(promoteDir, "promote_report.json");
const cliRegistry = readJson(promoteDir, "component_registry.json");
const cliRules = readJson(promoteDir, "codegen_promotion_rules.json");
assert.equal(cliReport.promoted, true);
assert.equal(cliRegistry.components[0].id, "cmp_login_preview");
assert.equal(cliRules[0].generatedFilePath, generatedFilePath);
assert.equal(cliRules[0].skipGeneratedRegions, true);

console.log("component promoter verification passed");

function readJson(base, file) {
  return JSON.parse(readFileSync(resolve(base, file), "utf8"));
}
