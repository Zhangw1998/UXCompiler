import type {
  AssetManifest,
  FidelityGenerationManifest,
  I18nManifest,
  InferredTokens,
  LayoutCandidate,
  LayoutDecision,
  NormalizedDesignIR,
  OverrideSet,
  ReviewTask,
  ReviewTaskPriority,
  ReviewTaskResult,
  ReviewTaskStatusReport,
  ReviewTaskSuggestedAction,
  ReviewTaskType,
  StaleOverrideReport,
  TokenConfidenceReport,
  UpliftDecisionArtifact,
  VisualDiffReport
} from "@uxcompiler/ir-schemas";

export interface GenerateReviewTasksInput {
  normalizedDesignIR: NormalizedDesignIR;
  layoutCandidates: LayoutCandidate[];
  layoutDecisions: LayoutDecision[];
  inferredTokens: InferredTokens;
  tokenConfidenceReport?: TokenConfidenceReport;
  assetManifest: AssetManifest;
  i18nManifest: I18nManifest;
  fidelityGenerationManifest: FidelityGenerationManifest;
  staleOverrideReport?: StaleOverrideReport;
  visualDiffReport?: VisualDiffReport;
  upliftDecisions?: UpliftDecisionArtifact;
  flutterCapture?: { status: string; reason?: string };
  overrideSet?: OverrideSet;
}

