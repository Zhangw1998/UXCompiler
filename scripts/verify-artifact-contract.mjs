import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { assertReviewTaskContract } from "./review-task-contract.mjs";

const root = resolve(process.argv[2] ?? "artifacts/sample");

const requiredJsonFiles = [
  "raw_figma_scene.json",
  "extraction_report.json",
  "canonical_scene.json",
  "canonicalization_report.json",
  "node_mapping.json",
  "inferred_tokens.json",
  "token_usage_map.json",
  "regions.json",
  "layout_candidates.json",
  "layout_decisions.json",
  "asset_manifest.json",
  "i18n_manifest.json",
  "normalized_design_ir.json",
  "visual_ir.json",
  "node_pixel_map.json",
  "semantic_ir.json",
  "uplift_decisions.json",
  "uplift_diff_report.json",
  "semantic_labels.json",
  "normalization_report.json",
  "render_strategy_manifest.json",
  "fidelity_generation_manifest.json",
  "visual_diff_report.json",
  "repair_patch.json",
  "repair_iteration_log.json",
  "compile_manifest.json"
];

assert.equal(existsSync(root), true, `${root} must exist before artifact contract verification.`);

const parsedJsonFiles = new Map();
for (const file of findJsonFiles(root)) {
  const artifactPath = relative(root, file);
  parsedJsonFiles.set(artifactPath, readJson(artifactPath));
}

for (const file of requiredJsonFiles) {
  assert.equal(parsedJsonFiles.has(file), true, `Missing required JSON artifact: ${file}`);
}

const raw = json("raw_figma_scene.json");
const extractionReport = json("extraction_report.json");
const canonical = json("canonical_scene.json");
const canonicalizationReport = json("canonicalization_report.json");
const mapping = json("node_mapping.json");
const tokens = json("inferred_tokens.json");
const regions = json("regions.json");
const layoutCandidates = json("layout_candidates.json");
const layoutDecisions = json("layout_decisions.json");
const assetManifest = json("asset_manifest.json");
const i18nManifest = json("i18n_manifest.json");
const normalized = json("normalized_design_ir.json");
const visualIR = json("visual_ir.json");
const nodePixelMap = json("node_pixel_map.json");
const semanticLabels = json("semantic_labels.json");
const semanticIR = json("semantic_ir.json");
const upliftDecisions = json("uplift_decisions.json");
const upliftDiffReport = json("uplift_diff_report.json");
const normalizationReport = json("normalization_report.json");
const renderStrategyManifest = json("render_strategy_manifest.json");
const fidelityManifest = json("fidelity_generation_manifest.json");
const visualDiffReport = json("visual_diff_report.json");
const repairPatch = json("repair_patch.json");
const repairIterationLog = json("repair_iteration_log.json");
const compileManifest = json("compile_manifest.json");
const materializedAssetReport = parsedJsonFiles.get("materialized_assets_report.json");

const rawSourceNodeIds = new Set();
walkRawNode(raw.root, (node) => rawSourceNodeIds.add(node.id));
const canonicalIds = new Set();
walkCanonicalNode(canonical.root, (node) => canonicalIds.add(node.id));
const normalizedIds = new Set();
walkNormalizedNode(normalized.tree, (node) => normalizedIds.add(node.id));
const traceableIds = new Set([...rawSourceNodeIds, ...canonicalIds, ...normalizedIds]);

assert.equal(rawSourceNodeIds.has(canonical.root.sourceNodeId), true, "canonical root must trace to raw root.");
assert.equal(mapping.rawToCanonical[raw.root.id]?.includes(canonical.root.id), true, "node mapping must trace raw root to canonical root.");
assert.equal(semanticIR.normalizedDesignIR.tree.id, normalized.tree.id, "semantic_ir must embed the normalized IR baseline.");

