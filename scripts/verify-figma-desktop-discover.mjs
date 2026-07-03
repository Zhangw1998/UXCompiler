import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const tmp = await mkdtemp(join(tmpdir(), "uxcompiler-figma-desktop-discover-"));
const settingsPath = join(tmp, "settings.json");
const reportPath = join(tmp, "report.json");

try {
  await mkdir(tmp, { recursive: true });
  await writeFile(
    settingsPath,
    JSON.stringify({
      windows: [
        {
          id: "window-1",
          activeTabPath: "/file/vnFCiTFokCQ2WkLH1fXPKz",
          tabs: [
            {
              path: "/file/vnFCiTFokCQ2WkLH1fXPKz",
              title: "Bolt Blast消除钉子游戏",
              params: "?node-id=60-5315&m=dev&type=design",
              editorType: "dev_handoff",
              lastViewedAt: 1783102190365
            }
          ]
        }
      ]
    }),
    "utf8"
  );

  const result = await execFileAsync("node", ["scripts/figma-desktop-discover.mjs"], {
    cwd: resolve(import.meta.dirname, ".."),
    env: {
      ...process.env,
      UXCOMPILER_FIGMA_DESKTOP_SETTINGS: settingsPath,
      UXCOMPILER_FIGMA_DESKTOP_REPORT: reportPath
    },
    maxBuffer: 1024 * 1024
  });

  assert.match(result.stdout, /Status: found/);
  assert.match(result.stdout, /File key: vnFCiTFokCQ2WkLH1fXPKz/);
  assert.match(result.stdout, /Node id: 60:5315/);
  assert.match(result.stdout, /Connector: fileKey=vnFCiTFokCQ2WkLH1fXPKz, nodeId=60:5315/);

  const report = JSON.parse(await readFile(reportPath, "utf8"));
  assert.equal(report.status, "found");
  assert.equal(report.current.fileKey, "vnFCiTFokCQ2WkLH1fXPKz");
  assert.equal(report.current.nodeId, "60:5315");
  assert.equal(report.current.sourceType, "design");
  assert.match(report.current.url, /^https:\/\/www\.figma\.com\/design\/vnFCiTFokCQ2WkLH1fXPKz\//);
  console.log("figma desktop discovery verification passed");
} finally {
  await rm(tmp, { recursive: true, force: true });
}
