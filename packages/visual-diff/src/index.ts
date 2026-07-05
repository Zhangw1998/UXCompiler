import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import type {
  NodePixelMapEntry,
  VisualDiffManualReviewReport,
  VisualDiffRepairIterationLog,
  VisualDiffRepairPatch,
  VisualDiffReport,
  VisualDiffResult,
  VisualDiffScore
} from "@uxcompiler/ir-schemas";

export interface RunVisualDiffOptions {
  referencePng: Uint8Array;
  candidatePng: Uint8Array;
  referencePath: string;
  candidatePath: string;
  heatmapPath: string;
  nodePixelMap?: NodePixelMapEntry[];
  viewport?: { width: number; height: number };
  dpr?: number;
  fonts?: string[];
  flutterVersion?: string;
  themeBrightness?: "light" | "dark";
  locale?: string;
  textScaleFactor?: number;
  safeArea?: { top: number; right: number; bottom: number; left: number };
  threshold?: {
    visualScore?: number;
    pixelDiffRatio?: number;
  };
}

export function runVisualDiff(options: RunVisualDiffOptions): VisualDiffResult {
  const reference = PNG.sync.read(Buffer.from(options.referencePng));
  const candidate = PNG.sync.read(Buffer.from(options.candidatePng));
  const warnings: VisualDiffReport["warnings"] = [];
  const generatedAt = new Date().toISOString();
  const threshold = {
    visualScore: options.threshold?.visualScore ?? 0.99,
    pixelDiffRatio: options.threshold?.pixelDiffRatio ?? 0.01
  };
  const environment = visualDiffEnvironment(options);

  if (reference.width !== candidate.width || reference.height !== candidate.height) {
    const width = Math.max(reference.width, candidate.width);
    const height = Math.max(reference.height, candidate.height);
    const heatmap = new PNG({ width, height });
    fillHeatmapForSizeMismatch(heatmap);
    const totalPixels = width * height;
    const score = scoreFromDiff(totalPixels, totalPixels);
    const report: VisualDiffReport = {
      version: "2.0",
      generatedAt,
      inputs: {
        reference: options.referencePath,
        candidate: options.candidatePath,
        heatmap: options.heatmapPath
      },
      environment,
      page: {
        pass: false,
        score,
        threshold
      },
      issues: [
        {
          issueId: "diff_size_mismatch",
          type: "size_mismatch",
          score,
          suggestedFixes: [
            {
              type: "match_viewport_size",
              payload: {
                reference: { width: reference.width, height: reference.height },
                candidate: { width: candidate.width, height: candidate.height }
              }
            }
          ]
        }
      ],
      warnings: [
        {
          type: "size_mismatch",
          message: `Reference ${reference.width}x${reference.height} does not match candidate ${candidate.width}x${candidate.height}.`
        }
      ]
    };
    return {
      visualDiffReport: report,
      nodeDiffReport: report.issues,
      heatmapPng: PNG.sync.write(heatmap),
      repairPatch: buildRepairPatch(report),
      repairIterationLog: buildRepairIterationLog(report),
      manualReviewReport: buildManualReviewReport(report)
    };
  }

  const heatmap = new PNG({ width: reference.width, height: reference.height });
  const diffPixels = pixelmatch(reference.data, candidate.data, heatmap.data, reference.width, reference.height, {
    threshold: 0.1,
    includeAA: true
  });
  const totalPixels = reference.width * reference.height;
  const pageScore = scoreFromDiff(diffPixels, totalPixels);
  const issues = buildNodeIssues(reference, candidate, options.nodePixelMap ?? []);

  if (!options.nodePixelMap || options.nodePixelMap.length === 0) {
    warnings.push({
      type: "missing_node_pixel_map",
      message: "Node-level attribution was skipped because node_pixel_map.json was not provided."
    });
  }

  const report: VisualDiffReport = {
    version: "2.0",
    generatedAt,
    inputs: {
      reference: options.referencePath,
      candidate: options.candidatePath,
      heatmap: options.heatmapPath
    },
    environment,
    page: {
      pass: pageScore.visualScore >= threshold.visualScore && pageScore.pixelDiffRatio <= threshold.pixelDiffRatio,
      score: pageScore,
      threshold
    },
    issues,
    warnings
  };

  return {
    visualDiffReport: report,
    nodeDiffReport: issues,
    heatmapPng: PNG.sync.write(heatmap),
    repairPatch: buildRepairPatch(report),
    repairIterationLog: buildRepairIterationLog(report),
    manualReviewReport: report.page.pass ? undefined : buildManualReviewReport(report)
  };
}

