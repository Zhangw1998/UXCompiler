import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const scriptPath = resolve(import.meta.dirname, "figma-plugin-wait.mjs");
const tmp = await mkdtemp(join(tmpdir(), "uxcompiler-figma-plugin-wait-"));

try {
  await verifyRealPluginSync();
  await verifyTimeoutIgnoresLocalSmoke();
  console.log("figma plugin wait verification passed");
} finally {
  await rm(tmp, { recursive: true, force: true });
}

async function verifyRealPluginSync() {
  const cwd = join(tmp, "real-workspace");
  const reportDir = join(cwd, "artifacts/figma-bridge/real_plugin_sync");
  const auditPath = join(cwd, "artifacts/figma-access-audit/figma_access_audit_report.json");
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

  const result = await execFileAsync("node", [scriptPath], {
    cwd,
    env: {
      ...process.env,
      UXCOMPILER_PLUGIN_WAIT_TIMEOUT_MS: "0",
      UXCOMPILER_PLUGIN_WAIT_INTERVAL_MS: "1",
      UXCOMPILER_ACCESS_AUDIT_REPORT: auditPath
    },
    maxBuffer: 1024 * 1024
  });

  assert.match(result.stdout, /Real Figma plugin sync detected/);
  assert.match(result.stdout, /Status: verified/);
  assert.equal(result.stderr, "");
  const audit = JSON.parse(await readFile(auditPath, "utf8"));
  assert.equal(audit.status, "verified");
  assert.equal(audit.latestRealAccess.sourceKind, "figma_plugin");
}

async function verifyTimeoutIgnoresLocalSmoke() {
  const cwd = join(tmp, "local-workspace");
  const reportDir = join(cwd, "artifacts/figma-bridge/local_smoke");
  await mkdir(reportDir, { recursive: true });
  await writeFile(
    join(reportDir, "pipeline_run_report.json"),
    JSON.stringify(
      {
        generatedAt: "2026-07-02T00:00:00.000Z",
        source: {
          sourceKind: "local_smoke",
          fileKey: "plugin_file",
          fileName: "figma_plugin_smoke",
          frameNodeId: "1:1"
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

  await assert.rejects(
    execFileAsync("node", [scriptPath], {
      cwd,
      env: {
        ...process.env,
        UXCOMPILER_PLUGIN_WAIT_TIMEOUT_MS: "0",
        UXCOMPILER_PLUGIN_WAIT_INTERVAL_MS: "1"
      },
      maxBuffer: 1024 * 1024
    }),
    (error) => {
      assert.equal(error.code, 2);
      assert.match(error.stdout, /Timed out waiting/);
      return true;
    }
  );
}
