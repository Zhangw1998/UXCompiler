import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyTreeEdits } from "../packages/tree-editor/dist/index.js";

const root = "artifacts/tree-editor-smoke";
const baseDir = resolve(root, "base");
const draftDir = resolve(root, "draft");
const operationsPath = resolve(root, "tree_operations.json");
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });

execFileSync(
  "node",
  [
    "apps/cli/dist/index.js",
    "compile",
    "--input",
    "examples/fixtures/login_raw_figma_scene.json",
    "--out",
    baseDir
  ],
  { stdio: "pipe" }
);

const input = {
  normalizedDesignIR: readJson("normalized_design_ir.json"),
  assetManifest: readJson("asset_manifest.json"),
  i18nManifest: readJson("i18n_manifest.json"),
  inferredTokens: readJson("inferred_tokens.json"),
  overrideSet: readJson("override_set.json"),
  actor: "agent",
  now: () => new Date("2026-07-04T00:00:00.000Z")
};

const operations = [
  {
    id: "create_hero_region",
    kind: "create_region",
    regionId: "region_hero",
    name: "HeroRegion",
    role: "header",
    sourceNodeIds: ["1:3", "1:4"],
    layout: "column",
    reason: "Group title and subtitle into a reviewed hero region."
  },
  {
    id: "split_credentials",
    kind: "split_region",
    sourceRegionId: "n_1_5",
    regionId: "region_credentials",
    name: "CredentialsRegion",
    role: "content",
    sourceNodeIds: ["1:6", "1:9"],
    layout: "column",
    reason: "Split credential fields from the generated form region."
  },
  {
    id: "move_divider_into_form",
    kind: "move_node",
    sourceNodeId: "1:17",
    targetNormalizedParentId: "n_1_5",
    reason: "Pin divider dot under the reviewed form region."
  },
  {
    id: "rename_title",
    kind: "rename_node",
    sourceNodeId: "1:3",
    name: "HeroTitle",
    reason: "Use a stable semantic tree name."
  },
  {
    id: "force_footer_stack",
    kind: "force_layout",
    sourceNodeId: "1:15",
    strategy: "stack",
    reason: "Lock footer layout for manual review."
  },
  {
    id: "force_button_asset",
    kind: "force_render",
    sourceNodeId: "1:12",
    strategy: "asset_slice",
    reason: "Preserve button fidelity as a slice for the draft preview."
  }
];

const result = applyTreeEdits({
  ...input,
  operations
});
assert.equal(result.validationReport.issues.length, 0);
assert.equal(result.overrideMutations.length, operations.length);
assert.match(result.overrideSet.hash, /^sha256_[a-f0-9]{64}$/);
assert.equal(findNode(result.draftNormalizedDesignIR.tree, "region_hero").role, "header");
assert.equal(findNode(result.draftNormalizedDesignIR.tree, "region_hero").children.length, 2);
assert.equal(findNode(result.draftNormalizedDesignIR.tree, "region_credentials").children.length, 2);
assert.equal(findNode(result.draftNormalizedDesignIR.tree, "n_1_3").name, "HeroTitle");
assert.equal(findNode(result.draftNormalizedDesignIR.tree, "n_1_15").layout.type, "stack");
assert.equal(findNode(result.draftNormalizedDesignIR.tree, "n_1_12").render.strategy, "asset_slice");
assert.ok(findNode(result.draftNormalizedDesignIR.tree, "n_1_5").children.some((child) => child.sourceNodeIds.includes("1:17")));

const mergeResult = applyTreeEdits({
  ...input,
  operations: [
    {
      id: "merge_form_footer",
      kind: "merge_regions",
      sourceRegionIds: ["n_1_5", "n_1_15"],
      targetRegionId: "region_bottom",
      name: "BottomRegion",
      role: "footer",
      layout: "stack",
      reason: "Merge form and footer into a reviewed bottom region."
    }
  ]
});
assert.equal(mergeResult.validationReport.issues.length, 0);
assert.equal(findNode(mergeResult.draftNormalizedDesignIR.tree, "region_bottom").children.length, 6);
assert.throws(() => findNode(mergeResult.draftNormalizedDesignIR.tree, "n_1_5"));

const invalidCycle = applyTreeEdits({
  ...input,
  operations: [
    {
      id: "cycle_move",
      kind: "move_node",
      normalizedNodeId: "n_1_5",
      targetNormalizedParentId: "n_1_6",
      reason: "This should be rejected because it creates a cycle."
    }
  ]
});
assert.equal(invalidCycle.overrideMutations.length, 0);
assert.ok(invalidCycle.validationReport.issues.some((issue) => issue.code === "cycle"));

