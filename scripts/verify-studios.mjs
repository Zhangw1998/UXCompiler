import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyStudioOperations } from "../packages/studios/dist/index.js";
import { applyOverrides } from "../packages/override-engine/dist/index.js";

const root = "artifacts/studios-smoke";
const baseDir = resolve(root, "base");
const studioDir = resolve(root, "studio");
const operationsPath = resolve(root, "studio_operations.json");
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
    id: "approve_primary_button",
    kind: "approve_component",
    componentId: "cmp_primary_button",
    name: "PrimaryButton",
    instances: ["1:12", "1:13"],
    reason: "Approve the inferred login primary button component."
  },
  {
    id: "primary_button_label_prop",
    kind: "define_component_prop",
    componentId: "cmp_primary_button",
    prop: {
      name: "label",
      type: "text",
      sourceSelector: "sourceNodeId:1:14"
    },
    reason: "Expose button label as a component prop."
  },
  {
    id: "primary_button_state_variant",
    kind: "define_component_variant",
    componentId: "cmp_primary_button",
    variant: {
      name: "state",
      values: ["default", "disabled"]
    },
    reason: "Track state variants for the button."
  },
  {
    id: "primary_button_flutter_mapping",
    kind: "map_flutter_component",
    componentId: "cmp_primary_button",
    flutter: {
      import: "package:app/ui/app_button.dart",
      constructor: "AppButton.primary",
      props: {
        label: { from: "prop.label", i18n: true }
      }
    },
    reason: "Map the reviewed component to an existing Flutter widget."
  },
  {
    id: "rename_primary_text_color",
    kind: "rename_token",
    tokenType: "color",
    from: "color_text_primary",
    to: "color_text_body",
    reason: "Use project naming for primary text color."
  },
  {
    id: "merge_compact_spacing",
    kind: "merge_tokens",
    tokenType: "spacing",
    sourceTokenNames: ["space_10", "space_12"],
    canonicalTokenName: "space_compact",
    reason: "Merge close compact spacing values."
  },
  {
    id: "split_input_radius",
    kind: "split_token",
    tokenType: "radius",
    sourceTokenName: "radius_16",
    tokens: [
      { name: "radius_email_field", value: 16, aliases: [16], sourceNodeIds: ["1:7"] },
      { name: "radius_password_field", value: 16, aliases: [16], sourceNodeIds: ["1:10"] }
    ],
    reason: "Split field radii for project token mapping."
  },
  {
    id: "divider_asset_slice",
    kind: "set_asset_strategy",
    assetId: "asset_1_17",
    strategy: "decorative_slice",
    sourceName: "Divider Dot Slice",
    format: "png",
    path: "assets/slices/divider_dot.png",
    scale: 2,
    cropBounds: { x: 185, y: 622, w: 20, h: 20 },
    excludeTextNodes: true,
    reason: "Export divider dot as a decorative slice."
  },
  {
    id: "accept_generated_title_key",
    kind: "accept_i18n_key",
    messageKey: "title",
    reason: "Accept the generated title i18n key."
  },
  {
    id: "rename_button_label_key",
    kind: "rename_i18n_key",
    messageKey: "button_label",
    key: "loginSubmitLabel",
    description: "Primary login form submit button label.",
    reason: "Use project i18n key naming."
  },
  {
    id: "button_label_placeholder",
    kind: "define_i18n_placeholder",
    sourceNodeId: "1:14",
    placeholder: {
      name: "ctaLabel",
      type: "String",
      example: "Sign in",
      description: "Resolved submit button label."
    },
    reason: "Track typed ARB placeholder metadata for generated localization."
  },
  {
    id: "subtitle_non_i18n",
    kind: "mark_non_i18n",
    messageKey: "subtitle",
    reason: "Subtitle is replaced by product copy outside this screen."
  }
];

const result = applyStudioOperations({
  ...input,
  operations
});
assert.equal(result.validationReport.issues.length, 0);
assert.equal(result.overrideMutations.length, operations.length);
assert.match(result.overrideSet.hash, /^sha256_[a-f0-9]{64}$/);

const component = result.componentRegistry.components.find((candidate) => candidate.id === "cmp_primary_button");
assert.equal(component.name, "PrimaryButton");
assert.equal(component.props[0].sourceSelector, "sourceNodeId:1:14");
assert.equal(component.variants[0].values.includes("disabled"), true);
assert.equal(component.flutter.constructor, "AppButton.primary");

