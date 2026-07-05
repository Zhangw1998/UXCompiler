import assert from "node:assert/strict";
import { generateReviewTasks } from "../packages/review-task-engine/dist/index.js";
import { assertReviewTaskContract } from "./review-task-contract.mjs";

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
assertReviewTaskContract(noTypography.reviewTasks, "no typography review tasks");

const globalWarnings = generateReviewTasks({
  ...baseInput,
  tokenConfidenceReport: {
    warnings: [{ type: "missing_font", message: "Unknown project font." }]
  },
  inferredTokens: {
    ...emptyTokens(),
    colors: [
      {
        name: "color_low",
        value: "#123456",
        confidence: 0.4,
        usageCount: 1,
        sourceNodeIds: []
      }
    ]
  },
  assetManifest: {
    version: "0.1.0",
    assets: [],
    warnings: [{ type: "export_failed", message: "Global export warning." }]
  },
  fidelityGenerationManifest: {
    ...baseInput.fidelityGenerationManifest,
    warnings: [{ type: "unsupported_effect", message: "Unsupported global effect." }]
  },
  staleOverrideReport: {
    version: "0.1.0",
    generatedAt: "2026-07-04T00:00:00.000Z",
    staleOverrides: [
      {
        overrideId: "ovr_missing_token",
        type: "token_rename_override",
        target: { kind: "token", tokenName: "old_color" },
        reason: "Token no longer exists."
      }
    ],
    appliedOverrideIds: []
  }
});
assert.ok(globalWarnings.reviewTasks.length >= 5, "Expected global warnings to create review tasks");
assert.ok(globalWarnings.reviewTasks.every((task) => task.target.normalizedNodeId === "root" || task.target.sourceNodeIds?.length > 0));
assertReviewTaskContract(globalWarnings.reviewTasks, "global warning review tasks");

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
assertReviewTaskContract(systemFont.reviewTasks, "system font review tasks");

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
assertReviewTaskContract(mappedFont.reviewTasks, "mapped font review tasks");

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
assertReviewTaskContract(componentCandidate.reviewTasks, "component review tasks");

const visualDiffReport = {
  version: "2.0",
  generatedAt: "2026-07-04T00:00:00.000Z",
  inputs: { reference: "figma_reference.png", candidate: "flutter_preview.png", heatmap: "diff_heatmap.png" },
  environment: {
    dpr: 1,
    fonts: ["Inter"],
    themeBrightness: "light",
    locale: "en",
    textScaleFactor: 1,
    safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    renderer: "png_pixelmatch"
  },
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
    },
    {
      issueId: "diff_text_baseline",
      type: "pixel_diff_region",
      sourceNodeId: "title:1",
      bounds: { x: 10, y: 20, w: 120, h: 32 },
      score: { visualScore: 0.92, pixelDiffRatio: 0.08, diffPixels: 30, totalPixels: 384 },
      suggestedFixes: [
        {
          type: "text_calibration_override",
          payload: { baselineShift: -1, lineHeightDelta: 1 }
        }
      ]
    }
  ],
  warnings: []
};
const visualDiff = generateReviewTasks({
  ...baseInput,
  visualDiffReport
});
const pageDiffTask = visualDiff.reviewTasks.find((task) => task.id === "task_visual_diff_page");
assert.ok(pageDiffTask, "Expected failing page diff to create a page task");
assert.equal(pageDiffTask.target.normalizedNodeId, "root");
assert.deepEqual(pageDiffTask.target.sourceNodeIds, ["frame:1"]);
const acceptLowVisualAction = pageDiffTask.suggestedActions.find((action) => action.override.payload.action === "accept_low_visual_score");
assert.ok(acceptLowVisualAction, "Expected page diff task to offer an explicit low visual score override");
assert.equal(acceptLowVisualAction.override.type, "render_strategy_override");
assert.equal(acceptLowVisualAction.override.payload.visualScore, 0.82);
assert.equal(acceptLowVisualAction.override.payload.visualScoreThreshold, 0.99);
const unmappedRegionTask = visualDiff.reviewTasks.find((task) => task.target.diffIssueId === "diff_unmapped");
assert.ok(unmappedRegionTask, "Expected unmapped diff issue to create a region task");
assert.equal(unmappedRegionTask.target.normalizedNodeId, "root");
assert.deepEqual(unmappedRegionTask.target.sourceNodeIds, ["frame:1"]);
assert.equal(unmappedRegionTask.suggestedActions[0].override.type, "render_strategy_override");
assert.equal(unmappedRegionTask.suggestedActions[0].override.payload.strategy, "asset_slice");
const textBaselineTask = visualDiff.reviewTasks.find((task) => task.target.diffIssueId === "diff_text_baseline");
assert.ok(textBaselineTask, "Expected text baseline diff issue to create a region task");
assert.deepEqual(textBaselineTask.target.sourceNodeIds, ["title:1"]);
assert.equal(textBaselineTask.suggestedActions[0].label, "Apply text calibration");
assert.equal(textBaselineTask.suggestedActions[0].override.type, "text_calibration_override");
assert.equal(textBaselineTask.suggestedActions[0].override.payload.sourceNodeId, "title:1");
assert.equal(textBaselineTask.suggestedActions[0].override.payload.diffIssueId, "diff_text_baseline");
assert.equal(textBaselineTask.suggestedActions[0].override.payload.baselineShift, -1);
assertReviewTaskContract(visualDiff.reviewTasks, "visual diff review tasks");