assertRawExtractionContract(raw, extractionReport);
assertCanonicalMapping(rawSourceNodeIds, canonicalIds, mapping);
assertCanonicalizationReport(rawSourceNodeIds, canonicalIds, canonicalizationReport);
assertSourceRefs(rawSourceNodeIds, "inferred_tokens.colors", tokens.colors, (entry) => entry.sourceNodeIds ?? []);
assertSourceRefs(rawSourceNodeIds, "inferred_tokens.spacing", tokens.spacing, (entry) => entry.sourceNodeIds ?? []);
assertSourceRefs(rawSourceNodeIds, "inferred_tokens.typography", tokens.typography, (entry) => entry.sourceNodeIds ?? []);
assertSourceRefs(rawSourceNodeIds, "inferred_tokens.radii", tokens.radii, (entry) => entry.sourceNodeIds ?? []);
assertSourceRefs(rawSourceNodeIds, "inferred_tokens.shadows", tokens.shadows, (entry) => entry.sourceNodeIds ?? []);
assertSourceRefs(rawSourceNodeIds, "regions", regions, (entry) => entry.sourceNodeIds ?? []);
assertLayoutArtifacts(rawSourceNodeIds, traceableIds, layoutCandidates, layoutDecisions);
assertSourceRefs(rawSourceNodeIds, "asset_manifest.assets", assetManifest.assets, (entry) => [entry.sourceNodeId]);
assertSourceRefs(rawSourceNodeIds, "i18n_manifest.messages", i18nManifest.messages, (entry) => [entry.sourceNodeId]);
assertI18nManifestWarnings(rawSourceNodeIds, i18nManifest, "i18n_manifest");
for (const optionalI18nPath of ["reviewed_i18n_manifest.json", "final_i18n_manifest.json"]) {
  if (parsedJsonFiles.has(optionalI18nPath)) assertI18nManifestWarnings(rawSourceNodeIds, parsedJsonFiles.get(optionalI18nPath), optionalI18nPath);
}
assertSourceRefs(rawSourceNodeIds, "semantic_labels.regions", semanticLabels.regions, (entry) => entry.sourceNodeIds ?? []);
assertSourceRefs(rawSourceNodeIds, "semantic_labels.nodes", semanticLabels.nodes, (entry) => entry.sourceNodeIds ?? []);
assertSourceRefs(rawSourceNodeIds, "semantic_labels.assets", semanticLabels.assets, (entry) => [entry.sourceNodeId]);
assertSourceRefs(rawSourceNodeIds, "semantic_labels.i18n", semanticLabels.i18n, (entry) => [entry.sourceNodeId]);
assertSourceRefs(rawSourceNodeIds, "render_strategy_manifest.regions", renderStrategyManifest.regions, (entry) => entry.sourceNodeIds ?? []);
assertVisibleTextI18nCoverage(canonical, i18nManifest);
assertAssetManifestPaths(assetManifest, materializedAssetReport);
assertAcceptedUpliftsHaveDiffEvidence(upliftDecisions, upliftDiffReport, semanticIR);
assertVisualTraceability(rawSourceNodeIds, visualIR, nodePixelMap);
if (parsedJsonFiles.has("review_tasks.json")) {
  assertReviewTaskArtifacts(reviewTaskSourceNodeIds(rawSourceNodeIds, parsedJsonFiles.get("node_remap_report.json")), normalizedIds, parsedJsonFiles.get("review_tasks.json"));
}

walkNormalizedNode(normalized.tree, (node) => {
  assert.ok(node.sourceNodeIds.length > 0, `Normalized node ${node.id} must include sourceNodeIds.`);
  for (const sourceNodeId of node.sourceNodeIds) {
    assert.equal(rawSourceNodeIds.has(sourceNodeId), true, `Normalized node ${node.id} references unknown sourceNodeId ${sourceNodeId}.`);
  }
});

for (const issue of normalizationReport.issues ?? []) {
  assert.ok(issue.message, `Normalization issue ${issue.type} must include a message.`);
  for (const sourceNodeId of issue.sourceNodeIds ?? []) {
    assert.equal(traceableIds.has(sourceNodeId), true, `Normalization issue ${issue.type} references untraceable id ${sourceNodeId}.`);
  }
}

for (const decision of fidelityManifest.renderDecisions ?? []) {
  assert.equal(rawSourceNodeIds.has(decision.sourceNodeId), true, `Render decision references unknown sourceNodeId ${decision.sourceNodeId}.`);
  assert.ok(decision.reason, `Render decision for ${decision.sourceNodeId} must include a reason.`);
}

