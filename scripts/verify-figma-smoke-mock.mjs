import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const fixture = JSON.parse(readFileSync("examples/fixtures/login_raw_figma_scene.json", "utf8"));
const outDir = "artifacts/figma-smoke-mock";
const pngBytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4AWP4DwQACfsD/c8LaHIAAAAASUVORK5CYII=",
  "base64"
);

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/v1/files/mock") {
    sendJson(response, {
      name: "Mock Figma File",
      lastModified: "2026-07-03T00:00:00Z",
      editorType: "figma",
      version: "mock-version",
      document: fixture.root
    });
    return;
  }
  if (url.pathname === "/v1/files/mock/nodes") {
    sendJson(response, {
      name: "Mock Figma File",
      lastModified: "2026-07-03T00:00:00Z",
      editorType: "figma",
      version: "mock-version",
      nodes: {
        "1:1": {
          document: fixture.root
        }
      }
    });
    return;
  }
  if (url.pathname === "/v1/images/mock") {
    const nodeId = url.searchParams.get("ids") ?? "1:1";
    sendJson(response, {
      images: {
        [nodeId]: `http://127.0.0.1:${server.address().port}/render.png`
      }
    });
    return;
  }
  if (url.pathname === "/render.png") {
    response.writeHead(200, { "content-type": "image/png" });
    response.end(pngBytes);
    return;
  }
  response.writeHead(404, { "content-type": "text/plain" });
  response.end("not found");
});

await new Promise((resolveServer) => server.listen(0, "127.0.0.1", resolveServer));
const port = server.address().port;
rmSync(outDir, { recursive: true, force: true });

try {
  const result = await execFileAsync("node", ["scripts/figma-smoke.mjs"], {
    env: {
      ...process.env,
      FIGMA_ACCESS_TOKEN: "mock-token",
      FIGMA_FILE_KEY: "mock",
      FIGMA_FILE_URL: "",
      FIGMA_NODE_ID: "",
      FIGMA_FRAME_INDEX: "1",
      FIGMA_API_BASE_URL: `http://127.0.0.1:${port}`,
      UXCOMPILER_FIGMA_OUT: outDir
    },
    maxBuffer: 30 * 1024 * 1024
  });
  assert.match(result.stdout, /UXCompiler Figma frames/);
  assert.match(result.stdout, /Selected frame 1:/);
  assert.match(result.stdout, /Real Figma smoke completed/);
  assert.doesNotMatch(result.stderr, /UXCompiler error/);

  const required = [
    "raw_figma_scene.json",
    "figma_reference.png",
    "normalized_design_ir.json",
    "flutter_preview.png",
    "diff/visual_diff_report.json",
    "diff/diff_issues.json",
    "preview_artifact.json",
    "pipeline_run_report.json"
  ];
  for (const file of required) {
    assert.equal(existsSync(resolve(outDir, file)), true, `Missing ${file}`);
  }

  const runReport = JSON.parse(readFileSync(resolve(outDir, "pipeline_run_report.json"), "utf8"));
  assert.equal(runReport.source.fileKey, "mock");
  assert.equal(runReport.source.frameNodeId, "1:1");
  assert.equal(runReport.steps.figmaFetch.status, "success");
  assert.equal(runReport.steps.flutterCapture.status, "success");
  assert.equal(runReport.steps.visualDiff.status, "success");
  console.log("figma smoke mock verification passed");
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
}

function sendJson(response, body) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(`${JSON.stringify(body)}\n`);
}
