import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const tmp = await mkdtemp(join(tmpdir(), "uxcompiler-figma-next-"));
const readinessPath = join(tmp, "readiness.json");
const auditPath = join(tmp, "audit.json");
const desktopPath = join(tmp, "desktop.json");

try {
  await writeFile(
    readinessPath,
    JSON.stringify(
      {
        status: "setup_needed",
        rest: { ready: false },
        pluginBridge: { ready: false }
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    auditPath,
    JSON.stringify(
      {
        status: "not_verified",
        latestRealAccess: null,
        reports: []
      },
      null,
      2
    ),
    "utf8"
  );
  await writeFile(
    desktopPath,
    JSON.stringify(
      {
        status: "found",
        current: {
          title: "Bolt Blast消除钉子游戏",
          fileKey: "vnFCiTFokCQ2WkLH1fXPKz",
          nodeId: "60:5315",
          url: "https://www.figma.com/design/vnFCiTFokCQ2WkLH1fXPKz/Bolt-Blast?node-id=60-5315"
        }
      },
      null,
      2
    ),
    "utf8"
  );

  const result = await execFileAsync("node", ["scripts/figma-next.mjs"], {
    cwd: resolve(import.meta.dirname, ".."),
    env: {
      ...process.env,
      UXCOMPILER_READY_REPORT: readinessPath,
      UXCOMPILER_ACCESS_AUDIT_REPORT: auditPath,
      UXCOMPILER_FIGMA_DESKTOP_REPORT: desktopPath
    },
    maxBuffer: 1024 * 1024
  });
  assert.match(result.stdout, /Status: real Figma access not verified yet/);
  assert.match(result.stdout, /Figma desktop currently has a target open/);
  assert.match(result.stdout, /fileKey=vnFCiTFokCQ2WkLH1fXPKz nodeId=60:5315/);
  assert.match(result.stdout, /REST path needs configuration/);
  assert.match(result.stdout, /Plugin bridge path/);
  assert.match(result.stdout, /pnpm figma:plugin-wait/);
  assert.match(result.stdout, /Codex Figma connector path/);
  assert.doesNotMatch(result.stdout, /real Figma access verified/);
  console.log("figma next-step verification passed");
} finally {
  await rm(tmp, { recursive: true, force: true });
}
