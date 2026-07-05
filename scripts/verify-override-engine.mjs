import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = "artifacts/override-engine-smoke";
const overrideSetPath = resolve(root, "override_set_input.json");
rmSync(root, { recursive: true, force: true });
mkdirSync(root, { recursive: true });

writeFileSync(
  overrideSetPath,
  `${JSON.stringify(
    {
      id: "ovset_smoke",
      version: 1,
      snapshotId: "sample",
      hash: "",
      overrides: [
        override("ovr_name_title", "naming_override", { kind: "normalized_node", normalizedNodeId: "n_1_3" }, { name: "HeroTitle" }),
        override("ovr_layout_footer", "layout_strategy_override", { kind: "source_node", sourceNodeId: "1:15" }, { strategy: "stack" }),
        override("ovr_render_button", "render_strategy_override", { kind: "source_node", sourceNodeId: "1:12" }, { strategy: "asset_slice" }),
        override(
          "ovr_asset_dot",
          "asset_strategy_override",
          { kind: "asset", assetId: "asset_1_17" },
          {
            strategy: "decorative_slice",
            format: "png",
            path: "assets/slices/divider_dot.png",
            scale: 3,
            cropBounds: { x: 180, y: 620, w: 22, h: 22 },
            excludeTextNodes: true,
            reason: "Smoke override"
          }
        ),
        override("ovr_i18n_title", "i18n_key_override", { kind: "i18n_message", messageKey: "title" }, { key: "loginTitle" }),
        override("ovr_i18n_subtitle_non", "i18n_key_override", { kind: "i18n_message", messageKey: "subtitle" }, {
          key: "subtitle",
          nonI18nReason: "Subtitle copy is managed outside this generated screen.",
          reason: "Mark subtitle as non-i18n."
        }),
        override("ovr_token_radius", "token_rename_override", { kind: "token", tokenName: "radius_18" }, { from: "radius_18", to: "radius_cta" }),
        override("ovr_component_button", "component_candidate_override", { kind: "page" }, {
          kind: "approve_component",
          componentId: "cmp_primary_button",
          name: "PrimaryButton",
          instances: ["1:12", "1:14"],
          reason: "Approve the primary button as a reusable component."
        }),
        override("ovr_component_button_label", "component_prop_override", { kind: "page" }, {
          kind: "define_component_prop",
          componentId: "cmp_primary_button",
          prop: { name: "label", type: "text", sourceSelector: "sourceNodeId:1:14" },
          reason: "Expose the primary button label."
        }),
        override("ovr_component_button_state", "component_variant_override", { kind: "page" }, {
          kind: "define_component_variant",
          componentId: "cmp_primary_button",
          variant: { name: "state", values: ["default", "disabled"] },
          reason: "Track primary button state variants."
        }),
        override("ovr_component_button_flutter", "flutter_component_mapping_override", { kind: "page" }, {
          kind: "map_flutter_component",
          componentId: "cmp_primary_button",
          flutter: { import: "package:app/ui/app_button.dart", constructor: "AppButton.primary" },
          reason: "Map the approved button to an app component."
        }),
        override("ovr_component_footer", "component_candidate_override", { kind: "page" }, {
          kind: "approve_component",
          componentId: "cmp_footer_link",
          name: "FooterLink",
          instances: ["1:16", "1:18"],
          reason: "Approve footer links without conflicting with the button component."
        }),
        override("ovr_component_reject", "component_candidate_override", { kind: "page" }, {
          kind: "reject_component",
          componentId: "cmp_rejected_decoration",
          reason: "Reject a decorative component candidate."
        }),
        override("ovr_font_inter", "font_mapping_override", { kind: "token", tokenName: "text_body" }, { fromFamily: "System", fallbackFamily: "Inter" }),
        override("ovr_text_title_calibration", "text_calibration_override", { kind: "normalized_node", normalizedNodeId: "n_1_3" }, {
          baselineShift: -1,
          lineHeight: 42,
          letterSpacing: 0.2,
          bboxDelta: { y: -1 },
          reason: "Calibrate the title text baseline and line height after visual diff."
        }),
        override("ovr_stale", "naming_override", { kind: "normalized_node", normalizedNodeId: "missing_node" }, { name: "Missing" }),
        override("ovr_conflict_a", "naming_override", { kind: "normalized_node", normalizedNodeId: "n_1_4" }, { name: "SubtitleA" }),
        override("ovr_conflict_b", "naming_override", { kind: "normalized_node", normalizedNodeId: "n_1_4" }, { name: "SubtitleB" })
      ]
    },
    null,
    2
  )}\n`
);

execFileSync(
  "node",
  [
    "apps/cli/dist/index.js",
    "compile",
    "--input",
    "examples/fixtures/login_raw_figma_scene.json",
    "--out",
    root,
    "--override-set",
    overrideSetPath
  ],
  { stdio: "pipe" }
);

for (const file of [
  "override_set.json",
  "reviewed_normalized_design_ir.json",
  "reviewed_asset_manifest.json",
  "reviewed_i18n_manifest.json",
  "reviewed_inferred_tokens.json",
  "reviewed_arb/app_en.arb",
  "override_conflict_report.json",
  "stale_override_report.json"
]) {
  assert.equal(existsSync(resolve(root, file)), true, `Missing ${file}`);
}

