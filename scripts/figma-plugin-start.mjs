import { spawn } from "node:child_process";
import { existsSync, openSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const port = Number(process.env.UXCOMPILER_LOCAL_API_PORT ?? 8787);
const workbenchPort = Number(process.env.UXCOMPILER_WORKBENCH_PORT ?? 8788);
const healthUrl = `http://127.0.0.1:${port}/health`;
const workbenchUrl = `http://127.0.0.1:${workbenchPort}/apps/workbench-web/?artifacts=/artifacts/figma-bridge`;
const workbenchProbeUrl = `http://127.0.0.1:${workbenchPort}/apps/workbench-web/`;
const sessionDir = resolve(process.cwd(), process.env.UXCOMPILER_LOCAL_API_SESSION_DIR ?? "artifacts/local-api-session");
const pidPath = resolve(sessionDir, "local-api.pid");
const logPath = resolve(sessionDir, "local-api.log");
const workbenchLogPath = resolve(sessionDir, "workbench-web.log");
const serverEntry = resolve(process.cwd(), "apps/local-api/dist/index.js");
const workbenchEntry = resolve(process.cwd(), "scripts/workbench-web-server.mjs");

if (!Number.isInteger(port) || port <= 0 || !Number.isInteger(workbenchPort) || workbenchPort <= 0) {
  console.error("UXCOMPILER_LOCAL_API_PORT and UXCOMPILER_WORKBENCH_PORT must be positive integers.");
  process.exit(2);
}

if (!existsSync(serverEntry)) {
  console.error("Local API build output is missing.");
  console.error("Run pnpm build first, or use pnpm figma:plugin-start.");
  process.exit(2);
}

const existingApi = await checkHealth();
const existingWorkbench = await checkWorkbench();
if (existingApi.ok && existingWorkbench.ok) {
  console.log("UXCompiler Figma plugin bridge is already ready.");
  console.log(`Local API: ${healthUrl}`);
  console.log(`Workbench: ${workbenchUrl}`);
  console.log(`Artifacts root: ${existingApi.artifactRoot}`);
  await writeStatus(existingApi.pid ?? null, existingWorkbench.pid ?? null);
  process.exit(0);
}

await mkdir(sessionDir, { recursive: true });
const logFd = openSync(logPath, "a");
const workbenchLogFd = openSync(workbenchLogPath, "a");
let child;
let workbenchChild;

if (!existingApi.ok) {
  child = spawn(process.execPath, [serverEntry], {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...process.env,
      UXCOMPILER_LOCAL_API_PORT: String(port),
      UXCOMPILER_WORKBENCH_PORT: String(workbenchPort),
      UXCOMPILER_ARTIFACTS_DIR: process.env.UXCOMPILER_ARTIFACTS_DIR ?? "artifacts/figma-bridge"
    },
    stdio: ["ignore", logFd, logFd]
  });
  child.unref();
}

if (!existingWorkbench.ok) {
  workbenchChild = spawn(process.execPath, [workbenchEntry, "--port", String(workbenchPort), "--artifacts", "/artifacts/figma-bridge"], {
    cwd: process.cwd(),
    detached: true,
    env: {
      ...process.env,
      UXCOMPILER_WORKBENCH_PORT: String(workbenchPort)
    },
    stdio: ["ignore", workbenchLogFd, workbenchLogFd]
  });
  workbenchChild.unref();
}

await writeStatus(child?.pid ?? existingApi.pid ?? null, workbenchChild?.pid ?? existingWorkbench.pid ?? null);

const ready = await waitForHealth(15000);
const workbenchReady = await waitForWorkbench(15000);
if (ready.ok && workbenchReady.ok) {
  console.log("UXCompiler Figma plugin bridge is ready.");
  console.log(`Local API: ${healthUrl}`);
  console.log(`Workbench: ${workbenchUrl}`);
  console.log(`Artifacts root: ${ready.artifactRoot}`);
  console.log(`PID file: ${pidPath}`);
  console.log(`Log: ${logPath}`);
  console.log(`Workbench log: ${workbenchLogPath}`);
  console.log("In Figma, import apps/figma-plugin/manifest.json and click Sync to UXCompiler.");
  process.exit(0);
}

await stopChild(child);
await stopChild(workbenchChild);

console.error("Figma plugin bridge did not become ready.");
console.error(`Local API: ${healthUrl}`);
console.error(`Workbench: ${workbenchUrl}`);
console.error(`Log: ${logPath}`);
console.error(`Workbench log: ${workbenchLogPath}`);
const logTail = await readTail(logPath);
if (logTail) {
  console.error("");
  console.error(logTail);
}
const workbenchLogTail = await readTail(workbenchLogPath);
if (workbenchLogTail) {
  console.error("");
  console.error(workbenchLogTail);
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

async function waitForWorkbench(timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const health = await checkWorkbench();
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
      const status = await readPid();
      return {
        ok: true,
        artifactRoot: body.artifactRoot,
        pid: status.pid
      };
    }
  } catch {
    // The caller only needs an offline/online distinction.
  }
  return { ok: false };
}

async function checkWorkbench() {
  try {
    const response = await fetch(workbenchProbeUrl, { signal: AbortSignal.timeout(1000) });
    if (response.ok) {
      const status = await readPid();
      return {
        ok: true,
        pid: status.workbenchPid
      };
    }
  } catch {
    // The caller only needs an offline/online distinction.
  }
  return { ok: false };
}

async function writeStatus(pid, workbenchPid) {
  await mkdir(dirname(pidPath), { recursive: true });
  await writeFile(
    pidPath,
    `${JSON.stringify(
      {
        pid,
        workbenchPid,
        port,
        workbenchPort,
        healthUrl,
        workbenchUrl,
        logPath,
        workbenchLogPath,
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
    return {
      pid: Number.isInteger(status.pid) ? status.pid : null,
      workbenchPid: Number.isInteger(status.workbenchPid) ? status.workbenchPid : null
    };
  } catch {
    return {
      pid: null,
      workbenchPid: null
    };
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

async function stopChild(processHandle) {
  if (!processHandle?.pid) return;
  try {
    process.kill(-processHandle.pid, "SIGTERM");
    return;
  } catch {
    // Try the process directly below.
  }
  try {
    process.kill(processHandle.pid, "SIGTERM");
  } catch {
    // Best effort cleanup only.
  }
}
