import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createServer } from "node:net";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const cwd = resolve(import.meta.dirname, "..");
const tmp = await mkdtemp(join(tmpdir(), "uxcompiler-figma-plugin-session-"));
const port = await reservePort();
const env = {
  ...process.env,
  UXCOMPILER_LOCAL_API_PORT: String(port),
  UXCOMPILER_LOCAL_API_SESSION_DIR: join(tmp, "session"),
  UXCOMPILER_ARTIFACTS_DIR: join(tmp, "artifacts")
};

try {
  const start = await execFileAsync("node", ["scripts/figma-plugin-start.mjs"], {
    cwd,
    env,
    maxBuffer: 1024 * 1024
  });
  assert.match(start.stdout, /Figma plugin bridge is ready/);
  assert.equal(start.stderr, "");

  const response = await fetch(`http://127.0.0.1:${port}/health`);
  const body = await response.json();
  assert.equal(response.ok, true);
  assert.equal(body.ok, true);
  assert.equal(body.artifactRoot, join(tmp, "artifacts"));

  const stop = await execFileAsync("node", ["scripts/figma-plugin-stop.mjs"], {
    cwd,
    env,
    maxBuffer: 1024 * 1024
  });
  assert.match(stop.stdout, /local API stopped|local API is not running/);
  console.log("figma plugin session verification passed");
} finally {
  await execFileAsync("node", ["scripts/figma-plugin-stop.mjs"], {
    cwd,
    env,
    maxBuffer: 1024 * 1024
  }).catch(() => undefined);
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