for (const fallback of normalized.fallbacks ?? []) {
  assert.ok(fallback.reason, `Fallback for ${fallback.nodeId} must include a reason.`);
  assert.ok(fallback.strategy, `Fallback for ${fallback.nodeId} must include a strategy.`);
}

assertConfidenceTree(parsedJsonFiles);
assertScore(normalized.confidence.overall, "normalized.confidence.overall");
assertScore(normalized.confidence.tokens, "normalized.confidence.tokens");
assertScore(normalized.confidence.layout, "normalized.confidence.layout");
assertScore(normalized.confidence.components, "normalized.confidence.components");
assertScore(normalizationReport.score.overall, "normalization_report.score.overall");
assertScore(normalizationReport.score.assets, "normalization_report.score.assets");

for (const artifactPath of compileManifest.artifacts ?? []) {
  const fullPath = resolve(root, artifactPath);
  assert.equal(existsSync(fullPath), true, `compile_manifest references missing artifact ${artifactPath}.`);
}

assert.deepEqual(renderStrategyManifest.viewport, normalized.source.viewport, "render strategy viewport must match normalized viewport.");
assert.deepEqual(visualDiffReport.environment.viewport, normalized.source.viewport, "visual diff viewport must match normalized viewport.");
assert.equal(typeof visualDiffReport.environment.dpr, "number", "visual diff report must record DPR.");
assert.ok(Array.isArray(visualDiffReport.environment.fonts), "visual diff report must record font profile.");
assert.equal(typeof visualDiffReport.environment.flutterVersion, "string", "visual diff report must record Flutter version.");
assert.ok(visualDiffReport.environment.flutterVersion.length > 0, "visual diff Flutter version must not be empty.");
assert.ok(["light", "dark"].includes(visualDiffReport.environment.themeBrightness), "visual diff report must record theme brightness.");
assert.equal(typeof visualDiffReport.environment.locale, "string", "visual diff report must record locale.");
assert.ok(visualDiffReport.environment.locale.length > 0, "visual diff locale must not be empty.");
assert.equal(typeof visualDiffReport.environment.textScaleFactor, "number", "visual diff report must record text scale factor.");
assert.ok(visualDiffReport.environment.textScaleFactor > 0, "visual diff text scale factor must be positive.");
assert.deepEqual(
  Object.keys(visualDiffReport.environment.safeArea ?? {}).sort(),
  ["bottom", "left", "right", "top"],
  "visual diff report must record safe area insets."
);
assert.equal(typeof visualDiffReport.environment.renderer, "string", "visual diff report must record renderer.");
assertScore(visualDiffReport.page.score.visualScore, "visual_diff_report.page.score.visualScore");
assertScore(visualDiffReport.page.score.pixelDiffRatio, "visual_diff_report.page.score.pixelDiffRatio");
assertRepairArtifacts(repairPatch, repairIterationLog);

console.log("artifact contract verification passed");

function json(path) {
  return parsedJsonFiles.get(path);
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

function findJsonFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) files.push(...findJsonFiles(fullPath));
    else if (entry.endsWith(".json")) files.push(fullPath);
  }
  return files;
}

function walkRawNode(node, visit) {
  visit(node);
  for (const child of node.children ?? []) walkRawNode(child, visit);
}

function walkCanonicalNode(node, visit) {
  visit(node);
  for (const child of node.children ?? []) walkCanonicalNode(child, visit);
}

function assertVisibleTextI18nCoverage(canonicalScene, manifest) {
  const messagesBySourceNodeId = new Map();
  for (const message of manifest.messages ?? []) {
    assert.ok(message.key, `i18n message for ${message.sourceNodeId} must include a key.`);
    assert.ok(message.description, `i18n message ${message.key} must include a description.`);
    messagesBySourceNodeId.set(message.sourceNodeId, message);
  }
  const nonI18nSourceIds = new Set(
    (manifest.warnings ?? [])
      .filter((warning) => warning.type === "non_i18n" && warning.message)
      .map((warning) => warning.sourceNodeId)
      .filter(Boolean)
  );
  walkCanonicalNode(canonicalScene.root, (node) => {
    if (node.flags?.isInvisible || node.flags?.isZeroSize || node.canonicalType !== "text") return;
    const content = node.text?.content?.trim() ?? "";
    if (!content) return;
    const message = messagesBySourceNodeId.get(node.sourceNodeId);
    assert.ok(
      message || nonI18nSourceIds.has(node.sourceNodeId),
      `Visible text ${node.sourceNodeId} must have an i18n message or explicit non_i18n reason.`
    );
    if (message) assert.equal(message.value, content, `i18n message ${message.key} must match visible text ${node.sourceNodeId}.`);
  });
}

