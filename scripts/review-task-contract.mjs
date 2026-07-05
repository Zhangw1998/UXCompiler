import assert from "node:assert/strict";

const allowedPriorities = new Set(["P0", "P1", "P2"]);
const allowedStatuses = new Set(["open", "closed"]);
const allowedOverrideTypes = new Set([
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

export function assertReviewTaskContract(tasks, label = "review tasks") {
  assert.ok(Array.isArray(tasks), `${label} must be an array`);
  const ids = new Set();
  for (const task of tasks) {
    assert.equal(typeof task.id, "string", `${label}: task id must be a string`);
    assert.ok(task.id.length > 0, `${label}: task id must not be empty`);
    assert.equal(ids.has(task.id), false, `${label}: duplicate task id ${task.id}`);
    ids.add(task.id);

    assert.ok(allowedPriorities.has(task.priority), `${task.id}: invalid priority`);
    assert.ok(allowedStatuses.has(task.status), `${task.id}: invalid status`);
    assert.equal(typeof task.target, "object", `${task.id}: missing target`);
    assert.ok(task.target !== null && !Array.isArray(task.target), `${task.id}: target must be an object`);
    assert.ok(
      hasNonEmptyString(task.target.normalizedNodeId) || hasSourceNodeTrace(task.target),
      `${task.id}: target must trace to normalizedNodeId or sourceNodeIds`
    );
    assert.equal(typeof task.confidence, "number", `${task.id}: confidence must be a number`);
    assert.ok(task.confidence >= 0 && task.confidence <= 1, `${task.id}: confidence must be normalized`);
    assert.ok(hasNonEmptyString(task.title), `${task.id}: title must not be empty`);
    assert.ok(hasNonEmptyString(task.description), `${task.id}: description must not be empty`);
    assert.equal(typeof task.evidence, "object", `${task.id}: evidence must be an object`);
    assert.ok(task.evidence !== null && !Array.isArray(task.evidence), `${task.id}: evidence must be an object`);
    assertSuggestedActions(task);
  }
}

function assertSuggestedActions(task) {
  assert.ok(Array.isArray(task.suggestedActions), `${task.id}: suggestedActions must be an array`);
  assert.ok(task.suggestedActions.length > 0, `${task.id}: expected at least one suggested action`);
  for (const [index, action] of task.suggestedActions.entries()) {
    assert.ok(hasNonEmptyString(action.label), `${task.id}: action ${index} label must not be empty`);
    assert.equal(typeof action.override, "object", `${task.id}: action ${index} override must be an object`);
    assert.ok(action.override !== null && !Array.isArray(action.override), `${task.id}: action ${index} override must be an object`);
    assert.ok(allowedOverrideTypes.has(action.override.type), `${task.id}: action ${index} has invalid override type ${action.override.type}`);
    assert.equal(typeof action.override.payload, "object", `${task.id}: action ${index} override payload must be an object`);
    assert.ok(action.override.payload !== null && !Array.isArray(action.override.payload), `${task.id}: action ${index} override payload must be an object`);
    assert.ok(hasNonEmptyString(action.override.reason), `${task.id}: action ${index} override reason must not be empty`);
  }
}

function hasSourceNodeTrace(target) {
  return Array.isArray(target.sourceNodeIds) && target.sourceNodeIds.some(hasNonEmptyString);
}

function hasNonEmptyString(value) {
  return typeof value === "string" && value.length > 0;
}