const original = readJson("normalized_design_ir.json");
const reviewed = readJson("reviewed_normalized_design_ir.json");
const assetManifest = readJson("reviewed_asset_manifest.json");
const i18nManifest = readJson("reviewed_i18n_manifest.json");
const tokens = readJson("reviewed_inferred_tokens.json");
const arb = readJson("reviewed_arb/app_en.arb");
const overrideSet = readJson("override_set.json");
const conflicts = readJson("override_conflict_report.json");
const stale = readJson("stale_override_report.json");
const reviewTasks = readJson("review_tasks.json");
const taskStatusReport = readJson("task_status_report.json");

assert.equal(findNode(original.tree, "n_1_3").name, "TitleText");
assert.equal(findNode(reviewed.tree, "n_1_3").name, "HeroTitle");
assert.equal(findNode(reviewed.tree, "n_1_3").baselineShift, -1);
assert.equal(findNode(reviewed.tree, "n_1_3").lineHeight, 42);
assert.equal(findNode(reviewed.tree, "n_1_3").letterSpacing, 0.2);
assert.equal(findNode(reviewed.tree, "n_1_3").bounds.y, 95);
assert.equal(findNode(reviewed.tree, "n_1_3").render.textCalibration.baselineShift, -1);
assert.deepEqual(findNode(reviewed.tree, "n_1_3").render.textCalibration.boundsDelta, { x: 0, y: -1, w: 0, h: 0 });
assert.ok(findNode(reviewed.tree, "n_1_3").overrideRefs.includes("ovr_text_title_calibration"));
assert.equal(findNode(reviewed.tree, "n_1_15").layout.type, "stack");
assert.equal(findNode(reviewed.tree, "n_1_12").render.strategy, "asset_slice");
assert.ok(findNode(reviewed.tree, "n_1_12").overrideRefs.includes("ovr_render_button"));

const dividerAsset = assetManifest.assets.find((asset) => asset.id === "asset_1_17");
assert.equal(dividerAsset.strategy, "decorative_slice");
assert.equal(dividerAsset.path, "assets/slices/divider_dot.png");
assert.equal(dividerAsset.scale, 3);
assert.deepEqual(dividerAsset.cropBounds, { x: 180, y: 620, w: 22, h: 22 });
assert.equal(dividerAsset.excludeTextNodes, true);

assert.ok(i18nManifest.messages.some((message) => message.key === "loginTitle" && message.sourceNodeId === "1:3"));
assert.equal(i18nManifest.messages.some((message) => message.key === "subtitle"), false);
assert.ok(i18nManifest.warnings.some((warning) => warning.type === "non_i18n" && warning.sourceNodeId === "1:4"));
assert.equal(arb.loginTitle, "Welcome back");
assert.equal(arb.subtitle, undefined);
assert.ok(tokens.radii.some((token) => token.name === "radius_cta" && token.confidence === 1));
const primaryButton = reviewed.components.find((component) => component.componentId === "cmp_primary_button");
assert.equal(primaryButton.name, "PrimaryButton");
assert.deepEqual(primaryButton.sourceInstances, ["1:12", "1:14"]);
assert.equal(primaryButton.props[0].name, "label");
assert.equal(primaryButton.variants[0].values.includes("disabled"), true);
assert.equal(primaryButton.flutter.constructor, "AppButton.primary");
assert.equal(primaryButton.verified, true);
assert.ok(reviewed.components.some((component) => component.componentId === "cmp_footer_link"));
assert.equal(reviewed.components.some((component) => component.componentId === "cmp_rejected_decoration"), false);
assert.match(overrideSet.hash, /^sha256_[a-f0-9]{64}$/);
assert.ok(stale.appliedOverrideIds.includes("ovr_font_inter"));
assert.ok(stale.appliedOverrideIds.includes("ovr_component_button"));
assert.ok(stale.appliedOverrideIds.includes("ovr_component_button_label"));
assert.ok(stale.appliedOverrideIds.includes("ovr_component_button_state"));
assert.ok(stale.appliedOverrideIds.includes("ovr_component_button_flutter"));
assert.ok(stale.appliedOverrideIds.includes("ovr_text_title_calibration"));
assert.ok(conflicts.warnings.some((entry) => entry.overrideId === "ovr_font_inter" && entry.type === "configuration_override"));
assert.equal(conflicts.warnings.some((entry) => entry.overrideId?.startsWith("ovr_component_") && entry.type === "unsupported_override"), false);
assert.equal(conflicts.warnings.some((entry) => entry.overrideId === "ovr_text_title_calibration" && entry.type === "unsupported_override"), false);
assert.ok(stale.staleOverrides.some((entry) => entry.overrideId === "ovr_stale"));
assert.ok(stale.appliedOverrideIds.includes("ovr_name_title"));
assert.ok(reviewTasks.some((task) => task.type === "stale_override" && task.evidence.overrideId === "ovr_stale"));
assert.equal(taskStatusReport.byType.stale_override, 1);
assert.ok(
  conflicts.conflicts.some(
    (entry) => entry.type === "duplicate_target" && entry.overrideIds.includes("ovr_conflict_a") && entry.overrideIds.includes("ovr_conflict_b")
  )
);
assert.equal(conflicts.conflicts.some((entry) => entry.overrideIds.some((overrideId) => overrideId.startsWith("ovr_component_"))), false);

console.log("override engine verification passed");

function override(id, type, target, payload) {
  return {
    id,
    type,
    target,
    payload,
    status: "active",
    createdBy: "agent",
    createdAt: "2026-07-04T00:00:00.000Z"
  };
}

function readJson(file) {
  return JSON.parse(readFileSync(resolve(root, file), "utf8"));
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
