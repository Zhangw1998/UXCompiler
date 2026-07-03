import type {
  AssetManifest,
  FidelityGenerationManifest,
  I18nManifest,
  InferredTokens,
  LayoutCandidate,
  LayoutDecision,
  NormalizedDesignIR,
  ReviewTask,
  ReviewTaskPriority,
  ReviewTaskResult,
  ReviewTaskStatusReport,
  ReviewTaskSuggestedAction,
  ReviewTaskType,
  VisualDiffReport
} from "@uxcompiler/ir-schemas";

export interface GenerateReviewTasksInput {
  normalizedDesignIR: NormalizedDesignIR;
  layoutCandidates: LayoutCandidate[];
  layoutDecisions: LayoutDecision[];
  inferredTokens: InferredTokens;
  assetManifest: AssetManifest;
  i18nManifest: I18nManifest;
  fidelityGenerationManifest: FidelityGenerationManifest;
  visualDiffReport?: VisualDiffReport;
  flutterCapture?: { status: string; reason?: string };
}

export function generateReviewTasks(input: GenerateReviewTasksInput): ReviewTaskResult {
  const tasks: ReviewTask[] = [
    ...layoutTasks(input),
    ...assetTasks(input),
    ...fidelityTasks(input),
    ...tokenTasks(input),
    ...i18nTasks(input),
    ...visualDiffTasks(input),
    ...flutterCaptureTasks(input)
  ];
  const sorted = dedupeTasks(tasks).sort(compareTasks);
  return {
    reviewTasks: sorted,
    taskStatusReport: buildStatusReport(sorted)
  };
}

function layoutTasks(input: GenerateReviewTasksInput): ReviewTask[] {
  const candidateMap = new Map(input.layoutCandidates.map((candidate) => [candidate.nodeId, candidate]));
  return input.layoutDecisions
    .filter((decision) => decision.confidence < 0.7 || !!decision.fallback)
    .map((decision) => {
      const candidates = candidateMap.get(decision.nodeId)?.candidates ?? [];
      const actions = candidates
        .slice()
        .sort((left, right) => right.score - left.score)
        .slice(0, 3)
        .map<ReviewTaskSuggestedAction>((candidate) => ({
          label: `Force ${candidate.layout}`,
          override: {
            type: "layout_strategy_override",
            payload: {
              targetNodeId: decision.nodeId,
              sourceNodeIds: decision.sourceNodeIds,
              strategy: candidate.layout
            },
            reason: `Review task ${taskId("layout", decision.nodeId)} selected ${candidate.layout}.`
          }
        }));
      if (!actions.some((action) => action.override.payload.strategy === "absolute")) {
        actions.push({
          label: "Use absolute fallback",
          override: {
            type: "layout_strategy_override",
            payload: {
              targetNodeId: decision.nodeId,
              sourceNodeIds: decision.sourceNodeIds,
              strategy: "absolute"
            },
            reason: "Absolute layout preserves fidelity when semantic layout confidence is low."
          }
        });
      }
      return makeTask({
        id: taskId("layout", decision.nodeId),
        type: "low_confidence_layout",
        priority: "P1",
        target: {
          normalizedNodeId: decision.nodeId,
          sourceNodeIds: decision.sourceNodeIds
        },
        title: "Review low-confidence layout strategy",
        description: `Layout confidence is ${round(decision.confidence)} for ${decision.nodeId}; confirm whether ${decision.layout} or its fallback is correct.`,
        confidence: decision.confidence,
        evidence: {
          selectedLayout: decision.layout,
          fallback: decision.fallback,
          score: decision.score,
          evidence: decision.evidence,
          candidates
        },
        suggestedActions: actions
      });
    });
}

function assetTasks(input: GenerateReviewTasksInput): ReviewTask[] {
  const assetsByNode = new Map(input.assetManifest.assets.map((asset) => [asset.sourceNodeId, asset]));
  return input.assetManifest.warnings.map((warning) => {
    const asset = warning.sourceNodeId ? assetsByNode.get(warning.sourceNodeId) : undefined;
    const priority: ReviewTaskPriority = warning.type === "decorative_slice_contains_text" ? "P0" : "P2";
    return makeTask({
      id: taskId("asset", warning.sourceNodeId ?? warning.type),
      type: priority === "P0" ? "resource_export_failed" : "asset_strategy_uncertain",
      priority,
      target: {
        sourceNodeIds: warning.sourceNodeId ? [warning.sourceNodeId] : undefined,
        assetId: asset?.id
      },
      title: priority === "P0" ? "Resolve blocking asset strategy" : "Confirm asset strategy",
      description: warning.message,
      confidence: asset?.confidence ?? 0.5,
      evidence: {
        warningType: warning.type,
        strategy: asset?.strategy,
        path: asset?.path,
        reason: asset?.reason
      },
      suggestedActions: [
        {
          label: "Keep generated asset strategy",
          override: {
            type: "asset_strategy_override",
            payload: {
              sourceNodeId: warning.sourceNodeId,
              strategy: asset?.strategy ?? "decorative_slice",
              path: asset?.path
            },
            reason: "User confirmed the generated asset strategy."
          }
        }
      ]
    });
  });
}

