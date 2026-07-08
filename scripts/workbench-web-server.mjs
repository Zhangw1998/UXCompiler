#!/usr/bin/env node

import { createServer } from "node:http";
import { copyFile, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve, sep } from "node:path";
import { codegenProjectFileProbePaths, createCodegenReview } from "../packages/codegen-review/dist/index.js";
import { runIncrementalSync } from "../packages/incremental-sync/dist/index.js";
import { applyOverrides } from "../packages/override-engine/dist/index.js";
import { writeCodegenToProject } from "../packages/project-writer/dist/index.js";
import { generateReviewTasks } from "../packages/review-task-engine/dist/index.js";
import { applyStudioOperations } from "../packages/studios/dist/index.js";
import { applyTreeEdits } from "../packages/tree-editor/dist/index.js";

const args = parseArgs(process.argv.slice(2));
const port = Number(args.port ?? process.env.UXCOMPILER_WORKBENCH_PORT ?? 8788);
const host = args.host ?? "127.0.0.1";
const artifactRoot = args.artifacts ?? "/artifacts/sample";
const root = resolve(process.cwd());
const overrideTypes = new Set([
  "node_parent_override",
  "region_create_override",
  "region_merge_override",
  "region_split_override",
  "layout_strategy_override",
  "render_strategy_override",
  "naming_override",
  "component_candidate_override",
  "component_prop_override",
  "component_variant_override",
  "token_merge_override",
  "token_split_override",
  "token_rename_override",
  "asset_strategy_override",
  "i18n_key_override",
  "flutter_component_mapping_override",
  "font_mapping_override",
  "text_calibration_override",
  "ignore_node_override"
]);

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".map", "application/json; charset=utf-8"],
  [".arb", "application/json; charset=utf-8"],
  [".dart", "text/plain; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"]
]);

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);
    if (request.method === "OPTIONS") {
      sendJson(response, 204, {});
      return;
    }

    if (requestUrl.pathname === "/api/workbench/task-action") {
      if (request.method !== "POST") {
        sendJson(response, 405, { ok: false, error: "Method not allowed" });
        return;
      }
      const body = await readJsonBody(request);
      const result = await applyReviewTaskAction(body);
      sendJson(response, 200, {
        ok: true,
        ...result
      });
      return;
    }

    if (requestUrl.pathname === "/api/workbench/task-bulk-close") {
      if (request.method !== "POST") {
        sendJson(response, 405, { ok: false, error: "Method not allowed" });
        return;
      }
      const body = await readJsonBody(request);
      const result = await applyReviewTaskBulkClose(body);
      sendJson(response, 200, {
        ok: true,
        ...result
      });
      return;
    }

    if (requestUrl.pathname === "/api/workbench/tree-edit") {
      if (request.method !== "POST") {
        sendJson(response, 405, { ok: false, error: "Method not allowed" });
        return;
      }
      const body = await readJsonBody(request);
      const result = await applyWorkbenchTreeEdit(body);
      sendJson(response, 200, {
        ok: true,
        ...result
      });
      return;
    }

    if (requestUrl.pathname === "/api/workbench/studio-operation") {
      if (request.method !== "POST") {
        sendJson(response, 405, { ok: false, error: "Method not allowed" });
        return;
      }
      const body = await readJsonBody(request);
      const result = await applyWorkbenchStudioOperation(body);
      sendJson(response, 200, {
        ok: true,
        ...result
      });
      return;
    }

    if (requestUrl.pathname === "/api/workbench/studio-rollback") {
      if (request.method !== "POST") {
        sendJson(response, 405, { ok: false, error: "Method not allowed" });
        return;
      }
      const body = await readJsonBody(request);
      const result = await applyWorkbenchStudioRollback(body);
      sendJson(response, 200, {
        ok: true,
        ...result
      });
      return;
    }

    if (requestUrl.pathname === "/api/workbench/codegen-review") {
      if (request.method !== "POST") {
        sendJson(response, 405, { ok: false, error: "Method not allowed" });
        return;
      }
      const body = await readJsonBody(request);
      const result = await applyWorkbenchCodegenReview(body);
      sendJson(response, 200, {
        ok: true,
        ...result
      });
      return;
    }

    if (requestUrl.pathname === "/api/workbench/sync-remap") {
      if (request.method !== "POST") {
        sendJson(response, 405, { ok: false, error: "Method not allowed" });
        return;
      }
      const body = await readJsonBody(request);
      const result = await applyWorkbenchSyncRemap(body);
      sendJson(response, 200, {
        ok: true,
        ...result
      });
      return;
    }

    if (requestUrl.pathname === "/api/workbench/project-preset") {
      if (request.method === "GET") {
        const result = await readWorkbenchProjectPreset(requestUrl.searchParams.get("artifactRoot"));
        sendJson(response, 200, {
          ok: true,
          ...result
        });
        return;
      }
      if (request.method !== "POST") {
        sendJson(response, 405, { ok: false, error: "Method not allowed" });
        return;
      }
      const body = await readJsonBody(request);
      const result = await saveWorkbenchProjectPreset(body);
      sendJson(response, 200, {
        ok: true,
        ...result
      });
      return;
    }

    if (requestUrl.pathname === "/api/workbench/project-elements") {
      if (request.method !== "GET") {
        sendJson(response, 405, { ok: false, error: "Method not allowed" });
        return;
      }
      const result = await readWorkbenchProjectElements(requestUrl.searchParams.get("artifactRoot"));
      sendJson(response, 200, {
        ok: true,
        report: result
      });
      return;
    }

    if (requestUrl.pathname === "/api/workbench/project-pages") {
      if (request.method !== "GET") {
        sendJson(response, 405, { ok: false, error: "Method not allowed" });
        return;
      }
      const result = await readWorkbenchProjectPages(requestUrl.searchParams.get("artifactRoot"));
      sendJson(response, 200, {
        ok: true,
        report: result
      });
      return;
    }

    if (requestUrl.pathname === "/api/workbench/projects") {
      if (request.method !== "GET") {
        sendJson(response, 405, { ok: false, error: "Method not allowed" });
        return;
      }
      const result = await readWorkbenchProjects(requestUrl.searchParams.get("artifactRoot"));
      sendJson(response, 200, {
        ok: true,
        report: result
      });
      return;
    }

    if (requestUrl.pathname === "/api/workbench/prototype-link") {
      if (request.method !== "POST") {
        sendJson(response, 405, { ok: false, error: "Method not allowed" });
        return;
      }
      const body = await readJsonBody(request);
      const result = await updateWorkbenchPrototypeLink(body);
      sendJson(response, 200, {
        ok: true,
        report: result
      });
      return;
    }

    if (requestUrl.pathname === "/api/workbench/codegen-write") {
      if (request.method !== "POST") {
        sendJson(response, 405, { ok: false, error: "Method not allowed" });
        return;
      }
      const body = await readJsonBody(request);
      const result = await applyWorkbenchCodegenWrite(body);
      sendJson(response, 200, {
        ok: true,
        ...result
      });
      return;
    }

    if (requestUrl.pathname === "/api/workbench/diff-repair") {
      if (request.method !== "POST") {
        sendJson(response, 405, { ok: false, error: "Method not allowed" });
        return;
      }
      const body = await readJsonBody(request);
      const result = await applyWorkbenchDiffRepair(body);
      sendJson(response, 200, {
        ok: true,
        ...result
      });
      return;
    }

    if (requestUrl.pathname === "/api/workbench/diff-repair-rollback") {
      if (request.method !== "POST") {
        sendJson(response, 405, { ok: false, error: "Method not allowed" });
        return;
      }
      const body = await readJsonBody(request);
      const result = await applyWorkbenchDiffRepairRollback(body);
      sendJson(response, 200, {
        ok: true,
        ...result
      });
      return;
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      response.writeHead(405, { allow: "GET, HEAD, POST, OPTIONS" });
      response.end("Method not allowed");
      return;
    }

    if (requestUrl.pathname === "/") {
      const workbenchUrl = new URL("/apps/workbench-web/", `http://${host}:${port}`);
      workbenchUrl.searchParams.set("artifacts", artifactRoot);
      response.writeHead(302, { location: workbenchUrl.pathname + workbenchUrl.search });
      response.end();
      return;
    }

    const filePath = await resolveRequestPath(requestUrl.pathname);
    if (!filePath) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }

    const body = await readFile(filePath);
    response.writeHead(200, {
      "content-type": mimeTypes.get(extname(filePath)) ?? "application/octet-stream",
      "cache-control": "no-store"
    });
    if (request.method === "HEAD") {
      response.end();
    } else {
      response.end(body);
    }
  } catch (error) {
    const requestUrl = new URL(request.url ?? "/", `http://${request.headers.host ?? `${host}:${port}`}`);
    if (requestUrl.pathname.startsWith("/api/")) {
      sendJson(response, 500, {
        ok: false,
        error: error instanceof Error ? error.message : String(error)
      });
    } else {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : String(error));
    }
  }
});

server.listen(port, host, () => {
  const url = new URL("/apps/workbench-web/", `http://${host}:${port}`);
  url.searchParams.set("artifacts", artifactRoot);
  console.log(`UXCompiler Workbench listening on ${url.toString()}`);
  console.log(`Serving workspace root ${root}`);
});

async function resolveRequestPath(pathname) {
  const decodedPath = decodeURIComponent(pathname);
  const requestPath = decodedPath.endsWith("/") ? `${decodedPath}index.html` : decodedPath;
  const filePath = resolve(root, `.${requestPath}`);
  const relation = relative(root, filePath);
  if (relation.startsWith(`..${sep}`) || relation === ".." || relation === "") return undefined;
  try {
    const info = await stat(filePath);
    if (info.isFile()) return filePath;
  } catch {
    return undefined;
  }
  return undefined;
}