function assertI18nManifestWarnings(rawSourceNodeIds, manifest, label) {
  assert.ok(Array.isArray(manifest.messages), `${label}.messages must be an array.`);
  assert.ok(Array.isArray(manifest.warnings), `${label}.warnings must be an array.`);
  for (const warning of manifest.warnings) {
    if (warning.type !== "non_i18n") continue;
    assert.ok(warning.sourceNodeId, `${label} non_i18n warning must include sourceNodeId.`);
    assert.equal(rawSourceNodeIds.has(warning.sourceNodeId), true, `${label} non_i18n warning references unknown sourceNodeId ${warning.sourceNodeId}.`);
    assert.ok(warning.message, `${label} non_i18n warning must include a reason message.`);
  }
}

function assertReviewTaskArtifacts(rawSourceNodeIds, normalizedIds, tasks) {
  assertReviewTaskContract(tasks, "review_tasks.json");
  for (const task of tasks) {
    if (task.target.normalizedNodeId) {
      assert.equal(
        normalizedIds.has(task.target.normalizedNodeId),
        true,
        `${task.id}: target references unknown normalizedNodeId ${task.target.normalizedNodeId}`
      );
    }
    for (const sourceNodeId of task.target.sourceNodeIds ?? []) {
      assert.equal(rawSourceNodeIds.has(sourceNodeId), true, `${task.id}: target references unknown sourceNodeId ${sourceNodeId}`);
    }
    if (task.status === "closed") {
      assert.ok(task.closedReason || task.closeReason, `${task.id}: closed task must include a closed reason.`);
    }
  }
}

function reviewTaskSourceNodeIds(rawSourceNodeIds, nodeRemapReport) {
  const sourceNodeIds = new Set(rawSourceNodeIds);
  for (const match of nodeRemapReport?.matches ?? []) {
    if (match.oldSourceNodeId) sourceNodeIds.add(match.oldSourceNodeId);
    if (match.newSourceNodeId) sourceNodeIds.add(match.newSourceNodeId);
  }
  for (const sourceNodeId of nodeRemapReport?.addedSourceNodeIds ?? []) sourceNodeIds.add(sourceNodeId);
  for (const sourceNodeId of nodeRemapReport?.removedSourceNodeIds ?? []) sourceNodeIds.add(sourceNodeId);
  for (const staleOverride of nodeRemapReport?.staleOverrides ?? []) {
    if (staleOverride.target?.sourceNodeId) sourceNodeIds.add(staleOverride.target.sourceNodeId);
  }
  return sourceNodeIds;
}

