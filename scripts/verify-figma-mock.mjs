import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const fixture = JSON.parse(readFileSync("examples/fixtures/login_raw_figma_scene.json", "utf8"));
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
const outDir = "artifacts/figma-mock";
rmSync(outDir, { recursive: true, force: true });

try {
  const doctorResult = await execFileAsync("node", ["apps/cli/dist/index.js", "doctor"]);
  assert.match(doctorResult.stdout, /UXCompiler doctor/);

  const framesResult = await execFileAsync("node", [
    "apps/cli/dist/index.js",
    "figma",
    "frames",
    "--file",
    "mock",
    "--token",
    "mock-token",
    "--api-base-url",
    `http://127.0.0.1:${port}`
  ]);
  assert.match(framesResult.stdout, /UXCompiler Figma frames/);
  assert.match(framesResult.stdout, /1:1/);

  const framesJsonResult = await execFileAsync("node", [
    "apps/cli/dist/index.js",
    "figma",
    "frames",
    "--file",
    "mock",
    "--token",
    "mock-token",
    "--api-base-url",
    `http://127.0.0.1:${port}`,
    "--json"
  ]);
  const framesJson = JSON.parse(framesJsonResult.stdout);
  assert.equal(framesJson.frames[0].id, "1:1");

  const checkResult = await execFileAsync("node", [
    "apps/cli/dist/index.js",
    "figma",
    "check",
    "--file",
    "mock",
    "--node",
    "1:1",
    "--token",
    "mock-token",
    "--api-base-url",
    `http://127.0.0.1:${port}`
  ]);
  assert.match(checkResult.stdout, /UXCompiler Figma check completed/);
  assert.match(checkResult.stdout, /Frame node: 1:1/);

  const { stdout, stderr } = await execFileAsync("node", [
    "apps/cli/dist/index.js",
    "figma",
    "run",
    "--file",
    "mock",
    "--node",
    "1:1",
    "--out",
    outDir,
    "--token",
    "mock-token",
    "--api-base-url",
    `http://127.0.0.1:${port}`
  ]);
  assert.match(stdout, /UXCompiler Figma run completed/);
  assert.equal(stderr, "");

  const required = [
    "raw_figma_scene.json",
    "figma_reference.png",
    "extraction_report.json",
    "asset_manifest.json",
    "i18n_manifest.json",
    "arb/app_en.arb",
    "override_set.json",
    "reviewed_normalized_design_ir.json",
    "reviewed_asset_manifest.json",
    "reviewed_i18n_manifest.json",
    "reviewed_inferred_tokens.json",
    "reviewed_arb/app_en.arb",
    "override_conflict_report.json",
    "stale_override_report.json",
    "visual_ir.json",
    "fidelity_generation_manifest.json",
    "node_pixel_map.json",
    "review_tasks.json",
    "task_status_report.json",
    "flutter_preview/pubspec.yaml",
    "flutter_preview/lib/main.dart",
    "flutter_preview/lib/generated/fidelity/preview_page.dart",
    "flutter_preview/test/preview_test.dart",
    "flutter_preview/test/golden_preview_test.dart",
    "flutter_preview_format_report.json",
    "flutter_preview.png",
    "flutter_preview_capture_report.json",
    "pipeline_run_report.json",
    "diff/visual_diff_report.json",
    "diff/node_diff_report.json",
    "diff/diff_issues.json",
    "diff/diff_heatmap.png",
    "canonical_scene.json",
    "inferred_tokens.json",
    "regions.json",
    "layout_decisions.json",
    "normalized_design_ir.json"
  ];
  for (const file of required) {
    assert.equal(existsSync(resolve(outDir, file)), true, `Missing ${file}`);
  }

  const report = JSON.parse(readFileSync(resolve(outDir, "extraction_report.json"), "utf8"));
  assert.equal(report.source.fileKey, "mock");
  assert.equal(report.source.frameNodeId, "1:1");
  assert.equal(report.screenshot.status, "success");

  const normalized = JSON.parse(readFileSync(resolve(outDir, "normalized_design_ir.json"), "utf8"));
  assert.ok(normalized.confidence.overall >= 0.8);

  const runReport = JSON.parse(readFileSync(resolve(outDir, "pipeline_run_report.json"), "utf8"));
  assert.equal(runReport.steps.figmaFetch.status, "success");
  assert.equal(runReport.steps.compile.status, "success");
  assert.equal(runReport.steps.flutterCapture.status, "success");
  assert.equal(runReport.steps.visualDiff.status, "success");

  const diffReport = JSON.parse(readFileSync(resolve(outDir, "diff/visual_diff_report.json"), "utf8"));
  assert.equal(typeof diffReport.page.pass, "boolean");
  assert.equal(typeof diffReport.page.score.pixelDiffRatio, "number");
  assert.ok(diffReport.environment.fonts.length > 0, "Expected visual diff font metadata");
  assert.match(diffReport.environment.flutterVersion, /^Flutter /);
  const reviewTasks = JSON.parse(readFileSync(resolve(outDir, "review_tasks.json"), "utf8"));
  const taskStatusReport = JSON.parse(readFileSync(resolve(outDir, "task_status_report.json"), "utf8"));
  const overrideSet = JSON.parse(readFileSync(resolve(outDir, "override_set.json"), "utf8"));
  assert.match(overrideSet.hash, /^sha256_[a-f0-9]{64}$/);
  assert.ok(reviewTasks.length > 0, "Expected review tasks");
  assert.equal(taskStatusReport.total, reviewTasks.length);
  assert.equal(typeof taskStatusReport.codegenWriteBlocked, "boolean");

  console.log("figma mock verification passed");
} finally {
  await new Promise((resolveClose) => server.close(resolveClose));
}

function sendJson(response, body) {
  response.writeHead(200, { "content-type": "application/json" });
  response.end(`${JSON.stringify(body)}\n`);
}