async function applyReviewTaskAction(body) {
  const artifactDir = resolveArtifactRoot(stringValue(body.artifactRoot));
  const taskId = stringValue(body.taskId);
  const actionIndex = numberValue(body.actionIndex);
  const actor = stringValue(body.actor) ?? "user";
  if (!taskId) throw new Error("Missing taskId.");
  if (!Number.isInteger(actionIndex) || actionIndex < 0) throw new Error("Invalid actionIndex.");

  const reviewTasks = await readJson(resolve(artifactDir, "review_tasks.json"));
  if (!Array.isArray(reviewTasks)) throw new Error("review_tasks.json must be an array.");
  const task = reviewTasks.find((entry) => entry?.id === taskId);
  if (!task) throw new Error(`Review task not found: ${taskId}`);
  const action = task.suggestedActions?.[actionIndex];
  if (!action?.override) throw new Error(`Review task ${taskId} has no suggested action at ${actionIndex}.`);

  const existingOverrideSet = await readJson(resolve(artifactDir, "override_set.json"));
  const beforeOpen = reviewTasks.filter((entry) => entry?.status === "open").length;
  const now = new Date().toISOString();
  const nextOverrideSet = clone(existingOverrideSet);
  nextOverrideSet.version = Number.isFinite(nextOverrideSet.version) ? nextOverrideSet.version + 1 : 1;
  nextOverrideSet.overrides = Array.isArray(nextOverrideSet.overrides) ? nextOverrideSet.overrides : [];

  const disableResult = maybeDisableStaleOverride(nextOverrideSet, action.override, now);
  let appliedOverrideId = disableResult?.overrideId;
  if (!disableResult) {
    const override = buildOverrideFromAction({ task, action, actionIndex, actor, now });
    appliedOverrideId = override.id;
    const existingIndex = nextOverrideSet.overrides.findIndex((entry) => entry.id === override.id);
    if (existingIndex >= 0) {
      nextOverrideSet.overrides[existingIndex] = {
        ...nextOverrideSet.overrides[existingIndex],
        ...override,
        createdAt: nextOverrideSet.overrides[existingIndex].createdAt ?? override.createdAt,
        updatedAt: now
      };
    } else {
      nextOverrideSet.overrides.push(override);
    }
  }

  const normalizedDesignIR = await readJson(resolve(artifactDir, "normalized_design_ir.json"));
  const assetManifest = await readJson(resolve(artifactDir, "asset_manifest.json"));
  const i18nManifest = await readJson(resolve(artifactDir, "i18n_manifest.json"));
  const inferredTokens = await readJson(resolve(artifactDir, "inferred_tokens.json"));
  const tokenConfidenceReport = await readOptionalJson(resolve(artifactDir, "token_confidence_report.json"), undefined);
  const layoutCandidates = await readOptionalJson(resolve(artifactDir, "layout_candidates.json"), []);
  const layoutDecisions = await readOptionalJson(resolve(artifactDir, "layout_decisions.json"), []);
  const fidelityGenerationManifest = await readOptionalJson(resolve(artifactDir, "fidelity_generation_manifest.json"), {
    version: "2.0",
    generatedAt: now,
    viewport: normalizedDesignIR.source?.viewport ?? { width: 0, height: 0 },
    files: [],
    renderDecisions: [],
    warnings: []
  });
  const visualDiffReport =
    (await readOptionalJson(resolve(artifactDir, "visual_diff_report.json"), undefined)) ??
    (await readOptionalJson(resolve(artifactDir, "diff/visual_diff_report.json"), undefined));
  const upliftDecisions = await readOptionalJson(resolve(artifactDir, "uplift_decisions.json"), undefined);
  const flutterCapture = await readOptionalJson(resolve(artifactDir, "flutter_preview_capture_report.json"), undefined);

  const overrideResult = applyOverrides({
    normalizedDesignIR,
    assetManifest,
    i18nManifest,
    inferredTokens,
    overrideSet: nextOverrideSet
  });
  const reviewResult = generateReviewTasks({
    normalizedDesignIR: overrideResult.reviewedNormalizedDesignIR,
    layoutCandidates,
    layoutDecisions,
    inferredTokens: overrideResult.reviewedInferredTokens,
    tokenConfidenceReport,
    assetManifest: overrideResult.reviewedAssetManifest,
    i18nManifest: overrideResult.reviewedI18nManifest,
    fidelityGenerationManifest,
    overrideSet: overrideResult.overrideSet,
    staleOverrideReport: overrideResult.staleOverrideReport,
    visualDiffReport,
    upliftDecisions,
    flutterCapture: flutterCapture ? { status: flutterCapture.status, reason: flutterCapture.reason } : undefined
  });
  const closureReason =
    stringValue(action.override.reason) ??
    stringValue(action.override.payload?.reason) ??
    `Applied suggested action: ${action.label}`;

  await writeJson(resolve(artifactDir, "override_set.json"), overrideResult.overrideSet);
  await appendOverrideHistory(artifactDir, existingOverrideSet, overrideResult.overrideSet, {
    now,
    actor,
    source: "review_task_action",
    reason: closureReason
  });
  await writeJson(resolve(artifactDir, "reviewed_normalized_design_ir.json"), overrideResult.reviewedNormalizedDesignIR);
  await writeJson(resolve(artifactDir, "reviewed_asset_manifest.json"), overrideResult.reviewedAssetManifest);
  await writeJson(resolve(artifactDir, "reviewed_i18n_manifest.json"), overrideResult.reviewedI18nManifest);
  await writeJson(resolve(artifactDir, "reviewed_inferred_tokens.json"), overrideResult.reviewedInferredTokens);
  await writeJson(resolve(artifactDir, "reviewed_arb/app_en.arb"), overrideResult.reviewedArbFile);
  await writeJson(resolve(artifactDir, "override_conflict_report.json"), overrideResult.overrideConflictReport);
  await writeJson(resolve(artifactDir, "stale_override_report.json"), overrideResult.staleOverrideReport);
  await writeJson(resolve(artifactDir, "review_tasks.json"), reviewResult.reviewTasks);
  await writeJson(resolve(artifactDir, "task_status_report.json"), reviewResult.taskStatusReport);

  const existingClosureLog = await readOptionalJson(resolve(artifactDir, "review_task_closure_log.json"), []);
  const closureLog = Array.isArray(existingClosureLog) ? existingClosureLog : [];
  closureLog.push({
    version: "0.1.0",
    taskId,
    closedAt: now,
    closedBy: actor,
    status: "closed",
    closureReason,
    actionIndex,
    actionLabel: action.label,
    overrideId: appliedOverrideId,
    disabledStaleOverride: disableResult?.disabled ?? false,
    taskSnapshot: {
      ...task,
      status: "closed",
      closedReason: closureReason,
      closeReason: closureReason,
      closedAt: now,
      closedBy: actor,
      closedByOverrideId: appliedOverrideId
    }
  });
  await writeJson(resolve(artifactDir, "review_task_closure_log.json"), closureLog);

  const report = {
    version: "0.1.0",
    generatedAt: now,
    artifactRoot: `/${relative(root, artifactDir).replaceAll(sep, "/")}`,
    taskId,
    actionIndex,
    actionLabel: action.label,
    overrideId: appliedOverrideId,
    beforeOpenTasks: beforeOpen,
    afterOpenTasks: reviewResult.taskStatusReport.open,
    closureReason,
    overrideHash: overrideResult.overrideSet.hash,
    disabledStaleOverride: disableResult?.disabled ?? false
  };
  await writeJson(resolve(artifactDir, "review_task_action_report.json"), report);

  return {
    report,
    overrideSet: overrideResult.overrideSet,
    taskStatusReport: reviewResult.taskStatusReport,
    reviewTasks: reviewResult.reviewTasks
  };
}

async function applyReviewTaskBulkClose(body) {
  const artifactDir = resolveArtifactRoot(stringValue(body.artifactRoot));
  const taskIds = stringArray(body.taskIds);
  const actor = stringValue(body.actor) ?? "user";
  const closureReason = stringValue(body.reason) ?? "Bulk accepted low-risk review task fallback.";
  if (taskIds.length === 0) throw new Error("Missing taskIds.");

  const reviewTasks = await readJson(resolve(artifactDir, "review_tasks.json"));
  if (!Array.isArray(reviewTasks)) throw new Error("review_tasks.json must be an array.");
  const now = new Date().toISOString();
  const uniqueTaskIds = [...new Set(taskIds)];
  const selectedTasks = [];
  for (const taskId of uniqueTaskIds) {
    const task = reviewTasks.find((entry) => entry?.id === taskId);
    if (!task) throw new Error(`Review task not found: ${taskId}`);
    if (task.status !== "open") throw new Error(`Review task is not open: ${taskId}`);
    selectedTasks.push(task);
  }
  const blockingTask = selectedTasks.find((task) => task.priority === "P0");
  if (blockingTask) {
    throw new Error(`P0 review task cannot be bulk closed: ${blockingTask.id}`);
  }

  const beforeOpen = reviewTasks.filter((entry) => entry?.status === "open").length;
  const selectedTaskIds = new Set(uniqueTaskIds);
  const remainingTasks = reviewTasks.filter((task) => !selectedTaskIds.has(task.id));
  const nextTaskStatusReport = buildTaskStatusReport(remainingTasks, now);

  const existingClosureLog = await readOptionalJson(resolve(artifactDir, "review_task_closure_log.json"), []);
  const closureLog = Array.isArray(existingClosureLog) ? existingClosureLog : [];
  for (const task of selectedTasks) {
    closureLog.push({
      version: "0.1.0",
      taskId: task.id,
      closedAt: now,
      closedBy: actor,
      status: "closed",
      closureReason,
      actionIndex: undefined,
      actionLabel: "Bulk close low-risk task",
      overrideId: undefined,
      bulkClosed: true,
      taskSnapshot: {
        ...task,
        status: "closed",
        closedReason: closureReason,
        closeReason: closureReason,
        closedAt: now,
        closedBy: actor
      }
    });
  }

  await writeJson(resolve(artifactDir, "review_tasks.json"), remainingTasks);
  await writeJson(resolve(artifactDir, "task_status_report.json"), nextTaskStatusReport);
  await writeJson(resolve(artifactDir, "review_task_closure_log.json"), closureLog);

  const report = {
    version: "0.1.0",
    generatedAt: now,
    artifactRoot: `/${relative(root, artifactDir).replaceAll(sep, "/")}`,
    taskIds: uniqueTaskIds,
    closedTaskCount: selectedTasks.length,
    beforeOpenTasks: beforeOpen,
    afterOpenTasks: nextTaskStatusReport.open,
    closureReason,
    blockedP0: false
  };
  await writeJson(resolve(artifactDir, "review_task_bulk_close_report.json"), report);

  return {
    report,
    taskStatusReport: nextTaskStatusReport,
    reviewTasks: remainingTasks
  };
}

async function applyWorkbenchTreeEdit(body) {
  const artifactDir = resolveArtifactRoot(stringValue(body.artifactRoot));
  const operation = body.operation;
  const actor = stringValue(body.actor) ?? "user";
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    throw new Error("Missing tree edit operation.");
  }
  const nowValue = new Date();
  const normalizedDesignIR = await readFirstJson([
    resolve(artifactDir, "reviewed_normalized_design_ir.json"),
    resolve(artifactDir, "normalized_design_ir.json")
  ]);
  const assetManifest = await readJson(resolve(artifactDir, "asset_manifest.json"));
  const i18nManifest = await readJson(resolve(artifactDir, "i18n_manifest.json"));
  const inferredTokens = await readJson(resolve(artifactDir, "inferred_tokens.json"));
  const overrideSet = await readJson(resolve(artifactDir, "override_set.json"));
  const result = applyTreeEdits({
    normalizedDesignIR,
    assetManifest,
    i18nManifest,
    inferredTokens,
    overrideSet,
    operations: [operation],
    actor: actor === "agent" || actor === "system" ? actor : "user",
    now: () => nowValue
  });
  if (result.validationReport.rejectedOperationIds.length > 0 || result.overrideMutations.length === 0) {
    const message = result.validationReport.issues.map((issue) => issue.message).join("; ") || "Tree edit operation was rejected.";
    throw new Error(message);
  }
  const nextOverrideSet = clone(overrideSet);
  nextOverrideSet.version = Number.isFinite(nextOverrideSet.version) ? nextOverrideSet.version + 1 : 1;
  nextOverrideSet.overrides = [...(Array.isArray(nextOverrideSet.overrides) ? nextOverrideSet.overrides : []), ...result.overrideMutations];
  nextOverrideSet.hash = "";

  const rebuilt = await rebuildReviewedArtifacts(artifactDir, nextOverrideSet, nowValue.toISOString(), {}, {
    actor,
    source: "tree_edit",
    reason: stringValue(operation.reason) ?? "Workbench tree edit."
  });
  const report = {
    version: "0.1.0",
    generatedAt: nowValue.toISOString(),
    artifactRoot: `/${relative(root, artifactDir).replaceAll(sep, "/")}`,
    operation,
    overrideIds: result.overrideMutations.map((override) => override.id),
    validationReport: result.validationReport,
    afterOpenTasks: rebuilt.reviewResult.taskStatusReport.open,
    overrideHash: rebuilt.overrideResult.overrideSet.hash
  };
  await writeJson(resolve(artifactDir, "tree_edit_report.json"), {
    ...result,
    overrideSet: rebuilt.overrideResult.overrideSet,
    draftNormalizedDesignIR: rebuilt.overrideResult.reviewedNormalizedDesignIR,
    savedAt: nowValue.toISOString()
  });
  await writeJson(resolve(artifactDir, "workbench_tree_edit_action_report.json"), report);

  return {
    report,
    overrideSet: rebuilt.overrideResult.overrideSet,
    taskStatusReport: rebuilt.reviewResult.taskStatusReport,
    reviewTasks: rebuilt.reviewResult.reviewTasks
  };
}

