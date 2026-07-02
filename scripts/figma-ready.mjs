import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const envPath = resolve(process.cwd(), process.env.UXCOMPILER_ENV_FILE ?? ".env");
const dotenv = await readDotenv(envPath);
const token = readSetting("FIGMA_ACCESS_TOKEN", dotenv);
const file = readSetting("FIGMA_FILE_URL", dotenv) ?? readSetting("FIGMA_FILE_KEY", dotenv);
const node = readSetting("FIGMA_NODE_ID", dotenv);
const frameIndex = readSetting("FIGMA_FRAME_INDEX", dotenv);
const apiBaseUrl = readSetting("FIGMA_API_BASE_URL", dotenv) ?? "https://api.figma.com";
const out = readSetting("UXCOMPILER_FIGMA_OUT", dotenv) ?? "artifacts/real-figma-smoke";
const localApiPort = Number(process.env.UXCOMPILER_LOCAL_API_PORT ?? 8787);
const readinessReportPath = resolve(
  process.cwd(),
  process.env.UXCOMPILER_READY_REPORT ?? "artifacts/figma-readiness/figma_readiness_report.json"
);
const accessAuditReportPath = resolve(
  process.cwd(),
  process.env.UXCOMPILER_ACCESS_AUDIT_REPORT ?? "artifacts/figma-access-audit/figma_access_audit_report.json"
);

const tools = await Promise.all([
  { command: "node", ok: true, summary: process.version },
  commandVersion("pnpm", ["--version"]),
  commandVersion("dart", ["--version"]),
  commandVersion("flutter", ["--version"])
]);
const manifestReport = await readManifestReport();
const localApi = await checkLocalApi(localApiPort);
const accessAudit = await readAccessAudit(accessAuditReportPath);

const rest = {
  tokenStatus: tokenStatus(token),
  fileStatus: fileStatus(file),
  targetStatus: targetStatus(file, node, frameIndex),
  apiBaseUrl,
  out
};
const restReady = rest.tokenStatus.ok && rest.fileStatus.ok && rest.targetStatus.ok;
const pluginReady = manifestReport.ok && localApi.ok;
const readinessReport = {
  version: "0.1.0",
  generatedAt: new Date().toISOString(),
  status: restReady || pluginReady ? "ready" : "setup_needed",
  reportPath: readinessReportPath,
  tools,
  rest: {
    ready: restReady,
    token: rest.tokenStatus,
    file: rest.fileStatus,
    target: rest.targetStatus,
    apiBaseUrl,
    out,
    next: restReady ? "pnpm figma:smoke" : "add FIGMA_ACCESS_TOKEN plus FIGMA_FILE_URL, then run pnpm figma:smoke"
  },
  pluginBridge: {
    ready: pluginReady,
    manifest: manifestReport,
    localApi,
    next: localApi.ok ? "use the Figma plugin Check Local API and Sync Selection buttons" : "pnpm figma:plugin-start"
  },
  completionEvidence: {
    status: accessAudit.status,
    reportPath: accessAudit.reportPath,
    latestRealAccess: accessAudit.latestRealAccess,
    next: accessAudit.status === "verified" ? "real Figma access already verified" : "pnpm figma:access-audit after a real run"
  }
};
await writeJson(readinessReportPath, readinessReport);

console.log("UXCompiler Figma readiness");
console.log("");
console.log(`Status: ${restReady || pluginReady ? "ready to run a Figma access path" : "setup needed"}`);
console.log("");

console.log("Tools");
for (const tool of tools) {
  console.log(`${tool.ok ? "ok" : "missing"} ${tool.command}: ${tool.summary}`);
}
console.log("");

console.log("REST path");
console.log(`${rest.tokenStatus.ok ? "ok" : "missing"} FIGMA_ACCESS_TOKEN: ${rest.tokenStatus.summary}`);
console.log(`${rest.fileStatus.ok ? "ok" : "missing"} Figma file: ${rest.fileStatus.summary}`);
console.log(`${rest.targetStatus.ok ? "ok" : "missing"} target frame: ${rest.targetStatus.summary}`);
console.log(`ok FIGMA_API_BASE_URL: ${apiBaseUrl}`);
console.log(`ok UXCOMPILER_FIGMA_OUT: ${out}`);
console.log(`next: ${restReady ? "pnpm figma:smoke" : "add FIGMA_ACCESS_TOKEN plus FIGMA_FILE_URL, then run pnpm figma:smoke"}`);
console.log("");

