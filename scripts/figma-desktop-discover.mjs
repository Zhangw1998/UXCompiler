import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, resolve } from "node:path";

const settingsPath = resolve(
  process.env.UXCOMPILER_FIGMA_DESKTOP_SETTINGS ??
    `${homedir()}/Library/Application Support/Figma/settings.json`
);
const reportPath = resolve(
  process.cwd(),
  process.env.UXCOMPILER_FIGMA_DESKTOP_REPORT ?? "artifacts/figma-desktop/figma_desktop_discovery_report.json"
);

const discovery = await discoverCurrentFigmaFile(settingsPath);
await writeJson(reportPath, discovery);

console.log("UXCompiler Figma desktop discovery");
console.log("");
console.log(`Status: ${discovery.status}`);
if (discovery.current) {
  const target = discovery.current;
  console.log(`Title: ${target.title}`);
  console.log(`File key: ${target.fileKey}`);
  console.log(`Node id: ${target.nodeId ?? "(missing)"}`);
  console.log(`Editor type: ${target.editorType ?? "unknown"}`);
  console.log(`Figma URL: ${target.url}`);
  console.log("");
  console.log("Next options");
  console.log(`Connector: fileKey=${target.fileKey}${target.nodeId ? `, nodeId=${target.nodeId}` : ""}`);
  console.log(`REST inspect: pnpm figma:inspect-url '${target.url}'`);
  console.log(`REST configure: FIGMA_ACCESS_TOKEN=figd_... pnpm figma:configure -- --url '${target.url}'`);
  console.log("Plugin bridge: pnpm figma:plugin-start && pnpm figma:plugin-wait");
} else {
  console.log("No active Figma design tab was found in the desktop app state.");
  console.log("Open a Figma design file in the desktop app, then rerun this command.");
}
console.log("");
console.log(`Report: ${reportPath}`);

async function discoverCurrentFigmaFile(path) {
  const base = {
    version: "0.1.0",
    generatedAt: new Date().toISOString(),
    settingsPath: path,
    reportPath
  };
  if (!existsSync(path)) {
    return {
      ...base,
      status: "not_found",
      current: null,
      reason: "Figma desktop settings.json was not found"
    };
  }

  const settings = JSON.parse(await readFile(path, "utf8"));
  const candidates = [];
  for (const window of settings.windows ?? []) {
    const activeTab = (window.tabs ?? []).find((tab) => tab.path === window.activeTabPath) ?? (window.tabs ?? []).find((tab) => !tab.isDiscarded);
    if (!activeTab) continue;
    const target = tabToTarget(activeTab, window);
    if (target) candidates.push(target);
  }

  candidates.sort((a, b) => Number(b.lastViewedAt ?? 0) - Number(a.lastViewedAt ?? 0));
  return {
    ...base,
    status: candidates.length > 0 ? "found" : "not_found",
    current: candidates[0] ?? null,
    candidates
  };
}

function tabToTarget(tab, window) {
  const fileKey = parseFileKey(tab.path);
  if (!fileKey) return null;
  const params = new URLSearchParams(String(tab.params ?? "").replace(/^\?/, ""));
  const nodeId = normalizeNodeId(params.get("node-id") ?? undefined);
  const sourceType = sourceTypeFor(tab);
  return {
    title: tab.title ?? "Untitled",
    fileKey,
    nodeId,
    sourceType,
    editorType: tab.editorType,
    path: tab.path,
    params: tab.params ?? "",
    url: buildFigmaUrl({ sourceType, fileKey, title: tab.title, nodeId, params }),
    activeTabPath: window.activeTabPath,
    windowId: window.id,
    lastViewedAt: tab.lastViewedAt,
    createdAt: tab.createdAt,
    editedAt: tab.editedAt
  };
}

function parseFileKey(path) {
  const parts = String(path ?? "").split("/").filter(Boolean);
  const fileTypeIndex = parts.findIndex((part) => ["file", "design", "board", "slides"].includes(part));
  if (fileTypeIndex < 0) return undefined;
  const branchIndex = parts.findIndex((part) => part === "branch");
  if (branchIndex >= 0 && parts[branchIndex + 1]) return parts[branchIndex + 1];
  return parts[fileTypeIndex + 1];
}

function sourceTypeFor(tab) {
  const params = new URLSearchParams(String(tab.params ?? "").replace(/^\?/, ""));
  if (params.get("type") === "whiteboard") return "board";
  if (params.get("type") === "slides") return "slides";
  return "design";
}

function buildFigmaUrl({ sourceType, fileKey, title, nodeId, params }) {
  const slug = encodeURIComponent(String(title ?? "Figma File").trim().replace(/\s+/g, "-"));
  const searchParams = new URLSearchParams(String(params ?? "").replace(/^\?/, ""));
  if (nodeId) searchParams.set("node-id", nodeId.replace(/:/g, "-"));
  if (sourceType === "design") searchParams.set("type", "design");
  const query = searchParams.toString();
  return `https://www.figma.com/${sourceType}/${fileKey}/${slug}${query ? `?${query}` : ""}`;
}

function normalizeNodeId(nodeId) {
  return nodeId ? nodeId.replace(/-/g, ":") : undefined;
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