async function applyWorkbenchStudioRollback(body) {
  const artifactDir = resolveArtifactRoot(stringValue(body.artifactRoot));
  const nowValue = new Date();
  const now = nowValue.toISOString();
  const actor = stringValue(body.actor) ?? "user";
  const explicitOverrideIds = stringArray(body.overrideIds);
  const actionReport = await readOptionalJson(resolve(artifactDir, "workbench_studio_action_report.json"), {});
  const rollbackOverrideIds = explicitOverrideIds.length > 0 ? explicitOverrideIds : stringArray(actionReport.overrideIds);
  if (rollbackOverrideIds.length === 0) throw new Error("Missing Studio override ids to disable.");
  for (const overrideId of rollbackOverrideIds) {
    if (!overrideId.startsWith("ovr_studio_")) throw new Error(`Not a Studio override: ${overrideId}`);
  }

  const overrideSet = await readJson(resolve(artifactDir, "override_set.json"));
  const nextOverrideSet = clone(overrideSet);
  nextOverrideSet.version = Number.isFinite(nextOverrideSet.version) ? nextOverrideSet.version + 1 : 1;
  nextOverrideSet.overrides = Array.isArray(nextOverrideSet.overrides) ? nextOverrideSet.overrides : [];
  const disabled = [];
  for (const overrideId of rollbackOverrideIds) {
    const entry = nextOverrideSet.overrides.find((candidate) => candidate.id === overrideId);
    if (!entry) throw new Error(`Cannot disable missing Studio override: ${overrideId}`);
    if (entry.status === "active") {
      entry.status = "disabled";
      entry.disabledBy = actor === "agent" || actor === "system" ? actor : "user";
      entry.updatedAt = now;
      disabled.push(overrideId);
    }
  }
  if (disabled.length === 0) throw new Error("Selected Studio overrides are already disabled.");

  const refreshed = await refreshStudioArtifacts(artifactDir, nextOverrideSet, now, nowValue, {
    actor,
    source: "studio_rollback",
    reason: "Workbench Studio rollback."
  });
  const report = {
    version: "0.1.0",
    generatedAt: now,
    artifactRoot: `/${relative(root, artifactDir).replaceAll(sep, "/")}`,
    rollbackOverrideIds: disabled,
    afterOpenTasks: refreshed.rebuilt.reviewResult.taskStatusReport.open,
    overrideHash: refreshed.rebuilt.overrideResult.overrideSet.hash,
    componentCount: refreshed.studioResult.componentRegistry.components.length,
    tokenCount: refreshed.studioResult.tokenRegistry.tokens.length
  };
  await writeJson(resolve(artifactDir, "workbench_studio_rollback_report.json"), report);
  return {
    report,
    overrideSet: refreshed.rebuilt.overrideResult.overrideSet,
    taskStatusReport: refreshed.rebuilt.reviewResult.taskStatusReport,
    reviewTasks: refreshed.rebuilt.reviewResult.reviewTasks
  };
}

async function applyWorkbenchStudioOperation(body) {
  const artifactDir = resolveArtifactRoot(stringValue(body.artifactRoot));
  const operation = body.operation;
  const actor = stringValue(body.actor) ?? "user";
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    throw new Error("Missing Studio operation.");
  }

  const nowValue = new Date();
  const now = nowValue.toISOString();
  const normalizedDesignIR = await readJson(resolve(artifactDir, "normalized_design_ir.json"));
  const assetManifest = await readJson(resolve(artifactDir, "asset_manifest.json"));
  const i18nManifest = await readJson(resolve(artifactDir, "i18n_manifest.json"));
  const inferredTokens = await readJson(resolve(artifactDir, "inferred_tokens.json"));
  const overrideSet = await readJson(resolve(artifactDir, "override_set.json"));
  const result = applyStudioOperations({
    normalizedDesignIR,
    assetManifest,
    i18nManifest,
    inferredTokens,
    overrideSet,
    operations: [operation],
    actor: actor === "agent" || actor === "system" ? actor : "user",
    now: () => nowValue
  });
  if (result.validationReport.rejectedOperationIds.length > 0 || result.overrideMutations.length === 0) {
    const message = result.validationReport.issues.map((issue) => issue.message).join("; ") || "Studio operation was rejected.";
    throw new Error(message);
  }

  const rebuilt = await rebuildReviewedArtifacts(artifactDir, result.overrideSet, now, {
    reviewedAssetManifest: result.finalAssetManifest,
    reviewedI18nManifest: result.finalI18nManifest,
    reviewedArbFile: result.finalArbFile
  }, {
    actor,
    source: "studio_operation",
    reason: stringValue(operation.reason) ?? "Workbench Studio operation."
  });
  const report = {
    version: "0.1.0",
    generatedAt: now,
    artifactRoot: `/${relative(root, artifactDir).replaceAll(sep, "/")}`,
    operation,
    overrideIds: result.overrideMutations.map((override) => override.id),
    validationReport: result.validationReport,
    afterOpenTasks: rebuilt.reviewResult.taskStatusReport.open,
    overrideHash: rebuilt.overrideResult.overrideSet.hash,
    componentCount: result.componentRegistry.components.length,
    tokenCount: result.tokenRegistry.tokens.length
  };

  await writeJson(resolve(artifactDir, "studio_report.json"), {
    version: result.version,
    generatedAt: now,
    operations: result.operations,
    validationReport: result.validationReport,
    overrideMutations: result.overrideMutations
  });
  await writeJson(resolve(artifactDir, "component_registry.json"), result.componentRegistry);
  await writeJson(resolve(artifactDir, "token_registry.json"), result.tokenRegistry);
  await writeJson(resolve(artifactDir, "final_asset_manifest.json"), result.finalAssetManifest);
  await writeJson(resolve(artifactDir, "final_i18n_manifest.json"), result.finalI18nManifest);
  await writeJson(resolve(artifactDir, "arb/app_en.arb"), result.finalArbFile);
  await ensureFileBackedAssets(artifactDir, artifactDir, result.finalAssetManifest);
  await writeJson(resolve(artifactDir, "workbench_studio_action_report.json"), report);

  return {
    report,
    overrideSet: rebuilt.overrideResult.overrideSet,
    taskStatusReport: rebuilt.reviewResult.taskStatusReport,
    reviewTasks: rebuilt.reviewResult.reviewTasks
  };
}

async function applyWorkbenchCodegenReview(body) {
  const artifactDir = resolveArtifactRoot(stringValue(body.artifactRoot));
  const projectPath = stringValue(body.projectPath) ? resolveLocalPath(stringValue(body.projectPath)) : undefined;
  const now = new Date().toISOString();
  const flutterPreviewFiles = await readTextFilesRecursively(resolve(artifactDir, "flutter_preview"));
  const normalizedDesignIR = await readFirstJson([
    resolve(artifactDir, "reviewed_normalized_design_ir.json"),
    resolve(artifactDir, "normalized_design_ir.json")
  ]);
  const i18nManifest = await readFirstJson([
    resolve(artifactDir, "final_i18n_manifest.json"),
    resolve(artifactDir, "reviewed_i18n_manifest.json"),
    resolve(artifactDir, "i18n_manifest.json")
  ]);
  const existingProjectFiles = projectPath
    ? await readExistingProjectFiles(projectPath, codegenProjectFileProbePaths({ normalizedDesignIR, flutterPreviewFiles, locale: i18nManifest.locale }))
    : undefined;
  const result = createCodegenReview({
    normalizedDesignIR,
    assetManifest: await readFirstJson([
      resolve(artifactDir, "final_asset_manifest.json"),
      resolve(artifactDir, "reviewed_asset_manifest.json"),
      resolve(artifactDir, "asset_manifest.json")
    ]),
    i18nManifest,
    existingArbFile: projectPath ? await readOptionalJson(resolve(projectPath, "lib/l10n/app_en.arb"), undefined) : undefined,
    flutterPreviewFiles,
    existingProjectFiles,
    previousManifest: await readOptionalJson(resolve(artifactDir, "codegen_review.json"), undefined),
    reviewTasks: await readOptionalJson(resolve(artifactDir, "review_tasks.json"), undefined),
    taskStatusReport: await readOptionalJson(resolve(artifactDir, "task_status_report.json"), undefined),
    visualDiffReport:
      (await readOptionalJson(resolve(artifactDir, "visual_diff_report.json"), undefined)) ??
      (await readOptionalJson(resolve(artifactDir, "diff/visual_diff_report.json"), undefined)),
    fidelityGenerationManifest: await readOptionalJson(resolve(artifactDir, "fidelity_generation_manifest.json"), undefined),
    nodePixelMap: await readOptionalJson(resolve(artifactDir, "node_pixel_map.json"), undefined),
    overrideSet: await readOptionalJson(resolve(artifactDir, "override_set.json"), undefined),
    staleOverrideReport: await readOptionalJson(resolve(artifactDir, "stale_override_report.json"), undefined),
    promotionRules: await readOptionalJson(resolve(artifactDir, "codegen_promotion_rules.json"), undefined),
    format: await readWorkbenchFormatSummary(artifactDir),
    analyze: await readWorkbenchAnalyzeSummary(artifactDir),
    projectId: stringValue(body.projectId),
    buildId: stringValue(body.buildId),
    normalizedIrId: stringValue(body.normalizedIrId),
    allowLowVisualScore: Boolean(body.allowLowVisualScore)
  });
  await writeCodegenReviewArtifacts(artifactDir, result);
  const report = {
    version: "0.1.0",
    generatedAt: now,
    artifactRoot: `/${relative(root, artifactDir).replaceAll(sep, "/")}`,
    projectPath,
    buildId: result.codegenReview.buildId,
    gateStatus: result.codegenReview.gates.status,
    blockers: result.codegenReview.gates.blockers.length,
    formatStatus: result.codegenReview.format.status,
    formatSource: result.codegenReview.format.source,
    analyzeErrors: result.codegenReview.analyze.errors,
    analyzeWarnings: result.codegenReview.analyze.warnings,
    analyzeSource: result.codegenReview.analyze.source,
    filesToCreate: result.filesToCreate.length,
    filesToModify: result.filesToModify.length,
    assetsToAdd: result.assetsToAdd.length,
    arbKeysToAdd: result.codegenReview.arbKeysToAdd.length,
    generatedWidgets: result.codegenReview.generatedWidgets.length,
    fallbackRegions: result.codegenReview.fallbackRegions.length,
    unresolvedReviewTasks: result.codegenReview.unresolvedReviewTasks.length,
    manualOverrides: result.codegenReview.manualOverrideSummary.active
  };
  await writeJson(resolve(artifactDir, "workbench_codegen_review_report.json"), report);
  return {
    report,
    codegenReview: result.codegenReview
  };
}