assert.ok(result.tokenRegistry.tokens.some((token) => token.name === "color_text_body" && token.type === "color"));
assert.ok(result.tokenRegistry.tokens.some((token) => token.name === "space_compact" && token.type === "spacing"));
assert.ok(!result.tokenRegistry.tokens.some((token) => token.name === "space_10"));
assert.ok(result.tokenRegistry.tokens.some((token) => token.name === "radius_email_field" && token.type === "radius"));
assert.ok(result.tokenRegistry.tokens.some((token) => token.name === "radius_password_field" && token.type === "radius"));

const divider = result.finalAssetManifest.assets.find((asset) => asset.id === "asset_1_17");
assert.equal(divider.strategy, "decorative_slice");
assert.equal(divider.sourceName, "Divider Dot Slice");
assert.equal(divider.path, "assets/slices/divider_dot.png");
assert.equal(divider.format, "png");
assert.equal(divider.scale, 2);
assert.deepEqual(divider.cropBounds, { x: 185, y: 622, w: 20, h: 20 });
assert.equal(divider.excludeTextNodes, true);
const dividerOverride = result.overrideMutations.find((override) => override.id === "ovr_studio_divider_asset_slice");
assert.equal(dividerOverride.payload.sourceName, "Divider Dot Slice");

assert.ok(result.finalI18nManifest.messages.some((message) => message.key === "loginSubmitLabel"));
assert.ok(!result.finalI18nManifest.messages.some((message) => message.key === "subtitle"));
assert.ok(result.finalI18nManifest.warnings.every((warning) => warning.type !== "non_i18n" || warning.sourceNodeId));
assert.equal(result.finalI18nManifest.messages.find((message) => message.key === "loginSubmitLabel").placeholders.ctaLabel.type, "String");
assert.equal(result.finalI18nManifest.messages.find((message) => message.key === "title").confidence, 1);
assert.equal(result.finalArbFile.loginSubmitLabel, "Sign in");
assert.equal(result.finalArbFile["@loginSubmitLabel"].placeholders.ctaLabel.example, "Sign in");
assert.equal(result.finalArbFile.subtitle, undefined);
assert.equal(result.overrideConflictReport.warnings.some((warning) => warning.type === "unsupported_override" && warning.overrideId.includes("approve_primary_button")), false);

const replayed = applyOverrides({
  normalizedDesignIR: input.normalizedDesignIR,
  assetManifest: input.assetManifest,
  i18nManifest: input.i18nManifest,
  inferredTokens: input.inferredTokens,
  overrideSet: result.overrideSet
});
const replayedComponent = replayed.reviewedNormalizedDesignIR.components.find((candidate) => candidate.componentId === "cmp_primary_button");
assert.equal(replayedComponent.name, "PrimaryButton");
assert.equal(replayedComponent.props[0].name, "label");
assert.equal(replayedComponent.variants[0].name, "state");
assert.equal(replayedComponent.flutter.constructor, "AppButton.primary");
assert.equal(replayedComponent.verified, true);
assert.equal(replayed.reviewedI18nManifest.messages.some((message) => message.key === "subtitle"), false);
assert.equal(replayed.reviewedArbFile.subtitle, undefined);
assert.ok(replayed.reviewedI18nManifest.warnings.some((warning) => warning.type === "non_i18n" && warning.sourceNodeId === "1:4"));
assert.ok(replayed.staleOverrideReport.appliedOverrideIds.includes("ovr_studio_approve_primary_button"));
assert.ok(replayed.staleOverrideReport.appliedOverrideIds.includes("ovr_studio_primary_button_flutter_mapping"));
assert.ok(replayed.staleOverrideReport.appliedOverrideIds.includes("ovr_studio_subtitle_non_i18n"));

const disabledNonI18n = applyStudioOperations({
  ...input,
  overrideSet: result.overrideSet,
  operations: [
    {
      id: "disable_subtitle_non_i18n",
      kind: "disable_override",
      overrideId: "ovr_studio_subtitle_non_i18n",
      reason: "Undo the non-i18n decision so subtitle returns to ARB output."
    }
  ]
});
assert.equal(disabledNonI18n.validationReport.issues.length, 0);
assert.equal(disabledNonI18n.overrideMutations.length, 1);
assert.equal(disabledNonI18n.overrideMutations[0].status, "disabled");
assert.equal(disabledNonI18n.overrideSet.overrides.find((override) => override.id === "ovr_studio_subtitle_non_i18n").status, "disabled");
assert.ok(disabledNonI18n.finalI18nManifest.messages.some((message) => message.key === "subtitle"));
assert.equal(disabledNonI18n.finalArbFile.subtitle, "Sign in to continue your workspace");