function fidelityTasks(input: GenerateReviewTasksInput): ReviewTask[] {
  return input.fidelityGenerationManifest.warnings.map((warning) => {
    if (warning.type === "placeholder_asset") {
      return makeTask({
        id: taskId("resource", warning.sourceNodeId ?? warning.type),
        type: "resource_export_failed",
        priority: "P0",
        target: {
          sourceNodeIds: warning.sourceNodeId ? [warning.sourceNodeId] : undefined
        },
        title: "Export missing render asset",
        description: warning.message,
        confidence: 0.3,
        evidence: warning,
        suggestedActions: [
          {
            label: "Force decorative slice export",
            override: {
              type: "asset_strategy_override",
              payload: {
                sourceNodeId: warning.sourceNodeId,
                strategy: "decorative_slice"
              },
              reason: "Missing concrete asset should be exported as a decorative slice."
            }
          }
        ]
      });
    }
    if (warning.type === "frame_screenshot_fallback") {
      return makeTask({
        id: taskId("frame_fallback", warning.sourceNodeId ?? "root"),
        type: "asset_strategy_uncertain",
        priority: "P1",
        target: {
          normalizedNodeId: input.normalizedDesignIR.tree.id,
          sourceNodeIds: warning.sourceNodeId ? [warning.sourceNodeId] : input.normalizedDesignIR.tree.sourceNodeIds
        },
        title: "Replace full-frame screenshot fallback when ready",
        description: "The preview is visually exact because it uses the exported Figma frame screenshot; review before writing editable production code.",
        confidence: 0.99,
        evidence: warning,
        suggestedActions: [
          {
            label: "Keep frame screenshot fallback",
            override: {
              type: "render_strategy_override",
              payload: {
                targetNodeId: input.normalizedDesignIR.tree.id,
                strategy: "frame_screenshot_asset"
              },
              reason: "User accepted the non-editable full-frame fidelity fallback."
            }
          },
          {
            label: "Use editable fidelity tree",
            override: {
              type: "render_strategy_override",
              payload: {
                targetNodeId: input.normalizedDesignIR.tree.id,
                strategy: "absolute_widget"
              },
              reason: "User wants to continue with editable per-node fidelity rendering."
            }
          }
        ]
      });
    }
    return makeTask({
      id: taskId("fidelity", warning.sourceNodeId ?? warning.type),
      type: "asset_strategy_uncertain",
      priority: "P2",
      target: {
        sourceNodeIds: warning.sourceNodeId ? [warning.sourceNodeId] : undefined
      },
      title: "Review fidelity warning",
      description: warning.message,
      confidence: 0.6,
      evidence: warning,
      suggestedActions: [
        {
          label: "Acknowledge warning",
          override: {
            type: "render_strategy_override",
            payload: {
              sourceNodeId: warning.sourceNodeId,
              action: "acknowledge_warning"
            },
            reason: "User acknowledged the generated fidelity warning."
          }
        }
      ]
    });
  });
}

function tokenTasks(input: GenerateReviewTasksInput): ReviewTask[] {
  const candidates = [
    ...input.inferredTokens.colors.map((token) => ({ kind: "color", name: token.name, confidence: token.confidence, sourceNodeIds: token.sourceNodeIds })),
    ...input.inferredTokens.spacing.map((token) => ({ kind: "spacing", name: token.name, confidence: token.confidence, sourceNodeIds: token.sourceNodeIds })),
    ...input.inferredTokens.typography.map((token) => ({ kind: "typography", name: token.name, confidence: token.confidence, sourceNodeIds: token.sourceNodeIds })),
    ...input.inferredTokens.radii.map((token) => ({ kind: "radius", name: token.name, confidence: token.confidence, sourceNodeIds: token.sourceNodeIds }))
  ];
  return candidates
    .filter((token) => token.confidence < 0.75)
    .slice(0, 20)
    .map((token) =>
      makeTask({
        id: taskId("token", `${token.kind}_${token.name}`),
        type: "token_conflict",
        priority: "P2",
        target: {
          tokenName: token.name,
          sourceNodeIds: token.sourceNodeIds
        },
        title: "Review low-confidence token",
        description: `${token.kind} token ${token.name} has confidence ${round(token.confidence)}.`,
        confidence: token.confidence,
        evidence: token,
        suggestedActions: [
          {
            label: "Keep token",
            override: {
              type: "token_rename_override",
              payload: {
                tokenName: token.name,
                action: "keep"
              },
              reason: "User accepted the generated token."
            }
          }
        ]
      })
    );
}

function i18nTasks(input: GenerateReviewTasksInput): ReviewTask[] {
  return input.i18nManifest.messages
    .filter((message) => message.confidence < 0.75)
    .map((message) =>
      makeTask({
        id: taskId("i18n", message.key),
        type: "i18n_key_uncertain",
        priority: "P2",
        target: {
          messageKey: message.key,
          sourceNodeIds: [message.sourceNodeId]
        },
        title: "Review low-confidence i18n key",
        description: `Confirm i18n key ${message.key}.`,
        confidence: message.confidence,
        evidence: {
          value: message.value,
          description: message.description
        },
        suggestedActions: [
          {
            label: "Keep i18n key",
            override: {
              type: "i18n_key_override",
              payload: {
                sourceNodeId: message.sourceNodeId,
                key: message.key
              },
              reason: "User accepted the generated i18n key."
            }
          }
        ]
      })
    );
}

