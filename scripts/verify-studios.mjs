import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { applyStudioOperations } from "../packages/studios/dist/index.js";

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
    format: "png",
    path: "assets/slices/divider_dot.png",
    reason: "Export divider dot as a decorative slice."
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
assert.equal(divider.path, "assets/slices/divider_dot.png");
assert.equal(divider.format, "png");

assert.ok(result.finalI18nManifest.messages.some((message) => message.key === "loginSubmitLabel"));
assert.ok(!result.finalI18nManifest.messages.some((message) => message.key === "subtitle"));
assert.equal(result.finalArbFile.loginSubmitLabel, "Sign in");
assert.equal(result.finalArbFile.subtitle, undefined);
assert.ok(result.overrideConflictReport.warnings.some((warning) => warning.type === "unsupported_override" && warning.overrideId.includes("approve_primary_button")));

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
    }
  ]
});
assert.equal(invalid.overrideMutations.length, 0);
assert.ok(invalid.validationReport.issues.some((issue) => issue.code === "invalid_component"));
assert.ok(invalid.validationReport.issues.some((issue) => issue.code === "invalid_i18n_key"));

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
const cliRegistry = JSON.parse(readFileSync(resolve(studioDir, "component_registry.json"), "utf8"));
assert.equal(cliRegistry.components[0].id, "cmp_primary_button");

console.log("studios verification passed");

function readJson(file) {
  return JSON.parse(readFileSync(resolve(baseDir, file), "utf8"));
}