const invalid = applyStudioOperations({
  ...input,
  operations: [
    {
      id: "bad_single_component",
      kind: "approve_component",
      componentId: "cmp_single",
      name: "single_button",
      instances: ["1:12"],
      reason: "Should be rejected because the component name is invalid and it has one instance."
    },
    {
      id: "bad_i18n_key",
      kind: "rename_i18n_key",
      messageKey: "title",
      key: "BadKey",
      reason: "Should be rejected because the key is not lowerCamelCase."
    },
    {
      id: "bad_i18n_placeholder",
      kind: "define_i18n_placeholder",
      messageKey: "title",
      placeholder: {
        name: "BadPlaceholder",
        type: ""
      },
      reason: "Should be rejected because placeholder name and type are invalid."
    },
    {
      id: "bad_accept_i18n",
      kind: "accept_i18n_key",
      messageKey: "missingKey",
      reason: "Should be rejected because the i18n message target is missing."
    },
    {
      id: "bad_asset_missing_target",
      kind: "set_asset_strategy",
      strategy: "image_asset",
      path: "assets/images/missing_target.png",
      reason: "Should be rejected because assetId or sourceNodeId is required."
    },
    {
      id: "bad_asset_duplicate_path",
      kind: "set_asset_strategy",
      assetId: "asset_1_2",
      strategy: "image_asset",
      path: "assets/icons/divider_dot.svg",
      reason: "Should be rejected because another asset already uses this path."
    },
    {
      id: "bad_asset_scale",
      kind: "set_asset_strategy",
      assetId: "asset_1_2",
      strategy: "image_asset",
      path: "assets/images/hero.png",
      scale: 8,
      reason: "Should be rejected because the export scale is out of range."
    },
    {
      id: "bad_asset_crop",
      kind: "set_asset_strategy",
      assetId: "asset_1_2",
      strategy: "image_asset",
      path: "assets/images/hero_crop.png",
      cropBounds: { x: 0, y: 0, w: 0, h: 12 },
      reason: "Should be rejected because crop bounds must have positive dimensions."
    },
    {
      id: "bad_asset_path_traversal",
      kind: "set_asset_strategy",
      assetId: "asset_1_2",
      strategy: "image_asset",
      path: "../outside.png",
      reason: "Should be rejected because asset paths must stay under assets/."
    },
    {
      id: "bad_disable_missing_override",
      kind: "disable_override",
      overrideId: "ovr_missing",
      reason: "Should be rejected because the override does not exist."
    }
  ]
});
assert.equal(invalid.overrideMutations.length, 0);
assert.ok(invalid.validationReport.issues.some((issue) => issue.code === "invalid_component"));
assert.ok(invalid.validationReport.issues.some((issue) => issue.code === "invalid_i18n_key"));
assert.ok(invalid.validationReport.issues.some((issue) => issue.code === "invalid_i18n_placeholder"));
assert.ok(invalid.validationReport.issues.some((issue) => issue.operationId === "bad_asset_missing_target" && issue.code === "invalid_asset"));
assert.ok(invalid.validationReport.issues.some((issue) => issue.operationId === "bad_asset_duplicate_path" && issue.code === "invalid_asset"));
assert.ok(invalid.validationReport.issues.some((issue) => issue.operationId === "bad_asset_scale" && issue.code === "invalid_asset"));
assert.ok(invalid.validationReport.issues.some((issue) => issue.operationId === "bad_asset_crop" && issue.code === "invalid_asset"));
assert.ok(invalid.validationReport.issues.some((issue) => issue.operationId === "bad_asset_path_traversal" && issue.code === "invalid_asset"));
assert.ok(invalid.validationReport.issues.some((issue) => issue.operationId === "bad_disable_missing_override" && issue.code === "invalid_override"));

const sequentialApprove = applyStudioOperations({
  ...input,
  operations: [
    {
      id: "seq_approve_card",
      kind: "approve_component",
      componentId: "cmp_seq_card",
      name: "SeqCard",
      instances: ["1:5"],
      allowSingleUse: true,
      reason: "Approve a single-use component in the first Studio operation."
    },
    {
      id: "seq_non_i18n",
      kind: "mark_non_i18n",
      messageKey: "subtitle",
      reason: "Keep non-i18n state across later Studio operations."
    }
  ]
});
assert.equal(sequentialApprove.validationReport.issues.length, 0);
const sequentialProp = applyStudioOperations({
  ...input,
  overrideSet: sequentialApprove.overrideSet,
  operations: [
    {
      id: "seq_card_title_prop",
      kind: "define_component_prop",
      componentId: "cmp_seq_card",
      prop: {
        name: "title",
        type: "text",
        sourceSelector: "sourceNodeId:1:3"
      },
      reason: "Add a prop in a later Studio operation."
    }
  ]
});
const sequentialComponent = sequentialProp.componentRegistry.components.find((candidate) => candidate.id === "cmp_seq_card");
assert.equal(sequentialComponent.name, "SeqCard");
assert.equal(sequentialComponent.props[0].name, "title");
assert.ok(!sequentialProp.finalI18nManifest.messages.some((message) => message.key === "subtitle"));
assert.ok(sequentialProp.finalI18nManifest.warnings.every((warning) => warning.type !== "non_i18n" || warning.sourceNodeId));

