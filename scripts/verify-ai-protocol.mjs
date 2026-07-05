import assert from "node:assert/strict";
import {
  validateAiProtocolOutput,
  validateAiProtocolRequest
} from "../packages/ai-protocol/dist/index.js";

const validRequest = validateAiProtocolRequest({
  task: "semantic_region_labeling",
  version: "2.0",
  context: {
    pageName: "LoginPage",
    viewport: { width: 390, height: 844 },
    targetPlatform: "flutter"
  },
  data: {
    regions: [
      {
        sourceId: "region_1",
        texts: ["Welcome back"],
        layoutCandidates: [{ type: "column", score: 0.92 }]
      }
    ]
  },
  constraints: {
    jsonOnly: true,
    doNotGenerateDart: true,
    doNotInventBusinessLogic: true,
    mustReferenceSourceIds: true
  }
});
assert.equal(validRequest.valid, true);
assert.deepEqual(validRequest.issues, []);

const unsafeRequest = validateAiProtocolRequest({
  task: "semantic_region_labeling",
  version: "2.0",
  data: {
    rawFigmaScene: {
      root: {
        children: []
      }
    }
  },
  constraints: {
    jsonOnly: true,
    doNotGenerateDart: true,
    doNotInventBusinessLogic: true,
    mustReferenceSourceIds: true
  }
});
assert.equal(unsafeRequest.valid, false);
assert.ok(unsafeRequest.issues.some((issue) => issue.code === "unsafe_input"));

const mixedOutput = validateAiProtocolOutput({
  expectedTask: "semantic_region_labeling",
  allowedSourceIds: ["region_1", "node_1", "asset_1"],
  output: {
    task: "semantic_region_labeling",
    version: "2.0",
    items: [
      {
        sourceId: "region_1",
        suggestion: { name: "LoginHeader", role: "header" },
        confidence: 0.94,
        reason: "Contains title and intro copy."
      },
      {
        sourceId: "node_1",
        suggestion: { name: "SecondaryHelp", role: "link" },
        confidence: 0.78,
        reason: "Looks like a supporting action."
      },
      {
        sourceId: "asset_1",
        suggestion: { name: "ambiguousDecoration", role: "decorative" },
        confidence: 0.42,
        reason: "The visual role is unclear."
      }
    ],
    warnings: []
  }
});
assert.equal(mixedOutput.status, "partially_accepted");
assert.deepEqual(mixedOutput.accepted.map((item) => item.sourceId), ["region_1"]);
assert.deepEqual(mixedOutput.review.map((item) => item.sourceId), ["node_1"]);
assert.deepEqual(mixedOutput.rejected.map((item) => item.sourceId), ["asset_1"]);

const nestedReferenceOutput = validateAiProtocolOutput({
  expectedTask: "semantic_region_labeling",
  allowedSourceIds: ["region_1", "node_1", "node_2"],
  output: {
    task: "semantic_region_labeling",
    version: "2.0",
    items: [
      {
        sourceId: "region_1",
        suggestion: {
          name: "LoginCluster",
          role: "form",
          sourceNodeIds: ["node_1", "node_2"],
          evidence: { sourceNodeId: "node_1" }
        },
        confidence: 0.95,
        reason: "References only known source nodes."
      }
    ],
    warnings: []
  }
});
assert.equal(nestedReferenceOutput.status, "accepted");
assert.equal(nestedReferenceOutput.accepted.length, 1);

const invalidJson = validateAiProtocolOutput({
  allowedSourceIds: ["region_1"],
  output: "{not json"
});
assert.equal(invalidJson.status, "rejected");
assert.ok(invalidJson.issues.some((issue) => issue.code === "invalid_json"));

const unsafeOutput = validateAiProtocolOutput({
  expectedTask: "semantic_region_labeling",
  allowedSourceIds: ["region_1"],
  output: {
    task: "semantic_region_labeling",
    version: "2.0",
    items: [
      {
        sourceId: "region_404",
        suggestion: {
          name: "InventedScreen",
          flutterCode: "class Bad extends StatelessWidget {}",
          onTap: "Navigator.pushNamed(context, '/home')"
        },
        confidence: 0.99,
        reason: "Unsafe generated code and invented source."
      }
    ],
    warnings: []
  }
});
assert.equal(unsafeOutput.status, "rejected");
assert.ok(unsafeOutput.issues.some((issue) => issue.code === "unknown_source"));
assert.ok(unsafeOutput.issues.some((issue) => issue.code === "forbidden_field" && issue.path.endsWith(".flutterCode")));
assert.ok(unsafeOutput.issues.some((issue) => issue.code === "forbidden_field" && issue.path.endsWith(".onTap")));
assert.ok(unsafeOutput.issues.some((issue) => issue.code === "forbidden_field" && issue.message.includes("Dart")));

const nestedUnknownSourceOutput = validateAiProtocolOutput({
  expectedTask: "semantic_region_labeling",
  allowedSourceIds: ["region_1", "node_1"],
  output: {
    task: "semantic_region_labeling",
    version: "2.0",
    items: [
      {
        sourceId: "region_1",
        suggestion: {
          name: "LoginCluster",
          role: "form",
          sourceNodeIds: ["node_1", "ghost_node"],
          evidence: { sourceNodeId: "ghost_node" }
        },
        confidence: 0.95,
        reason: "Tries to cite a nonexistent source node."
      }
    ],
    warnings: []
  }
});
assert.equal(nestedUnknownSourceOutput.status, "rejected");
assert.equal(nestedUnknownSourceOutput.accepted.length, 0);
assert.equal(nestedUnknownSourceOutput.rejected.length, 1);
assert.ok(nestedUnknownSourceOutput.issues.some((issue) => issue.code === "unknown_source" && issue.path === "$.items[0].suggestion.sourceNodeIds[1]"));
assert.ok(nestedUnknownSourceOutput.issues.some((issue) => issue.code === "unknown_source" && issue.path === "$.items[0].suggestion.evidence.sourceNodeId"));

const duplicateOutput = validateAiProtocolOutput({
  allowedSourceIds: ["region_1"],
  output: {
    task: "semantic_region_labeling",
    version: "2.0",
    items: [
      { sourceId: "region_1", suggestion: { name: "Header" }, confidence: 0.92, reason: "First suggestion." },
      { sourceId: "region_1", suggestion: { name: "Hero" }, confidence: 0.93, reason: "Conflicting suggestion." }
    ],
    warnings: []
  }
});
assert.equal(duplicateOutput.accepted.length, 1);
assert.equal(duplicateOutput.rejected.length, 1);
assert.ok(duplicateOutput.issues.some((issue) => issue.code === "duplicate_source"));

console.log("AI protocol verification passed");
