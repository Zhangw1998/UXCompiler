import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const tmp = await mkdtemp(join(tmpdir(), "uxcompiler-figma-access-audit-"));
const reportPath = join(tmp, "figma_access_audit_report.json");

try {
  const result = await execFileAsync("node", ["scripts/figma-access-audit.mjs"], {
    cwd: resolve(import.meta.dirname, ".."),
    env: {
      ...process.env,
      UXCOMPILER_ACCESS_AUDIT_REPORT: reportPath
    },
    maxBuffer: 1024 * 1024
  });
  assert.match(result.stdout, /UXCompiler Figma access audit/);
  assert.match(result.stdout, /Status: not_verified/);
  assert.match(result.stdout, /No successful real Figma access report found yet/);
  assert.equal(result.stderr, "");

  const audit = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(audit.status, "not_verified");
  assert.ok(Array.isArray(audit.reports));
  assert.equal(audit.latestRealAccess, null);
  assert.ok(audit.reports.some((report) => report.classification === "mock" || report.classification === "local_smoke"));
  console.log("figma access audit verification passed");
} finally {
  await rm(tmp, { recursive: true, force: true });
}

await verifyPluginSourceKindCountsAsReal();

async function verifyPluginSourceKindCountsAsReal() {
  const realTmp = await mkdtemp(join(tmpdir(), "uxcompiler-figma-access-audit-real-"));
  const cwd = join(realTmp, "workspace");
  const reportDir = join(cwd, "artifacts/figma-bridge/real_plugin_sync");
  const reportPath = join(realTmp, "audit-real.json");
  await mkdir(reportDir, { recursive: true });
  await writeFile(
    join(reportDir, "pipeline_run_report.json"),
    JSON.stringify(
      {
        generatedAt: "2026-07-02T00:00:00.000Z",
        source: {
          sourceKind: "figma_plugin",
          fileKey: "plugin_file",
          fileName: "figma_plugin_Page 1",
          frameNodeId: "10:2"
        },
        steps: {
          snapshot: { status: "success" },
          compile: { status: "success" },
          flutterCapture: { status: "success" }
        }
      },
      null,
      2
    ),
    "utf8"
  );
  try {
    const result = await execFileAsync("node", [resolve(import.meta.dirname, "figma-access-audit.mjs")], {
      cwd,
      env: {
        ...process.env,
        UXCOMPILER_ACCESS_AUDIT_REPORT: reportPath
      },
      maxBuffer: 1024 * 1024
    });
    assert.match(result.stdout, /Status: verified/);
    const audit = JSON.parse(await readFile(reportPath, "utf8"));
    assert.equal(audit.status, "verified");
    assert.equal(audit.latestRealAccess.sourceKind, "figma_plugin");
  } finally {
    await rm(realTmp, { recursive: true, force: true });
  }
}
