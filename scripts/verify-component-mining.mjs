import assert from "node:assert/strict";
import { compileRawScene } from "../packages/normalizer/dist/index.js";

const rawScene = {
  version: "2.0",
  source: {
    fileKey: "fixture-component-mining",
    pageId: "0:1",
    frameNodeId: "1:1",
    exportedAt: "2026-07-05T00:00:00Z",
    viewport: { width: 390, height: 844, scale: 1 }
  },
  root: {
    id: "1:1",
    name: "Component Mining Fixture",
    type: "FRAME",
    visible: true,
    absoluteBoundingBox: { x: 0, y: 0, width: 390, height: 844 },
    layoutMode: "NONE",
    fills: [solid(0.96, 0.97, 0.98)],
    children: [
      button("1:10", "Primary Button", 24, 40, "Add item"),
      button("1:20", "Primary Button", 24, 120, "Save item"),
      card("1:30", "Product Card", 24, 220, "Starter Kit", "Ready to ship"),
      card("1:40", "Product Card", 24, 390, "Design Pack", "Includes icons"),
      listItem("1:50", "List Item", 24, 600, "Workspace Alpha"),
      listItem("1:60", "List Item", 24, 680, "Workspace Beta")
    ]
  }
};

const result = compileRawScene(rawScene);
const inferred = result.inferredComponents;
const instanceMap = result.componentInstanceMap;
const confidenceReport = result.componentConfidenceReport;

assert.equal(inferred.status, "candidates_detected");
assert.equal(inferred.fallback, undefined);
assert.ok(inferred.confidence >= 0.75);

const candidates = inferred.candidates.map((candidate) => {
  assert.ok(candidate && typeof candidate === "object" && !Array.isArray(candidate));
  return candidate;
});

assertComponent(candidates, "Button", "PrimaryButton", ["1:10", "1:20"], ["label"]);
assertComponent(candidates, "Card", "ProductCard", ["1:30", "1:40"], ["title", "subtitle"]);
assertComponent(candidates, "ListItem", "ListItem", ["1:50", "1:60"], ["title"]);

assert.equal(instanceMap.components.length, 3);
for (const component of instanceMap.components) {
  assert.equal(component.status, "candidate");
  assert.equal(component.instances.length, 2);
  assert.ok(component.instances.every((instance) => instance.sourceNodeIds.length === 1));
}

assert.equal(confidenceReport.status, "ready");
assert.equal(confidenceReport.candidates.length, 3);
assert.ok(confidenceReport.candidates.every((candidate) => candidate.instanceCount === 2));
assert.ok(confidenceReport.candidates.every((candidate) => candidate.gate === "needs_review" || candidate.gate === "auto_reusable"));

console.log("component mining verification passed");

function assertComponent(candidates, kind, name, instances, propNames) {
  const candidate = candidates.find((entry) => entry.kind === kind);
  assert.ok(candidate, `Missing ${kind} component candidate`);
  assert.equal(candidate.name, name);
  assert.deepEqual(candidate.sourceInstances, instances);
  assert.ok(candidate.confidence >= 0.75, `${kind} confidence should meet review threshold`);
  assert.ok(candidate.evidence.length > 0, `${kind} should include evidence`);

  const props = candidate.props ?? [];
  assert.deepEqual(
    props.map((prop) => prop.name),
    propNames,
    `${kind} props should come from stable text slots`
  );
  assert.ok(props.every((prop) => prop.sourceNodeIds.length === instances.length));
}

function button(id, name, x, y, label) {
  return group(id, name, x, y, 342, 56, [
    rect(`${id}:1`, "Button Background", x, y, 342, 56, 18, [solid(0.09, 0.33, 0.84)]),
    text(`${id}:2`, "Button Label", x + 132, y + 16, 88, 24, label, 16, 600)
  ]);
}

function card(id, name, x, y, title, subtitle) {
  return group(id, name, x, y, 342, 132, [
    rect(`${id}:1`, "Card Background", x, y, 342, 132, 20, [solid(1, 1, 1)]),
    rect(`${id}:2`, "Card Image", x + 16, y + 20, 64, 64, 16, [solid(0.82, 0.88, 0.96)]),
    text(`${id}:3`, "Card Title", x + 96, y + 28, 180, 24, title, 18, 700),
    text(`${id}:4`, "Card Subtitle", x + 96, y + 60, 180, 22, subtitle, 14, 400)
  ]);
}

function listItem(id, name, x, y, title) {
  return group(id, name, x, y, 342, 56, [
    rect(`${id}:1`, "List Icon", x, y + 8, 40, 40, 12, [solid(0.9, 0.93, 0.98)]),
    text(`${id}:2`, "List Title", x + 56, y + 16, 180, 24, title, 16, 500),
    rect(`${id}:3`, "List Chevron", x + 318, y + 24, 8, 8, 2, [solid(0.2, 0.24, 0.32)])
  ]);
}

function group(id, name, x, y, width, height, children) {
  return {
    id,
    name,
    type: "GROUP",
    visible: true,
    absoluteBoundingBox: { x, y, width, height },
    children
  };
}

function rect(id, name, x, y, width, height, radius, fills) {
  return {
    id,
    name,
    type: "RECTANGLE",
    visible: true,
    absoluteBoundingBox: { x, y, width, height },
    cornerRadius: radius,
    fills
  };
}

function text(id, name, x, y, width, height, characters, fontSize, fontWeight) {
  return {
    id,
    name,
    type: "TEXT",
    visible: true,
    absoluteBoundingBox: { x, y, width, height },
    characters,
    style: {
      fontName: { family: "Inter", style: fontWeight >= 600 ? "Semi Bold" : "Regular" },
      fontSize,
      fontWeight,
      lineHeightPx: height,
      letterSpacing: 0
    },
    fills: [solid(0.08, 0.09, 0.11)]
  };
}

function solid(r, g, b) {
  return { type: "SOLID", color: { r, g, b } };
}
