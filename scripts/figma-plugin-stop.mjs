import { rm, readFile } from "node:fs/promises";
import { resolve } from "node:path";

const port = Number(process.env.UXCOMPILER_LOCAL_API_PORT ?? 8787);
const healthUrl = `http://127.0.0.1:${port}/health`;
const sessionDir = resolve(process.cwd(), process.env.UXCOMPILER_LOCAL_API_SESSION_DIR ?? "artifacts/local-api-session");
const pidPath = resolve(sessionDir, "local-api.pid");

const status = await readStatus();
if (!status?.pid) {
  const health = await checkHealth();
  if (health.ok) {
    console.log("UXCompiler local API is online, but no PID file was found.");
    console.log(`URL: ${healthUrl}`);
    console.log("Stop the process that started it, or remove the listener on this port.");
    process.exitCode = 2;
  } else {
    console.log("UXCompiler local API is not running.");
    await rm(pidPath, { force: true });
  }
  process.exit();
}

await stopPid(status.pid);
const stopped = await waitUntilStopped(10000);
await rm(pidPath, { force: true });

if (stopped) {
  console.log("UXCompiler local API stopped.");
  console.log(`PID: ${status.pid}`);
} else {
  console.log("Stop signal was sent, but the local API still responded to health checks.");
  console.log(`PID: ${status.pid}`);
  console.log(`URL: ${healthUrl}`);
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

async function checkHealth() {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1000) });
    const body = await response.json().catch(() => undefined);
    return { ok: response.ok && body?.ok };
  } catch {
    return { ok: false };
  }
}

async function readStatus() {
  try {
    const status = JSON.parse(await readFile(pidPath, "utf8"));
    return Number.isInteger(status.pid) ? status : null;
  } catch {
    return null;
  }
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}
