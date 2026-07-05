import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve("artifacts/ai-semantic-smoke");
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });

const aiOutputPath = resolve(root, "ai_semantic_output.json");
writeFileSync(
  aiOutputPath,
  `${JSON.stringify(
    {
      task: "semantic_labeling",
      version: "2.0",
      items: [
        {
          sourceId: "region_1",
          suggestion: { suggestedName: "LoginHero", role: "hero" },
          confidence: 0.95,
          reason: "The top region contains the title and intro copy."
        },
        {
          sourceId: "1:8",
          suggestion: { suggestedName: "EmailField", role: "form_field", suggestedKey: "login_email_input" },
          confidence: 0.82,
          reason: "The text labels the email field."
        },
        {
          sourceId: "1:11",
          suggestion: {
            suggestedName: "InjectedGhostPassword",
            role: "form_field",
            sourceNodeIds: ["1:11", "ghost_nested_source"]
          },
          confidence: 0.96,
          reason: "The top-level source exists, but the nested source reference must still be rejected."
        },
        {
          sourceId: "1:9",
          suggestion: { suggestedName: "RejectedPasswordField" },
          confidence: 0.41,
          reason: "Too uncertain to apply."
        },
        {
          sourceId: "missing_source",
          suggestion: { suggestedName: "InventedNode" },
          confidence: 0.96,
          reason: "This should be rejected because the source does not exist."
        }
      ],
      warnings: []
    },
    null,
    2
  )}\n`,
  "utf8"
);

execFileSync(
  "node",
  [
    "apps/cli/dist/index.js",
    "compile",
    "--input",
    "examples/fixtures/login_raw_figma_scene.json",
    "--out",
    root,
    "--ai-semantic-output",
    aiOutputPath
  ],
  { stdio: "pipe" }
);

const semanticLabels = readJson("semantic_labels.json");
const aiDecisionReport = readJson("ai_decision_report.json");
const namingMap = readJson("naming_map.json");
const i18nSuggestions = readJson("i18n_key_suggestions.json");

assert.equal(semanticLabels.source, "ai");
assert.equal(semanticLabels.status, "needs_ai_review");
assert.ok(semanticLabels.regions.some((region) => region.regionId === "region_1" && region.suggestedName === "LoginHero" && region.role === "hero"));
assert.ok(semanticLabels.nodes.some((node) => node.sourceNodeIds.includes("1:8") && node.suggestedName === "emailField" && node.role === "form_field"));
assert.ok(semanticLabels.i18n.some((entry) => entry.sourceNodeId === "1:8" && entry.suggestedKey === "loginEmailInput"));
assert.ok(!semanticLabels.nodes.some((node) => node.suggestedName === "rejectedPasswordField"));
assert.ok(!semanticLabels.nodes.some((node) => node.suggestedName === "injectedGhostPassword"));
assert.equal(namingMap.regions.region_1, "LoginHero");
assert.equal(namingMap.i18n["1:8"], "loginEmailInput");
assert.ok(i18nSuggestions.suggestions.some((entry) => entry.sourceNodeId === "1:8" && entry.suggestedKey === "loginEmailInput"));
assert.equal(aiDecisionReport.status, "partially_accepted");
assert.equal(aiDecisionReport.accepted.length, 1);
assert.ok(aiDecisionReport.decisions.some((decision) => decision.sourceId === "1:8" && decision.gate === "review_required"));
assert.ok(aiDecisionReport.rejected.some((decision) => decision.sourceId === "1:9"));
assert.ok(aiDecisionReport.rejected.some((decision) => decision.sourceId === "missing_source"));
assert.ok(aiDecisionReport.rejected.some((decision) => decision.sourceId === "1:11"));
assert.ok(aiDecisionReport.warnings.some((warning) => warning.type === "review_required"));
assert.ok(aiDecisionReport.warnings.some((warning) => warning.type === "unknown_source"));
assert.ok(aiDecisionReport.warnings.some((warning) => warning.message.includes("$.items[2].suggestion.sourceNodeIds[1]")));

console.log("AI semantic labeling verification passed");

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}