async function applyWorkbenchSyncRemap(body) {
  const artifactDir = resolveArtifactRoot(stringValue(body.artifactRoot));
  const newRawPath = resolveLocalPath(stringValue(body.newRawPath));
  const oldRawScene = await readJson(resolve(artifactDir, "raw_figma_scene.json"));
  const newRawScene = await readJson(newRawPath);
  const oldVisualDiffReport =
    (await readOptionalJson(resolve(artifactDir, "visual_diff_report.json"), undefined)) ??
    (await readOptionalJson(resolve(artifactDir, "diff/visual_diff_report.json"), undefined));
  const now = new Date().toISOString();
  const previousOverrideSet = await readJson(resolve(artifactDir, "override_set.json"));
  const result = runIncrementalSync({
    oldRawScene,
    newRawScene,
    overrideSet: previousOverrideSet,
    oldSnapshotId: stringValue(body.oldSnapshotId) ?? stringValue(oldRawScene.source?.version) ?? stringValue(oldRawScene.source?.frameNodeId),
    newSnapshotId: stringValue(body.newSnapshotId) ?? stringValue(newRawScene.source?.version) ?? stringValue(newRawScene.source?.frameNodeId),
    oldVisualDiffReport,
    actor: "agent",
    now: () => new Date(now)
  });
  const existingReviewTasks = await readOptionalJson(resolve(artifactDir, "review_tasks.json"), []);
  const incrementalTaskIds = new Set(result.incrementalReviewTasks.map((task) => task.id));
  const mergedReviewTasks = [
    ...asArray(existingReviewTasks).filter((task) => !incrementalTaskIds.has(task.id)),
    ...result.incrementalReviewTasks
  ];
  const nextTaskStatusReport = buildTaskStatusReport(mergedReviewTasks, now);
  const report = {
    version: "0.1.0",
    generatedAt: now,
    artifactRoot: `/${relative(root, artifactDir).replaceAll(sep, "/")}`,
    newRawPath,
    oldSnapshotId: result.oldSnapshotId,
    newSnapshotId: result.newSnapshotId,
    matches: result.nodeRemapReport.matches.length,
    reappliedOverrides: result.reappliedOverrides.length,
    staleOverrides: result.staleOverrides.length,
    reviewTasks: result.incrementalReviewTasks.length,
    tokenMigrationStatus: result.tokenMigrationReport.status,
    visualDiffChange: result.nodeRemapReport.visualDiffChange,
    overrideHash: result.overrideSet.hash
  };
  await writeJson(resolve(artifactDir, "override_set.json"), result.overrideSet);
  await appendOverrideHistory(artifactDir, previousOverrideSet, result.overrideSet, {
    now,
    actor: "agent",
    source: "sync_remap",
    reason: "Workbench incremental sync remapped overrides."
  });
  await writeJson(resolve(artifactDir, "node_remap_report.json"), result.nodeRemapReport);
  await writeJson(resolve(artifactDir, "token_migration_report.json"), result.tokenMigrationReport);
  await writeJson(resolve(artifactDir, "reapplied_overrides.json"), result.reappliedOverrides);
  await writeJson(resolve(artifactDir, "stale_overrides.json"), result.staleOverrides);
  await writeJson(resolve(artifactDir, "incremental_review_tasks.json"), result.incrementalReviewTasks);
  await writeJson(resolve(artifactDir, "review_tasks.json"), mergedReviewTasks);
  await writeJson(resolve(artifactDir, "task_status_report.json"), nextTaskStatusReport);
  await writeJson(resolve(artifactDir, "workbench_sync_remap_report.json"), report);
  return {
    report,
    overrideSet: result.overrideSet,
    nodeRemapReport: result.nodeRemapReport,
    tokenMigrationReport: result.tokenMigrationReport,
    reviewTasks: mergedReviewTasks,
    taskStatusReport: nextTaskStatusReport
  };
}

async function saveWorkbenchProjectPreset(body) {
  const { projectDir } = await resolveWorkbenchProjectContext(stringValue(body.artifactRoot));
  const preset = body.preset;
  if (!preset || typeof preset !== "object" || Array.isArray(preset)) {
    throw new Error("Missing project preset.");
  }

  const now = new Date().toISOString();
  const design = preset.design ?? {};
  const fonts = preset.fonts ?? {};
  const assets = preset.assets ?? {};
  const width = numberValue(design.width);
  const height = numberValue(design.height);
  const dpr = numberValue(design.dpr) ?? 1;
  if (!Number.isFinite(width) || width <= 0) throw new Error("Design width must be positive.");
  if (!Number.isFinite(height) || height <= 0) throw new Error("Design height must be positive.");
  if (!Number.isFinite(dpr) || dpr <= 0) throw new Error("Design DPR must be positive.");

  const nextPreset = {
    version: "0.1.0",
    generatedAt: stringValue(preset.generatedAt) ?? now,
    updatedAt: now,
    source: stringValue(preset.source) ?? "workbench",
    design: {
      width,
      height,
      dpr
    },
    fonts: {
      defaultFamily: stringValue(fonts.defaultFamily) ?? "",
      families: stringArray(fonts.families),
      resources: asArray(fonts.resources).map(normalizePresetResource).filter(Boolean)
    },
    assets: {
      root: stringValue(assets.root) ?? "assets",
      images: stringValue(assets.images) ?? "assets/images",
      slices: stringValue(assets.slices) ?? "assets/slices",
      frames: stringValue(assets.frames) ?? "assets/frames"
    },
    notes: stringValue(preset.notes) ?? ""
  };
  const path = resolve(projectDir, "project_preset.json");
  await writeJson(path, nextPreset);
  return {
    report: {
      path,
      scope: "project",
      updatedAt: now,
      fontFamilies: nextPreset.fonts.families.length,
      resources: nextPreset.fonts.resources.length
    }
  };
}

async function readWorkbenchProjectPreset(artifactRootValue) {
  const { pageDir: currentPageDir, projectDir } = await resolveWorkbenchProjectContext(stringValue(artifactRootValue));
  const projectPath = resolve(projectDir, "project_preset.json");
  const pagePath = resolve(currentPageDir, "project_preset.json");
  const projectPreset = await readOptionalJson(projectPath, undefined);
  const pagePreset = await readOptionalJson(pagePath, undefined);
  return {
    scope: "project",
    path: projectPath,
    preset: projectPreset ?? pagePreset
  };
}

async function readWorkbenchProjectElements(artifactRootValue) {
  const { pageDir: currentPageDir, projectDir } = await resolveWorkbenchProjectContext(stringValue(artifactRootValue));
  const pageDirs = await projectPagesInDir(projectDir);
  const pages = [];
  const tokens = [];
  const components = [];
  const assets = [];
  const docs = [];

  for (const pageDir of pageDirs) {
    const page = await readProjectPageEntry(pageDir, pageDir === currentPageDir);
    pages.push(page);
    const pageName = page.name;

    const tokenRoot =
      (await readOptionalJson(resolve(pageDir, "reviewed_inferred_tokens.json"), undefined)) ??
      (await readOptionalJson(resolve(pageDir, "inferred_tokens.json"), {}));
    for (const [type, entries] of Object.entries(tokenRoot && typeof tokenRoot === "object" ? tokenRoot : {})) {
      if (!Array.isArray(entries)) continue;
      for (const entry of entries) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        const name = stringValue(entry.name) ?? stringValue(entry.id);
        if (!name) continue;
        tokens.push({
          pageName,
          type,
          name,
          value: projectElementDisplayValue(entry),
          source: stringValue(entry.source)
        });
      }
    }

    const registry = await readOptionalJson(resolve(pageDir, "component_registry.json"), undefined);
    const normalized =
      (await readOptionalJson(resolve(pageDir, "reviewed_normalized_design_ir.json"), undefined)) ??
      (await readOptionalJson(resolve(pageDir, "normalized_design_ir.json"), {}));
    for (const component of asArray(registry?.components ?? normalized?.components)) {
      if (!component || typeof component !== "object" || Array.isArray(component)) continue;
      const id = stringValue(component.id) ?? stringValue(component.componentId);
      components.push({
        pageName,
        id,
        name: stringValue(component.name) ?? id,
        source: stringValue(component.source) ?? stringValue(component.status)
      });
    }

    const assetManifest =
      (await readOptionalJson(resolve(pageDir, "final_asset_manifest.json"), undefined)) ??
      (await readOptionalJson(resolve(pageDir, "reviewed_asset_manifest.json"), undefined)) ??
      (await readOptionalJson(resolve(pageDir, "asset_manifest.json"), {}));
    for (const asset of asArray(assetManifest?.assets)) {
      if (!asset || typeof asset !== "object" || Array.isArray(asset)) continue;
      const id = stringValue(asset.id) ?? stringValue(asset.sourceNodeId);
      assets.push({
        pageName,
        artifactRoot: page.artifactRoot,
        id,
        name: stringValue(asset.sourceName) ?? id,
        path: stringValue(asset.path),
        strategy: stringValue(asset.strategy) ?? stringValue(asset.format)
      });
    }

    const i18nManifest =
      (await readOptionalJson(resolve(pageDir, "final_i18n_manifest.json"), undefined)) ??
      (await readOptionalJson(resolve(pageDir, "reviewed_i18n_manifest.json"), undefined)) ??
      (await readOptionalJson(resolve(pageDir, "i18n_manifest.json"), {}));
    for (const message of asArray(i18nManifest?.messages)) {
      if (!message || typeof message !== "object" || Array.isArray(message)) continue;
      const key = stringValue(message.key);
      if (!key) continue;
      docs.push({
        pageName,
        key,
        value: stringValue(message.value) ?? "",
        source: "i18n"
      });
    }
  }

  return {
    version: "0.1.0",
    projectName: basename(projectDir),
    projectRoot: artifactRootForDir(projectDir),
    pages,
    tokens,
    components,
    assets,
    docs
  };
}

async function readWorkbenchProjectPages(artifactRootValue) {
  const { pageDir, projectDir } = await resolveWorkbenchProjectContext(stringValue(artifactRootValue));
  const projectRoot = artifactRootForDir(projectDir);
  const entries = await readdir(projectDir, { withFileTypes: true });
  const pages = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const candidatePageDir = resolve(projectDir, entry.name);
    if (!(await fileExists(resolve(candidatePageDir, "raw_figma_scene.json")))) continue;
    pages.push(await readProjectPageEntry(candidatePageDir, candidatePageDir === pageDir));
  }
  pages.sort((left, right) => Number(right.current) - Number(left.current) || left.name.localeCompare(right.name));
  const prototypeFlow = normalizePrototypeFlow(await readOptionalJson(resolve(projectDir, "prototype_flow.json"), undefined));
  return {
    version: "0.1.0",
    projectName: basename(projectDir),
    projectRoot,
    currentArtifactRoot: artifactRootForDir(pageDir),
    pages,
    prototypeFlow
  };
}