function assertRawExtractionContract(rawScene, report) {
  assert.equal(report.source.rootNodeId, rawScene.root.id, "extraction_report source rootNodeId must match raw root.");
  assert.equal(report.source.rootNodeName, rawScene.root.name, "extraction_report source rootNodeName must match raw root.");
  assert.deepEqual(report.source.viewport, rawScene.source.viewport, "extraction_report viewport must match raw scene viewport.");
  if (rawScene.source.viewport && rawScene.root.absoluteBoundingBox) {
    assert.equal(rawScene.source.viewport.width, rawScene.root.absoluteBoundingBox.width, "raw root viewport width must match root bounds.");
    assert.equal(rawScene.source.viewport.height, rawScene.root.absoluteBoundingBox.height, "raw root viewport height must match root bounds.");
  }

  const stats = {
    nodes: 0,
    textNodes: 0,
    vectorNodes: 0,
    imageNodes: 0,
    componentInstances: 0,
    invisibleNodes: 0,
    missingBounds: 0
  };
  const warningKeys = new Set((report.warnings ?? []).map((warning) => `${warning.nodeId}:${warning.type}`));
  walkRawNode(rawScene.root, (node) => {
    stats.nodes += 1;
    if (node.type === "TEXT") stats.textNodes += 1;
    if (["VECTOR", "BOOLEAN_OPERATION", "LINE", "POLYGON", "STAR"].includes(node.type)) stats.vectorNodes += 1;
    if (node.type === "IMAGE" || node.imageHash || rawImagePaints(node).length > 0) stats.imageNodes += 1;
    if (node.type === "INSTANCE" || node.componentId || node.componentKey) stats.componentInstances += 1;
    if (node.visible === false) stats.invisibleNodes += 1;
    if (!node.absoluteBoundingBox && !node.absoluteRenderBounds) {
      stats.missingBounds += 1;
      assert.equal(warningKeys.has(`${node.id}:invalid_bounds`), true, `Missing-bounds raw node ${node.id} must be reported.`);
    }
    if (node.absoluteBoundingBox) assertRawBounds(node.absoluteBoundingBox, `raw.${node.id}.absoluteBoundingBox`);
    if (node.absoluteRenderBounds) assertRawBounds(node.absoluteRenderBounds, `raw.${node.id}.absoluteRenderBounds`);
    if (node.opacity !== undefined) assertScore(node.opacity, `raw.${node.id}.opacity`);
    if (node.constraints !== undefined) {
      assert.equal(typeof node.constraints, "object", `raw.${node.id}.constraints must be an object.`);
      assert.ok(node.constraints !== null && !Array.isArray(node.constraints), `raw.${node.id}.constraints must be an object.`);
    }
    for (const effect of node.effects ?? []) {
      assert.equal(typeof effect, "object", `raw.${node.id}.effects entry must be an object.`);
      assert.ok(effect !== null && !Array.isArray(effect), `raw.${node.id}.effects entry must be an object.`);
    }
  });
  assert.deepEqual(report.stats, stats, "extraction_report stats must match raw scene contents.");
}

function assertCanonicalMapping(rawSourceNodeIds, canonicalIds, mapping) {
  for (const [rawSourceNodeId, mappedCanonicalIds] of Object.entries(mapping.rawToCanonical ?? {})) {
    assert.equal(rawSourceNodeIds.has(rawSourceNodeId), true, `node_mapping.rawToCanonical references unknown raw id ${rawSourceNodeId}.`);
    assert.ok(Array.isArray(mappedCanonicalIds), `node_mapping.rawToCanonical.${rawSourceNodeId} must be an array.`);
    for (const canonicalId of mappedCanonicalIds) {
      assert.equal(canonicalIds.has(canonicalId), true, `node_mapping.rawToCanonical.${rawSourceNodeId} references unknown canonical id ${canonicalId}.`);
    }
  }
  for (const canonicalId of canonicalIds) {
    const rawIds = mapping.canonicalToRaw?.[canonicalId];
    assert.ok(Array.isArray(rawIds) && rawIds.length > 0, `node_mapping.canonicalToRaw must include canonical id ${canonicalId}.`);
    for (const rawSourceNodeId of rawIds) {
      assert.equal(rawSourceNodeIds.has(rawSourceNodeId), true, `node_mapping.canonicalToRaw.${canonicalId} references unknown raw id ${rawSourceNodeId}.`);
    }
  }
}

function assertCanonicalizationReport(rawSourceNodeIds, canonicalIds, report) {
  assert.equal(typeof report.stats?.rawNodes, "number", "canonicalization_report.stats.rawNodes must be a number.");
  assert.equal(typeof report.stats?.canonicalNodes, "number", "canonicalization_report.stats.canonicalNodes must be a number.");
  assert.ok(report.stats.rawNodes > 0, "canonicalization_report.stats.rawNodes must be positive.");
  assert.ok(report.stats.canonicalNodes > 0, "canonicalization_report.stats.canonicalNodes must be positive.");
  for (const flattened of report.flattenedNodes ?? []) {
    assert.equal(rawSourceNodeIds.has(flattened.sourceNodeId), true, `flattened node references unknown sourceNodeId ${flattened.sourceNodeId}.`);
    assert.ok(flattened.reason, `flattened node ${flattened.sourceNodeId} must include a reason.`);
    assert.ok(Array.isArray(flattened.replacementCanonicalIds), `flattened node ${flattened.sourceNodeId} must list replacement canonical ids.`);
    for (const canonicalId of flattened.replacementCanonicalIds) {
      assert.equal(canonicalIds.has(canonicalId), true, `flattened node ${flattened.sourceNodeId} references unknown canonical id ${canonicalId}.`);
    }
  }
  for (const warning of report.warnings ?? []) {
    assert.equal(rawSourceNodeIds.has(warning.sourceNodeId), true, `canonicalization warning references unknown sourceNodeId ${warning.sourceNodeId}.`);
    assert.ok(warning.type, `canonicalization warning for ${warning.sourceNodeId} must include type.`);
    assert.ok(warning.message, `canonicalization warning for ${warning.sourceNodeId} must include message.`);
  }
}