function visualDiffTasks(input: GenerateReviewTasksInput): ReviewTask[] {
  const report = input.visualDiffReport;
  if (!report || report.page.pass) return [];
  const tasks: ReviewTask[] = [
    makeTask({
      id: "task_visual_diff_page",
      type: "visual_diff_failed",
      priority: "P0",
      target: {},
      title: "Resolve failing visual diff before codegen",
      description: `Page visual score is ${report.page.score.visualScore}; threshold is ${report.page.threshold.visualScore}.`,
      confidence: report.page.score.visualScore,
      evidence: {
        score: report.page.score,
        threshold: report.page.threshold,
        inputs: report.inputs
      },
      suggestedActions: [
        {
          label: "Use frame screenshot fallback",
          override: {
            type: "render_strategy_override",
            payload: {
              targetNodeId: input.normalizedDesignIR.tree.id,
              strategy: "frame_screenshot_asset"
            },
            reason: "Visual diff failed and a full-frame fidelity fallback can preserve the visual baseline."
          }
        }
      ]
    })
  ];
  for (const issue of report.issues.slice(0, 5)) {
    tasks.push(
      makeTask({
        id: taskId("visual", issue.issueId),
        type: "visual_diff_failed",
        priority: issue.score.pixelDiffRatio > 0.1 ? "P0" : "P1",
        target: {
          sourceNodeIds: issue.sourceNodeId ? [issue.sourceNodeId] : undefined,
          diffIssueId: issue.issueId
        },
        title: "Review visual diff region",
        description: `Region diff ratio is ${round(issue.score.pixelDiffRatio)} for ${issue.sourceNodeId ?? issue.issueId}.`,
        confidence: issue.score.visualScore,
        evidence: { ...issue },
        suggestedActions: [
          {
            label: "Force asset slice",
            override: {
              type: "render_strategy_override",
              payload: {
                sourceNodeId: issue.sourceNodeId,
                strategy: "asset_slice"
              },
              reason: "A localized asset slice can reduce visual mismatch in this region."
            }
          }
        ]
      })
    );
  }
  return tasks;
}

function flutterCaptureTasks(input: GenerateReviewTasksInput): ReviewTask[] {
  const capture = input.flutterCapture;
  if (!capture || capture.status === "success" || capture.status === "skipped") return [];
  return [
    makeTask({
      id: "task_flutter_capture_failed",
      type: "flutter_analyze_failed",
      priority: "P0",
      target: {
        filePath: "flutter_preview"
      },
      title: "Fix Flutter preview capture failure",
      description: capture.reason ?? "Flutter preview capture failed.",
      confidence: 0,
      evidence: capture,
      suggestedActions: [
        {
          label: "Keep blocked until Flutter passes",
          override: {
            type: "render_strategy_override",
            payload: {
              action: "block_codegen_until_flutter_passes"
            },
            reason: "Flutter preview must pass before codegen write."
          }
        }
      ]
    })
  ];
}

function buildStatusReport(tasks: ReviewTask[]): ReviewTaskStatusReport {
  const byPriority = { P0: 0, P1: 0, P2: 0 };
  const byType: Partial<Record<ReviewTaskType, number>> = {};
  for (const task of tasks) {
    if (task.status !== "open") continue;
    byPriority[task.priority] += 1;
    byType[task.type] = (byType[task.type] ?? 0) + 1;
  }
  const blockedReasons = tasks.filter((task) => task.status === "open" && task.priority === "P0").map((task) => task.title);
  return {
    version: "0.1.0",
    generatedAt: new Date().toISOString(),
    total: tasks.length,
    open: tasks.filter((task) => task.status === "open").length,
    byPriority,
    byType,
    codegenWriteBlocked: blockedReasons.length > 0,
    blockedReasons
  };
}

function makeTask(task: Omit<ReviewTask, "status">): ReviewTask {
  return {
    ...task,
    confidence: round(Math.max(0, Math.min(1, task.confidence))),
    status: "open"
  };
}

function dedupeTasks(tasks: ReviewTask[]): ReviewTask[] {
  const seen = new Map<string, ReviewTask>();
  for (const task of tasks) {
    if (!seen.has(task.id)) seen.set(task.id, task);
  }
  return Array.from(seen.values());
}

function compareTasks(left: ReviewTask, right: ReviewTask): number {
  const priorityOrder = { P0: 0, P1: 1, P2: 2 };
  return priorityOrder[left.priority] - priorityOrder[right.priority] || left.id.localeCompare(right.id);
}

function taskId(prefix: string, value: string): string {
  return `task_${prefix}_${safeId(value)}`;
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").toLowerCase() || "unknown";
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