async function readWorkbenchProjects(artifactRootValue) {
  const { projectDir: currentProjectDir } = await resolveWorkbenchProjectContext(stringValue(artifactRootValue));
  const projectsRoot = dirname(currentProjectDir);
  const entries = await readdir(projectsRoot, { withFileTypes: true });
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const projectDir = resolve(projectsRoot, entry.name);
    const pages = await projectPagesInDir(projectDir);
    if (pages.length === 0) continue;
    projects.push({
      name: entry.name,
      artifactRoot: artifactRootForDir(pages[0]),
      pageCount: pages.length,
      current: projectDir === currentProjectDir
    });
  }
  projects.sort((left, right) => Number(right.current) - Number(left.current) || left.name.localeCompare(right.name));
  return {
    version: "0.1.0",
    currentProjectName: basename(currentProjectDir),
    projects
  };
}

async function updateWorkbenchPrototypeLink(body) {
  const { projectDir } = await resolveWorkbenchProjectContext(stringValue(body.artifactRoot));
  const operation = stringValue(body.operation);
  const flowPath = resolve(projectDir, "prototype_flow.json");
  const now = new Date().toISOString();
  const flow = normalizePrototypeFlow(await readOptionalJson(flowPath, undefined));
  if (operation === "add") {
    const link = body.link ?? {};
    const fromPage = stringValue(link.fromPage);
    const toPage = stringValue(link.toPage);
    if (!fromPage || !toPage) throw new Error("Prototype link requires fromPage and toPage.");
    if (fromPage === toPage) throw new Error("Prototype link cannot connect a page to itself.");
    const trigger = stringValue(link.trigger) ?? "tap";
    const id = stringValue(link.id) ?? `proto_${safeName(fromPage)}_${safeName(toPage)}_${safeName(trigger)}`;
    const nextLink = {
      id,
      fromPage,
      toPage,
      trigger,
      note: stringValue(link.note) ?? ""
    };
    const existingIndex = flow.links.findIndex((entry) => entry.id === id);
    if (existingIndex >= 0) flow.links[existingIndex] = nextLink;
    else flow.links.push(nextLink);
  } else if (operation === "delete") {
    const linkId = stringValue(body.linkId);
    if (!linkId) throw new Error("Prototype link delete requires linkId.");
    flow.links = flow.links.filter((link) => link.id !== linkId);
  } else {
    throw new Error(`Unsupported prototype link operation: ${operation ?? "missing"}.`);
  }
  flow.updatedAt = now;
  await writeJson(flowPath, flow);
  return {
    path: flowPath,
    updatedAt: now,
    links: flow.links.length
  };
}

async function resolveWorkbenchProjectContext(artifactRootValue) {
  const artifactDir = resolveArtifactRoot(artifactRootValue);
  if (await fileExists(resolve(artifactDir, "raw_figma_scene.json"))) {
    return {
      pageDir: artifactDir,
      projectDir: dirname(artifactDir)
    };
  }
  const pageDirs = await projectPagesInDir(artifactDir);
  if (pageDirs.length > 0) {
    return {
      pageDir: pageDirs[0],
      projectDir: artifactDir
    };
  }
  return {
    pageDir: artifactDir,
    projectDir: dirname(artifactDir)
  };
}

async function projectPagesInDir(projectDir) {
  const entries = await readdir(projectDir, { withFileTypes: true });
  const pages = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pageDir = resolve(projectDir, entry.name);
    if (await fileExists(resolve(pageDir, "raw_figma_scene.json"))) pages.push(pageDir);
  }
  return pages.sort((left, right) => basename(left).localeCompare(basename(right)));
}

async function applyWorkbenchCodegenWrite(body) {
  const artifactDir = resolveArtifactRoot(stringValue(body.artifactRoot));
  const projectPath = resolveLocalPath(stringValue(body.projectPath));
  const dryRun = body.dryRun !== false;
  const assetRoots = stringArray(body.assetRoots).map(resolveLocalPath);
  const result = await writeCodegenToProject({
    projectPath,
    codegenReview: await readJson(resolve(artifactDir, "codegen_review.json")),
    generatedFiles: await readGeneratedFiles(resolve(artifactDir, "generated")),
    arbPatch: await readOptionalJson(resolve(artifactDir, "arb_patch.json"), undefined),
    pubspecPatch: await readOptionalJson(resolve(artifactDir, "pubspec_patch.json"), undefined),
    assetRoots: [...assetRoots, resolve(artifactDir, "assets"), artifactDir],
    dryRun,
    allowBlocked: Boolean(body.allowBlocked)
  });
  await writeJson(resolve(artifactDir, "project_write_report.json"), result.report);
  await writeJson(resolve(artifactDir, "workbench_codegen_write_report.json"), result.report);
  return {
    report: result.report
  };
}

async function applyWorkbenchDiffRepair(body) {
  const artifactDir = resolveArtifactRoot(stringValue(body.artifactRoot));
  const repairKind = stringValue(body.repairKind) ?? "issue_asset_slice";
  const issueId = stringValue(body.issueId);
  const actor = stringValue(body.actor) ?? "user";
  const visualDiffReport =
    (await readOptionalJson(resolve(artifactDir, "visual_diff_report.json"), undefined)) ??
    (await readOptionalJson(resolve(artifactDir, "diff/visual_diff_report.json"), undefined));
  if (!visualDiffReport) throw new Error("No visual diff report is available.");

  const normalizedDesignIR = await readFirstJson([
    resolve(artifactDir, "reviewed_normalized_design_ir.json"),
    resolve(artifactDir, "normalized_design_ir.json")
  ]);
  const overrideSet = await readJson(resolve(artifactDir, "override_set.json"));
  const previousTaskStatusReport = await readOptionalJson(resolve(artifactDir, "task_status_report.json"), {});
  const now = new Date().toISOString();
  const nextOverrideSet = clone(overrideSet);
  nextOverrideSet.version = Number.isFinite(nextOverrideSet.version) ? nextOverrideSet.version + 1 : 1;
  nextOverrideSet.overrides = Array.isArray(nextOverrideSet.overrides) ? nextOverrideSet.overrides : [];

  const override = buildDiffRepairOverride({
    repairKind,
    issueId,
    visualDiffReport,
    normalizedDesignIR,
    actor: actor === "agent" || actor === "system" ? actor : "user",
    now
  });
  const existingIndex = nextOverrideSet.overrides.findIndex((entry) => entry.id === override.id);
  const previousOverride = existingIndex >= 0 ? clone(nextOverrideSet.overrides[existingIndex]) : undefined;
  if (existingIndex >= 0) {
    nextOverrideSet.overrides[existingIndex] = {
      ...nextOverrideSet.overrides[existingIndex],
      ...override,
      createdAt: nextOverrideSet.overrides[existingIndex].createdAt ?? override.createdAt,
      updatedAt: now
    };
  } else {
    nextOverrideSet.overrides.push(override);
  }

  const rebuilt = await rebuildReviewedArtifacts(artifactDir, nextOverrideSet, now, {}, {
    actor,
    source: "diff_repair",
    reason: `Workbench diff repair: ${repairKind}.`
  });
  const repairPatch = {
    version: "0.1.0",
    generatedAt: now,
    artifactRoot: `/${relative(root, artifactDir).replaceAll(sep, "/")}`,
    repairKind,
    issueId,
    inputs: visualDiffReport.inputs,
    page: visualDiffReport.page,
    overrideId: override.id,
    operation: previousOverride ? "replace_override" : "add_override",
    beforeOverride: previousOverride ?? null,
    afterOverride: override,
    rollback: previousOverride
      ? { type: "restore_override", overrideId: override.id, override: previousOverride }
      : { type: "disable_override", overrideId: override.id },
    status: "applied"
  };
  const report = {
    version: "0.1.0",
    generatedAt: now,
    artifactRoot: `/${relative(root, artifactDir).replaceAll(sep, "/")}`,
    repairKind,
    issueId,
    overrideId: override.id,
    repairPatchPath: "repair_patch.json",
    afterOpenTasks: rebuilt.reviewResult.taskStatusReport.open,
    overrideHash: rebuilt.overrideResult.overrideSet.hash
  };
  await writeJson(resolve(artifactDir, "diff_repair_report.json"), report);
  await writeJson(resolve(artifactDir, "workbench_diff_repair_report.json"), report);
  await writeJson(resolve(artifactDir, "repair_patch.json"), repairPatch);
  await appendRepairIterationLog(artifactDir, {
    event: "applied",
    generatedAt: now,
    repairKind,
    issueId,
    overrideId: override.id,
    operation: repairPatch.operation,
    visualScore: visualDiffReport.page.score.visualScore,
    pixelDiffRatio: visualDiffReport.page.score.pixelDiffRatio,
    visualDiffGeneratedAt: visualDiffReport.generatedAt,
    visualDiffIssueIds: ["page", ...(visualDiffReport.issues ?? []).map((issue) => issue.issueId).filter(Boolean)],
    repairPatchPath: "repair_patch.json",
    rollbackAvailable: true,
    reason: `Applied rollbackable ${repairKind} repair from visual diff issue ${issueId ?? "page"}.`,
    beforeOpenTasks: previousTaskStatusReport.open,
    afterOpenTasks: rebuilt.reviewResult.taskStatusReport.open,
    overrideHash: rebuilt.overrideResult.overrideSet.hash
  });
  return {
    report,
    repairPatch,
    overrideSet: rebuilt.overrideResult.overrideSet,
    taskStatusReport: rebuilt.reviewResult.taskStatusReport,
    reviewTasks: rebuilt.reviewResult.reviewTasks
  };
}