function assertLayoutArtifacts(rawSourceNodeIds, traceableIds, candidates, decisions) {
  assert.ok(Array.isArray(candidates), "layout_candidates must be an array.");
  assert.ok(Array.isArray(decisions), "layout_decisions must be an array.");
  const decisionNodeIds = new Set(decisions.map((decision) => decision.nodeId));
  for (const candidate of candidates) {
    assert.equal(traceableIds.has(candidate.nodeId), true, `layout candidate references unknown nodeId ${candidate.nodeId}.`);
    assert.ok(Array.isArray(candidate.candidates) && candidate.candidates.length > 0, `layout candidate ${candidate.nodeId} must include options.`);
    for (const option of candidate.candidates) {
      assertScore(option.score, `layout_candidates.${candidate.nodeId}.${option.layout}.score`);
      assert.ok(Array.isArray(option.evidence) && option.evidence.length > 0, `layout candidate ${candidate.nodeId}.${option.layout} must include evidence.`);
    }
  }
  for (const decision of decisions) {
    assert.equal(traceableIds.has(decision.nodeId), true, `layout decision references unknown nodeId ${decision.nodeId}.`);
    assert.equal(decisionNodeIds.has(decision.nodeId), true, `layout decision ${decision.nodeId} must be addressable.`);
    assertSourceRefs(rawSourceNodeIds, `layout_decisions.${decision.nodeId}`, [decision], (entry) => entry.sourceNodeIds ?? []);
    assertScore(decision.score, `layout_decisions.${decision.nodeId}.score`);
    assertScore(decision.confidence, `layout_decisions.${decision.nodeId}.confidence`);
    assert.ok(Array.isArray(decision.evidence) && decision.evidence.length > 0, `layout decision ${decision.nodeId} must include evidence.`);
  }
}

function assertVisualTraceability(rawSourceNodeIds, visualIR, nodePixelMap) {
  assert.deepEqual(visualIR.source.viewport, json("normalized_design_ir.json").source.viewport, "visual_ir viewport must match normalized viewport.");
  walkVisualNode(visualIR.root, (node) => {
    if (!node.sourceNodeId) return;
    assert.equal(rawSourceNodeIds.has(node.sourceNodeId), true, `visual_ir ${node.type} references unknown sourceNodeId ${node.sourceNodeId}.`);
  });
  assert.ok(Array.isArray(nodePixelMap), "node_pixel_map must be an array.");
  for (const entry of nodePixelMap) {
    assert.equal(rawSourceNodeIds.has(entry.sourceNodeId), true, `node_pixel_map references unknown sourceNodeId ${entry.sourceNodeId}.`);
    assert.ok(entry.widgetPath, `node_pixel_map ${entry.sourceNodeId} must include widgetPath.`);
    assertBounds(entry.bounds, `node_pixel_map.${entry.sourceNodeId}.bounds`);
  }
}