export function generateReviewTasks(input: GenerateReviewTasksInput): ReviewTaskResult {
  const tasks: ReviewTask[] = [
    ...layoutTasks(input),
    ...componentTasks(input),
    ...assetTasks(input),
    ...fidelityTasks(input),
    ...fontTasks(input),
    ...tokenTasks(input),
    ...i18nTasks(input),
    ...staleOverrideTasks(input),
    ...semanticUpliftTasks(input),
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

function componentTasks(input: GenerateReviewTasksInput): ReviewTask[] {
  return input.normalizedDesignIR.components.flatMap((candidate, index) => {
    const component = recordValue(candidate);
    if (!component) return [];
    const score = numberValue(component.confidence) ?? numberValue(component.similarity) ?? numberValue(component.componentSimilarity);
    if (score === undefined || score < 0.7 || score >= 0.9) return [];
    const componentId = stringValue(component.componentId) ?? stringValue(component.id) ?? `component_${index + 1}`;
    const name = stringValue(component.name) ?? pascalCase(componentId);
    const instances = stringArrayValue(component.sourceInstances) ?? stringArrayValue(component.instances) ?? [];
    const traceSourceNodeIds = instances.length > 0 ? instances : input.normalizedDesignIR.tree.sourceNodeIds;
    return [
      makeTask({
        id: taskId("component", componentId),
        type: "low_confidence_component",
        priority: "P1",
        target: {
          candidateId: componentId,
          sourceNodeIds: traceSourceNodeIds
        },
        title: "Review inferred component candidate",
        description: `Component candidate ${name} has similarity ${round(score)}; confirm whether it should become a reusable component.`,
        confidence: score,
        evidence: {
          componentId,
          name,
          instances: traceSourceNodeIds,
          props: component.props,
          fallback: component.fallback
        },
        suggestedActions: [
          {
            label: "Approve component",
            override: {
              type: "component_candidate_override",
              payload: {
                kind: "approve_component",
                componentId,
                name,
                instances: traceSourceNodeIds,
                reason: "User confirmed the inferred component candidate."
              },
              reason: "Confirmed component candidates are recorded in the Component Studio registry."
            }
          },
          {
            label: "Reject component",
            override: {
              type: "component_candidate_override",
              payload: {
                kind: "reject_component",
                componentId,
                reason: "User rejected the inferred component candidate."
              },
              reason: "Rejected candidates remain as generated separate widgets."
            }
          }
        ]
      })
    ];
  });
}

function assetTasks(input: GenerateReviewTasksInput): ReviewTask[] {
  const assetsByNode = new Map(input.assetManifest.assets.map((asset) => [asset.sourceNodeId, asset]));
  return input.assetManifest.warnings.map((warning) => {
    const asset = warning.sourceNodeId ? assetsByNode.get(warning.sourceNodeId) : undefined;
    const priority: ReviewTaskPriority = warning.type === "decorative_slice_contains_text" ? "P0" : "P2";
    return makeTask({
      id: taskId("asset", `${warning.sourceNodeId ?? "global"}_${warning.type}`),
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

function fontTasks(input: GenerateReviewTasksInput): ReviewTask[] {
  const tasks: ReviewTask[] = [];
  for (const warning of input.tokenConfidenceReport?.warnings ?? []) {
    if (warning.type !== "missing_font" && warning.type !== "no_typography") continue;
    tasks.push(
      makeTask({
        id: taskId("font_missing", `${warning.type}_${warning.sourceNodeIds?.join("_") ?? warning.message}`),
        type: "font_missing",
        priority: "P1",
        target: {
          sourceNodeIds: warning.sourceNodeIds
        },
        title: "Map missing text font",
        description: warning.type === "no_typography" ? "No typography samples were discovered; configure a font mapping before trusting text fidelity." : warning.message,
        confidence: 0.25,
        evidence: {
          warningType: warning.type,
          message: warning.message,
          sourceNodeIds: warning.sourceNodeIds
        },
        suggestedActions: [
          {
            label: "Configure font mapping",
            override: {
              type: "font_mapping_override",
              payload: {
                sourceNodeIds: warning.sourceNodeIds,
                fallbackFamily: "Inter"
              },
              reason: "Missing or unknown text fonts should be mapped before final fidelity validation."
            }
          }
        ]
      })
    );
  }

  for (const token of input.inferredTokens.typography) {
    if (!isMissingFontFamily(token.fontFamily)) continue;
    tasks.push(
      makeTask({
        id: taskId("font_missing", token.name),
        type: "font_missing",
        priority: "P1",
        target: {
          tokenName: token.name,
          sourceNodeIds: token.sourceNodeIds
        },
        title: "Map missing text font",
        description: `Typography token ${token.name} uses ${token.fontFamily || "an unknown font family"}; configure a project font mapping.`,
        confidence: token.confidence,
        evidence: {
          tokenName: token.name,
          fontFamily: token.fontFamily,
          fontSize: token.fontSize,
          fontWeight: token.fontWeight,
          lineHeight: token.lineHeight
        },
        suggestedActions: [
          {
            label: "Map font family",
            override: {
              type: "font_mapping_override",
              payload: {
                tokenName: token.name,
                sourceNodeIds: token.sourceNodeIds,
                fromFamily: token.fontFamily || "unknown",
                fallbackFamily: "Inter"
              },
              reason: "Map missing design fonts to an available project font."
            }
          }
        ]
      })
    );
  }
  return tasks;
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

function isMissingFontFamily(fontFamily: string): boolean {
  const normalized = fontFamily.trim().toLowerCase();
  return !normalized || normalized === "system" || normalized === "unknown" || normalized === "missing";
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

function staleOverrideTasks(input: GenerateReviewTasksInput): ReviewTask[] {
  return (input.staleOverrideReport?.staleOverrides ?? []).map((entry) =>
    makeTask({
      id: taskId("stale_override", entry.overrideId),
      type: "stale_override",
      priority: "P1",
      target: {
        normalizedNodeId: entry.target.normalizedNodeId,
        sourceNodeIds: entry.target.sourceNodeId ? [entry.target.sourceNodeId] : undefined,
        assetId: entry.target.assetId,
        tokenName: entry.target.tokenName,
        messageKey: entry.target.messageKey
      },
      title: "Review stale override",
      description: `${entry.overrideId} no longer applies: ${entry.reason}`,
      confidence: 0.2,
      evidence: {
        overrideId: entry.overrideId,
        overrideType: entry.type,
        target: entry.target,
        reason: entry.reason
      },
      suggestedActions: [
        {
          label: "Disable stale override",
          override: {
            type: entry.type,
            payload: {
              overrideId: entry.overrideId,
              action: "disable_stale_override"
            },
            reason: "The override target could not be found in the current snapshot."
          }
        }
      ]
    })
  );
}

function visualDiffTasks(input: GenerateReviewTasksInput): ReviewTask[] {
  const report = input.visualDiffReport;
  if (!report || report.page.pass) return [];
  const acceptedRepairs = acceptedVisualDiffRepairs(input);
  const tasks: ReviewTask[] = [];
  if (!acceptedRepairs.page) {
    tasks.push(
      makeTask({
        id: "task_visual_diff_page",
        type: "visual_diff_failed",
        priority: "P0",
        target: {
          normalizedNodeId: input.normalizedDesignIR.tree.id,
          sourceNodeIds: input.normalizedDesignIR.tree.sourceNodeIds
        },
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
    );
  }
  for (const issue of report.issues.slice(0, 5)) {
    if (issue.sourceNodeId && acceptedRepairs.sourceNodeIds.has(issue.sourceNodeId)) continue;
    tasks.push(
      makeTask({
        id: taskId("visual", issue.issueId),
        type: "visual_diff_failed",
        priority: issue.score.pixelDiffRatio > 0.1 ? "P0" : "P1",
        target: {
          normalizedNodeId: input.normalizedDesignIR.tree.id,
          sourceNodeIds: issue.sourceNodeId ? [issue.sourceNodeId] : input.normalizedDesignIR.tree.sourceNodeIds,
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
                sourceNodeId: issue.sourceNodeId ?? input.normalizedDesignIR.tree.sourceNodeIds[0],
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

function semanticUpliftTasks(input: GenerateReviewTasksInput): ReviewTask[] {
  const decisions = input.upliftDecisions?.decisions ?? [];
  const handledRegionIds = handledSemanticUpliftRegions(input);
  return decisions
    .filter((decision) => {
      const record = recordValue(decision);
      if (!record || record.accepted === true) return false;
      const regionId = stringValue(record.regionId);
      if (regionId && handledRegionIds.has(regionId)) return false;
      const gate = stringValue(record.gate);
      return gate === "auto_diff_required" || gate === "review_diff_required";
    })
    .map((decision) => {
      const record = recordValue(decision) ?? {};
      const regionId = stringValue(record.regionId) ?? "unknown_region";
      const sourceNodeIds = stringArrayValue(record.sourceNodeIds) ?? input.normalizedDesignIR.tree.sourceNodeIds;
      const gate = stringValue(record.gate) ?? "review_diff_required";
      const strategy = stringValue(record.strategy) ?? stringValue(record.to) ?? "semantic_layout";
      const confidence = numberValue(record.confidence) ?? 0.5;
      const priority: ReviewTaskPriority = gate === "auto_diff_required" ? "P1" : "P2";
      return makeTask({
        id: taskId("semantic_uplift", regionId),
        type: "semantic_uplift_pending",
        priority,
        target: {
          normalizedNodeId: input.normalizedDesignIR.tree.id,
          sourceNodeIds
        },
        title: gate === "auto_diff_required" ? "Run semantic uplift diff candidate" : "Review semantic uplift candidate",
        description: `Region ${regionId} can try ${strategy}, but fidelity remains authoritative until before/after diff evidence passes.`,
        confidence,
        evidence: {
          ...record,
          requiredEvidence: "uplift_diff_report.comparisons"
        },
        suggestedActions: [
          {
            label: "Run uplift diff",
            override: {
              type: "render_strategy_override",
              payload: {
                action: "run_semantic_uplift_diff",
                regionId,
                sourceNodeIds,
                strategy
              },
              reason: "Semantic uplift candidates require visual diff evidence before they can replace fidelity rendering."
            }
          },
          {
            label: "Keep fidelity for region",
            override: {
              type: "render_strategy_override",
              payload: {
                action: "keep_fidelity_region",
                regionId,
                sourceNodeIds
              },
              reason: "User chose to keep fidelity rendering for this region."
            }
          }
        ]
      });
    });
}

function handledSemanticUpliftRegions(input: GenerateReviewTasksInput): Set<string> {
  const regionIds = new Set<string>();
  for (const override of input.overrideSet?.overrides ?? []) {
    if (override.status !== "active" || override.type !== "render_strategy_override") continue;
    const payload = recordValue(override.payload);
    const action = stringValue(payload?.action);
    if (action !== "run_semantic_uplift_diff" && action !== "keep_fidelity_region") continue;
    const regionId = stringValue(payload?.regionId);
    if (regionId) regionIds.add(regionId);
  }
  return regionIds;
}

function acceptedVisualDiffRepairs(input: GenerateReviewTasksInput): { page: boolean; sourceNodeIds: Set<string> } {
  const sourceNodeIds = new Set<string>();
  let page = false;
  for (const override of input.overrideSet?.overrides ?? []) {
    if (override.status !== "active" || override.type !== "render_strategy_override") continue;
    const strategy = stringValue(override.payload.strategy);
    if (strategy === "frame_screenshot_asset" && override.target.normalizedNodeId === input.normalizedDesignIR.tree.id) page = true;
    if (strategy === "asset_slice" && override.target.sourceNodeId) sourceNodeIds.add(override.target.sourceNodeId);
    const payloadSourceNodeId = stringValue(override.payload.sourceNodeId);
    if (strategy === "asset_slice" && payloadSourceNodeId) sourceNodeIds.add(payloadSourceNodeId);
  }
  return { page, sourceNodeIds };
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
        normalizedNodeId: input.normalizedDesignIR.tree.id,
        sourceNodeIds: input.normalizedDesignIR.tree.sourceNodeIds,
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

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function stringArrayValue(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const strings = value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  return strings.length > 0 ? strings : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function pascalCase(value: string): string {
  const words = value.match(/[a-zA-Z0-9]+/g) ?? ["Component"];
  const result = words.map((word) => word.slice(0, 1).toUpperCase() + word.slice(1)).join("");
  return /^[A-Z]/.test(result) ? result : `Component${result}`;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
