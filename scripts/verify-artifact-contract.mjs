import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { assertReviewTaskContract } from "./review-task-contract.mjs";

const root = resolve(process.argv[2] ?? "artifacts/sample");
const assetStrategyDirs = new Map([
  ["svg_icon", "assets/icons/"],
  ["image_asset", "assets/images/"],
  ["frame_screenshot", "assets/frames/"],
  ["decorative_slice", "assets/slices/"]
]);
const pathlessAssetStrategies = new Set(["real_text", "custom_painter", "flutter_shape", "ignored"]);
const assetFormats = new Map([
  ["svg", [".svg"]],
  ["png", [".png"]],
  ["webp", [".webp"]],
  ["jpg", [".jpg", ".jpeg"]]
]);

const requiredJsonFiles = [
  "raw_figma_scene.json",
  "extraction_report.json",
  "canonical_scene.json",
  "canonicalization_report.json",
  "node_mapping.json",
  "inferred_tokens.json",
  "token_usage_map.json",
  "token_confidence_report.json",
  "regions.json",
  "region_tree.json",
  "layout_candidates.json",
  "layout_decisions.json",
  "inferred_components.json",
  "component_instance_map.json",
  "component_confidence_report.json",
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
  "flutter_generation_manifest.json",
  "pubspec_patch.json",
  "visual_diff_report.json",
  "node_diff_report.json",
  "manual_review_report.json",
  "repair_patch.json",
  "repair_iteration_log.json",
  "compile_manifest.json"
];

