import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import type { NodePixelMapEntry, VisualDiffReport, VisualDiffResult, VisualDiffScore } from "@uxcompiler/ir-schemas";

export interface RunVisualDiffOptions {
  referencePng: Uint8Array;
  candidatePng: Uint8Array;
  referencePath: string;
  candidatePath: string;
  heatmapPath: string;
  nodePixelMap?: NodePixelMapEntry[];
  viewport?: { width: number; height: number };
  dpr?: number;
  threshold?: {
    visualScore?: number;
    pixelDiffRatio?: number;
  };
}

export function runVisualDiff(options: RunVisualDiffOptions): VisualDiffResult {
  const reference = PNG.sync.read(Buffer.from(options.referencePng));
  const candidate = PNG.sync.read(Buffer.from(options.candidatePng));
  const warnings: VisualDiffReport["warnings"] = [];
  const threshold = {
    visualScore: options.threshold?.visualScore ?? 0.99,
    pixelDiffRatio: options.threshold?.pixelDiffRatio ?? 0.01
  };

  if (reference.width !== candidate.width || reference.height !== candidate.height) {
    const width = Math.max(reference.width, candidate.width);
    const height = Math.max(reference.height, candidate.height);
    const heatmap = new PNG({ width, height });
    fillHeatmapForSizeMismatch(heatmap);
    const totalPixels = width * height;
    const score = scoreFromDiff(totalPixels, totalPixels);
    const report: VisualDiffReport = {
      version: "2.0",
      generatedAt: new Date().toISOString(),
      inputs: {
        reference: options.referencePath,
        candidate: options.candidatePath,
        heatmap: options.heatmapPath
      },
      environment: {
        viewport: options.viewport,
        dpr: options.dpr ?? 1,
        renderer: "png_pixelmatch"
      },
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
      heatmapPng: PNG.sync.write(heatmap)
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
    generatedAt: new Date().toISOString(),
    inputs: {
      reference: options.referencePath,
      candidate: options.candidatePath,
      heatmap: options.heatmapPath
    },
    environment: {
      viewport: options.viewport,
      dpr: options.dpr ?? 1,
      renderer: "png_pixelmatch"
    },
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
    heatmapPng: PNG.sync.write(heatmap)
  };
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