function assertAssetManifestPaths(manifest, materializedReport) {
  const usedPaths = new Set();
  for (const asset of manifest.assets ?? []) {
    assert.ok(asset.id, `Asset for ${asset.sourceNodeId} must include id.`);
    assert.ok(asset.reason, `Asset ${asset.id} must include reason.`);
    assertScore(asset.confidence, `asset_manifest.assets.${asset.id}.confidence`);
    if (!asset.path) continue;
    assert.equal(asset.path.startsWith("assets/"), true, `Asset ${asset.id} path must stay under assets/: ${asset.path}`);
    assert.equal(asset.path.includes(".."), false, `Asset ${asset.id} path must not contain parent traversal.`);
    assert.equal(usedPaths.has(asset.path), false, `Asset path ${asset.path} must be unique.`);
    usedPaths.add(asset.path);
  }

  if (!materializedReport) return;
  for (const asset of materializedReport.materialized ?? []) {
    assert.equal(typeof asset.path, "string", "materialized asset must include path.");
    assert.equal(existsSync(resolve(root, asset.path)), true, `materialized asset is missing from artifact root: ${asset.path}`);
    assert.equal(
      existsSync(resolve(root, "flutter_preview", asset.path)),
      true,
      `materialized asset is missing from Flutter preview root: ${asset.path}`
    );
    assert.ok(asset.bytes > 0, `materialized asset ${asset.path} must record non-zero bytes.`);
  }
}

function assertAcceptedUpliftsHaveDiffEvidence(upliftDecisions, upliftDiffReport, semanticIR) {
  assert.ok(Array.isArray(upliftDecisions.decisions), "uplift_decisions.decisions must be an array.");
  assert.ok(Array.isArray(upliftDiffReport.comparisons), "uplift_diff_report.comparisons must be an array.");
  const accepted = upliftDecisions.decisions.filter((decision) => decision.accepted === true);
  if (accepted.length === 0) return;
  assert.equal(semanticIR.status, "uplift_ready", "semantic_ir.status must be uplift_ready when accepted uplift decisions exist.");
  for (const decision of accepted) {
    assertScore(decision.confidence, `uplift_decisions.${decision.regionId ?? decision.sourceNodeIds?.join("_")}.confidence`);
    assert.ok(decision.reason, `Accepted uplift ${decision.regionId ?? decision.sourceNodeIds?.join(",")} must include a reason.`);
    const comparison = findUpliftComparison(upliftDiffReport.comparisons, decision);
    assert.ok(
      comparison,
      `Accepted uplift ${decision.regionId ?? decision.sourceNodeIds?.join(",")} must have a matching diff comparison.`
    );
    const beforeScore = scoreValue(comparison.beforeScore ?? comparison.visualScoreBefore);
    const afterScore = scoreValue(comparison.afterScore ?? comparison.visualScoreAfter);
    const threshold = scoreValue(comparison.threshold ?? comparison.visualScoreThreshold ?? 0.99);
    assertScore(beforeScore, `uplift_diff_report.${decision.regionId ?? "comparison"}.beforeScore`);
    assertScore(afterScore, `uplift_diff_report.${decision.regionId ?? "comparison"}.afterScore`);
    assertScore(threshold, `uplift_diff_report.${decision.regionId ?? "comparison"}.threshold`);
    assert.ok(afterScore >= threshold, `Accepted uplift ${decision.regionId ?? ""} afterScore must meet threshold.`);
    assert.equal(comparison.accepted, true, `Accepted uplift ${decision.regionId ?? ""} diff comparison must be accepted.`);
  }
}

function assertRepairArtifacts(repairPatch, repairIterationLog) {
  assert.equal(typeof repairPatch.version, "string", "repair_patch.version must be present.");
  assert.equal(typeof repairPatch.generatedAt, "string", "repair_patch.generatedAt must be present.");
  assert.ok(["applied", "rolled_back", "proposed", "not_needed"].includes(repairPatch.status), "repair_patch.status must be known.");
  if (Array.isArray(repairPatch.patches)) {
    for (const patch of repairPatch.patches) {
      assert.equal(patch.target, "override_set", `repair patch ${patch.patchId ?? patch.issueId} must target override_set.`);
      assert.equal(patch.operation, "add_override", `repair patch ${patch.patchId ?? patch.issueId} must add an override.`);
      assert.ok(patch.override?.id, `repair patch ${patch.patchId ?? patch.issueId} must include override metadata.`);
      assert.equal(patch.rollback?.type, "disable_override", `repair patch ${patch.patchId ?? patch.issueId} must include rollback metadata.`);
      assert.equal(patch.rollback.overrideId, patch.override.id, `repair patch ${patch.patchId ?? patch.issueId} rollback must target its override.`);
    }
  } else {
    assert.ok(repairPatch.overrideId, "workbench repair_patch must include overrideId.");
    assert.ok(repairPatch.afterOverride?.id || repairPatch.rollbackReport, "workbench repair_patch must include applied override or rollback report.");
    assert.equal(repairPatch.rollback?.type, "disable_override", "workbench repair_patch must be rollbackable.");
    assert.equal(repairPatch.rollback.overrideId, repairPatch.overrideId, "workbench repair rollback must target the patch override.");
  }

  assert.equal(typeof repairIterationLog.version, "string", "repair_iteration_log.version must be present.");
  assert.ok(Array.isArray(repairIterationLog.iterations), "repair_iteration_log.iterations must be an array.");
  assert.ok(repairIterationLog.iterations.length > 0, "repair_iteration_log must record at least one iteration.");
}

