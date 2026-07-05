import assert from "node:assert/strict";
import { inferLayout } from "../packages/layout-inferencer/dist/index.js";

const tokens = {
  version: "2.0",
  colors: [],
  spacing: [],
  typography: [],
  radii: []
};

const cases = [
  {
    name: "column",
    expected: "column",
    children: [
      rect("c_column_a", 24, 16, 80, 20),
      rect("c_column_b", 24, 52, 80, 20),
      rect("c_column_c", 24, 88, 80, 20)
    ]
  },
  {
    name: "row",
    expected: "row",
    children: [
      rect("c_row_a", 16, 24, 24, 44),
      rect("c_row_b", 56, 24, 24, 44),
      rect("c_row_c", 96, 24, 24, 44)
    ]
  },
  {
    name: "grid",
    expected: "grid",
    fallback: "absolute",
    children: [
      rect("c_grid_a", 16, 16, 32, 32),
      rect("c_grid_b", 76, 16, 32, 32),
      rect("c_grid_c", 16, 76, 32, 32),
      rect("c_grid_d", 76, 76, 32, 32)
    ]
  },
  {
    name: "stack",
    expected: "stack",
    children: [
      rect("c_stack_a", 20, 20, 96, 96),
      rect("c_stack_b", 44, 44, 96, 96)
    ]
  },
  {
    name: "absolute",
    expected: "absolute",
    children: [
      rect("c_absolute_a", 89, 139, 54, 25),
      rect("c_absolute_b", 149, 142, 53, 35),
      rect("c_absolute_c", 98, 52, 40, 18)
    ]
  },
  {
    name: "leaf",
    expected: "leaf",
    children: []
  }
];

for (const testCase of cases) {
  const result = inferLayout(scene(testCase.name, testCase.children), tokens);
  assertArtifactShape(result, testCase.name);

  const rootId = rootIdFor(testCase.name);
  const decision = findDecision(result, rootId);
  assert.equal(decision.layout, testCase.expected, `${testCase.name} root should infer ${testCase.expected}`);
  assert.equal(result.normalizedDesignIR.tree.layout.type, testCase.expected);

  if (testCase.fallback) {
    assert.equal(decision.fallback, testCase.fallback, `${testCase.name} should preserve fidelity fallback`);
    assert.ok(
      result.normalizedDesignIR.fallbacks.some(
        (fallback) => fallback.nodeId === rootId && fallback.strategy === testCase.fallback
      ),
      `${testCase.name} fallback should be recorded in normalized IR`
    );
  }

  if (testCase.expected === "absolute") {
    assert.ok(decision.confidence < 0.7, "absolute fallback decisions should stay low confidence");
  }

  const rootCandidates = findCandidates(result, rootId);
  assert.ok(rootCandidates.some((candidate) => candidate.layout === testCase.expected));
  if (testCase.expected !== "leaf") {
    assert.ok(rootCandidates.some((candidate) => candidate.layout === "absolute"));
  }
}

console.log("layout inferencer verification passed");

function assertArtifactShape(result, name) {
  assert.ok(result.regions.length > 0, `${name} should emit at least one region`);
  assert.ok(result.layoutCandidates.length > 0, `${name} should emit layout candidates`);
  assert.ok(result.layoutDecisions.length > 0, `${name} should emit layout decisions`);
  assert.equal(result.normalizedDesignIR.version, "2.0");
  assert.ok(result.normalizedDesignIR.confidence.layout >= 0);
  assert.ok(result.normalizedDesignIR.confidence.layout <= 1);

  for (const candidateGroup of result.layoutCandidates) {
    assert.ok(candidateGroup.nodeId, "layout candidate group should include nodeId");
    assert.ok(candidateGroup.candidates.length > 0, `candidate group ${candidateGroup.nodeId} should not be empty`);
    for (const candidate of candidateGroup.candidates) {
      assert.ok(candidate.score >= 0 && candidate.score <= 1, `${candidate.layout} score should be normalized`);
      assert.ok(candidate.evidence.length > 0, `${candidate.layout} candidate should include evidence`);
    }
  }

  for (const decision of result.layoutDecisions) {
    assert.ok(decision.nodeId, "layout decision should include nodeId");
    assert.ok(decision.score >= 0 && decision.score <= 1, `${decision.nodeId} score should be normalized`);
    assert.ok(decision.confidence >= 0 && decision.confidence <= 1, `${decision.nodeId} confidence should be normalized`);
    assert.ok(decision.evidence.length > 0, `${decision.nodeId} decision should include evidence`);
    if (decision.confidence < 0.7) {
      assert.ok(
        decision.layout === "absolute" || decision.fallback === "absolute",
        `${decision.nodeId} low-confidence layout should use absolute fidelity fallback`
      );
    }
  }
}

function findDecision(result, nodeId) {
  const decision = result.layoutDecisions.find((item) => item.nodeId === nodeId);
  assert.ok(decision, `Missing layout decision for ${nodeId}`);
  return decision;
}

function findCandidates(result, nodeId) {
  const candidateGroup = result.layoutCandidates.find((item) => item.nodeId === nodeId);
  assert.ok(candidateGroup, `Missing layout candidates for ${nodeId}`);
  return candidateGroup.candidates;
}

function scene(name, children) {
  return {
    version: "2.0",
    source: {
      frameNodeId: sourceIdFor(name),
      viewport: { width: 240, height: 240 }
    },
    root: frame(rootIdFor(name), 0, 0, 240, 240, children)
  };
}

function frame(id, x, y, w, h, children = []) {
  return node(id, "frame", x, y, w, h, children);
}

function rect(id, x, y, w, h) {
  return node(id, "rect", x, y, w, h, []);
}

function node(id, canonicalType, x, y, w, h, children) {
  return {
    id,
    sourceNodeId: sourceIdFor(id),
    sourceName: id,
    canonicalType,
    bounds: { x, y, w, h },
    zIndex: 0,
    style: {
      fills: [],
      strokes: [],
      effects: [],
      opacity: 1
    },
    flags: {
      isInvisible: false,
      isZeroSize: false,
      isEmptyWrapper: false,
      hasClip: false,
      hasMask: false,
      hasBlendMode: false,
      hasBlur: false,
      isComplexVector: false,
      recommendAssetSlice: false
    },
    children
  };
}

function rootIdFor(name) {
  return `c_${name}_root`;
}

function sourceIdFor(id) {
  return id.replace(/^c_/, "").replaceAll("_", ":");
}