const invalidTextSlice = applyTreeEdits({
  ...input,
  operations: [
    {
      id: "text_slice",
      kind: "force_render",
      sourceNodeId: "1:3",
      strategy: "asset_slice",
      reason: "Text should not be forced to an asset slice."
    }
  ]
});
assert.equal(invalidTextSlice.overrideMutations.length, 0);
assert.ok(invalidTextSlice.validationReport.issues.some((issue) => issue.code === "invalid_render_strategy"));

const invalidDuplicateCreateSources = applyTreeEdits({
  ...input,
  operations: [
    {
      id: "duplicate_create_sources",
      kind: "create_region",
      regionId: "region_duplicate_sources",
      name: "DuplicateSources",
      role: "content",
      sourceNodeIds: ["1:3", "1:3"],
      layout: "column",
      reason: "This should be rejected because source nodes are repeated."
    }
  ]
});
assert.equal(invalidDuplicateCreateSources.overrideMutations.length, 0);
assert.ok(invalidDuplicateCreateSources.validationReport.issues.some((issue) => issue.code === "duplicate_source"));

const invalidDuplicateSplitSources = applyTreeEdits({
  ...input,
  operations: [
    {
      id: "duplicate_split_sources",
      kind: "split_region",
      sourceRegionId: "n_1_5",
      regionId: "region_duplicate_split",
      name: "DuplicateSplit",
      role: "content",
      sourceNodeIds: ["1:6", "1:6"],
      layout: "column",
      reason: "This should be rejected because split source nodes are repeated."
    }
  ]
});
assert.equal(invalidDuplicateSplitSources.overrideMutations.length, 0);
assert.ok(invalidDuplicateSplitSources.validationReport.issues.some((issue) => issue.code === "duplicate_source"));

const invalidDuplicateMergeRegions = applyTreeEdits({
  ...input,
  operations: [
    {
      id: "duplicate_merge_regions",
      kind: "merge_regions",
      sourceRegionIds: ["n_1_5", "n_1_5"],
      targetRegionId: "region_duplicate_merge",
      name: "DuplicateMerge",
      role: "content",
      layout: "stack",
      reason: "This should be rejected because merge source regions are repeated."
    }
  ]
});
assert.equal(invalidDuplicateMergeRegions.overrideMutations.length, 0);
assert.ok(invalidDuplicateMergeRegions.validationReport.issues.some((issue) => issue.code === "duplicate_source"));

const invalidMissingTarget = applyTreeEdits({
  ...input,
  operations: [
    {
      id: "missing_target_id",
      kind: "rename_node",
      name: "NoTarget",
      reason: "This should be rejected because no target id was provided."
    }
  ]
});
assert.equal(invalidMissingTarget.overrideMutations.length, 0);
assert.ok(invalidMissingTarget.validationReport.issues.some((issue) => issue.code === "missing_target"));

writeFileSync(operationsPath, `${JSON.stringify(operations, null, 2)}\n`);
execFileSync(
  "node",
  [
    "apps/cli/dist/index.js",
    "tree",
    "apply",
    "--artifacts",
    baseDir,
    "--operations",
    operationsPath,
    "--out",
    draftDir,
    "--actor",
    "agent"
  ],
  { stdio: "pipe" }
);
for (const file of [
  "tree_edit_report.json",
  "override_set.json",
  "reviewed_normalized_design_ir.json",
  "override_conflict_report.json",
  "stale_override_report.json"
]) {
  assert.equal(existsSync(resolve(draftDir, file)), true, `Missing ${file}`);
}
const cliReport = JSON.parse(readFileSync(resolve(draftDir, "tree_edit_report.json"), "utf8"));
assert.equal(cliReport.validationReport.validOperationIds.length, operations.length);

console.log("tree editor verification passed");

function readJson(file) {
  return JSON.parse(readFileSync(resolve(baseDir, file), "utf8"));
}

function findNode(rootNode, id) {
  const found = maybeFindNode(rootNode, id);
  if (found) return found;
  throw new Error(`Missing node ${id}`);
}

function maybeFindNode(rootNode, id) {
  if (rootNode.id === id) return rootNode;
  for (const child of rootNode.children ?? []) {
    const found = maybeFindNode(child, id);
    if (found) return found;
  }
  return undefined;
}
