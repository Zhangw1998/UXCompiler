import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const tmp = await mkdtemp(join(tmpdir(), "uxcompiler-figma-ready-"));
const envPath = join(tmp, ".env");
const reportPath = join(tmp, "figma_readiness_report.json");
const auditPath = join(tmp, "figma_access_audit_report.json");
const offlinePort = await reservePort();
await writeFile(envPath, "", "utf8");

try {
  const result = await execFileAsync("node", ["scripts/figma-ready.mjs"], {
    cwd: resolve(import.meta.dirname, ".."),
    env: {
      ...process.env,
      UXCOMPILER_ENV_FILE: envPath,
      UXCOMPILER_READY_REPORT: reportPath,
      UXCOMPILER_ACCESS_AUDIT_REPORT: auditPath,
      FIGMA_ACCESS_TOKEN: "",
      FIGMA_FILE_URL: "",
      FIGMA_FILE_KEY: "",
      FIGMA_NODE_ID: "",
      FIGMA_FRAME_INDEX: "",
      UXCOMPILER_LOCAL_API_PORT: String(offlinePort)
    },
    maxBuffer: 1024 * 1024
  });
  assert.match(result.stdout, /UXCompiler Figma readiness/);
  assert.match(result.stdout, /Status: setup needed/);
  assert.match(result.stdout, /REST path/);
  assert.match(result.stdout, /Plugin bridge path/);
  assert.match(result.stdout, /Completion evidence/);
  assert.match(result.stdout, /Report:/);
  assert.doesNotMatch(result.stdout, /figd_/);
  assert.equal(result.stderr, "");
  const reportText = await readFile(reportPath, "utf8");
  assert.doesNotMatch(reportText, /figd_/);
  const report = JSON.parse(reportText);
  assert.equal(report.status, "setup_needed");
  assert.equal(report.rest.ready, false);
  assert.equal(report.pluginBridge.manifest.ok, true);
  assert.equal(report.completionEvidence.status, "unknown");
  assert.equal(report.completionEvidence.latestRealAccess, null);
  console.log("figma readiness verification passed");
} finally {
  await rm(tmp, { recursive: true, force: true });
}

async function reservePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address?.port) resolvePort(address.port);
        else reject(new Error("Could not reserve a local port"));
      });
    });
    server.on("error", reject);
  });
}