async function applyWorkbenchDiffRepairRollback(body) {
  const artifactDir = resolveArtifactRoot(stringValue(body.artifactRoot));
  const overrideSet = await readJson(resolve(artifactDir, "override_set.json"));
  const repairPatch = await readJson(resolve(artifactDir, "repair_patch.json"));
  const actor = stringValue(body.actor) ?? "user";
  const requestedOverrideId = stringValue(body.overrideId);
  const overrideId = requestedOverrideId ?? stringValue(repairPatch.overrideId);
  if (!overrideId) throw new Error("Missing repair override id.");
  if (requestedOverrideId && requestedOverrideId !== repairPatch.overrideId) {
    throw new Error(`Repair patch belongs to ${repairPatch.overrideId}, not ${requestedOverrideId}.`);
  }
  if (repairPatch.status !== "applied") throw new Error("Repair patch is not currently applied.");
  const rollback = repairPatch.rollback ?? {};
  const rollbackType = stringValue(rollback.type);
  if (!rollbackType) throw new Error("Repair patch does not include rollback metadata.");

  const now = new Date().toISOString();
  const previousTaskStatusReport = await readOptionalJson(resolve(artifactDir, "task_status_report.json"), {});
  const nextOverrideSet = clone(overrideSet);
  nextOverrideSet.version = Number.isFinite(nextOverrideSet.version) ? nextOverrideSet.version + 1 : 1;
  nextOverrideSet.overrides = Array.isArray(nextOverrideSet.overrides) ? nextOverrideSet.overrides : [];
  const existingIndex = nextOverrideSet.overrides.findIndex((entry) => entry.id === overrideId);
  if (existingIndex < 0) throw new Error(`Override not found: ${overrideId}`);

  if (rollbackType === "restore_override") {
    if (!rollback.override) throw new Error("Repair patch restore override is missing.");
    nextOverrideSet.overrides[existingIndex] = {
      ...clone(rollback.override),
      updatedAt: now
    };
  } else if (rollbackType === "disable_override") {
    nextOverrideSet.overrides[existingIndex] = {
      ...nextOverrideSet.overrides[existingIndex],
      status: "disabled",
      updatedAt: now
    };
  } else {
    throw new Error(`Unsupported rollback type: ${rollbackType}`);
  }

  const rebuilt = await rebuildReviewedArtifacts(artifactDir, nextOverrideSet, now, {}, {
    actor,
    source: "diff_repair_rollback",
    reason: `Workbench diff repair rollback: ${rollbackType}.`
  });
  const report = {
    version: "0.1.0",
    generatedAt: now,
    artifactRoot: `/${relative(root, artifactDir).replaceAll(sep, "/")}`,
    overrideId,
    rollbackType,
    beforeOpenTasks: previousTaskStatusReport.open,
    afterOpenTasks: rebuilt.reviewResult.taskStatusReport.open,
    overrideHash: rebuilt.overrideResult.overrideSet.hash
  };
  const rolledBackPatch = {
    ...repairPatch,
    status: "rolled_back",
    rolledBackAt: now,
    rollbackReport: report
  };
  await writeJson(resolve(artifactDir, "repair_patch.json"), rolledBackPatch);
  await writeJson(resolve(artifactDir, "diff_repair_rollback_report.json"), report);
  await writeJson(resolve(artifactDir, "workbench_diff_repair_rollback_report.json"), report);
  await appendRepairIterationLog(artifactDir, {
    event: "rolled_back",
    generatedAt: now,
    overrideId,
    rollbackType,
    repairPatchPath: "repair_patch.json",
    rollbackAvailable: false,
    reason: `Rolled back repair override ${overrideId}.`,
    beforeOpenTasks: previousTaskStatusReport.open,
    afterOpenTasks: rebuilt.reviewResult.taskStatusReport.open,
    overrideHash: rebuilt.overrideResult.overrideSet.hash
  });
  return {
    report,
    repairPatch: rolledBackPatch,
    overrideSet: rebuilt.overrideResult.overrideSet,
    taskStatusReport: rebuilt.reviewResult.taskStatusReport,
    reviewTasks: rebuilt.reviewResult.reviewTasks
  };
}

async function rebuildReviewedArtifacts(artifactDir, overrideSet, now, reviewedPatch = {}, historyContext = {}) {
  const previousOverrideSet = await readOptionalJson(resolve(artifactDir, "override_set.json"), undefined);
  const normalizedDesignIR = await readJson(resolve(artifactDir, "normalized_design_ir.json"));
  const assetManifest = await readJson(resolve(artifactDir, "asset_manifest.json"));
  const i18nManifest = await readJson(resolve(artifactDir, "i18n_manifest.json"));
  const inferredTokens = await readJson(resolve(artifactDir, "inferred_tokens.json"));
  const tokenConfidenceReport = await readOptionalJson(resolve(artifactDir, "token_confidence_report.json"), undefined);
  const layoutCandidates = await readOptionalJson(resolve(artifactDir, "layout_candidates.json"), []);
  const layoutDecisions = await readOptionalJson(resolve(artifactDir, "layout_decisions.json"), []);
  const fidelityGenerationManifest = await readOptionalJson(resolve(artifactDir, "fidelity_generation_manifest.json"), {
    version: "2.0",
    generatedAt: now,
    viewport: normalizedDesignIR.source?.viewport ?? { width: 0, height: 0 },
    files: [],
    renderDecisions: [],
    warnings: []
  });
  const visualDiffReport =
    (await readOptionalJson(resolve(artifactDir, "visual_diff_report.json"), undefined)) ??
    (await readOptionalJson(resolve(artifactDir, "diff/visual_diff_report.json"), undefined));
  const upliftDecisions = await readOptionalJson(resolve(artifactDir, "uplift_decisions.json"), undefined);
  const flutterCapture = await readOptionalJson(resolve(artifactDir, "flutter_preview_capture_report.json"), undefined);
  const overrideResult = applyOverrides({
    normalizedDesignIR,
    assetManifest,
    i18nManifest,
    inferredTokens,
    overrideSet
  });
  const reviewedNormalizedDesignIR = reviewedPatch.reviewedNormalizedDesignIR ?? overrideResult.reviewedNormalizedDesignIR;
  const reviewedAssetManifest = reviewedPatch.reviewedAssetManifest ?? overrideResult.reviewedAssetManifest;
  const reviewedI18nManifest = reviewedPatch.reviewedI18nManifest ?? overrideResult.reviewedI18nManifest;
  const reviewedInferredTokens = reviewedPatch.reviewedInferredTokens ?? overrideResult.reviewedInferredTokens;
  const reviewedArbFile = reviewedPatch.reviewedArbFile ?? overrideResult.reviewedArbFile;
  const reviewResult = generateReviewTasks({
    normalizedDesignIR: reviewedNormalizedDesignIR,
    layoutCandidates,
    layoutDecisions,
    inferredTokens: reviewedInferredTokens,
    tokenConfidenceReport,
    assetManifest: reviewedAssetManifest,
    i18nManifest: reviewedI18nManifest,
    fidelityGenerationManifest,
    overrideSet: overrideResult.overrideSet,
    staleOverrideReport: overrideResult.staleOverrideReport,
    visualDiffReport,
    upliftDecisions,
    flutterCapture: flutterCapture ? { status: flutterCapture.status, reason: flutterCapture.reason } : undefined
  });
  await writeJson(resolve(artifactDir, "override_set.json"), overrideResult.overrideSet);
  await appendOverrideHistory(artifactDir, previousOverrideSet, overrideResult.overrideSet, {
    now,
    actor: historyContext.actor ?? "system",
    source: historyContext.source ?? "rebuild_reviewed_artifacts",
    reason: historyContext.reason
  });
  await writeJson(resolve(artifactDir, "reviewed_normalized_design_ir.json"), reviewedNormalizedDesignIR);
  await writeJson(resolve(artifactDir, "reviewed_asset_manifest.json"), reviewedAssetManifest);
  await ensureFileBackedAssets(artifactDir, artifactDir, reviewedAssetManifest);
  await writeJson(resolve(artifactDir, "reviewed_i18n_manifest.json"), reviewedI18nManifest);
  await writeJson(resolve(artifactDir, "reviewed_inferred_tokens.json"), reviewedInferredTokens);
  await writeJson(resolve(artifactDir, "reviewed_arb/app_en.arb"), reviewedArbFile);
  await writeJson(resolve(artifactDir, "override_conflict_report.json"), overrideResult.overrideConflictReport);
  await writeJson(resolve(artifactDir, "stale_override_report.json"), overrideResult.staleOverrideReport);
  await writeJson(resolve(artifactDir, "review_tasks.json"), reviewResult.reviewTasks);
  await writeJson(resolve(artifactDir, "task_status_report.json"), reviewResult.taskStatusReport);
  return { overrideResult, reviewResult };
}

async function writeCodegenReviewArtifacts(artifactDir, result) {
  await Promise.all([
    writeJson(resolve(artifactDir, "codegen_review.json"), result.codegenReview),
    writeJson(resolve(artifactDir, "flutter_generation_manifest.json"), result.codegenReview),
    writeJson(resolve(artifactDir, "files_to_create.json"), result.filesToCreate),
    writeJson(resolve(artifactDir, "files_to_modify.json"), result.filesToModify),
    writeJson(resolve(artifactDir, "assets_to_add.json"), result.assetsToAdd),
    writeJson(resolve(artifactDir, "arb_patch.json"), result.arbPatch),
    writeText(resolve(artifactDir, "pubspec.yaml.patch"), result.pubspecPatch.patch),
    writeJson(resolve(artifactDir, "pubspec_patch.json"), result.pubspecPatch),
    writeJson(resolve(artifactDir, "merge_report.json"), result.mergeReport),
    writeJson(resolve(artifactDir, "incremental_sync_report.json"), result.incrementalSyncReport),
    ...result.generatedFiles.map((file) => writeText(resolve(artifactDir, "generated", file.path), file.content)),
    ...result.filePatches.map((patch) => writeText(resolve(artifactDir, patch.patchPath), patch.patch))
  ]);
}

async function refreshStudioArtifacts(artifactDir, overrideSet, now, nowValue = new Date(now), historyContext = {}) {
  const normalizedDesignIR = await readJson(resolve(artifactDir, "normalized_design_ir.json"));
  const assetManifest = await readJson(resolve(artifactDir, "asset_manifest.json"));
  const i18nManifest = await readJson(resolve(artifactDir, "i18n_manifest.json"));
  const inferredTokens = await readJson(resolve(artifactDir, "inferred_tokens.json"));
  const studioResult = applyStudioOperations({
    normalizedDesignIR,
    assetManifest,
    i18nManifest,
    inferredTokens,
    overrideSet,
    operations: [],
    actor: "system",
    now: () => nowValue
  });
  const rebuilt = await rebuildReviewedArtifacts(artifactDir, studioResult.overrideSet, now, {
    reviewedAssetManifest: studioResult.finalAssetManifest,
    reviewedI18nManifest: studioResult.finalI18nManifest,
    reviewedArbFile: studioResult.finalArbFile
  }, historyContext);
  await writeJson(resolve(artifactDir, "studio_report.json"), {
    version: studioResult.version,
    generatedAt: now,
    operations: studioResult.operations,
    validationReport: studioResult.validationReport,
    overrideMutations: studioResult.overrideMutations,
    refreshedFromOverrideSet: true
  });
  await writeJson(resolve(artifactDir, "component_registry.json"), studioResult.componentRegistry);
  await writeJson(resolve(artifactDir, "token_registry.json"), studioResult.tokenRegistry);
  await writeJson(resolve(artifactDir, "final_asset_manifest.json"), studioResult.finalAssetManifest);
  await writeJson(resolve(artifactDir, "final_i18n_manifest.json"), studioResult.finalI18nManifest);
  await writeJson(resolve(artifactDir, "arb/app_en.arb"), studioResult.finalArbFile);
  await ensureFileBackedAssets(artifactDir, artifactDir, studioResult.finalAssetManifest);
  return { studioResult, rebuilt };
}

async function ensureFileBackedAssets(sourceDir, outDir, assetManifest) {
  await Promise.all(
    (assetManifest.assets ?? [])
      .filter((asset) => typeof asset.path === "string" && asset.path.length > 0)
      .map(async (asset) => {
        const target = resolveSafeAssetPath(outDir, asset.path);
        if (await fileExists(target)) return;
        const source = resolveSafeAssetPath(sourceDir, asset.path);
        if (source !== target && (await fileExists(source))) {
          await mkdir(dirname(target), { recursive: true });
          await copyFile(source, target);
          return;
        }
        await mkdir(dirname(target), { recursive: true });
        if (asset.format === "svg" || asset.path.toLowerCase().endsWith(".svg")) {
          await writeFile(target, renderPlaceholderSvgAsset(asset), "utf8");
        } else if (asset.format === "png" || asset.path.toLowerCase().endsWith(".png")) {
          await writeFile(target, placeholderPngBytes());
        }
      })
  );
}