console.log("Plugin bridge path");
console.log(`${manifestReport.ok ? "ok" : "missing"} manifest: ${manifestReport.summary}`);
console.log(`${localApi.ok ? "ok" : "missing"} local API: ${localApi.summary}`);
console.log("next: pnpm figma:bridge-smoke");
console.log(localApi.ok ? "then: use the Figma plugin Check Local API and Sync Selection buttons" : "then: pnpm figma:plugin-start");
console.log("");
console.log("Completion evidence");
console.log(`${accessAudit.status === "verified" ? "ok" : "missing"} real Figma access: ${accessAudit.summary}`);
console.log(`next: ${accessAudit.status === "verified" ? "real Figma access already verified" : "pnpm figma:access-audit after a real run"}`);
console.log("");
console.log(`Report: ${readinessReportPath}`);

function readSetting(name, envFile) {
  return process.env[name] || envFile.get(name);
}

function tokenStatus(value) {
  if (!value) return { ok: false, summary: "not configured" };
  if (["replace_with_your_figma_token", "YOUR_TOKEN", "figd_..."].includes(value)) {
    return { ok: false, summary: "placeholder value" };
  }
  return { ok: true, summary: "configured" };
}

function fileStatus(value) {
  if (!value) return { ok: false, summary: "not configured" };
  if (value.includes("FILE_KEY") || value.includes("File-Name")) return { ok: false, summary: "placeholder value" };
  return { ok: true, summary: value.startsWith("http") ? "URL configured" : "file key configured" };
}

function targetStatus(fileValue, nodeValue, frameIndexValue) {
  const urlNode = readNodeIdFromUrl(fileValue);
  if (urlNode) return { ok: true, summary: `URL node-id ${urlNode}` };
  if (nodeValue) return { ok: true, summary: `FIGMA_NODE_ID ${nodeValue}` };
  if (frameIndexValue) {
    const parsed = Number(frameIndexValue);
    if (Number.isInteger(parsed) && parsed > 0) return { ok: true, summary: `FIGMA_FRAME_INDEX ${parsed}` };
    return { ok: false, summary: "FIGMA_FRAME_INDEX must be a positive integer" };
  }
  return { ok: false, summary: "add node-id, FIGMA_NODE_ID, or FIGMA_FRAME_INDEX" };
}

function readNodeIdFromUrl(value) {
  if (!value || (!value.startsWith("http://") && !value.startsWith("https://"))) return undefined;
  return new URL(value).searchParams.get("node-id") ?? undefined;
}

async function readDotenv(path) {
  const values = new Map();
  try {
    const content = await readFile(path, "utf8");
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!match) continue;
      values.set(match[1], match[2].replace(/^['"]|['"]$/g, "").trim());
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  return values;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function readAccessAudit(path) {
  try {
    const audit = JSON.parse(await readFile(path, "utf8"));
    return {
      status: audit.status ?? "unknown",
      reportPath: path,
      latestRealAccess: audit.latestRealAccess ?? null,
      summary:
        audit.status === "verified"
          ? `verified by ${audit.latestRealAccess?.path ?? "access audit"}`
          : audit.status === "not_verified"
            ? "no successful real Figma access report found"
            : "audit status unknown"
    };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return {
      status: "unknown",
      reportPath: path,
      latestRealAccess: null,
      summary: "access audit report not found"
    };
  }
}

async function commandVersion(command, args) {
  try {
    const result = await execFileAsync(command, args);
    return {
      command,
      ok: true,
      summary: (result.stdout || result.stderr).split(/\r?\n/)[0] || "available"
    };
  } catch {
    return {
      command,
      ok: false,
      summary: "not found"
    };
  }
}

async function readManifestReport() {
  const path = resolve(process.cwd(), "apps/figma-plugin/manifest.json");
  if (!existsSync(path)) return { ok: false, summary: "missing apps/figma-plugin/manifest.json" };
  try {
    const manifest = JSON.parse(await readFile(path, "utf8"));
    const domains = manifest.networkAccess?.allowedDomains ?? [];
    const devDomains = manifest.networkAccess?.devAllowedDomains ?? [];
    const ok =
      manifest.main === "dist/main.js" &&
      manifest.ui === "src/ui.html" &&
      manifest.documentAccess === "dynamic-page" &&
      manifest.enablePrivatePluginApi === true &&
      domains.includes("http://127.0.0.1:8787") &&
      devDomains.includes("http://127.0.0.1:8787");
    return {
      ok,
      summary: ok ? "development bridge manifest ready" : "manifest exists but bridge fields need attention"
    };
  } catch (error) {
    return { ok: false, summary: error instanceof Error ? error.message : String(error) };
  }
}

async function checkLocalApi(port) {
  const url = `http://127.0.0.1:${port}/health`;
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
    const body = await response.json().catch(() => undefined);
    if (response.ok && body?.ok) return { ok: true, summary: `${url} online; artifacts ${body.artifactRoot}` };
    return { ok: false, summary: `${url} returned ${response.status}` };
  } catch {
    return { ok: false, summary: `${url} is not running` };
  }
}
