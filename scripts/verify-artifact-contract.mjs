import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = resolve(process.argv[2] ?? "artifacts/sample");

const requiredJsonFiles = [
  "raw_figma_scene.json",
  "canonical_scene.json",
  "node_mapping.json",
  "inferred_tokens.json",
  "asset_manifest.json",
  "i18n_manifest.json",
  "normalized_design_ir.json",
  "visual_ir.json",
  "semantic_ir.json",
  "semantic_labels.json",
  "normalization_report.json",
  "render_strategy_manifest.json",
  "fidelity_generation_manifest.json",
  "visual_diff_report.json",
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
const canonical = json("canonical_scene.json");
const mapping = json("node_mapping.json");
const tokens = json("inferred_tokens.json");
const assetManifest = json("asset_manifest.json");
const i18nManifest = json("i18n_manifest.json");
const normalized = json("normalized_design_ir.json");
const semanticLabels = json("semantic_labels.json");
const semanticIR = json("semantic_ir.json");
const normalizationReport = json("normalization_report.json");
const renderStrategyManifest = json("render_strategy_manifest.json");
const fidelityManifest = json("fidelity_generation_manifest.json");
const visualDiffReport = json("visual_diff_report.json");
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

assertSourceRefs(rawSourceNodeIds, "asset_manifest.assets", assetManifest.assets, (entry) => [entry.sourceNodeId]);
assertSourceRefs(rawSourceNodeIds, "i18n_manifest.messages", i18nManifest.messages, (entry) => [entry.sourceNodeId]);
assertSourceRefs(rawSourceNodeIds, "semantic_labels.regions", semanticLabels.regions, (entry) => entry.sourceNodeIds ?? []);
assertSourceRefs(rawSourceNodeIds, "semantic_labels.nodes", semanticLabels.nodes, (entry) => entry.sourceNodeIds ?? []);
assertSourceRefs(rawSourceNodeIds, "semantic_labels.assets", semanticLabels.assets, (entry) => [entry.sourceNodeId]);
assertSourceRefs(rawSourceNodeIds, "semantic_labels.i18n", semanticLabels.i18n, (entry) => [entry.sourceNodeId]);
assertSourceRefs(rawSourceNodeIds, "render_strategy_manifest.regions", renderStrategyManifest.regions, (entry) => entry.sourceNodeIds ?? []);
assertVisibleTextI18nCoverage(canonical, i18nManifest);
assertAssetManifestPaths(assetManifest, materializedAssetReport);

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
assert.equal(typeof visualDiffReport.environment.renderer, "string", "visual diff report must record renderer.");
assertScore(visualDiffReport.page.score.visualScore, "visual_diff_report.page.score.visualScore");
assertScore(visualDiffReport.page.score.pixelDiffRatio, "visual_diff_report.page.score.pixelDiffRatio");

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

function walkNormalizedNode(node, visit) {
  visit(node);
  for (const child of node.children ?? []) walkNormalizedNode(child, visit);
}

function assertSourceRefs(sourceIds, label, entries, selectIds) {
  assert.ok(Array.isArray(entries), `${label} must be an array.`);
  for (const entry of entries) {
    for (const sourceNodeId of selectIds(entry).filter(Boolean)) {
      assert.equal(sourceIds.has(sourceNodeId), true, `${label} references unknown sourceNodeId ${sourceNodeId}.`);
    }
  }
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