function resolveSafeAssetPath(base, assetPath) {
  if (assetPath.startsWith("/") || assetPath.includes("..") || !assetPath.startsWith("assets/")) {
    throw new Error(`Unsafe asset path: ${assetPath}`);
  }
  return resolve(base, assetPath);
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function renderPlaceholderSvgAsset(asset) {
  const title = escapeXml(asset.sourceName || asset.id);
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1" viewBox="0 0 1 1" data-uxc-placeholder="true" data-uxc-source-node-id="${escapeXml(asset.sourceNodeId)}">`,
    `  <title>${title}</title>`,
    `  <rect width="1" height="1" fill="none" />`,
    "</svg>",
    ""
  ].join("\n");
}

function escapeXml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function placeholderPngBytes() {
  return Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=", "base64");
}

async function appendOverrideHistory(artifactDir, previousOverrideSet, nextOverrideSet, context = {}) {
  const previousOverrides = new Map(asArray(previousOverrideSet?.overrides).map((override) => [override.id, override]));
  const nextOverrides = new Map(asArray(nextOverrideSet?.overrides).map((override) => [override.id, override]));
  const timestamp = context.now ?? new Date().toISOString();
  const entries = [];

  for (const [overrideId, override] of nextOverrides) {
    const previous = previousOverrides.get(overrideId);
    if (!previous) {
      entries.push(historyEntry("added", override, previous, previousOverrideSet, nextOverrideSet, timestamp, context));
      continue;
    }
    if (JSON.stringify(previous) !== JSON.stringify(override)) {
      entries.push(historyEntry(override.status === "disabled" && previous.status !== "disabled" ? "disabled" : "updated", override, previous, previousOverrideSet, nextOverrideSet, timestamp, context));
    }
  }

  for (const [overrideId, previous] of previousOverrides) {
    if (!nextOverrides.has(overrideId)) {
      entries.push(historyEntry("removed", undefined, previous, previousOverrideSet, nextOverrideSet, timestamp, context));
    }
  }

  if (entries.length === 0) return;
  const historyPath = resolve(artifactDir, "override_history.ndjson");
  await mkdir(dirname(historyPath), { recursive: true });
  await writeFile(historyPath, entries.map((entry) => `${JSON.stringify(entry)}\n`).join(""), { flag: "a" });
}

function historyEntry(event, override, previousOverride, previousOverrideSet, nextOverrideSet, timestamp, context) {
  const overrideSnapshot = override ?? previousOverride;
  return {
    version: "0.1.0",
    event,
    timestamp,
    actor: normalizeActor(context.actor),
    source: stringValue(context.source) ?? "workbench",
    reason: stringValue(context.reason),
    overrideId: overrideSnapshot?.id,
    overrideType: overrideSnapshot?.type,
    overrideSetId: nextOverrideSet?.id ?? previousOverrideSet?.id,
    previousHash: stringValue(previousOverrideSet?.hash),
    nextHash: stringValue(nextOverrideSet?.hash),
    previousStatus: previousOverride?.status,
    nextStatus: override?.status,
    previousOverride: previousOverride ? clone(previousOverride) : undefined,
    override: override ? clone(override) : undefined
  };
}

function normalizeActor(actor) {
  return actor === "agent" || actor === "system" ? actor : "user";
}

async function appendRepairIterationLog(artifactDir, entry) {
  const logPath = resolve(artifactDir, "repair_iteration_log.json");
  const existing = await readOptionalJson(logPath, { version: "0.1.0", maxIterations: 3, iterations: [] });
  const iterations = Array.isArray(existing.iterations) ? existing.iterations : [];
  await writeJson(logPath, {
    version: existing.version ?? "0.1.0",
    generatedAt: existing.generatedAt ?? entry.generatedAt,
    updatedAt: entry.generatedAt,
    maxIterations: Number.isInteger(existing.maxIterations) ? existing.maxIterations : 3,
    iterations: [...iterations, entry]
  });
}

function buildOverrideFromAction({ task, action, actionIndex, actor, now }) {
  const suggestion = action.override;
  const type = stringValue(suggestion.type);
  if (!type || !overrideTypes.has(type)) throw new Error(`Unsupported override type: ${type ?? "missing"}`);
  const payload = normalizeSuggestedPayload(type, task, suggestion.payload ?? {});
  return {
    id: `ovr_${safeName(`${task.id}_action_${actionIndex}`)}`,
    type,
    target: deriveTarget(type, task, payload),
    payload,
    status: "active",
    createdBy: actor === "agent" || actor === "system" ? actor : "user",
    createdAt: now,
    scope: "snapshot"
  };
}

function buildDiffRepairOverride({ repairKind, issueId, visualDiffReport, normalizedDesignIR, actor, now }) {
  if (repairKind === "page_frame_fallback") {
    return {
      id: "ovr_diff_page_frame_fallback",
      type: "render_strategy_override",
      target: { kind: "normalized_node", normalizedNodeId: normalizedDesignIR.tree.id },
      payload: {
        targetNodeId: normalizedDesignIR.tree.id,
        strategy: "frame_screenshot_asset",
        diffIssueId: "page",
        reason: "Workbench Preview accepted full-frame fallback for a failing visual diff."
      },
      status: "active",
      createdBy: actor,
      createdAt: now,
      scope: "snapshot"
    };
  }
  const issue = visualDiffReport.issues?.find((entry) => entry?.issueId === issueId);
  if (!issue) throw new Error(`Visual diff issue not found: ${issueId ?? "missing"}`);
  const sourceNodeId = stringValue(issue.sourceNodeId);
  if (!sourceNodeId) throw new Error(`Visual diff issue ${issueId} does not have a sourceNodeId.`);
  const suggested = selectDiffRepairSuggestion(issue, sourceNodeId);
  const type = suggested?.type ?? "render_strategy_override";
  const payload = suggested?.payload ?? {
    sourceNodeId,
    strategy: "asset_slice",
    diffIssueId: issue.issueId,
    reason: "Workbench Preview accepted asset-slice repair for a localized visual diff."
  };
  return {
    id: `ovr_diff_${safeName(issue.issueId)}_${diffRepairOverrideSuffix(type, payload)}`,
    type,
    target: deriveDiffRepairTarget(type, payload, sourceNodeId),
    payload,
    status: "active",
    createdBy: actor,
    createdAt: now,
    scope: "snapshot"
  };
}

function selectDiffRepairSuggestion(issue, sourceNodeId) {
  const fixes = Array.isArray(issue.suggestedFixes) ? issue.suggestedFixes : [];
  for (const fix of fixes) {
    const type = stringValue(fix?.type);
    if (!type || !overrideTypes.has(type)) continue;
    const payload = fix?.payload && typeof fix.payload === "object" && !Array.isArray(fix.payload) ? { ...fix.payload } : {};
    payload.sourceNodeId = stringValue(payload.sourceNodeId) ?? sourceNodeId;
    payload.diffIssueId = stringValue(payload.diffIssueId) ?? stringValue(issue.issueId);
    payload.reason = stringValue(payload.reason) ?? diffRepairReason(type, payload);
    return { type, payload };
  }
  return undefined;
}

function deriveDiffRepairTarget(type, payload, sourceNodeId) {
  if (type === "asset_strategy_override") {
    return {
      kind: "asset",
      assetId: stringValue(payload.assetId),
      sourceNodeId: stringValue(payload.sourceNodeId) ?? sourceNodeId
    };
  }
  const targetNodeId = stringValue(payload.targetNodeId);
  if (targetNodeId && type !== "text_calibration_override") return { kind: "normalized_node", normalizedNodeId: targetNodeId };
  return { kind: "source_node", sourceNodeId: stringValue(payload.sourceNodeId) ?? sourceNodeId };
}

function diffRepairOverrideSuffix(type, payload) {
  if (type === "render_strategy_override" && stringValue(payload.strategy) === "asset_slice") return "asset_slice";
  if (type === "render_strategy_override" && stringValue(payload.strategy) === "frame_screenshot_asset") return "frame_fallback";
  if (type === "text_calibration_override") return "text_calibration";
  if (type === "asset_strategy_override") return "asset_strategy";
  if (type === "layout_strategy_override") return "layout_strategy";
  return safeName(type);
}

function diffRepairReason(type, payload) {
  if (type === "render_strategy_override" && stringValue(payload.strategy) === "asset_slice") {
    return "Workbench Preview accepted asset-slice repair for a localized visual diff.";
  }
  if (type === "text_calibration_override") {
    return "Workbench Preview accepted text calibration repair for a localized visual diff.";
  }
  return "Workbench Preview accepted a suggested repair for a localized visual diff.";
}

async function readWorkbenchFormatSummary(artifactDir) {
  const candidates = [
    ["flutter_preview_format_report.json", "flutter_preview_format_report.json"],
    ["format_report.json", "format_report.json"],
    ["dart_format_report.json", "dart_format_report.json"]
  ];
  for (const [file, source] of candidates) {
    const summary = normalizeFormatSummary(await readOptionalJson(resolve(artifactDir, file), undefined), source);
    if (summary) return summary;
  }
  return undefined;
}

async function readWorkbenchAnalyzeSummary(artifactDir) {
  const candidates = [
    ["flutter_analyze_report.json", "flutter_analyze_report.json"],
    ["analyze_report.json", "analyze_report.json"],
    ["flutter_preview_analyze_report.json", "flutter_preview_analyze_report.json"],
    ["flutter_preview_capture_report.json", "flutter_preview_capture_report.json"]
  ];
  for (const [file, source] of candidates) {
    const summary = normalizeAnalyzeSummary(await readOptionalJson(resolve(artifactDir, file), undefined), source);
    if (summary) return summary;
  }
  return undefined;
}

function normalizeFormatSummary(value, source) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value;
  const statusValue = stringValue(raw.status)?.toLowerCase();
  const exitCode = numberValue(raw.exitCode);
  const stderr = stringValue(raw.stderr);
  const status =
    statusValue === "success" || exitCode === 0
      ? "success"
      : statusValue === "skipped"
        ? "skipped"
        : statusValue === "failed" || statusValue === "error" || statusValue === "failure" || (exitCode ?? 0) > 0
          ? "failed"
          : "unknown";
  return {
    status,
    source,
    command: stringValue(raw.command),
    stdout: stringValue(raw.stdout),
    stderr,
    raw
  };
}

function normalizeAnalyzeSummary(value, source) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const raw = value;
  const summary =
    raw.summary && typeof raw.summary === "object" && !Array.isArray(raw.summary)
      ? raw.summary
      : raw.analyze && typeof raw.analyze === "object" && !Array.isArray(raw.analyze)
        ? raw.analyze
        : raw;
  const diagnostics = Array.isArray(raw.diagnostics) ? raw.diagnostics : Array.isArray(raw.issues) ? raw.issues : [];
  const diagnosticErrors = diagnostics.filter((entry) => stringValue(entry?.severity) === "ERROR" || stringValue(entry?.severity) === "error").length;
  const diagnosticWarnings = diagnostics.filter((entry) => stringValue(entry?.severity) === "WARNING" || stringValue(entry?.severity) === "warning").length;
  const output = [raw.stdout, raw.stderr, raw.output, raw.analyzerOutput, raw.analyzeOutput]
    .map((entry) => (typeof entry === "string" ? entry : ""))
    .filter(Boolean)
    .join("\n");
  const parsed = parseAnalyzeOutput(output);
  return {
    errors:
      numberValue(summary.errors) ??
      numberValue(summary.errorCount) ??
      numberValue(raw.errorCount) ??
      (diagnostics.length > 0 ? diagnosticErrors : parsed.errors),
    warnings:
      numberValue(summary.warnings) ??
      numberValue(summary.warningCount) ??
      numberValue(raw.warningCount) ??
      (diagnostics.length > 0 ? diagnosticWarnings : parsed.warnings),
    source,
    stdout: stringValue(raw.stdout),
    stderr: stringValue(raw.stderr),
    raw
  };
}

