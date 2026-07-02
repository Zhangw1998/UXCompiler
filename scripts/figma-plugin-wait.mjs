import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const artifactRoot = resolve(process.cwd(), process.env.UXCOMPILER_ARTIFACTS_DIR ?? "artifacts/figma-bridge");
const timeoutMs = readDuration("UXCOMPILER_PLUGIN_WAIT_TIMEOUT_MS", 5 * 60 * 1000);
const intervalMs = readDuration("UXCOMPILER_PLUGIN_WAIT_INTERVAL_MS", 2000);
const auditScript = resolve(import.meta.dirname, "figma-access-audit.mjs");

console.log("UXCompiler waiting for a real Figma plugin sync");
console.log(`Artifacts root: ${artifactRoot}`);
console.log(`Timeout: ${Math.round(timeoutMs / 1000)}s`);
console.log("");
console.log("In Figma, run UXCompiler Bridge, then click Check Local API and Sync Selection.");
console.log("");

const started = Date.now();
let latestSeen = 0;

while (Date.now() - started <= timeoutMs) {
  const reports = await readPluginReports(artifactRoot);
  const real = reports.filter((report) => report.real && report.success).sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)));
  if (real.length > 0) {
    const latest = real[0];
    console.log("Real Figma plugin sync detected.");
    console.log(`File key: ${latest.fileKey}`);
    console.log(`Frame node: ${latest.frameNodeId}`);
    console.log(`Report: ${latest.path}`);
    console.log("");
    await runAccessAudit();
    process.exit(0);
  }

  if (reports.length !== latestSeen) {
    latestSeen = reports.length;
    console.log(`Reports seen: ${reports.length}; waiting for sourceKind=figma_plugin...`);
  }
  await delay(intervalMs);
}

console.log("Timed out waiting for a real Figma plugin sync.");
console.log("The local smoke reports are ignored on purpose; sync a real selected frame from Figma and rerun this command.");
process.exit(2);

async function readPluginReports(root) {
  if (!existsSync(root)) return [];
  const paths = await findPipelineReports(root);
  const reports = [];
  for (const path of paths) {
    try {
      const report = JSON.parse(await readFile(path, "utf8"));
      reports.push({
        path,
        artifactDir: dirname(path),
        generatedAt: report.generatedAt,
        sourceKind: report.source?.sourceKind,
        fileKey: report.source?.fileKey,
        frameNodeId: report.source?.frameNodeId,
        real: report.source?.sourceKind === "figma_plugin",
        success:
          report.steps?.compile?.status === "success" &&
          report.steps?.flutterCapture?.status === "success" &&
          (report.steps?.snapshot?.status === "success" || report.steps?.figmaFetch?.status === "success")
      });
    } catch {
      // Ignore partial reports while a pipeline is still writing.
    }
  }
  return reports;
}

async function findPipelineReports(root) {
  const results = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await findPipelineReports(path)));
    } else if (entry.isFile() && entry.name === "pipeline_run_report.json") {
      results.push(path);
    }
  }
  return results;
}

async function runAccessAudit() {
  const result = await execFileAsync("node", [auditScript], {
    cwd: process.cwd(),
    env: process.env,
    maxBuffer: 1024 * 1024
  });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
}

function readDuration(name, fallback) {
  const value = process.env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
