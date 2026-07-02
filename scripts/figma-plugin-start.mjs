import { spawn } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const port = Number(process.env.UXCOMPILER_LOCAL_API_PORT ?? 8787);
const healthUrl = `http://127.0.0.1:${port}/health`;
const sessionDir = resolve(process.cwd(), process.env.UXCOMPILER_LOCAL_API_SESSION_DIR ?? "artifacts/local-api-session");
const pidPath = resolve(sessionDir, "local-api.pid");
const logPath = resolve(sessionDir, "local-api.log");
const serverEntry = resolve(process.cwd(), "apps/local-api/dist/index.js");

if (!Number.isInteger(port) || port <= 0) {
  console.error("UXCOMPILER_LOCAL_API_PORT must be a positive integer.");
  process.exit(2);
}

if (!existsSync(serverEntry)) {
  console.error("Local API build output is missing.");
  console.error("Run pnpm build first, or use pnpm figma:plugin-start.");
  process.exit(2);
}

const existing = await checkHealth();
if (existing.ok) {
  console.log("UXCompiler local API is already online.");
  console.log(`URL: ${healthUrl}`);
  console.log(`Artifacts root: ${existing.artifactRoot}`);
  await writeStatus(existing.pid ?? null);
  process.exit(0);
}

await mkdir(sessionDir, { recursive: true });
const logFd = openSync(logPath, "a");
const child = spawn(process.execPath, [serverEntry], {
  cwd: process.cwd(),
  detached: true,
  env: {
    ...process.env,
    UXCOMPILER_LOCAL_API_PORT: String(port),
    UXCOMPILER_ARTIFACTS_DIR: process.env.UXCOMPILER_ARTIFACTS_DIR ?? "artifacts/figma-bridge"
  },
  stdio: ["ignore", logFd, logFd]
});
child.unref();

await writeStatus(child.pid ?? null);

const ready = await waitForHealth(15000);
if (ready.ok) {
  console.log("UXCompiler Figma plugin bridge is ready.");
  console.log(`Local API: ${healthUrl}`);
  console.log(`Artifacts root: ${ready.artifactRoot}`);
  console.log(`PID file: ${pidPath}`);
  console.log(`Log: ${logPath}`);
  console.log("In Figma, import apps/figma-plugin/manifest.json and click Check Local API, then Sync Selection.");
  process.exit(0);
}

try {
  if (child.pid) process.kill(-child.pid, "SIGTERM");
} catch {
  try {
    if (child.pid) process.kill(child.pid, "SIGTERM");
  } catch {
    // Best effort cleanup only.
  }
}

console.error("Local API did not become healthy.");
console.error(`URL: ${healthUrl}`);
console.error(`Log: ${logPath}`);
const logTail = await readTail(logPath);
if (logTail) {
  console.error("");
  console.error(logTail);
}
process.exit(1);

async function waitForHealth(timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const health = await checkHealth();
    if (health.ok) return health;
    await delay(500);
  }
  return { ok: false };
}

async function checkHealth() {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1000) });
    const body = await response.json().catch(() => undefined);
    if (response.ok && body?.ok) {
      return {
        ok: true,
        artifactRoot: body.artifactRoot,
        pid: await readPid()
      };
    }
  } catch {
    // The caller only needs an offline/online distinction.
  }
  return { ok: false };
}

async function writeStatus(pid) {
  await mkdir(dirname(pidPath), { recursive: true });
  await writeFile(
    pidPath,
    `${JSON.stringify(
      {
        pid,
        port,
        healthUrl,
        logPath,
        startedAt: new Date().toISOString()
      },
      null,
      2
    )}\n`,
    "utf8"
  );
}

async function readPid() {
  try {
    const status = JSON.parse(await readFile(pidPath, "utf8"));
    return Number.isInteger(status.pid) ? status.pid : null;
  } catch {
    return null;
  }
}

async function readTail(path) {
  try {
    const content = await readFile(path, "utf8");
    return content.split(/\r?\n/).slice(-80).join("\n").trim();
  } catch {
    return "";
  }
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
