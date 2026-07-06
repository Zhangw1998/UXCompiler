import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const sampleRoot = resolve("artifacts/sample");
if (!existsSync(resolve(sampleRoot, "uplift_decisions.json"))) {
  execFileSync("node", ["apps/cli/dist/index.js", "compile", "--input", "examples/fixtures/login_raw_figma_scene.json", "--out", sampleRoot], {
    stdio: "pipe"
  });
}

const invalidRoot = resolve("artifacts/uplift-contract-negative");
rmSync(invalidRoot, { recursive: true, force: true });
mkdirSync(dirname(invalidRoot), { recursive: true });
cpSync(sampleRoot, invalidRoot, { recursive: true });

const visualDiffReport = readJson(resolve(invalidRoot, "visual_diff_report.json"));
writeSyntheticDiffImages(invalidRoot);
visualDiffReport.environment = {
  viewport: { width: 390, height: 844 },
  dpr: 1,
  fonts: ["Inter"],
  flutterVersion: "Flutter uplift negative fixture",
  themeBrightness: "light",
  locale: "en",
  textScaleFactor: 1,
  safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
  renderer: "uplift_contract_negative_fixture"
};
writeJson(resolve(invalidRoot, "visual_diff_report.json"), visualDiffReport);
writeJson(resolve(invalidRoot, "node_diff_report.json"), visualDiffReport.issues ?? []);
writeJson(resolve(invalidRoot, "manual_review_report.json"), {
  version: visualDiffReport.version,
  generatedAt: visualDiffReport.generatedAt,
  required: !visualDiffReport.page.pass,
  reason: "Negative uplift contract fixture preserves visual diff review coverage.",
  severity: "P0",
  inputs: visualDiffReport.inputs,
  page: visualDiffReport.page,
  issues: (visualDiffReport.issues ?? []).map((issue) => ({
    issueId: issue.issueId,
    type: issue.type,
    sourceNodeId: issue.sourceNodeId,
    bounds: issue.bounds,
    score: issue.score
  })),
  suggestedActions: [
    {
      label: "Review uplift evidence",
      reason: "Uplift acceptance must be backed by diff evidence.",
      payload: { action: "review_uplift_diff" }
    }
  ]
});
writeJson(resolve(invalidRoot, "repair_patch.json"), {
  version: "2.0",
  generatedAt: visualDiffReport.generatedAt,
  status: "not_needed",
  inputs: visualDiffReport.inputs,
  page: visualDiffReport.page,
  patches: []
});
writeJson(resolve(invalidRoot, "repair_iteration_log.json"), {
  version: "2.0",
  generatedAt: visualDiffReport.generatedAt,
  maxIterations: 3,
  iterations: [
    {
      iteration: 0,
      status: "not_run",
      visualScore: visualDiffReport.page.score.visualScore,
      pixelDiffRatio: visualDiffReport.page.score.pixelDiffRatio,
      repairPatchPath: "repair_patch.json",
      rollbackAvailable: false,
      reason: "Negative uplift contract fixture does not exercise visual diff repair."
    }
  ]
});

const decisions = readJson(resolve(invalidRoot, "uplift_decisions.json"));
decisions.decisions[0] = {
  ...decisions.decisions[0],
  confidence: 0.94,
  accepted: true,
  reason: "Negative verifier: accepted uplift must not pass without diff evidence."
};
writeJson(resolve(invalidRoot, "uplift_decisions.json"), decisions);

const diffReport = readJson(resolve(invalidRoot, "uplift_diff_report.json"));
diffReport.status = "passed";
diffReport.comparisons = [];
writeJson(resolve(invalidRoot, "uplift_diff_report.json"), diffReport);

const result = spawnSync("node", ["scripts/verify-artifact-contract.mjs", invalidRoot], {
  encoding: "utf8"
});
assert.notEqual(result.status, 0, "artifact contract should reject accepted uplift decisions without diff comparisons.");
assert.match(
  `${result.stdout}\n${result.stderr}`,
  /must have a matching diff comparison|semantic_ir\.status must be uplift_ready/,
  "artifact contract failure should identify missing uplift diff evidence."
);

console.log("uplift contract verification passed");

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function writeSyntheticDiffImages(root) {
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMB/ax2X7sAAAAASUVORK5CYII=",
    "base64"
  );
  writeFileSync(resolve(root, "figma_reference.png"), png);
  writeFileSync(resolve(root, "flutter_preview.png"), png);
  writeFileSync(resolve(root, "diff_heatmap.png"), png);
}