const duplicateI18nManifest = {
  ...input.i18nManifest,
  messages: [
    ...input.i18nManifest.messages,
    {
      key: "button_label_duplicate",
      value: "Sign in",
      sourceNodeId: "duplicate:button",
      description: "Duplicate button text from another node.",
      confidence: 0.61
    }
  ]
};
const duplicateMerge = applyStudioOperations({
  ...input,
  i18nManifest: duplicateI18nManifest,
  operations: [
    {
      id: "merge_duplicate_button_label",
      kind: "merge_i18n_messages",
      messageKey: "button_label_duplicate",
      targetMessageKey: "button_label",
      reason: "Merge duplicate button text into the canonical key."
    }
  ]
});
assert.equal(duplicateMerge.validationReport.issues.length, 0);
assert.equal(duplicateMerge.finalI18nManifest.messages.some((message) => message.key === "button_label_duplicate"), false);
assert.equal(duplicateMerge.finalArbFile.button_label, "Sign in");
assert.equal(duplicateMerge.finalArbFile.button_label_duplicate, undefined);
assert.ok(duplicateMerge.finalI18nManifest.warnings.some((warning) => warning.type === "merged_duplicate_text"));
const duplicateReplay = applyOverrides({
  normalizedDesignIR: input.normalizedDesignIR,
  assetManifest: input.assetManifest,
  i18nManifest: duplicateI18nManifest,
  inferredTokens: input.inferredTokens,
  overrideSet: duplicateMerge.overrideSet
});
assert.equal(duplicateReplay.reviewedI18nManifest.messages.some((message) => message.key === "button_label_duplicate"), false);
assert.equal(duplicateReplay.reviewedArbFile.button_label_duplicate, undefined);
assert.ok(duplicateReplay.reviewedI18nManifest.warnings.some((warning) => warning.type === "merged_duplicate_text" && warning.sourceNodeId === "duplicate:button"));
assert.ok(duplicateReplay.staleOverrideReport.appliedOverrideIds.includes("ovr_studio_merge_duplicate_button_label"));

const invalidDuplicateMerge = applyStudioOperations({
  ...input,
  i18nManifest: duplicateI18nManifest,
  operations: [
    {
      id: "merge_different_text",
      kind: "merge_i18n_messages",
      messageKey: "title",
      targetMessageKey: "button_label",
      reason: "Should be rejected because the source and target text differ."
    }
  ]
});
assert.ok(invalidDuplicateMerge.validationReport.issues.some((issue) => issue.code === "invalid_i18n_key"));

writeFileSync(operationsPath, `${JSON.stringify(operations, null, 2)}\n`);
execFileSync(
  "node",
  [
    "apps/cli/dist/index.js",
    "studio",
    "apply",
    "--artifacts",
    baseDir,
    "--operations",
    operationsPath,
    "--out",
    studioDir,
    "--actor",
    "agent"
  ],
  { stdio: "pipe" }
);

for (const file of [
  "studio_report.json",
  "override_set.json",
  "component_registry.json",
  "token_registry.json",
  "final_asset_manifest.json",
  "final_i18n_manifest.json",
  "arb/app_en.arb",
  "override_conflict_report.json",
  "stale_override_report.json"
]) {
  assert.equal(existsSync(resolve(studioDir, file)), true, `Missing ${file}`);
}
assert.equal(existsSync(resolve(studioDir, "assets/slices/divider_dot.png")), true, "Missing CLI Studio decorative slice asset file");
const cliRegistry = JSON.parse(readFileSync(resolve(studioDir, "component_registry.json"), "utf8"));
assert.equal(cliRegistry.components[0].id, "cmp_primary_button");

console.log("studios verification passed");

function readJson(file) {
  return JSON.parse(readFileSync(resolve(baseDir, file), "utf8"));
}
