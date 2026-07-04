#!/usr/bin/env node

import { createServer } from "node:http";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, extname, relative, resolve, sep } from "node:path";
import { createCodegenReview } from "../packages/codegen-review/dist/index.js";
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
    assetManifest: overrideResult.reviewedAssetManifest,
    i18nManifest: overrideResult.reviewedI18nManifest,
    fidelityGenerationManifest,
    overrideSet: overrideResult.overrideSet,
    staleOverrideReport: overrideResult.staleOverrideReport,
    visualDiffReport,
    flutterCapture: flutterCapture ? { status: flutterCapture.status, reason: flutterCapture.reason } : undefined
  });

  await writeJson(resolve(artifactDir, "override_set.json"), overrideResult.overrideSet);
  await writeJson(resolve(artifactDir, "reviewed_normalized_design_ir.json"), overrideResult.reviewedNormalizedDesignIR);
  await writeJson(resolve(artifactDir, "reviewed_asset_manifest.json"), overrideResult.reviewedAssetManifest);
  await writeJson(resolve(artifactDir, "reviewed_i18n_manifest.json"), overrideResult.reviewedI18nManifest);
  await writeJson(resolve(artifactDir, "reviewed_inferred_tokens.json"), overrideResult.reviewedInferredTokens);
  await writeJson(resolve(artifactDir, "reviewed_arb/app_en.arb"), overrideResult.reviewedArbFile);
  await writeJson(resolve(artifactDir, "override_conflict_report.json"), overrideResult.overrideConflictReport);
  await writeJson(resolve(artifactDir, "stale_override_report.json"), overrideResult.staleOverrideReport);
  await writeJson(resolve(artifactDir, "review_tasks.json"), reviewResult.reviewTasks);
  await writeJson(resolve(artifactDir, "task_status_report.json"), reviewResult.taskStatusReport);

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

async function applyWorkbenchTreeEdit(body) {
  const artifactDir = resolveArtifactRoot(stringValue(body.artifactRoot));
  const operation = body.operation;
  const actor = stringValue(body.actor) ?? "user";
  if (!operation || typeof operation !== "object" || Array.isArray(operation)) {
    throw new Error("Missing tree edit operation.");
  }
  const nowValue = new Date();
  const normalizedDesignIR = await readJson(resolve(artifactDir, "normalized_design_ir.json"));
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

  const rebuilt = await rebuildReviewedArtifacts(artifactDir, result.overrideSet, nowValue.toISOString());
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
  const existingProjectFiles = projectPath ? await readExistingProjectFiles(projectPath, Object.keys(flutterPreviewFiles)) : undefined;
  const result = createCodegenReview({
    normalizedDesignIR: await readFirstJson([
      resolve(artifactDir, "reviewed_normalized_design_ir.json"),
      resolve(artifactDir, "normalized_design_ir.json")
    ]),
    assetManifest: await readFirstJson([
      resolve(artifactDir, "final_asset_manifest.json"),
      resolve(artifactDir, "reviewed_asset_manifest.json"),
      resolve(artifactDir, "asset_manifest.json")
    ]),
    i18nManifest: await readFirstJson([
      resolve(artifactDir, "final_i18n_manifest.json"),
      resolve(artifactDir, "reviewed_i18n_manifest.json"),
      resolve(artifactDir, "i18n_manifest.json")
    ]),
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
    filesToCreate: result.filesToCreate.length,
    filesToModify: result.filesToModify.length,
    assetsToAdd: result.assetsToAdd.length,
    arbKeysToAdd: result.codegenReview.arbKeysToAdd.length
  };
  await writeJson(resolve(artifactDir, "workbench_codegen_review_report.json"), report);
  return {
    report,
    codegenReview: result.codegenReview
  };
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

  const rebuilt = await rebuildReviewedArtifacts(artifactDir, nextOverrideSet, now);
  const report = {
    version: "0.1.0",
    generatedAt: now,
    artifactRoot: `/${relative(root, artifactDir).replaceAll(sep, "/")}`,
    repairKind,
    issueId,
    overrideId: override.id,
    afterOpenTasks: rebuilt.reviewResult.taskStatusReport.open,
    overrideHash: rebuilt.overrideResult.overrideSet.hash
  };
  await writeJson(resolve(artifactDir, "diff_repair_report.json"), report);
  await writeJson(resolve(artifactDir, "workbench_diff_repair_report.json"), report);
  return {
    report,
    overrideSet: rebuilt.overrideResult.overrideSet,
    taskStatusReport: rebuilt.reviewResult.taskStatusReport,
    reviewTasks: rebuilt.reviewResult.reviewTasks
  };
}

async function rebuildReviewedArtifacts(artifactDir, overrideSet, now, reviewedPatch = {}) {
  const normalizedDesignIR = await readJson(resolve(artifactDir, "normalized_design_ir.json"));
  const assetManifest = await readJson(resolve(artifactDir, "asset_manifest.json"));
  const i18nManifest = await readJson(resolve(artifactDir, "i18n_manifest.json"));
  const inferredTokens = await readJson(resolve(artifactDir, "inferred_tokens.json"));
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
    assetManifest: reviewedAssetManifest,
    i18nManifest: reviewedI18nManifest,
    fidelityGenerationManifest,
    overrideSet: overrideResult.overrideSet,
    staleOverrideReport: overrideResult.staleOverrideReport,
    visualDiffReport,
    flutterCapture: flutterCapture ? { status: flutterCapture.status, reason: flutterCapture.reason } : undefined
  });
  await writeJson(resolve(artifactDir, "override_set.json"), overrideResult.overrideSet);
  await writeJson(resolve(artifactDir, "reviewed_normalized_design_ir.json"), reviewedNormalizedDesignIR);
  await writeJson(resolve(artifactDir, "reviewed_asset_manifest.json"), reviewedAssetManifest);
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
  return {
    id: `ovr_diff_${safeName(issue.issueId)}_asset_slice`,
    type: "render_strategy_override",
    target: { kind: "source_node", sourceNodeId },
    payload: {
      sourceNodeId,
      strategy: "asset_slice",
      diffIssueId: issue.issueId,
      reason: "Workbench Preview accepted asset-slice repair for a localized visual diff."
    },
    status: "active",
    createdBy: actor,
    createdAt: now,
    scope: "snapshot"
  };
}

function deriveTarget(type, task, payload) {
  const target = task.target ?? {};
  const firstSourceNodeId = stringArray(payload.sourceNodeIds)[0] ?? stringArray(target.sourceNodeIds)[0] ?? stringValue(payload.sourceNodeId);
  if (type.startsWith("token_")) {
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
