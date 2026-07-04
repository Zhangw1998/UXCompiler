import assert from "node:assert/strict";
import { generateReviewTasks } from "../packages/review-task-engine/dist/index.js";

const baseInput = {
  normalizedDesignIR: {
    version: "2.0",
    source: { frameNodeId: "frame:1", viewport: { width: 390, height: 844 } },
    tree: {
      id: "root",
      name: "Root",
      type: "frame",
      sourceNodeIds: ["frame:1"],
      bounds: { x: 0, y: 0, w: 390, h: 844 },
      layout: { type: "stack" },
      render: { strategy: "absolute_widget" },
      children: []
    },
    tokens: emptyTokens(),
    components: [],
    confidence: { overall: 1 }
  },
  layoutCandidates: [],
  layoutDecisions: [],
  inferredTokens: emptyTokens(),
  assetManifest: { version: "0.1.0", assets: [], warnings: [] },
  i18nManifest: { version: "0.1.0", locale: "en", messages: [], warnings: [] },
  fidelityGenerationManifest: {
    version: "2.0",
    generatedAt: "2026-07-04T00:00:00.000Z",
    viewport: { width: 390, height: 844 },
    files: [],
    renderDecisions: [],
    warnings: []
  }
};

const noTypography = generateReviewTasks({
  ...baseInput,
  tokenConfidenceReport: {
    warnings: [
      { type: "no_typography", message: "No text style samples were discovered.", sourceNodeIds: ["text:1"] },
      { type: "no_typography", message: "No text style samples were discovered elsewhere.", sourceNodeIds: ["text:1b"] }
    ]
  }
});
const noTypographyTask = noTypography.reviewTasks.find((task) => task.type === "font_missing");
assert.ok(noTypographyTask, "Expected no_typography to create a font_missing task");
assert.equal(noTypographyTask.priority, "P1");
assert.deepEqual(noTypographyTask.target.sourceNodeIds, ["text:1"]);
assert.equal(noTypographyTask.suggestedActions[0].override.type, "font_mapping_override");
assert.equal(noTypography.taskStatusReport.byType.font_missing, 2);
assert.equal(noTypography.taskStatusReport.codegenWriteBlocked, false);

const systemFont = generateReviewTasks({
  ...baseInput,
  inferredTokens: {
    ...emptyTokens(),
    typography: [
      {
        name: "text_unknown",
        fontFamily: "System",
        fontSize: 16,
        fontWeight: 400,
        lineHeight: 20,
        letterSpacing: 0,
        confidence: 0.4,
        usageCount: 1,
        sourceNodeIds: ["text:2"]
      }
    ]
  },
  tokenConfidenceReport: { warnings: [] }
});
const systemFontTask = systemFont.reviewTasks.find((task) => task.type === "font_missing");
assert.ok(systemFontTask, "Expected System font fallback to create a font_missing task");
assert.equal(systemFontTask.target.tokenName, "text_unknown");
assert.equal(systemFontTask.evidence.fontFamily, "System");
assert.equal(systemFontTask.suggestedActions[0].override.payload.fromFamily, "System");

const mappedFont = generateReviewTasks({
  ...baseInput,
  inferredTokens: {
    ...emptyTokens(),
    typography: [
      {
        name: "text_body",
        fontFamily: "Inter",
        fontSize: 16,
        fontWeight: 400,
        lineHeight: 20,
        letterSpacing: 0,
        confidence: 0.9,
        usageCount: 1,
        sourceNodeIds: ["text:3"]
      }
    ]
  },
  tokenConfidenceReport: { warnings: [] }
});
assert.equal(mappedFont.reviewTasks.some((task) => task.type === "font_missing"), false);

console.log("review task engine verification passed");

function emptyTokens() {
  return {
    version: "0.1.0",
    colors: [],
    spacing: [],
    typography: [],
    radii: [],
    shadows: []
  };
}
