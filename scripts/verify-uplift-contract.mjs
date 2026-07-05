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
visualDiffReport.environment = {
  viewport: { width: 390, height: 844 },
  dpr: 1,
  fonts: [],
  renderer: "uplift_contract_negative_fixture"
};
writeJson(resolve(invalidRoot, "visual_diff_report.json"), visualDiffReport);

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
