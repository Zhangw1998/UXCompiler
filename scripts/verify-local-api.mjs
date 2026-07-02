import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const artifactRoot = "artifacts/local-api-smoke";
const referencePngBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4AWP4DwQACfsD/c8LaHIAAAAASUVORK5CYII=";
rmSync(artifactRoot, { recursive: true, force: true });

const server = spawn("node", ["apps/local-api/dist/index.js"], {
  env: {
    ...process.env,
    UXCOMPILER_LOCAL_API_PORT: "8799",
    UXCOMPILER_ARTIFACTS_DIR: artifactRoot
  },
  stdio: ["ignore", "pipe", "pipe"]
});

try {
  await waitForHealth();
  const rawFigmaScene = JSON.parse(readFileSync("examples/fixtures/login_raw_figma_scene.json", "utf8"));
  const response = await fetch("http://127.0.0.1:8799/api/snapshots", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sourceKind: "local_smoke", rawFigmaScene, projectId: "smoke", figmaReferencePngBase64: referencePngBase64 })
  });
  assert.equal(response.ok, true);
  const result = await response.json();
  assert.equal(result.ok, true);
  assert.ok(result.artifactDir);
  assert.equal(existsSync(resolve(result.artifactDir, "raw_figma_scene.json")), true);
  assert.equal(existsSync(resolve(result.artifactDir, "normalized_design_ir.json")), true);
  assert.equal(existsSync(resolve(result.artifactDir, "flutter_preview/pubspec.yaml")), true);
  assert.equal(existsSync(resolve(result.artifactDir, "flutter_preview.png")), true);
  assert.equal(existsSync(resolve(result.artifactDir, "flutter_preview_capture_report.json")), true);
  assert.equal(existsSync(resolve(result.artifactDir, "diff/visual_diff_report.json")), true);
  assert.equal(existsSync(resolve(result.artifactDir, "diff/diff_heatmap.png")), true);
  assert.equal(existsSync(resolve(result.artifactDir, "pipeline_run_report.json")), true);
  assert.equal(existsSync(resolve(result.artifactDir, "local_api_snapshot_report.json")), true);
  const pipelineRunReport = JSON.parse(readFileSync(resolve(result.artifactDir, "pipeline_run_report.json"), "utf8"));
  assert.equal(pipelineRunReport.source.sourceKind, "local_smoke");
  assert.equal(pipelineRunReport.steps.flutterCapture.status, "success");
  assert.equal(pipelineRunReport.steps.visualDiff.status, "success");
  console.log("local api verification passed");
} finally {
  server.kill("SIGTERM");
}

async function waitForHealth() {
  for (let index = 0; index < 40; index += 1) {
    try {
      const response = await fetch("http://127.0.0.1:8799/health");
      if (response.ok) return;
    } catch {
      // retry
    }
    await new Promise((resolveTimeout) => setTimeout(resolveTimeout, 250));
  }
  const stdout = await streamText(server.stdout);
  const stderr = await streamText(server.stderr);
  throw new Error(`local api did not start\nstdout:\n${stdout}\nstderr:\n${stderr}`);
}

async function streamText(stream) {
  if (!stream) return "";
  return new Promise((resolveText) => {
    let text = "";
    stream.on("data", (chunk) => {
      text += chunk.toString();
    });
    setTimeout(() => resolveText(text), 50);
  });
}
