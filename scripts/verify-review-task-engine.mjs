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

const componentCandidate = generateReviewTasks({
  ...baseInput,
  normalizedDesignIR: {
    ...baseInput.normalizedDesignIR,
    components: [
      {
        componentId: "primary_button",
        name: "PrimaryButton",
        sourceInstances: ["button:1", "button:2"],
        props: [{ name: "label", type: "text", source: "firstText" }],
        confidence: 0.82,
        fallback: "generate_separate_widgets"
      },
      {
        componentId: "trusted_card",
        name: "TrustedCard",
        sourceInstances: ["card:1", "card:2"],
        confidence: 0.95
      },
      {
        componentId: "fallback_component",
        name: "FallbackComponent",
        confidence: 0.8
      }
    ]
  }
});
const componentTask = componentCandidate.reviewTasks.find((task) => task.target.candidateId === "primary_button");
assert.ok(componentTask, "Expected a medium-confidence component candidate to create a review task");
assert.equal(componentTask.priority, "P1");
assert.equal(componentTask.target.candidateId, "primary_button");
assert.deepEqual(componentTask.target.sourceNodeIds, ["button:1", "button:2"]);
assert.equal(componentTask.suggestedActions[0].override.type, "component_candidate_override");
assert.equal(componentTask.suggestedActions[0].override.payload.kind, "approve_component");
const fallbackComponentTask = componentCandidate.reviewTasks.find((task) => task.target.candidateId === "fallback_component");
assert.ok(fallbackComponentTask, "Expected component candidates without instances to fall back to root source trace");
assert.deepEqual(fallbackComponentTask.target.sourceNodeIds, ["frame:1"]);
assert.deepEqual(fallbackComponentTask.suggestedActions[0].override.payload.instances, ["frame:1"]);
assert.equal(componentCandidate.taskStatusReport.byType.low_confidence_component, 2);

const visualDiff = generateReviewTasks({
  ...baseInput,
  visualDiffReport: {
    version: "2.0",
    generatedAt: "2026-07-04T00:00:00.000Z",
    inputs: { reference: "figma_reference.png", candidate: "flutter_preview.png", heatmap: "diff_heatmap.png" },
    environment: { dpr: 1, fonts: ["Inter"], renderer: "png_pixelmatch" },
    page: {
      pass: false,
      score: { visualScore: 0.82, pixelDiffRatio: 0.18, diffPixels: 18, totalPixels: 100 },
      threshold: { visualScore: 0.99, pixelDiffRatio: 0.01 }
    },
    issues: [
      {
        issueId: "diff_unmapped",
        type: "pixel_diff_region",
        bounds: { x: 0, y: 0, w: 100, h: 80 },
        score: { visualScore: 0.7, pixelDiffRatio: 0.3, diffPixels: 24, totalPixels: 80 },
        suggestedFixes: []
      }
    ],
    warnings: []
  }
});
const pageDiffTask = visualDiff.reviewTasks.find((task) => task.id === "task_visual_diff_page");
assert.ok(pageDiffTask, "Expected failing page diff to create a page task");
assert.equal(pageDiffTask.target.normalizedNodeId, "root");
assert.deepEqual(pageDiffTask.target.sourceNodeIds, ["frame:1"]);
const unmappedRegionTask = visualDiff.reviewTasks.find((task) => task.target.diffIssueId === "diff_unmapped");
assert.ok(unmappedRegionTask, "Expected unmapped diff issue to create a region task");
assert.equal(unmappedRegionTask.target.normalizedNodeId, "root");
assert.deepEqual(unmappedRegionTask.target.sourceNodeIds, ["frame:1"]);

const flutterCapture = generateReviewTasks({
  ...baseInput,
  flutterCapture: { status: "failed", reason: "Flutter capture exited 1" }
});
const flutterTask = flutterCapture.reviewTasks.find((task) => task.id === "task_flutter_capture_failed");
assert.ok(flutterTask, "Expected failed Flutter capture to create a task");
assert.equal(flutterTask.target.normalizedNodeId, "root");
assert.deepEqual(flutterTask.target.sourceNodeIds, ["frame:1"]);

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