function parseAnalyzeOutput(output) {
  const result = { errors: 0, warnings: 0 };
  if (!output.trim()) return result;
  for (const line of output.split(/\r?\n/)) {
    const lower = line.toLowerCase();
    const errorSummary = lower.match(/\b(\d+)\s+errors?\b/);
    const warningSummary = lower.match(/\b(\d+)\s+warnings?\b/);
    if (errorSummary) result.errors = Math.max(result.errors, Number(errorSummary[1]));
    if (warningSummary) result.warnings = Math.max(result.warnings, Number(warningSummary[1]));
    if (/\berror\s*[•:-]/.test(lower) || /:\s*error\s*$/.test(lower)) result.errors += 1;
    if (/\bwarning\s*[•:-]/.test(lower) || /:\s*warning\s*$/.test(lower)) result.warnings += 1;
  }
  return result;
}

function deriveTarget(type, task, payload) {
  const target = task.target ?? {};
  const firstSourceNodeId = stringArray(payload.sourceNodeIds)[0] ?? stringArray(target.sourceNodeIds)[0] ?? stringValue(payload.sourceNodeId);
  if (type.startsWith("token_")) {
    return { kind: "token", tokenName: stringValue(payload.tokenName) ?? stringValue(target.tokenName) };
  }
  if (type === "font_mapping_override") {
    return { kind: "token", tokenName: stringValue(payload.tokenName) ?? stringValue(target.tokenName) };
  }
  if (type === "asset_strategy_override") {
    return {
      kind: "asset",
      assetId: stringValue(target.assetId) ?? stringValue(payload.assetId),
      sourceNodeId: stringValue(payload.sourceNodeId) ?? firstSourceNodeId
    };
  }
  if (type === "i18n_key_override") {
    return {
      kind: "i18n_message",
      messageKey: stringValue(target.messageKey) ?? stringValue(payload.messageKey) ?? stringValue(payload.key),
      sourceNodeId: stringValue(payload.sourceNodeId) ?? firstSourceNodeId
    };
  }
  const normalizedNodeId = stringValue(payload.targetNodeId) ?? stringValue(target.normalizedNodeId);
  if (normalizedNodeId) return { kind: "normalized_node", normalizedNodeId };
  if (firstSourceNodeId) return { kind: "source_node", sourceNodeId: firstSourceNodeId };
  return { kind: "page" };
}

function normalizeSuggestedPayload(type, task, payload) {
  const next = { ...payload };
  const target = task.target ?? {};
  if (type === "token_rename_override") {
    const tokenName = stringValue(next.tokenName) ?? stringValue(target.tokenName);
    if (tokenName && stringValue(next.action) === "keep") {
      next.from = tokenName;
      next.to = tokenName;
    }
  }
  if (type === "font_mapping_override") {
    const tokenName = stringValue(next.tokenName) ?? stringValue(target.tokenName);
    if (tokenName) next.tokenName = tokenName;
    const sourceNodeIds = stringArray(next.sourceNodeIds);
    const targetSourceNodeIds = stringArray(target.sourceNodeIds);
    if (sourceNodeIds.length === 0 && targetSourceNodeIds.length > 0) next.sourceNodeIds = targetSourceNodeIds;
  }
  if (type === "flutter_component_mapping_override" && !stringValue(next.componentId)) {
    const componentId = stringValue(target.candidateId);
    if (componentId) next.componentId = componentId;
  }
  if (type === "i18n_key_override" && !stringValue(next.key)) {
    const key = stringValue(target.messageKey);
    if (key) next.key = key;
  }
  if ((type === "layout_strategy_override" || type === "render_strategy_override") && stringValue(next.targetNodeId) == null) {
    const targetNodeId = stringValue(target.normalizedNodeId);
    if (targetNodeId) next.targetNodeId = targetNodeId;
  }
  return next;
}

function maybeDisableStaleOverride(overrideSet, suggestion, now) {
  const payload = suggestion?.payload ?? {};
  const overrideId = stringValue(payload.overrideId);
  if (stringValue(payload.action) !== "disable_stale_override" || !overrideId) return undefined;
  const entry = overrideSet.overrides.find((candidate) => candidate.id === overrideId);
  if (!entry) throw new Error(`Cannot disable missing override: ${overrideId}`);
  entry.status = "disabled";
  entry.updatedAt = now;
  return { overrideId, disabled: true };
}

function buildTaskStatusReport(reviewTasks, generatedAt) {
  const byPriority = { P0: 0, P1: 0, P2: 0 };
  const byType = {};
  const blockedReasons = [];
  for (const task of reviewTasks) {
    if (task?.status !== "open") continue;
    if (task.priority === "P0" || task.priority === "P1" || task.priority === "P2") {
      byPriority[task.priority] += 1;
    }
    if (typeof task.type === "string" && task.type.length > 0) {
      byType[task.type] = (byType[task.type] ?? 0) + 1;
    }
    if (task.priority === "P0") blockedReasons.push(stringValue(task.title) ?? task.id);
  }
  const open = reviewTasks.filter((task) => task?.status === "open").length;
  return {
    version: "0.1.0",
    generatedAt,
    total: reviewTasks.length,
    open,
    byPriority,
    byType,
    codegenWriteBlocked: blockedReasons.length > 0,
    blockedReasons
  };
}

function normalizePresetResource(entry) {
  if (typeof entry === "string") return { family: entry, path: "" };
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
  const family = stringValue(entry.family) ?? stringValue(entry.name);
  if (!family) return undefined;
  return {
    family,
    path: stringValue(entry.path) ?? "",
    weight: stringValue(entry.weight) ?? "",
    style: stringValue(entry.style) ?? ""
  };
}

function projectElementDisplayValue(entry) {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return "";
  if (typeof entry.value === "string" || typeof entry.value === "number") return String(entry.value);
  const parts = [
    stringValue(entry.fontFamily),
    numberValue(entry.fontSize) ? `${numberValue(entry.fontSize)}px` : undefined,
    numberValue(entry.lineHeight) ? `${numberValue(entry.lineHeight)}px` : undefined
  ].filter(Boolean);
  return parts.join(" / ");
}

async function readProjectPageEntry(pageDir, current) {
  const snapshot = await readOptionalJson(resolve(pageDir, "local_api_snapshot_report.json"), {});
  const rawScene = await readOptionalJson(resolve(pageDir, "raw_figma_scene.json"), {});
  const rawSource = rawScene?.source ?? {};
  const taskStatus = await readOptionalJson(resolve(pageDir, "task_status_report.json"), {});
  const normalized = await readOptionalJson(resolve(pageDir, "reviewed_normalized_design_ir.json"), undefined) ??
    await readOptionalJson(resolve(pageDir, "normalized_design_ir.json"), {});
  const tree = normalized?.tree ?? {};
  const viewport = rawSource.viewport ?? normalized?.source?.viewport ?? {};
  const width = numberValue(viewport.width);
  const height = numberValue(viewport.height);
  const openTasks = numberValue(taskStatus.open) ?? 0;
  const blocked = Boolean(taskStatus.codegenWriteBlocked);
  return {
    name: stringValue(snapshot.pageName) ?? stringValue(rawSource.pageName) ?? basename(pageDir),
    artifactRoot: artifactRootForDir(pageDir),
    current,
    status: blocked ? "blocked" : openTasks > 0 ? "review" : "ready",
    frameName: stringValue(rawSource.selectedNodeName) ?? stringValue(tree.name) ?? stringValue(rawSource.frameName),
    frameNodeId: stringValue(rawSource.frameNodeId),
    updatedAt: stringValue(snapshot.savedAt) ?? stringValue(snapshot.generatedAt),
    viewport: width && height ? { width, height } : undefined,
    openTasks
  };
}

function normalizePrototypeFlow(value) {
  const flow = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    version: "0.1.0",
    updatedAt: stringValue(flow.updatedAt),
    links: asArray(flow.links)
      .map((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return undefined;
        const fromPage = stringValue(entry.fromPage);
        const toPage = stringValue(entry.toPage);
        if (!fromPage || !toPage) return undefined;
        const trigger = stringValue(entry.trigger) ?? "tap";
        return {
          id: stringValue(entry.id) ?? `proto_${safeName(fromPage)}_${safeName(toPage)}_${safeName(trigger)}`,
          fromPage,
          toPage,
          trigger,
          note: stringValue(entry.note) ?? ""
        };
      })
      .filter(Boolean)
  };
}

function artifactRootForDir(dir) {
  return `/${relative(root, dir).replaceAll(sep, "/")}`;
}

function resolveArtifactRoot(value) {
  if (!value || value === "selected directory") {
    throw new Error("This artifact source cannot be modified by the local server.");
  }
  const normalized = value.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized.startsWith("artifacts/")) {
    throw new Error("Workbench can only modify artifact directories under /artifacts.");
  }
  const artifactDir = resolve(root, normalized);
  const relation = relative(root, artifactDir);
  if (relation.startsWith(`..${sep}`) || relation === ".." || relation === "") {
    throw new Error("Artifact root must stay inside the workspace.");
  }
  return artifactDir;
}

function resolveLocalPath(value) {
  if (!value) throw new Error("Missing local path.");
  return resolve(root, value);
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  return text.trim() ? JSON.parse(text) : {};
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readOptionalJson(path, fallback) {
  try {
    return await readJson(path);
  } catch {
    return fallback;
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function writeText(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, "utf8");
}

async function readFirstJson(paths) {
  const attempted = [];
  for (const path of paths) {
    attempted.push(path);
    try {
      return await readJson(path);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  throw new Error(`Missing required JSON artifact. Tried: ${attempted.join(", ")}`);
}

async function readTextFilesRecursively(rootPath) {
  const files = {};
  async function walk(dir, prefix) {
    const entries = await readdir(dir, { withFileTypes: true });
    await Promise.all(
      entries.map(async (entry) => {
        const fullPath = resolve(dir, entry.name);
        const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          await walk(fullPath, relativePath);
        } else if (entry.isFile()) {
          files[relativePath] = await readFile(fullPath, "utf8");
        }
      })
    );
  }
  await walk(rootPath, "");
  return files;
}

async function readExistingProjectFiles(projectPath, paths) {
  const files = {};
  await Promise.all(
    paths.map(async (path) => {
      try {
        files[path] = await readFile(resolve(projectPath, path), "utf8");
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    })
  );
  return files;
}

async function readGeneratedFiles(generatedRoot) {
  const files = await readTextFilesRecursively(generatedRoot);
  return Object.entries(files)
    .map(([path, content]) => ({ path, content }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function sendJson(response, status, value) {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, HEAD, POST, OPTIONS",
    "access-control-allow-headers": "content-type"
  });
  if (status === 204) {
    response.end();
  } else {
    response.end(`${JSON.stringify(value, null, 2)}\n`);
  }
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stringValue(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : [];
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function safeName(value) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "item";
}

function parseArgs(values) {
  const result = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (value === "--port" || value === "--host" || value === "--artifacts") {
      result[value.slice(2)] = values[index + 1];
      index += 1;
    }
  }
  return result;
}