const acceptedTextCalibration = generateReviewTasks({
  ...baseInput,
  visualDiffReport,
  overrideSet: {
    id: "ovset_visual_text",
    version: 1,
    hash: "sha256_test",
    overrides: [
      {
        id: "ovr_text_baseline",
        type: "text_calibration_override",
        target: { kind: "source_node", sourceNodeId: "title:1" },
        payload: { sourceNodeId: "title:1", baselineShift: -1, diffIssueId: "diff_text_baseline" },
        status: "active",
        createdBy: "agent",
        createdAt: "2026-07-04T00:00:00.000Z"
      }
    ]
  }
});
assert.equal(
  acceptedTextCalibration.reviewTasks.some((task) => task.target.diffIssueId === "diff_text_baseline"),
  false,
  "Expected accepted text calibration repair to close the source-node diff task"
);

const acceptedLowVisualScore = generateReviewTasks({
  ...baseInput,
  visualDiffReport,
  overrideSet: {
    id: "ovset_visual_page_accept",
    version: 1,
    hash: "sha256_test",
    overrides: [
      {
        id: "ovr_accept_low_visual_score",
        type: "render_strategy_override",
        target: { kind: "page" },
        payload: { targetNodeId: "root", action: "accept_low_visual_score", visualScore: 0.82, visualScoreThreshold: 0.99 },
        status: "active",
        createdBy: "user",
        createdAt: "2026-07-04T00:00:00.000Z"
      }
    ]
  }
});
assert.equal(
  acceptedLowVisualScore.reviewTasks.some((task) => task.id === "task_visual_diff_page"),
  false,
  "Expected explicit low visual score override to close the page diff task"
);

const flutterCapture = generateReviewTasks({
  ...baseInput,
  flutterCapture: { status: "failed", reason: "Flutter capture exited 1" }
});
const flutterTask = flutterCapture.reviewTasks.find((task) => task.id === "task_flutter_capture_failed");
assert.ok(flutterTask, "Expected failed Flutter capture to create a task");
assert.equal(flutterTask.target.normalizedNodeId, "root");
assert.deepEqual(flutterTask.target.sourceNodeIds, ["frame:1"]);
assertReviewTaskContract(flutterCapture.reviewTasks, "flutter capture review tasks");

const semanticUplift = generateReviewTasks({
  ...baseInput,
  upliftDecisions: {
    version: "2.0",
    decisions: [
      {
        regionId: "region_hero",
        sourceNodeIds: ["frame:1", "text:1"],
        from: "absolute_widget",
        to: "semantic_layout",
        strategy: "semantic_column_region",
        gate: "review_diff_required",
        scoreBreakdown: {
          semanticConfidence: 0.9,
          layoutConfidence: 0.88,
          componentConfidence: 0.7,
          expectedDiffSafety: 0.88
        },
        confidence: 0.83,
        accepted: false,
        reason: "Diff evidence is required."
      },
      {
        regionId: "region_low",
        sourceNodeIds: ["frame:1"],
        strategy: "keep_fidelity_region",
        gate: "keep_fidelity",
        confidence: 0.5,
        accepted: false
      }
    ]
  }
});
const semanticTask = semanticUplift.reviewTasks.find((task) => task.type === "semantic_uplift_pending");
assert.ok(semanticTask, "Expected pending semantic uplift to create a review task");
assert.equal(semanticTask.id, "task_semantic_uplift_region_hero");
assert.equal(semanticTask.priority, "P2");
assert.deepEqual(semanticTask.target.sourceNodeIds, ["frame:1", "text:1"]);
assert.equal(semanticTask.suggestedActions[0].override.payload.action, "run_semantic_uplift_diff");
assert.equal(semanticUplift.taskStatusReport.byType.semantic_uplift_pending, 1);
assertReviewTaskContract(semanticUplift.reviewTasks, "semantic uplift review tasks");

const handledSemanticUplift = generateReviewTasks({
  ...baseInput,
  upliftDecisions: semanticUpliftInput(),
  overrideSet: {
    id: "ovset_test",
    version: 2,
    snapshotId: "frame:1",
    hash: "sha256_test",
    overrides: [
      {
        id: "ovr_semantic_uplift_region_hero",
        type: "render_strategy_override",
        target: { kind: "normalized_node", normalizedNodeId: "root" },
        payload: {
          action: "run_semantic_uplift_diff",
          regionId: "region_hero",
          strategy: "semantic_column_region"
        },
        status: "active",
        createdBy: "user",
        createdAt: "2026-07-04T00:00:00.000Z",
        scope: "snapshot"
      }
    ]
  }
});
assert.equal(handledSemanticUplift.reviewTasks.some((task) => task.type === "semantic_uplift_pending"), false);
assertReviewTaskContract(handledSemanticUplift.reviewTasks, "handled semantic uplift review tasks");

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

function semanticUpliftInput() {
  return {
    version: "2.0",
    decisions: [
      {
        regionId: "region_hero",
        sourceNodeIds: ["frame:1", "text:1"],
        from: "absolute_widget",
        to: "semantic_layout",
        strategy: "semantic_column_region",
        gate: "review_diff_required",
        scoreBreakdown: {
          semanticConfidence: 0.9,
          layoutConfidence: 0.88,
          componentConfidence: 0.7,
          expectedDiffSafety: 0.88
        },
        confidence: 0.83,
        accepted: false,
        reason: "Diff evidence is required."
      }
    ]
  };
}