function visualDiffEnvironment(options: RunVisualDiffOptions): VisualDiffReport["environment"] {
  return {
    viewport: options.viewport,
    dpr: options.dpr ?? 1,
    fonts: normalizedFonts(options.fonts),
    flutterVersion: options.flutterVersion,
    themeBrightness: options.themeBrightness ?? "light",
    locale: options.locale?.trim() || "en",
    textScaleFactor: Number.isFinite(options.textScaleFactor) && options.textScaleFactor && options.textScaleFactor > 0
      ? options.textScaleFactor
      : 1,
    safeArea: options.safeArea ?? { top: 0, right: 0, bottom: 0, left: 0 },
    renderer: "png_pixelmatch"
  };
}

function buildManualReviewReport(report: VisualDiffReport): VisualDiffManualReviewReport {
  const severeIssue = report.issues.some((issue) => issue.score.pixelDiffRatio > 0.1 || issue.type === "size_mismatch");
  return {
    version: "2.0",
    generatedAt: report.generatedAt,
    required: true,
    reason: report.issues.length > 0
      ? "Visual diff failed and localized issues require human review or an accepted repair."
      : "Visual diff failed at page level and requires human review before codegen write.",
    severity: severeIssue || report.page.score.pixelDiffRatio > 0.1 ? "P0" : "P1",
    inputs: report.inputs,
    page: report.page,
    issues: report.issues.map((issue) => ({
      issueId: issue.issueId,
      type: issue.type,
      sourceNodeId: issue.sourceNodeId,
      bounds: issue.bounds,
      score: issue.score
    })),
    suggestedActions: [
      {
        label: "Review visual mismatch",
        reason: "Confirm whether to repair the mapped region, accept an asset slice, or use a frame screenshot fallback.",
        payload: {
          issueIds: report.issues.map((issue) => issue.issueId),
          visualScore: report.page.score.visualScore,
          pixelDiffRatio: report.page.score.pixelDiffRatio
        }
      }
    ]
  };
}

function buildRepairPatch(report: VisualDiffReport): VisualDiffRepairPatch {
  const patches: VisualDiffRepairPatch["patches"] = [];
  if (!report.page.pass) {
    for (const issue of report.issues.filter((entry) => entry.sourceNodeId)) {
      const sourceNodeId = issue.sourceNodeId as string;
      const overrideId = `ovr_diff_${safeId(issue.issueId)}_asset_slice`;
      patches.push({
        patchId: `repair_${safeId(issue.issueId)}_asset_slice`,
        issueId: issue.issueId,
        target: "override_set",
        operation: "add_override",
        sourceNodeId,
        override: {
          id: overrideId,
          type: "render_strategy_override",
          target: { kind: "source_node", sourceNodeId },
          payload: {
            sourceNodeId,
            strategy: "asset_slice",
            diffIssueId: issue.issueId,
            reason: "Visual diff repair proposes an asset-slice fallback for this localized mismatch."
          },
          status: "active",
          createdBy: "agent",
          createdAt: report.generatedAt,
          scope: "snapshot"
        },
        rollback: { type: "disable_override", overrideId },
        reason: "Use a localized asset slice for this visual mismatch; rollback disables the generated override."
      });
    }

    const pageOverrideId = "ovr_diff_page_frame_fallback";
    patches.push({
      patchId: "repair_page_frame_fallback",
      issueId: "page",
      target: "override_set",
      operation: "add_override",
      override: {
        id: pageOverrideId,
        type: "render_strategy_override",
        target: { kind: "page" },
        payload: {
          strategy: "frame_screenshot_asset",
          diffIssueId: "page",
          reason: "Visual diff repair proposes a full-frame fallback for a page-level failure."
        },
        status: "active",
        createdBy: "agent",
        createdAt: report.generatedAt,
        scope: "snapshot"
      },
      rollback: { type: "disable_override", overrideId: pageOverrideId },
      reason: "Use a full-frame fallback when localized repairs are insufficient; rollback disables the generated override."
    });
  }

  return {
    version: "2.0",
    generatedAt: report.generatedAt,
    status: patches.length > 0 ? "proposed" : "not_needed",
    inputs: report.inputs,
    page: report.page,
    patches
  };
}

