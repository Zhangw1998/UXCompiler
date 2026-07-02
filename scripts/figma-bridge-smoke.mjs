import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const port = Number(process.env.UXCOMPILER_LOCAL_API_PORT ?? 8787);
const artifactRoot = process.env.UXCOMPILER_ARTIFACTS_DIR ?? "artifacts/figma-bridge-smoke";
const baseUrl = `http://127.0.0.1:${port}`;
const referencePngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4AWP4DwQACfsD/c8LaHIAAAAASUVORK5CYII=";

let server;
let startedServer = false;

try {
  const existing = await checkHealth();
  if (existing) {
    console.log(`Using existing UXCompiler local API at ${baseUrl}`);
  } else {
    rmSync(artifactRoot, { recursive: true, force: true });
    server = spawn("node", ["apps/local-api/dist/index.js"], {
      env: {
        ...process.env,
        UXCOMPILER_LOCAL_API_PORT: String(port),
        UXCOMPILER_ARTIFACTS_DIR: artifactRoot
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    startedServer = true;
    await waitForHealth();
    console.log(`Started UXCompiler local API at ${baseUrl}`);
  }

  const rawFigmaScene = buildPluginLikeSnapshot();
  const response = await fetch(`${baseUrl}/api/snapshots`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      sourceKind: "local_smoke",
      rawFigmaScene,
      projectId: "figma_bridge_smoke",
      figmaReferencePngBase64: referencePngBase64,
      extractionReport: {
        source: {
          fileKey: rawFigmaScene.source.fileKey,
          frameNodeId: rawFigmaScene.source.frameNodeId,
          fileName: rawFigmaScene.source.fileName,
          apiBaseUrl: "figma-plugin-smoke"
        },
        stats: countNodes(rawFigmaScene.root),
        screenshot: {
          requested: true,
          status: "success",
          format: "png",
          scale: 1,
          bytes: Buffer.from(referencePngBase64, "base64").byteLength
        },
        warnings: []
      }
    })
  });
  assert.equal(response.ok, true, `snapshot request failed with ${response.status}`);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.ok(result.artifactDir);
  assertArtifact(result.artifactDir, "raw_figma_scene.json");
  assertArtifact(result.artifactDir, "normalized_design_ir.json");
  assertArtifact(result.artifactDir, "flutter_preview.png");
  assertArtifact(result.artifactDir, "diff/visual_diff_report.json");
  assertArtifact(result.artifactDir, "pipeline_run_report.json");
  const pipelineRunReport = JSON.parse(readFileSync(resolve(result.artifactDir, "pipeline_run_report.json"), "utf8"));
  assert.equal(pipelineRunReport.source.sourceKind, "local_smoke");

  console.log("Figma Bridge smoke completed.");
  console.log(`Artifacts: ${result.artifactDir}`);
  console.log(`Report: ${resolve(result.artifactDir, "pipeline_run_report.json")}`);
  console.log(startedServer ? "The temporary local API was stopped." : "The existing local API is still running.");
} finally {
  if (server) server.kill("SIGTERM");
}

function buildPluginLikeSnapshot() {
  const raw = JSON.parse(readFileSync("examples/fixtures/login_raw_figma_scene.json", "utf8"));
  raw.source = {
    ...raw.source,
    fileKey: "plugin_file",
    pageId: "plugin_page",
    fileName: "figma_plugin_smoke",
    apiBaseUrl: "figma-plugin-smoke",
    exportedAt: new Date().toISOString()
  };
  return raw;
}

async function checkHealth() {
  try {
    const response = await fetch(`${baseUrl}/health`);
    const body = await response.json().catch(() => undefined);
    return response.ok && body?.ok === true;
  } catch {
    return false;
  }
}

async function waitForHealth() {
  for (let index = 0; index < 60; index += 1) {
    if (await checkHealth()) return;
    await new Promise((resolveTimeout) => setTimeout(resolveTimeout, 250));
  }
  throw new Error(`UXCompiler local API did not start at ${baseUrl}`);
}

function assertArtifact(artifactDir, name) {
  const path = resolve(artifactDir, name);
  assert.equal(existsSync(path), true, `expected artifact ${path}`);
}

function countNodes(root) {
  const stats = {
    nodes: 0,
    textNodes: 0,
    vectorNodes: 0,
    imageNodes: 0,
    componentInstances: 0
  };
  walk(root, (node) => {
    stats.nodes += 1;
    if (node.type === "TEXT") stats.textNodes += 1;
    if (["VECTOR", "BOOLEAN_OPERATION", "STAR", "LINE", "POLYGON", "ELLIPSE"].includes(node.type)) stats.vectorNodes += 1;
    if (node.type === "INSTANCE") stats.componentInstances += 1;
  });
  return stats;
}

function walk(node, visit) {
  visit(node);
  for (const child of node.children ?? []) walk(child, visit);
}