const requiredCompileManifestArtifacts = [
  "raw_figma_scene.json",
  "extraction_report.json",
  "canonical_scene.json",
  "canonicalization_report.json",
  "node_mapping.json",
  "inferred_tokens.json",
  "token_usage_map.json",
  "token_confidence_report.json",
  "asset_manifest.json",
  "i18n_manifest.json",
  "arb/app_en.arb",
  "override_set.json",
  "reviewed_normalized_design_ir.json",
  "reviewed_asset_manifest.json",
  "reviewed_i18n_manifest.json",
  "final_asset_manifest.json",
  "final_i18n_manifest.json",
  "reviewed_inferred_tokens.json",
  "reviewed_arb/app_en.arb",
  "visual_ir.json",
  "fidelity_generation_manifest.json",
  "flutter_generation_manifest.json",
  "node_pixel_map.json",
  "review_tasks.json",
  "task_status_report.json",
  "flutter_preview/pubspec.yaml",
  "flutter_preview/lib/main.dart",
  "flutter_preview/lib/generated/fidelity/preview_page.dart",
  "regions.json",
  "region_tree.json",
  "layout_candidates.json",
  "layout_decisions.json",
  "inferred_components.json",
  "component_instance_map.json",
  "component_confidence_report.json",
  "semantic_labels.json",
  "semantic_ir.json",
  "uplift_decisions.json",
  "uplift_diff_report.json",
  "normalization_report.json",
  "render_strategy_manifest.json",
  "normalized_design_ir.json",
  "codegen_review.json",
  "files_to_create.json",
  "files_to_modify.json",
  "assets_to_add.json",
  "arb_patch.json",
  "pubspec.yaml.patch",
  "pubspec_patch.json",
  "merge_report.json",
  "incremental_sync_report.json",
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
const rawSchema = JSON.parse(readFileSync(resolve("schemas/raw_figma_scene.schema.json"), "utf8"));
const extractionReport = json("extraction_report.json");
const canonical = json("canonical_scene.json");
const canonicalizationReport = json("canonicalization_report.json");
const mapping = json("node_mapping.json");
const tokens = json("inferred_tokens.json");
const tokenUsageMap = json("token_usage_map.json");
const tokenConfidenceReport = json("token_confidence_report.json");
const regions = json("regions.json");
const regionTree = json("region_tree.json");
const layoutCandidates = json("layout_candidates.json");
const layoutDecisions = json("layout_decisions.json");
const inferredComponents = json("inferred_components.json");
const componentInstanceMap = json("component_instance_map.json");
const componentConfidenceReport = json("component_confidence_report.json");
const reviewTasks = json("review_tasks.json");
const taskStatusReport = json("task_status_report.json");
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
const flutterGenerationManifest = json("flutter_generation_manifest.json");
const pubspecPatch = json("pubspec_patch.json");
const visualDiffReport = json("visual_diff_report.json");
const nodeDiffReport = json("node_diff_report.json");
const manualReviewReport = json("manual_review_report.json");
const repairPatch = json("repair_patch.json");
const repairIterationLog = json("repair_iteration_log.json");
const codegenReview = json("codegen_review.json");
const filesToCreate = json("files_to_create.json");
const filesToModify = json("files_to_modify.json");
const assetsToAdd = json("assets_to_add.json");
const arbPatch = json("arb_patch.json");
const codegenPubspecPatch = json("pubspec_patch.json");
const mergeReport = json("merge_report.json");
const incrementalSyncReport = json("incremental_sync_report.json");
const compileManifest = json("compile_manifest.json");
const overrideSet = parsedJsonFiles.get("override_set.json");
const materializedAssetReport = parsedJsonFiles.get("materialized_assets_report.json");
const effectiveAssetManifest =
  parsedJsonFiles.get("final_asset_manifest.json") ?? parsedJsonFiles.get("reviewed_asset_manifest.json") ?? assetManifest;
const effectiveI18nManifest =
  parsedJsonFiles.get("final_i18n_manifest.json") ?? parsedJsonFiles.get("reviewed_i18n_manifest.json") ?? i18nManifest;
const assetManifests = [
  ["asset_manifest", assetManifest],
  ["reviewed_asset_manifest", parsedJsonFiles.get("reviewed_asset_manifest.json")],
  ["final_asset_manifest", parsedJsonFiles.get("final_asset_manifest.json")]
].filter(([, manifest]) => Boolean(manifest));

const rawSourceNodeIds = new Set();
walkRawNode(raw.root, (node) => rawSourceNodeIds.add(node.id));
const canonicalIds = new Set();
walkCanonicalNode(canonical.root, (node) => canonicalIds.add(node.id));
const normalizedIds = new Set();
walkNormalizedNode(normalized.tree, (node) => normalizedIds.add(node.id));
const traceableIds = new Set([...rawSourceNodeIds, ...canonicalIds, ...normalizedIds]);

assertJsonSchema(rawSchema, raw, "raw_figma_scene.json");
assert.equal(rawSourceNodeIds.has(canonical.root.sourceNodeId), true, "canonical root must trace to raw root.");
assert.equal(mapping.rawToCanonical[raw.root.id]?.includes(canonical.root.id), true, "node mapping must trace raw root to canonical root.");
assert.equal(semanticIR.normalizedDesignIR.tree.id, normalized.tree.id, "semantic_ir must embed the normalized IR baseline.");

assertRawExtractionContract(raw, extractionReport);
assertCanonicalMapping(rawSourceNodeIds, canonicalIds, mapping);
assertCanonicalizationReport(rawSourceNodeIds, canonicalIds, canonicalizationReport);
assertTokenArtifacts(rawSourceNodeIds, tokens, tokenUsageMap, tokenConfidenceReport);
assertSourceRefs(rawSourceNodeIds, "regions", regions, (entry) => entry.sourceNodeIds ?? []);
assertRegionTree(rawSourceNodeIds, normalizedIds, regions, regionTree);
assertLayoutArtifacts(rawSourceNodeIds, traceableIds, regions, layoutCandidates, layoutDecisions);
assertComponentArtifacts(rawSourceNodeIds, inferredComponents, componentInstanceMap, componentConfidenceReport, semanticIR);
for (const [label, manifest] of assetManifests) {
  assertSourceRefs(rawSourceNodeIds, `${label}.assets`, manifest.assets, (entry) => [entry.sourceNodeId]);
}
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
assertVisibleTextI18nCoverage(canonical, effectiveI18nManifest);
assertAssetManifestContract(
  rawSourceNodeIds,
  canonical,
  assetManifests,
  effectiveAssetManifest,
  effectiveI18nManifest,
  pubspecPatch,
  flutterGenerationManifest,
  materializedAssetReport
);
assertAcceptedUpliftsHaveDiffEvidence(upliftDecisions, upliftDiffReport, semanticIR);
assertFlutterGenerationManifest(rawSourceNodeIds, traceableIds, flutterGenerationManifest, visualDiffReport, normalized, overrideSet);
assertVisualTraceability(rawSourceNodeIds, visualIR, nodePixelMap);
assertReviewTaskArtifacts(reviewTaskSourceNodeIds(rawSourceNodeIds, parsedJsonFiles.get("node_remap_report.json")), normalizedIds, reviewTasks, taskStatusReport);

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
  assert.equal(normalizedIds.has(fallback.nodeId), true, `Fallback references unknown normalized nodeId ${fallback.nodeId}.`);
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

assertCompileManifest(compileManifest);
assertCodegenReviewArtifacts(
  rawSourceNodeIds,
  codegenReview,
  filesToCreate,
  filesToModify,
  assetsToAdd,
  arbPatch,
  codegenPubspecPatch,
  mergeReport,
  incrementalSyncReport,
  flutterGenerationManifest,
  effectiveI18nManifest,
  overrideSet,
  reviewTasks
);

assert.deepEqual(renderStrategyManifest.viewport, normalized.source.viewport, "render strategy viewport must match normalized viewport.");
assertVisualDiffArtifacts(rawSourceNodeIds, normalized, visualDiffReport, nodeDiffReport, manualReviewReport);
assertRepairArtifacts(repairPatch, repairIterationLog, visualDiffReport, nodeDiffReport);

console.log("artifact contract verification passed");

function json(path) {
  return parsedJsonFiles.get(path);
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

function assertCompileManifest(manifest) {
  assert.equal(typeof manifest.version, "string", "compile_manifest.version must be present.");
  assert.equal(typeof manifest.input, "string", "compile_manifest.input must be present.");
  assert.ok(manifest.input.length > 0, "compile_manifest.input must not be empty.");
  assert.equal(typeof manifest.generatedAt, "string", "compile_manifest.generatedAt must be present.");
  assert.ok(Array.isArray(manifest.artifacts), "compile_manifest.artifacts must be an array.");
  const artifacts = new Set();
  for (const artifactPath of manifest.artifacts) {
    assertSafeRelativePath(artifactPath, `compile_manifest.artifacts.${artifactPath}`);
    assert.equal(artifacts.has(artifactPath), false, `compile_manifest artifact ${artifactPath} must be unique.`);
    artifacts.add(artifactPath);
    const fullPath = resolve(root, artifactPath);
    assert.equal(existsSync(fullPath), true, `compile_manifest references missing artifact ${artifactPath}.`);
  }
  for (const artifactPath of requiredCompileManifestArtifacts) {
    assert.equal(artifacts.has(artifactPath), true, `compile_manifest must include required artifact ${artifactPath}.`);
  }
}

function assertCodegenReviewArtifacts(
  rawSourceNodeIds,
  codegenReview,
  filesToCreate,
  filesToModify,
  assetsToAdd,
  arbPatch,
  codegenPubspecPatch,
  mergeReport,
  incrementalSyncReport,
  flutterGenerationManifest,
  i18nManifest,
  overrideSet,
  reviewTasks
) {
  assert.equal(typeof codegenReview.version, "string", "codegen_review.version must be present.");
  assert.equal(codegenReview.buildId, flutterGenerationManifest.buildId, "codegen_review buildId must match flutter_generation_manifest.");
  assert.equal(codegenReview.generatedAt, flutterGenerationManifest.generatedAt, "codegen_review generatedAt must match flutter_generation_manifest.");
  assert.deepEqual(codegenReview.format, flutterGenerationManifest.format, "codegen_review format must match flutter_generation_manifest.");
  assert.deepEqual(codegenReview.analyze, flutterGenerationManifest.analyze, "codegen_review analyze must match flutter_generation_manifest.");
  assert.deepEqual(codegenReview.files, flutterGenerationManifest.files, "codegen_review files must match flutter_generation_manifest.");
  assert.deepEqual(codegenReview.assetsToAdd, flutterGenerationManifest.assetsToAdd ?? [], "codegen_review assetsToAdd must match flutter_generation_manifest.");
  assert.deepEqual(codegenReview.arbKeysToAdd, flutterGenerationManifest.arbKeysToAdd ?? [], "codegen_review arbKeysToAdd must match flutter_generation_manifest.");
  assert.deepEqual(codegenReview.blockingTasks, flutterGenerationManifest.blockingTasks ?? [], "codegen_review blockingTasks must match flutter_generation_manifest.");
  assert.deepEqual(codegenReview.generatedWidgets, flutterGenerationManifest.generatedWidgets ?? [], "codegen_review generatedWidgets must match flutter_generation_manifest.");
  assert.deepEqual(codegenReview.fallbackRegions, flutterGenerationManifest.fallbackRegions ?? [], "codegen_review fallbackRegions must match flutter_generation_manifest.");
  assert.deepEqual(codegenReview.unresolvedReviewTasks, flutterGenerationManifest.unresolvedReviewTasks ?? [], "codegen_review unresolvedReviewTasks must match flutter_generation_manifest.");
  assert.deepEqual(codegenReview.gates, flutterGenerationManifest.gates, "codegen_review gates must match flutter_generation_manifest.");

  const createPlans = codegenReview.files.filter((file) => file.action === "create");
  const modifyPlans = codegenReview.files.filter((file) => file.action === "modify" || file.action === "conflict");
  assert.deepEqual(codegenReview.filesToCreate, createPlans.map((file) => file.path), "codegen_review.filesToCreate must list create plans.");
  assert.deepEqual(filesToCreate, createPlans, "files_to_create.json must mirror create file plans.");
  assert.deepEqual(filesToModify, modifyPlans, "files_to_modify.json must mirror modify/conflict file plans.");
  assert.deepEqual(
    codegenReview.filesToModify,
    modifyPlans.map((file) => ({ path: file.path, patch: file.patchPath, action: file.action })),
    "codegen_review.filesToModify must list patch paths for modify/conflict plans."
  );

  for (const file of codegenReview.files) {
    assertCodegenFilePlan(rawSourceNodeIds, file, "codegen_review.files");
    if (file.patchPath) {
      assertSafeRelativePath(file.patchPath, `codegen_review.files.${file.path}.patchPath`);
      assert.equal(existsSync(resolve(root, file.patchPath)), true, `codegen patch must exist for ${file.path}: ${file.patchPath}`);
    }
    if (file.action === "conflict") {
      assert.ok(file.existingHash, `conflict file ${file.path} must include existingHash so manual code is not silently overwritten.`);
      assert.ok(file.patchPath, `conflict file ${file.path} must include a patchPath.`);
    }
    if (file.action === "modify") {
      assert.ok(file.existingHash, `modified file ${file.path} must include existingHash.`);
      assert.ok(file.patchPath, `modified file ${file.path} must include a patchPath.`);
    }
  }

  assert.deepEqual(assetsToAdd, codegenReview.assetsToAdd, "assets_to_add.json must mirror codegen_review.assetsToAdd.");
  for (const asset of assetsToAdd) {
    assert.equal(rawSourceNodeIds.has(asset.sourceNodeId), true, `assets_to_add ${asset.assetId} references unknown sourceNodeId ${asset.sourceNodeId}.`);
    assert.ok(["add", "already_declared", "missing_path", "ignored"].includes(asset.action), `assets_to_add ${asset.assetId} action must be known.`);
    if (asset.path) assertSafeAssetPath(asset.path, `assets_to_add.${asset.assetId}.path`);
    assert.ok(asset.reason, `assets_to_add ${asset.assetId} must include reason.`);
  }

  assert.equal(typeof arbPatch.locale, "string", "arb_patch.locale must be present.");
  assert.deepEqual(codegenReview.arbKeysToAdd, arbPatch.keysToAdd.map((message) => message.key), "codegen_review.arbKeysToAdd must mirror arb_patch keysToAdd.");
  const l10nArbPlan = codegenReview.files.find((file) => /^lib\/l10n\/intl_[A-Za-z0-9_]+\.arb$/.test(file.path));
  assert.ok(l10nArbPlan, "codegen_review.files must include a generated lib/l10n/intl_*.arb file.");
  assert.equal(
    l10nArbPlan.generatedRegions.some((region) => region.strategy === "i18n_arb"),
    true,
    "generated l10n ARB file must be traceable with the i18n_arb strategy."
  );
  const generatedArbPath = resolve(root, "generated", l10nArbPlan.path);
  assert.equal(existsSync(generatedArbPath), true, `generated l10n ARB file must exist at generated/${l10nArbPlan.path}.`);
  const generatedArb = JSON.parse(readFileSync(generatedArbPath, "utf8"));
  assert.equal(generatedArb["@@locale"], i18nManifest.locale.replace(/-/g, "_"), "generated l10n ARB locale must mirror i18n_manifest.locale.");
  assert.equal(typeof generatedArb["@@uxcGenerated"], "object", "generated l10n ARB file must include UXCompiler metadata.");
  assert.equal(generatedArb["@@uxcGenerated"].strategy, "i18n_arb", "generated l10n ARB metadata must identify the i18n_arb strategy.");
  for (const message of [...arbPatch.keysToAdd, ...arbPatch.keysToModify]) {
    assert.ok(message.key, "arb_patch message must include key.");
    assert.ok(message.description, `arb_patch message ${message.key} must include description.`);
    assert.equal(rawSourceNodeIds.has(message.sourceNodeId), true, `arb_patch message ${message.key} references unknown sourceNodeId ${message.sourceNodeId}.`);
    assertScore(message.confidence, `arb_patch.${message.key}.confidence`);
  }
  for (const message of i18nManifest.messages.filter((entry) => entry.key)) {
    assert.equal(generatedArb[message.key], message.value, `generated l10n ARB message ${message.key} must mirror i18n_manifest.`);
    assert.equal(generatedArb[`@${message.key}`]?.description, message.description, `generated l10n ARB metadata ${message.key} must include description.`);
  }
  assert.ok(Array.isArray(arbPatch.warnings), "arb_patch.warnings must be an array.");

  assert.deepEqual(codegenPubspecPatch, pubspecPatch, "codegen pubspec_patch.json must match the asset pubspec patch contract.");
  const pubspecPatchText = readFileSync(resolve(root, "pubspec.yaml.patch"), "utf8");
  assert.equal(pubspecPatchText, codegenPubspecPatch.patch, "pubspec.yaml.patch must exactly mirror pubspec_patch.patch.");
  if (codegenPubspecPatch.assets.length > 0) {
    assert.match(pubspecPatchText, /# existingHash: sha256_[a-f0-9]{64}/, "pubspec patch must record existingHash.");
    assert.match(pubspecPatchText, /# currentHash: sha256_[a-f0-9]{64}/, "pubspec patch must record currentHash.");
  }

  assert.equal(typeof mergeReport.version, "string", "merge_report.version must be present.");
  assert.equal(mergeReport.generatedAt, codegenReview.generatedAt, "merge_report generatedAt must match codegen_review.");
  assert.deepEqual(
    mergeReport.files,
    codegenReview.files.map((file) => ({
      path: file.path,
      action: file.action,
      ...(file.patchPath ? { patchPath: file.patchPath } : {}),
      reason: file.reason
    })),
    "merge_report.files must summarize every codegen file plan."
  );
  assert.deepEqual(
    mergeReport.conflicts,
    codegenReview.files
      .filter((file) => file.action === "conflict")
      .map((file) => ({ path: file.path, reason: file.reason, patchPath: file.patchPath })),
    "merge_report.conflicts must mirror conflict file plans."
  );

  assertIncrementalSyncReport(rawSourceNodeIds, incrementalSyncReport, codegenReview, overrideSet, reviewTasks);
  assertManualOverrideSummary(codegenReview.manualOverrideSummary, overrideSet);
  assertCodegenReviewGates(codegenReview, reviewTasks, incrementalSyncReport);
}

function assertCodegenFilePlan(rawSourceNodeIds, file, label) {
  assertSafeRelativePath(file.path, `${label}.${file.path}.path`);
  assert.ok(["create", "modify", "unchanged", "conflict"].includes(file.action), `${label}.${file.path}.action must be known.`);
  assertHash(file.hash, `${label}.${file.path}.hash`);
  if (file.previousHash) assertHash(file.previousHash, `${label}.${file.path}.previousHash`);
  if (file.existingHash) assertHash(file.existingHash, `${label}.${file.path}.existingHash`);
  assert.ok(file.reason, `${label}.${file.path}.reason must be present.`);
  assert.ok(Array.isArray(file.generatedRegions) && file.generatedRegions.length > 0, `${label}.${file.path} must include generatedRegions.`);
  for (const region of file.generatedRegions) {
    assert.ok(region.id, `${label}.${file.path}.generatedRegions must include id.`);
    assert.ok(region.strategy, `${label}.${file.path}.generatedRegions.${region.id} must include strategy.`);
    assertHash(region.hash, `${label}.${file.path}.generatedRegions.${region.id}.hash`);
    assertSourceRefs(rawSourceNodeIds, `${label}.${file.path}.generatedRegions.${region.id}`, [region], (entry) => entry.sourceNodeIds ?? []);
  }
}

function assertIncrementalSyncReport(rawSourceNodeIds, report, codegenReview, overrideSet, reviewTasks) {
  assert.equal(typeof report.version, "string", "incremental_sync_report.version must be present.");
  assert.equal(report.generatedAt, codegenReview.generatedAt, "incremental_sync_report generatedAt must match codegen_review.");
  assert.ok(["initial_generation", "incremental_review"].includes(report.mode), "incremental_sync_report.mode must be known.");
  assertStringArray(report.nodeRemapReport.exactSourceNodeIds, "incremental_sync_report.nodeRemapReport.exactSourceNodeIds");
  assertStringArray(report.nodeRemapReport.addedSourceNodeIds, "incremental_sync_report.nodeRemapReport.addedSourceNodeIds");
  assertStringArray(report.nodeRemapReport.removedSourceNodeIds, "incremental_sync_report.nodeRemapReport.removedSourceNodeIds");
  for (const sourceNodeId of [...report.nodeRemapReport.exactSourceNodeIds, ...report.nodeRemapReport.addedSourceNodeIds]) {
    assert.equal(rawSourceNodeIds.has(sourceNodeId), true, `incremental_sync_report references unknown current sourceNodeId ${sourceNodeId}.`);
  }
  const currentFiles = new Map(codegenReview.files.map((file) => [file.path, file]));
  assert.ok(Array.isArray(report.fileChanges), "incremental_sync_report.fileChanges must be an array.");
  assert.ok(report.fileChanges.length > 0, "incremental_sync_report must describe file changes.");
  for (const change of report.fileChanges) {
    assertSafeRelativePath(change.path, `incremental_sync_report.fileChanges.${change.path}.path`);
    assert.ok(["added", "changed", "removed", "unchanged"].includes(change.change), `incremental_sync_report file ${change.path} change must be known.`);
    if (change.previousHash) assertHash(change.previousHash, `incremental_sync_report.fileChanges.${change.path}.previousHash`);
    if (change.currentHash) assertHash(change.currentHash, `incremental_sync_report.fileChanges.${change.path}.currentHash`);
    const current = currentFiles.get(change.path);
    if (change.change === "removed") {
      assert.equal(current, undefined, `removed incremental file ${change.path} must not exist in current codegen_review.`);
      assert.ok(change.previousHash, `removed incremental file ${change.path} must include previousHash.`);
    } else {
      assert.ok(current, `incremental file ${change.path} must exist in current codegen_review.`);
      assert.equal(change.currentHash, current.hash, `incremental file ${change.path} currentHash must match codegen_review hash.`);
      if (change.change === "added") assert.equal(change.previousHash, undefined, `added incremental file ${change.path} must not include previousHash.`);
      if (change.change === "unchanged") assert.equal(change.previousHash, change.currentHash, `unchanged incremental file ${change.path} hashes must match.`);
      if (change.change === "changed") assert.notEqual(change.previousHash, change.currentHash, `changed incremental file ${change.path} hashes must differ.`);
    }
  }

  const activeOverrideIds = new Set((overrideSet?.overrides ?? []).filter((override) => override.status === "active").map((override) => override.id));
  const staleOverrideIds = new Set();
  for (const stale of report.staleOverrides ?? []) {
    assert.ok(stale.overrideId, "incremental stale override must include overrideId.");
    staleOverrideIds.add(stale.overrideId);
    assert.ok(stale.reason, `incremental stale override ${stale.overrideId} must include reason.`);
  }
  for (const reapplied of report.reappliedOverrides ?? []) {
    assert.equal(activeOverrideIds.has(reapplied.overrideId), true, `reapplied override ${reapplied.overrideId} must be active in override_set.`);
    assert.equal(staleOverrideIds.has(reapplied.overrideId), false, `reapplied override ${reapplied.overrideId} cannot also be stale.`);
    assert.ok(reapplied.reason, `reapplied override ${reapplied.overrideId} must include reason.`);
  }
  const staleTaskIds = new Set(reviewTasks.filter((task) => task.type === "stale_override").map((task) => task.id));
  for (const stale of report.staleOverrides ?? []) {
    assert.equal(
      staleTaskIds.has(stale.overrideId) || staleTaskIds.has(`task_incremental_remap_${stale.overrideId}`),
      true,
      `stale override ${stale.overrideId} must be represented by a review task.`
    );
  }

  const expectedReviewRequired =
    codegenReview.gates.status === "blocked" ||
    (report.staleOverrides ?? []).length > 0 ||
    report.fileChanges.some((change) => change.change === "added" || change.change === "changed" || change.change === "removed");
  assert.equal(report.reviewRequired, expectedReviewRequired, "incremental_sync_report.reviewRequired must reflect gates, stale overrides, and file changes.");
  assert.ok(Array.isArray(report.warnings), "incremental_sync_report.warnings must be an array.");
  if (report.mode === "initial_generation") {
    assert.equal(report.warnings.some((warning) => warning.type === "no_previous_manifest"), true, "initial_generation must warn that no previous manifest exists.");
  }
}

function assertManualOverrideSummary(summary, overrideSet) {
  assert.equal(typeof summary.active, "number", "manualOverrideSummary.active must be a number.");
  assert.equal(typeof summary.disabled, "number", "manualOverrideSummary.disabled must be a number.");
  const overrides = overrideSet?.overrides ?? [];
  const active = overrides.filter((override) => override.status === "active");
  const disabled = overrides.filter((override) => override.status === "disabled");
  assert.equal(summary.active, active.length, "manualOverrideSummary.active must match override_set.");
  assert.equal(summary.disabled, disabled.length, "manualOverrideSummary.disabled must match override_set.");
  const byType = {};
  for (const override of active) byType[override.type] = (byType[override.type] ?? 0) + 1;
  assert.deepEqual(summary.byType, byType, "manualOverrideSummary.byType must count active overrides by type.");
  assert.ok(Array.isArray(summary.latest), "manualOverrideSummary.latest must be an array.");
  assert.ok(summary.latest.length <= 5, "manualOverrideSummary.latest must contain at most five overrides.");
  const overrideIds = new Set(overrides.map((override) => override.id));
  for (const entry of summary.latest) {
    assert.equal(overrideIds.has(entry.id), true, `manualOverrideSummary.latest references unknown override ${entry.id}.`);
    assert.ok(entry.type, `manualOverrideSummary.latest ${entry.id} must include type.`);
    assert.ok(["active", "disabled"].includes(entry.status), `manualOverrideSummary.latest ${entry.id} status must be known.`);
    assert.ok(entry.target, `manualOverrideSummary.latest ${entry.id} must include target.`);
  }
}

function assertCodegenReviewGates(codegenReview, reviewTasks, incrementalSyncReport) {
  assert.equal(typeof codegenReview.gates.canWrite, "boolean", "codegen_review.gates.canWrite must be boolean.");
  assert.ok(["ready", "blocked"].includes(codegenReview.gates.status), "codegen_review.gates.status must be known.");
  assert.equal(codegenReview.gates.canWrite, codegenReview.gates.status === "ready", "codegen_review.gates.canWrite must match gate status.");
  const blockerTypes = new Set(codegenReview.gates.blockers.map((blocker) => blocker.type));
  const openP0Tasks = reviewTasks.filter((task) => task.status === "open" && task.priority === "P0");
  assert.deepEqual(codegenReview.blockingTasks, openP0Tasks.map((task) => task.id), "codegen_review.blockingTasks must list open P0 tasks.");
  for (const task of openP0Tasks) {
    assert.equal(blockerTypes.has("blocking_review_task"), true, `open P0 task ${task.id} must block codegen write.`);
  }
  if (incrementalSyncReport.staleOverrides.length > 0 || reviewTasks.some((task) => task.status === "open" && task.type === "stale_override")) {
    assert.equal(blockerTypes.has("stale_override_unresolved"), true, "stale overrides must block codegen write.");
  }
  if (codegenReview.files.some((file) => file.action === "conflict")) {
    assert.equal(blockerTypes.has("manual_file_conflict"), true, "manual file conflicts must block codegen write.");
  }
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

function assertReviewTaskArtifacts(rawSourceNodeIds, normalizedIds, tasks, statusReport) {
  assertReviewTaskContract(tasks, "review_tasks.json");
  assertReviewTaskStatusReport(tasks, statusReport);
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

function assertReviewTaskStatusReport(tasks, statusReport) {
  assert.equal(typeof statusReport.version, "string", "task_status_report.version must be present.");
  assert.equal(typeof statusReport.generatedAt, "string", "task_status_report.generatedAt must be present.");
  assert.equal(statusReport.total, tasks.length, "task_status_report.total must match review_tasks length.");
  const openTasks = tasks.filter((task) => task.status === "open");
  assert.equal(statusReport.open, openTasks.length, "task_status_report.open must match open review tasks.");
  assert.equal(typeof statusReport.byPriority, "object", "task_status_report.byPriority must be an object.");
  assert.ok(statusReport.byPriority !== null && !Array.isArray(statusReport.byPriority), "task_status_report.byPriority must be an object.");
  assert.equal(typeof statusReport.byType, "object", "task_status_report.byType must be an object.");
  assert.ok(statusReport.byType !== null && !Array.isArray(statusReport.byType), "task_status_report.byType must be an object.");
  assert.equal(typeof statusReport.codegenWriteBlocked, "boolean", "task_status_report.codegenWriteBlocked must be boolean.");
  assertStringArray(statusReport.blockedReasons, "task_status_report.blockedReasons");

  const expectedByPriority = { P0: 0, P1: 0, P2: 0 };
  const expectedByType = new Map();
  for (const task of openTasks) {
    expectedByPriority[task.priority] += 1;
    expectedByType.set(task.type, (expectedByType.get(task.type) ?? 0) + 1);
  }
  for (const priority of ["P0", "P1", "P2"]) {
    assert.equal(statusReport.byPriority[priority], expectedByPriority[priority], `task_status_report.byPriority.${priority} must match open tasks.`);
  }
  assert.deepEqual(new Map(Object.entries(statusReport.byType)), expectedByType, "task_status_report.byType must match open task types.");

  const openP0Titles = openTasks.filter((task) => task.priority === "P0").map((task) => task.title);
  assert.equal(statusReport.codegenWriteBlocked, openP0Titles.length > 0, "task_status_report.codegenWriteBlocked must reflect open P0 tasks.");
  assert.deepEqual(new Set(statusReport.blockedReasons), new Set(openP0Titles), "task_status_report.blockedReasons must list every open P0 task title.");
}

function assertTokenArtifacts(rawSourceNodeIds, tokens, tokenUsageMap, tokenConfidenceReport) {
  assert.equal(tokens.version, "2.0", "inferred_tokens.version must be 2.0.");
  for (const category of ["colors", "spacing", "typography", "radii", "shadows"]) {
    assert.ok(Array.isArray(tokens[category]), `inferred_tokens.${category} must be an array.`);
  }
  assert.equal(typeof tokenUsageMap, "object", "token_usage_map must be an object.");
  assert.ok(tokenUsageMap !== null && !Array.isArray(tokenUsageMap), "token_usage_map must be an object.");
  for (const category of ["colors", "spacing", "typography", "radii"]) {
    assert.equal(typeof tokenUsageMap[category], "object", `token_usage_map.${category} must be an object.`);
    assert.ok(tokenUsageMap[category] !== null && !Array.isArray(tokenUsageMap[category]), `token_usage_map.${category} must be an object.`);
  }
  assert.ok(Array.isArray(tokenConfidenceReport.warnings), "token_confidence_report.warnings must be an array.");

  const tokenNamesByCategory = new Map();
  for (const category of ["colors", "spacing", "typography", "radii", "shadows"]) {
    tokenNamesByCategory.set(category, new Set(tokens[category].map((token) => token.name)));
    for (const token of tokens[category]) assertTokenEntry(rawSourceNodeIds, category, token);
  }

  assertTokenUsageMap(rawSourceNodeIds, tokenNamesByCategory.get("colors"), tokenUsageMap.colors, "token_usage_map.colors");
  assertTokenUsageMap(rawSourceNodeIds, tokenNamesByCategory.get("spacing"), tokenUsageMap.spacing, "token_usage_map.spacing");
  assertTokenUsageMap(rawSourceNodeIds, tokenNamesByCategory.get("typography"), tokenUsageMap.typography, "token_usage_map.typography");
  assertTokenUsageMap(rawSourceNodeIds, tokenNamesByCategory.get("radii"), tokenUsageMap.radii, "token_usage_map.radii");
  for (const token of tokens.spacing) assertAliasesCovered(tokenUsageMap.spacing, token, `spacing token ${token.name}`);
  for (const token of tokens.radii) assertAliasesCovered(tokenUsageMap.radii, token, `radius token ${token.name}`);
  for (const token of tokens.typography) {
    const key = [token.fontFamily, token.fontSize, token.fontWeight, token.lineHeight, token.letterSpacing].join("|");
    assert.equal(tokenUsageMap.typography[key]?.tokenName, token.name, `Typography token ${token.name} must be present in token_usage_map.`);
  }

  const lowConfidenceTokens = new Map();
  for (const category of ["colors", "spacing", "typography", "radii", "shadows"]) {
    for (const token of tokens[category]) {
      if (token.confidence < 0.8) lowConfidenceTokens.set(token.name, { category, token });
    }
  }
  const lowConfidenceWarnings = tokenConfidenceReport.warnings.filter((warning) => warning.type === "low_confidence_token");
  const warnedTokenNames = new Set();
  for (const warning of tokenConfidenceReport.warnings) {
    assert.ok(warning.type, "token_confidence_report warning must include type.");
    assert.ok(warning.message, `token_confidence_report warning ${warning.type} must include message.`);
    if (warning.sourceNodeIds) {
      assertSourceRefs(rawSourceNodeIds, `token_confidence_report.${warning.type}`, [warning], (entry) => entry.sourceNodeIds ?? []);
    }
    if (warning.confidence !== undefined) assertScore(warning.confidence, `token_confidence_report.${warning.type}.${warning.tokenName ?? "unknown"}.confidence`);
  }
  for (const warning of lowConfidenceWarnings) {
    assert.ok(warning.tokenName, "low_confidence_token warning must include tokenName.");
    assert.ok(warning.category, `low_confidence_token ${warning.tokenName} must include category.`);
    const match = lowConfidenceTokens.get(warning.tokenName);
    assert.ok(match, `low_confidence_token warning references unknown or high-confidence token ${warning.tokenName}.`);
    assert.equal(warning.category, match.category, `low_confidence_token ${warning.tokenName} category must match inferred token category.`);
    assert.equal(warning.confidence, match.token.confidence, `low_confidence_token ${warning.tokenName} confidence must match inferred token.`);
    assert.deepEqual(new Set(warning.sourceNodeIds ?? []), new Set(match.token.sourceNodeIds), `low_confidence_token ${warning.tokenName} sourceNodeIds must match inferred token.`);
    warnedTokenNames.add(warning.tokenName);
  }
  assert.deepEqual(warnedTokenNames, new Set(lowConfidenceTokens.keys()), "token_confidence_report must cover every low-confidence token.");
}

function assertTokenEntry(rawSourceNodeIds, category, token) {
  assert.ok(token.name, `inferred_tokens.${category} token must include name.`);
  assertScore(token.confidence, `inferred_tokens.${category}.${token.name}.confidence`);
  assert.equal(typeof token.usageCount, "number", `inferred_tokens.${category}.${token.name}.usageCount must be a number.`);
  assert.ok(Number.isInteger(token.usageCount) && token.usageCount > 0, `inferred_tokens.${category}.${token.name}.usageCount must be positive.`);
  assertStringArray(token.sourceNodeIds, `inferred_tokens.${category}.${token.name}.sourceNodeIds`, (sourceNodeId, label) => {
    assert.equal(rawSourceNodeIds.has(sourceNodeId), true, `${label} references unknown sourceNodeId ${sourceNodeId}.`);
  });
  assert.ok(token.sourceNodeIds.length > 0, `inferred_tokens.${category}.${token.name} must include sourceNodeIds.`);
  if (category === "colors") {
    assert.match(token.value, /^#[0-9A-F]{6}$/i, `Color token ${token.name} value must be a hex color.`);
    assert.ok(["background", "surface", "text", "border", "icon", "shadow", "unknown"].includes(token.usage), `Color token ${token.name} usage must be known.`);
    assertStringArray(token.aliases, `inferred_tokens.colors.${token.name}.aliases`);
    assert.ok(token.aliases.length > 0, `Color token ${token.name} must preserve aliases.`);
  }
  if (category === "spacing" || category === "radii") {
    assert.equal(typeof token.value, "number", `${category} token ${token.name} value must be a number.`);
    assert.ok(Number.isFinite(token.value), `${category} token ${token.name} value must be finite.`);
    assert.ok(Array.isArray(token.aliases), `${category} token ${token.name} aliases must be an array.`);
    assert.ok(token.aliases.length > 0, `${category} token ${token.name} must preserve aliases.`);
    for (const alias of token.aliases) assert.equal(typeof alias, "number", `${category} token ${token.name} aliases must be numbers.`);
  }
  if (category === "typography") {
    assert.ok(token.fontFamily, `Typography token ${token.name} must include fontFamily.`);
    for (const key of ["fontSize", "fontWeight", "lineHeight", "letterSpacing"]) {
      assert.equal(typeof token[key], "number", `Typography token ${token.name}.${key} must be a number.`);
      assert.ok(Number.isFinite(token[key]), `Typography token ${token.name}.${key} must be finite.`);
    }
    assert.ok(token.lineHeight > 0, `Typography token ${token.name} lineHeight must be positive.`);
  }
}

function assertTokenUsageMap(rawSourceNodeIds, validNames, usageMap, label) {
  for (const [rawValue, entry] of Object.entries(usageMap)) {
    assert.ok(rawValue.length > 0, `${label} raw value must not be empty.`);
    assert.equal(typeof entry, "object", `${label}.${rawValue} must map to a usage entry.`);
    assert.ok(entry !== null && !Array.isArray(entry), `${label}.${rawValue} must map to a usage entry.`);
    assert.equal(typeof entry.tokenName, "string", `${label}.${rawValue}.tokenName must be a string.`);
    assert.equal(validNames.has(entry.tokenName), true, `${label}.${rawValue} references unknown token ${entry.tokenName}.`);
    assertStringArray(entry.sourceNodeIds, `${label}.${rawValue}.sourceNodeIds`, (sourceNodeId, sourceLabel) => {
      assert.equal(rawSourceNodeIds.has(sourceNodeId), true, `${sourceLabel} references unknown sourceNodeId ${sourceNodeId}.`);
    });
    assert.ok(entry.sourceNodeIds.length > 0, `${label}.${rawValue}.sourceNodeIds must not be empty.`);
  }
}

function assertAliasesCovered(usageMap, token, label) {
  for (const alias of token.aliases) {
    assert.equal(usageMap[String(alias)]?.tokenName, token.name, `${label} alias ${alias} must be present in token_usage_map.`);
  }
}

function assertComponentArtifacts(rawSourceNodeIds, inferredComponents, componentInstanceMap, componentConfidenceReport, semanticIR) {
  assert.equal(inferredComponents.version, "2.0", "inferred_components.version must be 2.0.");
  assert.ok(
    ["candidates_detected", "no_reusable_components_detected"].includes(inferredComponents.status),
    "inferred_components.status must be known."
  );
  assert.ok(Array.isArray(inferredComponents.candidates), "inferred_components.candidates must be an array.");
  assertScore(inferredComponents.confidence, "inferred_components.confidence");

  assert.equal(componentInstanceMap.version, "2.0", "component_instance_map.version must be 2.0.");
  assert.ok(Array.isArray(componentInstanceMap.components), "component_instance_map.components must be an array.");
  assertStringArray(componentInstanceMap.unmappedSourceNodeIds, "component_instance_map.unmappedSourceNodeIds", (sourceNodeId, label) => {
    assert.equal(rawSourceNodeIds.has(sourceNodeId), true, `${label} references unknown sourceNodeId ${sourceNodeId}.`);
  });

  assert.equal(componentConfidenceReport.version, "2.0", "component_confidence_report.version must be 2.0.");
  assert.ok(["ready", "no_candidates"].includes(componentConfidenceReport.status), "component_confidence_report.status must be known.");
  assert.ok(Array.isArray(componentConfidenceReport.candidates), "component_confidence_report.candidates must be an array.");
  assert.ok(Array.isArray(componentConfidenceReport.warnings), "component_confidence_report.warnings must be an array.");

  assert.deepEqual(
    semanticIR.inferredComponents,
    inferredComponents,
    "semantic_ir.inferredComponents must embed inferred_components.json exactly."
  );

  if (inferredComponents.status === "no_reusable_components_detected") {
    assert.deepEqual(inferredComponents.candidates, [], "no_reusable_components_detected must not include candidates.");
    assert.ok(inferredComponents.fallback, "no_reusable_components_detected must include a fallback strategy.");
    assert.equal(componentConfidenceReport.status, "no_candidates", "no reusable components must produce a no_candidates confidence report.");
    assert.deepEqual(componentInstanceMap.components, [], "no reusable components must not produce instance-map components.");
    assert.equal(
      componentConfidenceReport.warnings.some((warning) => warning.type === "no_reusable_components_detected" && warning.message),
      true,
      "no reusable components must include an explicit confidence-report warning."
    );
    return;
  }

  assert.equal(componentConfidenceReport.status, "ready", "detected components must produce a ready confidence report.");
  assert.ok(inferredComponents.candidates.length > 0, "candidates_detected must include candidates.");

  const inferredIds = new Set();
  for (const candidate of inferredComponents.candidates) {
    assertComponentCandidate(rawSourceNodeIds, candidate, inferredIds);
  }

  const instanceIds = new Set();
  for (const component of componentInstanceMap.components) {
    assert.ok(component.componentId, "component_instance_map component must include componentId.");
    assert.equal(inferredIds.has(component.componentId), true, `component_instance_map references unknown componentId ${component.componentId}.`);
    assert.ok(["candidate", "accepted", "rejected", "fallback"].includes(component.status), `${component.componentId} status must be known.`);
    assert.ok(Array.isArray(component.instances), `${component.componentId} instances must be an array.`);
    assert.ok(component.instances.length >= 2, `${component.componentId} must map at least two instances.`);
    for (const [index, instance] of component.instances.entries()) {
      assertStringArray(instance.sourceNodeIds, `${component.componentId}.instances[${index}].sourceNodeIds`, (sourceNodeId, label) => {
        assert.equal(rawSourceNodeIds.has(sourceNodeId), true, `${label} references unknown sourceNodeId ${sourceNodeId}.`);
      });
      assert.ok(instance.sourceNodeIds.length > 0, `${component.componentId}.instances[${index}] must include sourceNodeIds.`);
    }
    instanceIds.add(component.componentId);
  }

  const reportIds = new Set();
  for (const candidate of componentConfidenceReport.candidates) {
    assert.ok(candidate.componentId, "component_confidence_report candidate must include componentId.");
    assert.equal(inferredIds.has(candidate.componentId), true, `component_confidence_report references unknown componentId ${candidate.componentId}.`);
    assertScore(candidate.confidence, `component_confidence_report.${candidate.componentId}.confidence`);
    assert.equal(typeof candidate.instanceCount, "number", `${candidate.componentId} instanceCount must be a number.`);
    assert.ok(Number.isInteger(candidate.instanceCount) && candidate.instanceCount >= 2, `${candidate.componentId} instanceCount must be at least 2.`);
    assert.ok(["auto_reusable", "needs_review", "fallback"].includes(candidate.gate), `${candidate.componentId} gate must be known.`);
    assert.ok(candidate.reason, `${candidate.componentId} confidence report must include a reason.`);
    reportIds.add(candidate.componentId);
  }

  assert.deepEqual(instanceIds, inferredIds, "component_instance_map must cover every inferred component exactly once.");
  assert.deepEqual(reportIds, inferredIds, "component_confidence_report must cover every inferred component exactly once.");
}

function assertComponentCandidate(rawSourceNodeIds, candidate, seenIds) {
  assert.ok(candidate && typeof candidate === "object" && !Array.isArray(candidate), "component candidate must be an object.");
  assert.ok(candidate.componentId, "component candidate must include componentId.");
  assert.equal(seenIds.has(candidate.componentId), false, `Duplicate component candidate ${candidate.componentId}.`);
  seenIds.add(candidate.componentId);
  assert.ok(candidate.name, `component candidate ${candidate.componentId} must include a name.`);
  assert.ok(["Button", "Card", "ListItem"].includes(candidate.kind), `${candidate.componentId} kind must be supported.`);
  assertScore(candidate.confidence, `inferred_components.${candidate.componentId}.confidence`);
  assertStringArray(candidate.sourceInstances, `inferred_components.${candidate.componentId}.sourceInstances`, (sourceNodeId, label) => {
    assert.equal(rawSourceNodeIds.has(sourceNodeId), true, `${label} references unknown sourceNodeId ${sourceNodeId}.`);
  });
  assert.ok(candidate.sourceInstances.length >= 2, `${candidate.componentId} must have at least two source instances.`);
  assert.ok(Array.isArray(candidate.evidence), `${candidate.componentId} evidence must be an array.`);
  assert.ok(candidate.evidence.length > 0, `${candidate.componentId} must include evidence.`);
  assert.ok(Array.isArray(candidate.props), `${candidate.componentId} props must be an array.`);
  for (const [index, prop] of candidate.props.entries()) {
    assert.ok(prop.name, `${candidate.componentId}.props[${index}] must include a name.`);
    assert.ok(prop.kind, `${candidate.componentId}.${prop.name} must include kind.`);
    assertStringArray(prop.sourceNodeIds, `${candidate.componentId}.${prop.name}.sourceNodeIds`, (sourceNodeId, label) => {
      assert.equal(rawSourceNodeIds.has(sourceNodeId), true, `${label} references unknown sourceNodeId ${sourceNodeId}.`);
    });
    assert.ok(prop.sourceNodeIds.length > 0, `${candidate.componentId}.${prop.name} must include sourceNodeIds.`);
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
  assertScreenshotContract(report);
}

function assertScreenshotContract(report) {
  assert.equal(typeof report.screenshot, "object", "extraction_report.screenshot must be present.");
  assert.ok(report.screenshot !== null && !Array.isArray(report.screenshot), "extraction_report.screenshot must be an object.");
  assert.equal(typeof report.screenshot.requested, "boolean", "extraction_report.screenshot.requested must be a boolean.");
  assert.ok(["success", "failed", "skipped"].includes(report.screenshot.status), "extraction_report.screenshot.status must be known.");
  if (report.screenshot.status === "success") {
    const format = report.screenshot.format ?? "png";
    const screenshotPath = resolve(root, `figma_reference.${format}`);
    assert.equal(existsSync(screenshotPath), true, `Reference screenshot must exist: figma_reference.${format}`);
    assert.ok(statSync(screenshotPath).size > 0, `Reference screenshot must be non-empty: figma_reference.${format}`);
    assert.ok(Number(report.screenshot.bytes) > 0, "Successful screenshot report must record byte size.");
  }
  if (report.screenshot.status === "failed") {
    assert.ok(report.screenshot.message, "Failed screenshot report must include a message.");
    assert.equal(
      (report.warnings ?? []).some((warning) => warning.type === "reference_screenshot_failed"),
      true,
      "Failed screenshot report must include a reference_screenshot_failed warning."
    );
  }
  if (report.screenshot.status === "skipped") {
    assert.ok(report.screenshot.message || report.screenshot.requested === false, "Skipped screenshot report must explain why no reference was exported.");
  }
}

function assertJsonSchema(schema, value, label) {
  const issues = [];
  validateSchemaNode(schema, value, "$", schema, issues);
  assert.equal(issues.length, 0, `${label} must satisfy JSON Schema:\n${issues.join("\n")}`);
}

function validateSchemaNode(schemaNode, value, path, rootSchema, issues) {
  if (!schemaNode || typeof schemaNode !== "object") return;
  if (schemaNode.$ref) {
    validateSchemaNode(resolveSchemaRef(rootSchema, schemaNode.$ref), value, path, rootSchema, issues);
    return;
  }
  if (Array.isArray(schemaNode.anyOf)) {
    const optionIssues = schemaNode.anyOf.map((option) => {
      const nextIssues = [];
      validateSchemaNode(option, value, path, rootSchema, nextIssues);
      return nextIssues;
    });
    if (optionIssues.some((entry) => entry.length === 0)) return;
    issues.push(`${path} must match one anyOf schema (${optionIssues.map((entry) => entry[0]).filter(Boolean).join("; ")})`);
    return;
  }
  if (schemaNode.type) assertSchemaType(schemaNode.type, value, path, issues);
  if (schemaNode.type === "object" && isPlainObject(value)) {
    for (const requiredKey of schemaNode.required ?? []) {
      if (!(requiredKey in value)) issues.push(`${path}.${requiredKey} is required`);
    }
    for (const [key, childSchema] of Object.entries(schemaNode.properties ?? {})) {
      if (key in value) validateSchemaNode(childSchema, value[key], `${path}.${key}`, rootSchema, issues);
    }
  }
  if (schemaNode.type === "array" && Array.isArray(value) && schemaNode.items) {
    value.forEach((entry, index) => validateSchemaNode(schemaNode.items, entry, `${path}[${index}]`, rootSchema, issues));
  }
}

function assertSchemaType(type, value, path, issues) {
  if (type === "object" && !isPlainObject(value)) issues.push(`${path} must be an object`);
  else if (type === "array" && !Array.isArray(value)) issues.push(`${path} must be an array`);
  else if (type === "string" && typeof value !== "string") issues.push(`${path} must be a string`);
  else if (type === "number" && (typeof value !== "number" || !Number.isFinite(value))) issues.push(`${path} must be a finite number`);
  else if (type === "boolean" && typeof value !== "boolean") issues.push(`${path} must be a boolean`);
  else if (type === "null" && value !== null) issues.push(`${path} must be null`);
}

function resolveSchemaRef(rootSchema, ref) {
  assert.equal(ref.startsWith("#/"), true, `Unsupported schema ref ${ref}`);
  return ref
    .slice(2)
    .split("/")
    .reduce((node, segment) => node?.[segment.replaceAll("~1", "/").replaceAll("~0", "~")], rootSchema);
}

function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

function assertLayoutArtifacts(rawSourceNodeIds, traceableIds, regions, candidates, decisions) {
  assert.ok(Array.isArray(regions), "regions must be an array.");
  assert.ok(Array.isArray(candidates), "layout_candidates must be an array.");
  assert.ok(Array.isArray(decisions), "layout_decisions must be an array.");
  const candidateNodeIds = new Set(candidates.map((candidate) => candidate.nodeId));
  const candidatesByNodeId = new Map(candidates.map((candidate) => [candidate.nodeId, candidate.candidates ?? []]));
  const decisionNodeIds = new Set(decisions.map((decision) => decision.nodeId));
  const decisionSourceNodeIds = new Set(decisions.flatMap((decision) => decision.sourceNodeIds ?? []));
  for (const region of regions) {
    assert.ok(region.id, "region must include id.");
    assert.ok(Array.isArray(region.sourceNodeIds) && region.sourceNodeIds.length > 0, `region ${region.id} must include sourceNodeIds.`);
    assert.ok(
      region.sourceNodeIds.some((sourceNodeId) => decisionSourceNodeIds.has(sourceNodeId)),
      `region ${region.id} must be covered by at least one layout decision.`
    );
  }
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
    assert.equal(candidateNodeIds.has(decision.nodeId), true, `layout decision ${decision.nodeId} must have matching layout candidates.`);
    assertSourceRefs(rawSourceNodeIds, `layout_decisions.${decision.nodeId}`, [decision], (entry) => entry.sourceNodeIds ?? []);
    assertScore(decision.score, `layout_decisions.${decision.nodeId}.score`);
    assertScore(decision.confidence, `layout_decisions.${decision.nodeId}.confidence`);
    assert.ok(Array.isArray(decision.evidence) && decision.evidence.length > 0, `layout decision ${decision.nodeId} must include evidence.`);
    const candidateOptions = candidatesByNodeId.get(decision.nodeId) ?? [];
    assert.equal(
      candidateOptions.some((option) => option.layout === decision.layout),
      true,
      `layout decision ${decision.nodeId} selected layout ${decision.layout} must be present in candidates.`
    );
    assert.ok(decision.fallback, `layout decision ${decision.nodeId} must include fallback.`);
    assert.equal(
      candidateOptions.some((option) => option.layout === decision.fallback),
      true,
      `layout decision ${decision.nodeId} fallback ${decision.fallback} must be present in candidates.`
    );
    if (decision.confidence < 0.7) {
      assert.equal(
        decision.layout === "absolute" || decision.fallback === "absolute",
        true,
        `layout decision ${decision.nodeId} low-confidence layout must include absolute fidelity fallback.`
      );
    }
  }
}

function assertRegionTree(rawSourceNodeIds, normalizedIds, regions, tree) {
  assert.equal(typeof tree, "object", "region_tree must be an object.");
  assert.ok(tree !== null && !Array.isArray(tree), "region_tree must be an object.");
  assert.equal(tree.id, "region_tree_root", "region_tree root id must be stable.");
  assert.ok(Array.isArray(tree.children), "region_tree.children must be an array.");
  assert.equal(tree.children.length, regions.length, "region_tree must include one top-level child per region.");

  const expectedRegionIds = new Set(regions.map((region) => region.id));
  const regionSourceIds = new Set(regions.flatMap((region) => region.sourceNodeIds ?? []));
  const treeSourceIds = new Set();
  const normalizedNodeIdsInTree = new Set();
  walkRegionTreeNode(tree, (node, label) => {
    assert.ok(node.id, `${label}.id must be present.`);
    assert.ok(node.name, `${label}.name must be present.`);
    assertBounds(node.bounds, `${label}.bounds`);
    assertStringArray(node.sourceNodeIds, `${label}.sourceNodeIds`, (sourceNodeId, sourceLabel) => {
      assert.equal(rawSourceNodeIds.has(sourceNodeId), true, `${sourceLabel} references unknown sourceNodeId ${sourceNodeId}.`);
    });
    for (const sourceNodeId of node.sourceNodeIds) treeSourceIds.add(sourceNodeId);
    if (node.normalizedNodeId) {
      assert.equal(normalizedIds.has(node.normalizedNodeId), true, `${label}.normalizedNodeId references unknown normalized node ${node.normalizedNodeId}.`);
      normalizedNodeIdsInTree.add(node.normalizedNodeId);
    }
    if (node.layout) assert.ok(["column", "row", "grid", "stack", "absolute", "leaf"].includes(node.layout), `${label}.layout must be known.`);
    assert.ok(Array.isArray(node.children), `${label}.children must be an array.`);
  });

  for (const child of tree.children) {
    assert.equal(expectedRegionIds.has(child.id), true, `region_tree child ${child.id} must match regions.json.`);
  }
  for (const sourceNodeId of regionSourceIds) {
    assert.equal(treeSourceIds.has(sourceNodeId), true, `region_tree must cover region sourceNodeId ${sourceNodeId}.`);
  }
  assert.ok(normalizedNodeIdsInTree.size > 0, "region_tree must trace at least one normalized node.");
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

function assertAssetManifestContract(
  rawSourceNodeIds,
  canonicalScene,
  manifests,
  effectiveManifest,
  i18nManifest,
  pubspecPatch,
  flutterGenerationManifest,
  materializedReport
) {
  const canonicalNodesBySourceId = canonicalNodesBySourceNodeId(canonicalScene);
  const i18nCoveredSourceIds = new Set((i18nManifest.messages ?? []).map((message) => message.sourceNodeId));
  const nonI18nSourceIds = new Set(
    (i18nManifest.warnings ?? [])
      .filter((warning) => warning.type === "non_i18n" && warning.message)
      .map((warning) => warning.sourceNodeId)
      .filter(Boolean)
  );

  for (const [label, manifest] of manifests) {
    assertSingleAssetManifest(rawSourceNodeIds, canonicalNodesBySourceId, i18nCoveredSourceIds, nonI18nSourceIds, label, manifest);
  }

  const effectiveAssetPaths = fileBackedAssetPaths(effectiveManifest);
  assertPubspecPatch(pubspecPatch, effectiveAssetPaths);
  assertFlutterAssetPlanMatchesPubspec(flutterGenerationManifest, effectiveAssetPaths);
  assertMaterializedAssetReport(materializedReport);
}

function assertSingleAssetManifest(rawSourceNodeIds, canonicalNodesBySourceId, i18nCoveredSourceIds, nonI18nSourceIds, label, manifest) {
  assert.equal(typeof manifest.version, "string", `${label}.version must be present.`);
  assert.ok(Array.isArray(manifest.assets), `${label}.assets must be an array.`);
  assert.ok(Array.isArray(manifest.warnings), `${label}.warnings must be an array.`);

  const assetIds = new Set();
  const usedPaths = new Set();
  const decorativeSliceTextWarnings = new Set();
  for (const warning of manifest.warnings) {
    assert.ok(warning.type, `${label} warning must include type.`);
    assert.ok(warning.message, `${label} warning ${warning.type} must include message.`);
    if (warning.sourceNodeId) {
      assert.equal(rawSourceNodeIds.has(warning.sourceNodeId), true, `${label} warning references unknown sourceNodeId ${warning.sourceNodeId}.`);
    }
    if (warning.type === "decorative_slice_contains_text" && warning.sourceNodeId) decorativeSliceTextWarnings.add(warning.sourceNodeId);
  }

  for (const asset of manifest.assets) {
    const assetLabel = `${label}.assets.${asset.id ?? asset.sourceNodeId ?? "unknown"}`;
    assert.ok(asset.id, `${assetLabel} must include id.`);
    assert.equal(assetIds.has(asset.id), false, `${label} asset id ${asset.id} must be unique.`);
    assetIds.add(asset.id);
    assert.equal(rawSourceNodeIds.has(asset.sourceNodeId), true, `${assetLabel} references unknown sourceNodeId ${asset.sourceNodeId}.`);
    assert.ok(asset.sourceName, `${assetLabel} must include sourceName.`);
    assert.ok([...assetStrategyDirs.keys(), ...pathlessAssetStrategies].includes(asset.strategy), `${assetLabel} strategy must be known.`);
    assert.ok(asset.reason, `${assetLabel} must include reason.`);
    assertScore(asset.confidence, `${assetLabel}.confidence`);
    if (asset.scale !== undefined) {
      assert.equal(typeof asset.scale, "number", `${assetLabel}.scale must be a number.`);
      assert.ok(Number.isFinite(asset.scale) && asset.scale > 0, `${assetLabel}.scale must be positive.`);
    }
    if (asset.cropBounds !== undefined) assertBounds(asset.cropBounds, `${assetLabel}.cropBounds`);
    if (asset.excludeTextNodes !== undefined) {
      assert.equal(typeof asset.excludeTextNodes, "boolean", `${assetLabel}.excludeTextNodes must be boolean.`);
    }

    if (assetStrategyDirs.has(asset.strategy)) {
      assertAssetPathForStrategy(asset, assetLabel);
      assert.equal(usedPaths.has(asset.path), false, `${label} asset path ${asset.path} must be unique.`);
      usedPaths.add(asset.path);
    } else {
      assert.equal(asset.path, undefined, `${assetLabel} must not declare an asset path for ${asset.strategy}.`);
      assert.equal(asset.format, undefined, `${assetLabel} must not declare an asset format for ${asset.strategy}.`);
    }

    const sourceNodes = canonicalNodesBySourceId.get(asset.sourceNodeId) ?? [];
    if (asset.strategy === "real_text" && sourceNodes.some(hasVisibleText)) {
      assert.ok(
        i18nCoveredSourceIds.has(asset.sourceNodeId) || nonI18nSourceIds.has(asset.sourceNodeId),
        `${assetLabel} real_text must be covered by i18n or an explicit non_i18n reason.`
      );
    }
    if (asset.strategy === "decorative_slice") {
      assert.ok(sourceNodes.length > 0, `${assetLabel} decorative_slice must trace to a canonical node.`);
      const containsVisibleText = sourceNodes.some(hasVisibleText);
      assert.ok(
        !containsVisibleText || asset.excludeTextNodes === true || decorativeSliceTextWarnings.has(asset.sourceNodeId),
        `${assetLabel} decorative_slice with visible text descendants must exclude text nodes or emit decorative_slice_contains_text.`
      );
    }
  }
}

function assertAssetPathForStrategy(asset, label) {
  assert.ok(asset.path, `${label} must include path for ${asset.strategy}.`);
  assert.ok(asset.format, `${label} must include format for ${asset.strategy}.`);
  assertSafeAssetPath(asset.path, `${label}.path`);
  const expectedDir = assetStrategyDirs.get(asset.strategy);
  assert.equal(asset.path.startsWith(expectedDir), true, `${label}.path must stay under ${expectedDir}.`);
  const expectedExtensions = assetFormats.get(asset.format);
  assert.ok(expectedExtensions, `${label}.format must be known.`);
  assert.equal(
    expectedExtensions.some((extension) => asset.path.toLowerCase().endsWith(extension)),
    true,
    `${label}.path extension must match ${asset.format}.`
  );
  if (asset.strategy === "svg_icon") assert.equal(asset.format, "svg", `${label} svg_icon must use svg format.`);
  if (asset.strategy === "decorative_slice") {
    assert.ok(asset.reason.trim().length > 0, `${label} decorative_slice must record a reason.`);
  }
}

function assertPubspecPatch(pubspecPatch, effectiveAssetPaths) {
  assert.equal(pubspecPatch.path, "pubspec.yaml", "pubspec_patch.path must target pubspec.yaml.");
  assert.ok(Array.isArray(pubspecPatch.assets), "pubspec_patch.assets must be an array.");
  assert.equal(typeof pubspecPatch.patch, "string", "pubspec_patch.patch must be a string.");
  assert.ok(Array.isArray(pubspecPatch.warnings), "pubspec_patch.warnings must be an array.");

  const pubspecAssets = new Set();
  for (const assetPath of pubspecPatch.assets) {
    assertSafeAssetPath(assetPath, `pubspec_patch.assets.${assetPath}`);
    assert.equal(pubspecAssets.has(assetPath), false, `pubspec_patch asset ${assetPath} must be unique.`);
    pubspecAssets.add(assetPath);
    assert.match(pubspecPatch.patch, new RegExp(escapeRegExp(assetPath)), `pubspec_patch.patch must declare ${assetPath}.`);
  }
  if (effectiveAssetPaths.size === 0) {
    assert.equal(pubspecPatch.patch, "", "pubspec_patch.patch must be empty when no file-backed assets are required.");
  }
  assert.deepEqual(pubspecAssets, effectiveAssetPaths, "pubspec_patch.assets must exactly match file-backed paths from the effective asset manifest.");
}

function assertFlutterAssetPlanMatchesPubspec(flutterGenerationManifest, effectiveAssetPaths) {
  const plannedAssetPaths = new Set(
    (flutterGenerationManifest.assetsToAdd ?? [])
      .filter((asset) => asset.action === "add" && asset.path)
      .map((asset) => asset.path)
  );
  assert.deepEqual(plannedAssetPaths, effectiveAssetPaths, "flutter_generation_manifest.assetsToAdd must match effective file-backed assets.");
}

function assertMaterializedAssetReport(materializedReport) {
  if (!materializedReport) return;
  for (const asset of materializedReport.materialized ?? []) {
    assertSafeAssetPath(asset.path, "materialized asset path");
    assert.equal(existsSync(resolve(root, asset.path)), true, `materialized asset is missing from artifact root: ${asset.path}`);
    assert.equal(
      existsSync(resolve(root, "flutter_preview", asset.path)),
      true,
      `materialized asset is missing from Flutter preview root: ${asset.path}`
    );
    assert.ok(asset.bytes > 0, `materialized asset ${asset.path} must record non-zero bytes.`);
  }
}

function fileBackedAssetPaths(manifest) {
  return new Set((manifest.assets ?? []).filter((asset) => assetStrategyDirs.has(asset.strategy)).map((asset) => asset.path));
}

function canonicalNodesBySourceNodeId(canonicalScene) {
  const nodes = new Map();
  walkCanonicalNode(canonicalScene.root, (node) => {
    if (!node.sourceNodeId) return;
    const bucket = nodes.get(node.sourceNodeId) ?? [];
    bucket.push(node);
    nodes.set(node.sourceNodeId, bucket);
  });
  return nodes;
}

function hasVisibleText(node) {
  if (!node.flags?.isInvisible && !node.flags?.isZeroSize && node.canonicalType === "text" && (node.text?.content?.trim() ?? "")) return true;
  return (node.children ?? []).some(hasVisibleText);
}

function assertSafeAssetPath(path, label) {
  assertSafeRelativePath(path, label);
  assert.equal(path.startsWith("assets/"), true, `${label} must stay under assets/: ${path}`);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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

function assertVisualDiffArtifacts(rawSourceNodeIds, normalized, visualDiffReport, nodeDiffReport, manualReviewReport) {
  assert.equal(typeof visualDiffReport.version, "string", "visual_diff_report.version must be present.");
  assert.equal(typeof visualDiffReport.generatedAt, "string", "visual_diff_report.generatedAt must be present.");
  assertVisualDiffInputs(visualDiffReport.inputs, "visual_diff_report.inputs");
  assert.deepEqual(visualDiffReport.environment.viewport, normalized.source.viewport, "visual diff viewport must match normalized viewport.");
  assert.equal(typeof visualDiffReport.environment.dpr, "number", "visual diff report must record DPR.");
  assert.ok(Number.isFinite(visualDiffReport.environment.dpr) && visualDiffReport.environment.dpr > 0, "visual diff DPR must be positive.");
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
  assert.equal(typeof visualDiffReport.page.pass, "boolean", "visual_diff_report.page.pass must be boolean.");
  assertVisualDiffScore(visualDiffReport.page.score, "visual_diff_report.page.score");
  assertScore(visualDiffReport.page.threshold.visualScore, "visual_diff_report.page.threshold.visualScore");
  assertScore(visualDiffReport.page.threshold.pixelDiffRatio, "visual_diff_report.page.threshold.pixelDiffRatio");
  assert.ok(Array.isArray(visualDiffReport.issues), "visual_diff_report.issues must be an array.");
  assert.ok(Array.isArray(visualDiffReport.warnings), "visual_diff_report.warnings must be an array.");

  assert.ok(Array.isArray(nodeDiffReport), "node_diff_report must be an array.");
  assert.deepEqual(nodeDiffReport, visualDiffReport.issues, "node_diff_report.json must mirror visual_diff_report.issues.");
  const issueIds = new Set();
  for (const issue of nodeDiffReport) {
    assert.ok(issue.issueId, "node diff issue must include issueId.");
    assert.equal(issueIds.has(issue.issueId), false, `Duplicate visual diff issue ${issue.issueId}.`);
    issueIds.add(issue.issueId);
    assert.ok(["pixel_diff_region", "size_mismatch"].includes(issue.type), `visual diff issue ${issue.issueId} type must be known.`);
    if (issue.sourceNodeId) {
      assert.equal(rawSourceNodeIds.has(issue.sourceNodeId), true, `visual diff issue ${issue.issueId} references unknown sourceNodeId ${issue.sourceNodeId}.`);
    }
    if (issue.bounds) assertBounds(issue.bounds, `node_diff_report.${issue.issueId}.bounds`);
    assertVisualDiffScore(issue.score, `node_diff_report.${issue.issueId}.score`);
    assert.ok(Array.isArray(issue.suggestedFixes), `node diff issue ${issue.issueId} must include suggestedFixes.`);
    if (!visualDiffReport.page.pass) assert.ok(issue.suggestedFixes.length > 0, `failing node diff issue ${issue.issueId} must include suggested fixes.`);
  }

  assert.equal(typeof manualReviewReport.version, "string", "manual_review_report.version must be present.");
  assert.equal(typeof manualReviewReport.generatedAt, "string", "manual_review_report.generatedAt must be present.");
  assert.equal(typeof manualReviewReport.required, "boolean", "manual_review_report.required must be boolean.");
  assert.equal(manualReviewReport.required, !visualDiffReport.page.pass, "manual_review_report.required must match visual diff pass state.");
  assert.ok(manualReviewReport.reason, "manual_review_report must include reason.");
  assert.ok(["P0", "P1"].includes(manualReviewReport.severity), "manual_review_report severity must be known.");
  assert.deepEqual(manualReviewReport.inputs, visualDiffReport.inputs, "manual_review_report inputs must match visual_diff_report inputs.");
  assert.deepEqual(manualReviewReport.page, visualDiffReport.page, "manual_review_report page must match visual_diff_report page.");
  assert.ok(Array.isArray(manualReviewReport.issues), "manual_review_report.issues must be an array.");
  assert.ok(Array.isArray(manualReviewReport.suggestedActions), "manual_review_report.suggestedActions must be an array.");
  const manualIssueIds = new Set(manualReviewReport.issues.map((issue) => issue.issueId));
  assert.deepEqual(manualIssueIds, issueIds, "manual_review_report must cover every visual diff issue.");
  if (manualReviewReport.required) {
    assert.ok(manualReviewReport.issues.length > 0, "required manual_review_report must include issues.");
    assert.ok(manualReviewReport.suggestedActions.length > 0, "required manual_review_report must include suggested actions.");
  }
}

function assertVisualDiffInputs(inputs, label) {
  assert.equal(typeof inputs, "object", `${label} must be an object.`);
  assert.ok(inputs !== null && !Array.isArray(inputs), `${label} must be an object.`);
  for (const key of ["reference", "candidate", "heatmap"]) {
    assertSafeRelativePath(inputs[key], `${label}.${key}`);
    assert.equal(existsSync(resolve(root, inputs[key])), true, `${label}.${key} file must exist: ${inputs[key]}`);
    assert.ok(statSync(resolve(root, inputs[key])).size > 0, `${label}.${key} file must be non-empty: ${inputs[key]}`);
  }
}

function assertVisualDiffScore(score, label) {
  assertVisualDiffPixelCounts(score, label);
  assertScore(score.visualScore, `${label}.visualScore`);
  assertScore(score.pixelDiffRatio, `${label}.pixelDiffRatio`);
}

function assertVisualDiffPixelCounts(score, label) {
  assert.equal(typeof score, "object", `${label} must be an object.`);
  assert.ok(score !== null && !Array.isArray(score), `${label} must be an object.`);
  for (const key of ["diffPixels", "totalPixels"]) {
    assert.equal(typeof score[key], "number", `${label}.${key} must be a number.`);
    assert.ok(Number.isInteger(score[key]) && score[key] >= 0, `${label}.${key} must be a non-negative integer.`);
  }
  assert.ok(score.totalPixels > 0, `${label}.totalPixels must be positive.`);
  assert.ok(score.diffPixels <= score.totalPixels, `${label}.diffPixels must not exceed totalPixels.`);
}

function assertFlutterGenerationManifest(rawSourceNodeIds, traceableIds, manifest, visualDiffReport, normalizedDesignIR, overrideSet) {
  assert.equal(typeof manifest.version, "string", "flutter_generation_manifest.version must be present.");
  assert.ok(manifest.buildId, "flutter_generation_manifest.buildId must be present.");
  assert.ok(manifest.generatedAt, "flutter_generation_manifest.generatedAt must be present.");
  assert.ok(Array.isArray(manifest.files), "flutter_generation_manifest.files must be an array.");
  assert.ok(manifest.files.length > 0, "flutter_generation_manifest must describe generated files.");
  for (const file of manifest.files) {
    assertSafeRelativePath(file.path, `flutter_generation_manifest.files.${file.path}.path`);
    assert.ok(["create", "modify", "unchanged", "conflict"].includes(file.action), `flutter_generation_manifest file ${file.path} must have a known action.`);
    assertHash(file.hash, `flutter_generation_manifest.files.${file.path}.hash`);
    if (file.previousHash) assertHash(file.previousHash, `flutter_generation_manifest.files.${file.path}.previousHash`);
    if (file.existingHash) assertHash(file.existingHash, `flutter_generation_manifest.files.${file.path}.existingHash`);
    assert.ok(file.reason, `flutter_generation_manifest file ${file.path} must include reason.`);
    assert.ok(Array.isArray(file.generatedRegions) && file.generatedRegions.length > 0, `flutter_generation_manifest file ${file.path} must include generated regions.`);
    for (const region of file.generatedRegions) {
      assert.ok(region.id, `flutter_generation_manifest file ${file.path} generated region must include id.`);
      assert.ok(region.strategy, `flutter_generation_manifest generated region ${region.id} must include strategy.`);
      assertHash(region.hash, `flutter_generation_manifest.generatedRegions.${region.id}.hash`);
      assertSourceRefs(rawSourceNodeIds, `flutter_generation_manifest.generatedRegions.${region.id}`, [region], (entry) => entry.sourceNodeIds ?? []);
    }
  }

  assertStringArray(manifest.filesToCreate ?? [], "flutter_generation_manifest.filesToCreate", assertSafeRelativePath);
  assert.ok(Array.isArray(manifest.filesToModify ?? []), "flutter_generation_manifest.filesToModify must be an array.");
  for (const file of manifest.filesToModify ?? []) {
    assertSafeRelativePath(file.path, `flutter_generation_manifest.filesToModify.${file.path}.path`);
    if (file.patch) assertSafeRelativePath(file.patch, `flutter_generation_manifest.filesToModify.${file.path}.patch`);
    assert.ok(["create", "modify", "unchanged", "conflict"].includes(file.action), `flutter_generation_manifest modified file ${file.path} must have a known action.`);
  }

  assert.ok(Array.isArray(manifest.assetsToAdd ?? []), "flutter_generation_manifest.assetsToAdd must be an array.");
  for (const asset of manifest.assetsToAdd ?? []) {
    assert.equal(rawSourceNodeIds.has(asset.sourceNodeId), true, `flutter_generation_manifest asset ${asset.assetId} references unknown sourceNodeId ${asset.sourceNodeId}.`);
    if (asset.path) assertSafeRelativePath(asset.path, `flutter_generation_manifest.assetsToAdd.${asset.assetId}.path`);
    assert.ok(asset.reason, `flutter_generation_manifest asset ${asset.assetId} must include reason.`);
  }

  assertStringArray(manifest.arbKeysToAdd ?? [], "flutter_generation_manifest.arbKeysToAdd");
  assertStringArray(manifest.blockingTasks ?? [], "flutter_generation_manifest.blockingTasks");
  if (manifest.generatedWidgets) {
    assert.ok(Array.isArray(manifest.generatedWidgets), "flutter_generation_manifest.generatedWidgets must be an array.");
    for (const widget of manifest.generatedWidgets) {
      assertSafeRelativePath(widget.path, `flutter_generation_manifest.generatedWidgets.${widget.regionId}.path`);
      assert.ok(widget.regionId, `flutter_generation_manifest generated widget for ${widget.path} must include regionId.`);
      assert.ok(widget.strategy, `flutter_generation_manifest generated widget ${widget.regionId} must include strategy.`);
      assertHash(widget.hash, `flutter_generation_manifest.generatedWidgets.${widget.regionId}.hash`);
      assertSourceRefs(rawSourceNodeIds, `flutter_generation_manifest.generatedWidgets.${widget.regionId}`, [widget], (entry) => entry.sourceNodeIds ?? []);
    }
  }
  if (manifest.fallbackRegions) {
    assert.ok(Array.isArray(manifest.fallbackRegions), "flutter_generation_manifest.fallbackRegions must be an array.");
    for (const region of manifest.fallbackRegions) {
      assert.equal(traceableIds.has(region.nodeId), true, `flutter_generation_manifest fallback region references unknown nodeId ${region.nodeId}.`);
      assertSourceRefs(rawSourceNodeIds, `flutter_generation_manifest.fallbackRegions.${region.nodeId}`, [region], (entry) => entry.sourceNodeIds ?? []);
      assert.ok(region.strategy, `flutter_generation_manifest fallback region ${region.nodeId} must include strategy.`);
      assert.ok(region.reason, `flutter_generation_manifest fallback region ${region.nodeId} must include reason.`);
    }
  }
  if (manifest.unresolvedReviewTasks) {
    assert.ok(Array.isArray(manifest.unresolvedReviewTasks), "flutter_generation_manifest.unresolvedReviewTasks must be an array.");
    for (const task of manifest.unresolvedReviewTasks) {
      assert.ok(task.id, "flutter_generation_manifest unresolved task must include id.");
      assert.ok(task.type, `flutter_generation_manifest unresolved task ${task.id} must include type.`);
      assert.ok(["P0", "P1", "P2"].includes(task.priority), `flutter_generation_manifest unresolved task ${task.id} must include priority.`);
      assert.ok(task.title, `flutter_generation_manifest unresolved task ${task.id} must include title.`);
      assertScore(task.confidence, `flutter_generation_manifest.unresolvedReviewTasks.${task.id}.confidence`);
      assert.ok(task.target && typeof task.target === "object" && !Array.isArray(task.target), `flutter_generation_manifest unresolved task ${task.id} must include target.`);
    }
  }
  if (manifest.format) {
    assert.ok(["success", "failed", "skipped", "unknown"].includes(manifest.format.status), "flutter_generation_manifest.format.status must be known.");
  }
  if (manifest.analyze) {
    assert.ok(Number.isInteger(manifest.analyze.errors) && manifest.analyze.errors >= 0, "flutter_generation_manifest.analyze.errors must be a non-negative integer.");
    assert.ok(Number.isInteger(manifest.analyze.warnings) && manifest.analyze.warnings >= 0, "flutter_generation_manifest.analyze.warnings must be a non-negative integer.");
  }
  if (manifest.gates) {
    assert.equal(typeof manifest.gates.canWrite, "boolean", "flutter_generation_manifest.gates.canWrite must be boolean.");
    assert.ok(["ready", "blocked"].includes(manifest.gates.status), "flutter_generation_manifest.gates.status must be known.");
    assert.equal(manifest.gates.canWrite, manifest.gates.status === "ready", "flutter_generation_manifest.gates.canWrite must match gate status.");
    assert.ok(Array.isArray(manifest.gates.blockers), "flutter_generation_manifest.gates.blockers must be an array.");
    assert.ok(Array.isArray(manifest.gates.warnings), "flutter_generation_manifest.gates.warnings must be an array.");
    for (const blocker of manifest.gates.blockers) {
      assert.ok(blocker.type, "flutter_generation_manifest gate blocker must include type.");
      assert.ok(blocker.message, `flutter_generation_manifest gate blocker ${blocker.type} must include message.`);
    }
    for (const warning of manifest.gates.warnings) {
      assert.ok(warning.type, "flutter_generation_manifest gate warning must include type.");
      assert.ok(warning.message, `flutter_generation_manifest gate warning ${warning.type} must include message.`);
    }
    assertCodegenGateDiagnostics(manifest, visualDiffReport, normalizedDesignIR, overrideSet);
  }
}

function assertCodegenGateDiagnostics(manifest, visualDiffReport, normalizedDesignIR, overrideSet) {
  const blockerTypes = new Set((manifest.gates?.blockers ?? []).map((blocker) => blocker.type));
  if (manifest.format?.status === "failed") {
    assert.equal(blockerTypes.has("dart_format_failed"), true, "flutter_generation_manifest must block writes when dart format fails.");
  }
  if ((manifest.analyze?.errors ?? 0) > 0) {
    assert.equal(blockerTypes.has("flutter_analyze_failed"), true, "flutter_generation_manifest must block writes when flutter analyze reports errors.");
  }
  if (visualDiffReport?.page?.pass === false && !hasExplicitLowVisualScoreOverride(normalizedDesignIR, overrideSet)) {
    assert.equal(blockerTypes.has("visual_diff_failed"), true, "flutter_generation_manifest must block writes when visual diff fails without an explicit override.");
  }
  const hasRequiredBlocker =
    manifest.format?.status === "failed" ||
    (manifest.analyze?.errors ?? 0) > 0 ||
    (visualDiffReport?.page?.pass === false && !hasExplicitLowVisualScoreOverride(normalizedDesignIR, overrideSet));
  if (manifest.gates?.canWrite === true) {
    assert.equal(hasRequiredBlocker, false, "flutter_generation_manifest.gates.canWrite cannot be true while a required codegen gate is failing.");
  }
}

function hasExplicitLowVisualScoreOverride(normalizedDesignIR, overrideSet) {
  if (!normalizedDesignIR?.tree) return false;
  const rootId = normalizedDesignIR.tree.id;
  const rootSourceNodeIds = new Set(normalizedDesignIR.tree.sourceNodeIds ?? []);
  for (const override of overrideSet?.overrides ?? []) {
    if (override.status !== "active" || override.type !== "render_strategy_override") continue;
    const payload = override.payload ?? {};
    const strategy = stringValue(payload.strategy);
    const action = stringValue(payload.action);
    const targetNodeId = stringValue(payload.targetNodeId) ?? override.target?.normalizedNodeId;
    const payloadSourceNodeId = stringValue(payload.sourceNodeId) ?? override.target?.sourceNodeId;
    const targetsRoot = override.target?.kind === "page" || targetNodeId === rootId || (payloadSourceNodeId ? rootSourceNodeIds.has(payloadSourceNodeId) : false);
    if (!targetsRoot) continue;
    if (strategy === "frame_screenshot_asset") return true;
    if (action === "accept_low_visual_score" || action === "allow_low_visual_score" || payload.acceptLowVisualScore === true) return true;
  }
  return false;
}

function assertRepairArtifacts(repairPatch, repairIterationLog, visualDiffReport, nodeDiffReport) {
  assert.equal(typeof repairPatch.version, "string", "repair_patch.version must be present.");
  assert.equal(typeof repairPatch.generatedAt, "string", "repair_patch.generatedAt must be present.");
  assert.ok(["applied", "rolled_back", "proposed", "not_needed"].includes(repairPatch.status), "repair_patch.status must be known.");
  const issueIds = new Set((nodeDiffReport ?? []).map((issue) => issue.issueId));
  issueIds.add("page");
  if (repairPatch.inputs) {
    assert.deepEqual(repairPatch.inputs, visualDiffReport.inputs, "repair_patch inputs must match visual_diff_report inputs.");
  }
  if (repairPatch.page) {
    assert.deepEqual(repairPatch.page, visualDiffReport.page, "repair_patch page must match visual_diff_report page.");
  }
  if (visualDiffReport.page.pass) {
    assert.equal(repairPatch.status, "not_needed", "passing visual diff must not require a repair patch.");
  }
  if (Array.isArray(repairPatch.patches)) {
    assert.deepEqual(repairPatch.inputs, visualDiffReport.inputs, "visual diff repair_patch inputs must match visual_diff_report inputs.");
    assert.deepEqual(repairPatch.page, visualDiffReport.page, "visual diff repair_patch page must match visual_diff_report page.");
    if (!visualDiffReport.page.pass) assert.ok(repairPatch.patches.length > 0, "failing visual diff must propose at least one rollbackable repair patch.");
    for (const patch of repairPatch.patches) {
      assert.ok(patch.patchId, `repair patch ${patch.issueId ?? "unknown"} must include patchId.`);
      assert.equal(issueIds.has(patch.issueId), true, `repair patch ${patch.patchId} references unknown visual diff issue ${patch.issueId}.`);
      assert.equal(patch.target, "override_set", `repair patch ${patch.patchId ?? patch.issueId} must target override_set.`);
      assert.equal(patch.operation, "add_override", `repair patch ${patch.patchId ?? patch.issueId} must add an override.`);
      assert.ok(patch.override?.id, `repair patch ${patch.patchId ?? patch.issueId} must include override metadata.`);
      assert.equal(patch.rollback?.type, "disable_override", `repair patch ${patch.patchId ?? patch.issueId} must include rollback metadata.`);
      assert.equal(patch.rollback.overrideId, patch.override.id, `repair patch ${patch.patchId ?? patch.issueId} rollback must target its override.`);
      assert.ok(patch.reason, `repair patch ${patch.patchId ?? patch.issueId} must include a reason.`);
      if (patch.sourceNodeId) {
        const issue = nodeDiffReport.find((entry) => entry.issueId === patch.issueId);
        assert.equal(issue?.sourceNodeId, patch.sourceNodeId, `repair patch ${patch.patchId} sourceNodeId must match its visual diff issue.`);
      }
      if (patch.override.payload?.diffIssueId) {
        assert.equal(patch.override.payload.diffIssueId, patch.issueId, `repair patch ${patch.patchId} override payload must trace to its diff issue.`);
      }
    }
  } else {
    assert.equal(issueIds.has(repairPatch.issueId), true, `workbench repair_patch references unknown visual diff issue ${repairPatch.issueId}.`);
    assert.ok(["add_override", "replace_override"].includes(repairPatch.operation), "workbench repair_patch operation must be known.");
    assert.ok(repairPatch.overrideId, "workbench repair_patch must include overrideId.");
    assert.ok(repairPatch.afterOverride?.id || repairPatch.rollbackReport, "workbench repair_patch must include applied override or rollback report.");
    assert.ok(["disable_override", "restore_override"].includes(repairPatch.rollback?.type), "workbench repair_patch must be rollbackable.");
    assert.equal(repairPatch.rollback.overrideId, repairPatch.overrideId, "workbench repair rollback must target the patch override.");
    if (repairPatch.afterOverride) {
      assert.equal(repairPatch.afterOverride.id, repairPatch.overrideId, "workbench repair_patch afterOverride must match overrideId.");
      assert.equal(repairPatch.afterOverride.payload?.diffIssueId, repairPatch.issueId, "workbench repair override must trace to its diff issue.");
    }
    if (repairPatch.rollback?.type === "restore_override") {
      assert.equal(repairPatch.rollback.override?.id, repairPatch.overrideId, "workbench restore rollback must embed the previous override.");
    }
    if (repairPatch.status === "rolled_back") {
      assert.equal(repairPatch.rollbackReport?.overrideId, repairPatch.overrideId, "rolled back repair_patch must include rollback report.");
      assert.equal(repairPatch.rollbackReport?.rollbackType, repairPatch.rollback?.type, "rolled back repair_patch report must match rollback type.");
    }
  }

  assert.equal(typeof repairIterationLog.version, "string", "repair_iteration_log.version must be present.");
  assert.ok(repairIterationLog.generatedAt || repairIterationLog.updatedAt, "repair_iteration_log must include generatedAt or updatedAt.");
  assert.equal(typeof repairIterationLog.maxIterations, "number", "repair_iteration_log.maxIterations must be present.");
  assert.ok(
    Number.isInteger(repairIterationLog.maxIterations) && repairIterationLog.maxIterations > 0 && repairIterationLog.maxIterations <= 3,
    "repair_iteration_log.maxIterations must be a positive integer no greater than 3."
  );
  assert.ok(Array.isArray(repairIterationLog.iterations), "repair_iteration_log.iterations must be an array.");
  assert.ok(repairIterationLog.iterations.length > 0, "repair_iteration_log must record at least one iteration.");
  const automaticIterations = repairIterationLog.iterations.filter((entry) => Number.isInteger(entry.iteration));
  assert.ok(
    automaticIterations.length <= repairIterationLog.maxIterations,
    "repair_iteration_log automatic iterations must not exceed maxIterations."
  );
  for (const entry of repairIterationLog.iterations) {
    const entryTimestamp = entry.generatedAt ?? repairIterationLog.generatedAt ?? repairIterationLog.updatedAt;
    assert.equal(typeof entryTimestamp, "string", "repair iteration entry must include generatedAt or inherit the log timestamp.");
    if (Number.isInteger(entry.iteration)) {
      assert.ok(entry.iteration >= 0 && entry.iteration < repairIterationLog.maxIterations, "repair iteration index must be within maxIterations.");
      assert.ok(["not_run", "proposed", "applied", "rolled_back"].includes(entry.status), "repair iteration status must be known.");
      assertScore(entry.visualScore, `repair_iteration_log.iterations.${entry.iteration}.visualScore`);
      assertScore(entry.pixelDiffRatio, `repair_iteration_log.iterations.${entry.iteration}.pixelDiffRatio`);
      assertSafeRelativePath(entry.repairPatchPath, `repair_iteration_log.iterations.${entry.iteration}.repairPatchPath`);
      assert.equal(typeof entry.rollbackAvailable, "boolean", "repair iteration rollbackAvailable must be boolean.");
      assert.ok(entry.reason, "repair iteration must include reason.");
    }
    if (entry.event) {
      assert.ok(["applied", "rolled_back"].includes(entry.event), "workbench repair iteration event must be known.");
      assert.ok(entry.overrideId, "workbench repair iteration event must include overrideId.");
      assertSafeRelativePath(entry.repairPatchPath, `repair_iteration_log.events.${entry.overrideId}.repairPatchPath`);
      assert.equal(typeof entry.rollbackAvailable, "boolean", "workbench repair iteration event must record rollback availability.");
      assert.ok(entry.reason, "workbench repair iteration event must include reason.");
      assertHash(entry.overrideHash, `repair_iteration_log.events.${entry.overrideId}.overrideHash`);
      if (entry.event === "applied") {
        const eventIssueIds = new Set(Array.isArray(entry.visualDiffIssueIds) ? entry.visualDiffIssueIds : [...issueIds]);
        assert.equal(eventIssueIds.has(entry.issueId), true, `workbench applied repair event references unknown visual diff issue ${entry.issueId}.`);
        assert.ok(entry.visualDiffGeneratedAt, "workbench applied repair event must record the source visual diff timestamp.");
        assert.ok(["add_override", "replace_override"].includes(entry.operation), "workbench applied repair event operation must be known.");
        assertScore(entry.visualScore, `repair_iteration_log.events.${entry.overrideId}.visualScore`);
        assertScore(entry.pixelDiffRatio, `repair_iteration_log.events.${entry.overrideId}.pixelDiffRatio`);
        assert.equal(entry.rollbackAvailable, true, "workbench applied repair event must be rollbackable.");
      }
      if (entry.event === "rolled_back") {
        assert.ok(["disable_override", "restore_override"].includes(entry.rollbackType), "workbench rolled_back repair event rollbackType must be known.");
        assert.equal(entry.rollbackAvailable, false, "workbench rolled_back repair event must not advertise an active rollback.");
      }
    }
  }
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

function walkRegionTreeNode(node, visit, label = "region_tree") {
  visit(node, label);
  for (const child of node.children ?? []) walkRegionTreeNode(child, visit, `${label}.${child.id}`);
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

function assertStringArray(values, label, each = undefined) {
  assert.ok(Array.isArray(values), `${label} must be an array.`);
  for (const value of values) {
    assert.equal(typeof value, "string", `${label} entries must be strings.`);
    assert.ok(value.length > 0, `${label} entries must not be empty.`);
    if (each) each(value, `${label}.${value}`);
  }
}

function assertSafeRelativePath(path, label) {
  assert.equal(typeof path, "string", `${label} must be a string.`);
  assert.ok(path.length > 0, `${label} must not be empty.`);
  assert.equal(path.startsWith("/"), false, `${label} must be relative.`);
  assert.equal(path.includes(".."), false, `${label} must not contain parent traversal.`);
}

function assertHash(value, label) {
  assert.match(value, /^sha256_[a-f0-9]{64}$/, `${label} must be a sha256 hash.`);
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

function stringValue(value) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