function buildRepairIterationLog(report: VisualDiffReport): VisualDiffRepairIterationLog {
  return {
    version: "2.0",
    generatedAt: report.generatedAt,
    maxIterations: 3,
    iterations: [
      {
        iteration: 0,
        status: report.page.pass ? "not_run" : "proposed",
        visualScore: report.page.score.visualScore,
        pixelDiffRatio: report.page.score.pixelDiffRatio,
        repairPatchPath: "repair_patch.json",
        rollbackAvailable: !report.page.pass,
        reason: report.page.pass
          ? "Visual diff passed; no repair iteration was needed."
          : "Visual diff failed; proposed rollbackable override patches before any automatic repair iteration is applied."
      }
    ]
  };
}

function normalizedFonts(fonts: string[] | undefined): string[] {
  return [...new Set((fonts ?? []).map((font) => font.trim()).filter(Boolean))].sort((left, right) => left.localeCompare(right));
}

function buildNodeIssues(reference: PNG, candidate: PNG, nodePixelMap: NodePixelMapEntry[]): VisualDiffReport["issues"] {
  const issues: VisualDiffReport["issues"] = [];
  for (const entry of nodePixelMap) {
    const bounds = clampBounds(entry.bounds, reference.width, reference.height);
    if (bounds.w <= 0 || bounds.h <= 0) continue;
    let diffPixels = 0;
    let totalPixels = 0;
    for (let y = bounds.y; y < bounds.y + bounds.h; y += 1) {
      for (let x = bounds.x; x < bounds.x + bounds.w; x += 1) {
        const index = (y * reference.width + x) * 4;
        totalPixels += 1;
        if (pixelDelta(reference.data, candidate.data, index) > 32) diffPixels += 1;
      }
    }
    const score = scoreFromDiff(diffPixels, totalPixels);
    if (score.pixelDiffRatio > 0.01) {
      issues.push({
        issueId: `diff_${issues.length + 1}`,
        type: "pixel_diff_region",
        sourceNodeId: entry.sourceNodeId,
        bounds,
        score,
        suggestedFixes: [
          {
            type: "review_visual_region",
            payload: {
              sourceNodeId: entry.sourceNodeId,
              pixelDiffRatio: score.pixelDiffRatio
            }
          }
        ]
      });
    }
  }
  return issues.sort((a, b) => b.score.pixelDiffRatio - a.score.pixelDiffRatio).slice(0, 50);
}

function scoreFromDiff(diffPixels: number, totalPixels: number): VisualDiffScore {
  const pixelDiffRatio = totalPixels > 0 ? diffPixels / totalPixels : 1;
  return {
    visualScore: round(1 - pixelDiffRatio),
    pixelDiffRatio: round(pixelDiffRatio),
    diffPixels,
    totalPixels
  };
}

function clampBounds(bounds: { x: number; y: number; w: number; h: number }, width: number, height: number): {
  x: number;
  y: number;
  w: number;
  h: number;
} {
  const x = Math.max(0, Math.floor(bounds.x));
  const y = Math.max(0, Math.floor(bounds.y));
  const right = Math.min(width, Math.ceil(bounds.x + bounds.w));
  const bottom = Math.min(height, Math.ceil(bounds.y + bounds.h));
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}

function pixelDelta(left: Buffer, right: Buffer, index: number): number {
  return (
    Math.abs(left[index] - right[index]) +
    Math.abs(left[index + 1] - right[index + 1]) +
    Math.abs(left[index + 2] - right[index + 2]) +
    Math.abs(left[index + 3] - right[index + 3])
  );
}

function fillHeatmapForSizeMismatch(heatmap: PNG): void {
  for (let y = 0; y < heatmap.height; y += 1) {
    for (let x = 0; x < heatmap.width; x += 1) {
      const index = (y * heatmap.width + x) * 4;
      heatmap.data[index] = 255;
      heatmap.data[index + 1] = 0;
      heatmap.data[index + 2] = 0;
      heatmap.data[index + 3] = 255;
    }
  }
}

function round(value: number): number {
  return Math.round(value * 1000000) / 1000000;
}

function safeId(value: string): string {
  return value.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || "repair";
}
