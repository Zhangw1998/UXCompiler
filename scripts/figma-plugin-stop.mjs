import { rm, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const port = Number(process.env.UXCOMPILER_LOCAL_API_PORT ?? 8787);
const workbenchPort = Number(process.env.UXCOMPILER_WORKBENCH_PORT ?? 8788);
const healthUrl = `http://127.0.0.1:${port}/health`;
const workbenchProbeUrl = `http://127.0.0.1:${workbenchPort}/apps/workbench-web/`;
const sessionDir = resolve(process.cwd(), process.env.UXCOMPILER_LOCAL_API_SESSION_DIR ?? "artifacts/local-api-session");
const pidPath = resolve(sessionDir, "local-api.pid");

const status = await readStatus();
if (!status?.pid && !status?.workbenchPid) {
  const health = await checkHealth();
  const workbenchHealth = await checkWorkbench();
  if (health.ok || workbenchHealth.ok) {
    console.log("UXCompiler services are online, but no PID file was found.");
    console.log(`URL: ${healthUrl}`);
    console.log(`Workbench: http://127.0.0.1:${workbenchPort}/apps/workbench-web/`);
    console.log("Stop the process that started it, or remove the listener on this port.");
    process.exitCode = 2;
  } else {
    console.log("UXCompiler local API is not running.");
    await rm(pidPath, { force: true });
  }
  process.exit();
}

if (status.workbenchPid) await stopPid(status.workbenchPid);
if (status.pid) await stopPid(status.pid);
const stopped = status.pid ? await waitUntilStopped(10000) : true;
const workbenchStopped = status.workbenchPid ? await waitUntilWorkbenchStopped(10000) : true;
await rm(pidPath, { force: true });

if (stopped && workbenchStopped) {
  console.log("UXCompiler local API stopped.");
  if (status.pid) console.log(`PID: ${status.pid}`);
  if (status.workbenchPid) console.log(`Workbench PID: ${status.workbenchPid}`);
} else {
  console.log("Stop signal was sent, but at least one UXCompiler service still responded to health checks.");
  if (status.pid) console.log(`PID: ${status.pid}`);
  if (status.workbenchPid) console.log(`Workbench PID: ${status.workbenchPid}`);
  console.log(`URL: ${healthUrl}`);
  console.log(`Workbench: http://127.0.0.1:${workbenchPort}/apps/workbench-web/`);
  process.exitCode = 1;
}

async function stopPid(pid) {
  try {
    process.kill(-pid, "SIGTERM");
    return;
  } catch {
    // Try the process directly below.
  }
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function waitUntilStopped(timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const health = await checkHealth();
    if (!health.ok) return true;
    await delay(500);
  }
  return false;
}

async function waitUntilWorkbenchStopped(timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const health = await checkWorkbench();
    if (!health.ok) return true;
    await delay(500);
  }
  return false;
}

async function checkHealth() {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1000) });
    const body = await response.json().catch(() => undefined);
    return { ok: response.ok && body?.ok };
  } catch {
    return { ok: false };
  }
}

async function checkWorkbench() {
  try {
    const response = await fetch(workbenchProbeUrl, { signal: AbortSignal.timeout(1000) });
    return { ok: response.ok };
  } catch {
    return { ok: false };
  }
}

async function readStatus() {
  try {
    const status = JSON.parse(await readFile(pidPath, "utf8"));
    if (!Number.isInteger(status.pid) && !Number.isInteger(status.workbenchPid)) return null;
    return {
      ...status,
      pid: Number.isInteger(status.pid) ? status.pid : null,
      workbenchPid: Number.isInteger(status.workbenchPid) ? status.workbenchPid : null
    };
  } catch {
    return null;
  }
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