function findUpliftComparison(comparisons, decision) {
  return comparisons.find((comparison) => {
    if (decision.regionId && comparison.regionId === decision.regionId) return true;
    const decisionSourceIds = new Set(decision.sourceNodeIds ?? []);
    if (decisionSourceIds.size === 0) return false;
    return (comparison.sourceNodeIds ?? []).some((sourceNodeId) => decisionSourceIds.has(sourceNodeId));
  });
}

function walkNormalizedNode(node, visit) {
  visit(node);
  for (const child of node.children ?? []) walkNormalizedNode(child, visit);
}

function walkVisualNode(node, visit) {
  visit(node);
  for (const child of node.children ?? []) walkVisualNode(child, visit);
  if (node.child) walkVisualNode(node.child, visit);
}

function assertSourceRefs(sourceIds, label, entries, selectIds) {
  assert.ok(Array.isArray(entries), `${label} must be an array.`);
  for (const entry of entries) {
    for (const sourceNodeId of selectIds(entry).filter(Boolean)) {
      assert.equal(sourceIds.has(sourceNodeId), true, `${label} references unknown sourceNodeId ${sourceNodeId}.`);
    }
  }
}

function assertBounds(bounds, label) {
  assert.equal(typeof bounds, "object", `${label} must be an object.`);
  assert.ok(bounds !== null && !Array.isArray(bounds), `${label} must be an object.`);
  for (const key of ["x", "y", "w", "h"]) {
    assert.equal(typeof bounds[key], "number", `${label}.${key} must be a number.`);
    assert.ok(Number.isFinite(bounds[key]), `${label}.${key} must be finite.`);
  }
  assert.ok(bounds.w >= 0, `${label}.w must not be negative.`);
  assert.ok(bounds.h >= 0, `${label}.h must not be negative.`);
}

function assertRawBounds(bounds, label) {
  assert.equal(typeof bounds, "object", `${label} must be an object.`);
  assert.ok(bounds !== null && !Array.isArray(bounds), `${label} must be an object.`);
  for (const key of ["x", "y", "width", "height"]) {
    assert.equal(typeof bounds[key], "number", `${label}.${key} must be a number.`);
    assert.ok(Number.isFinite(bounds[key]), `${label}.${key} must be finite.`);
  }
  assert.ok(bounds.width >= 0, `${label}.width must not be negative.`);
  assert.ok(bounds.height >= 0, `${label}.height must not be negative.`);
}

function rawImagePaints(node) {
  return [...(node.fills ?? []), ...(node.strokes ?? [])].filter((paint) => paint?.visible !== false && (paint?.type === "IMAGE" || Boolean(paint?.imageHash)));
}

function assertConfidenceTree(files) {
  for (const [artifactPath, value] of files.entries()) {
    walk(value, (node, path) => {
      if (path.endsWith(".confidence") && typeof node !== "object") assertScore(node, `${artifactPath}:${path}`);
    });
  }
}

function walk(value, visit, path = "$") {
  visit(value, path);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walk(entry, visit, `${path}[${index}]`));
    return;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) walk(child, visit, `${path}.${key}`);
  }
}

function assertScore(value, label) {
  assert.equal(typeof value, "number", `${label} must be a number.`);
  assert.ok(Number.isFinite(value), `${label} must be finite.`);
  assert.ok(value >= 0 && value <= 1, `${label} must be between 0 and 1.`);
}

function scoreValue(value) {
  return typeof value === "number" ? value : Number.NaN;
}
