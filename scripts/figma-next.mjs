import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const readinessPath = resolve(
  process.cwd(),
  process.env.UXCOMPILER_READY_REPORT ?? "artifacts/figma-readiness/figma_readiness_report.json"
);
const auditPath = resolve(
  process.cwd(),
  process.env.UXCOMPILER_ACCESS_AUDIT_REPORT ?? "artifacts/figma-access-audit/figma_access_audit_report.json"
);
const desktopPath = resolve(
  process.cwd(),
  process.env.UXCOMPILER_FIGMA_DESKTOP_REPORT ?? "artifacts/figma-desktop/figma_desktop_discovery_report.json"
);

const readiness = await readJsonIfExists(readinessPath);
const audit = await readJsonIfExists(auditPath);
const desktop = await readJsonIfExists(desktopPath);

console.log("UXCompiler Figma next step");
console.log("");

if (audit?.status === "verified") {
  console.log("Status: real Figma access verified");
  console.log(`Latest file: ${audit.latestRealAccess?.fileKey}`);
  console.log(`Frame node: ${audit.latestRealAccess?.frameNodeId}`);
  console.log(`Pipeline report: ${audit.latestRealAccess?.path}`);
  process.exit(0);
}

console.log("Status: real Figma access not verified yet");
console.log("");

if (desktop?.status === "found" && desktop.current) {
  console.log("0. Figma desktop currently has a target open:");
  console.log(`   ${desktop.current.title}`);
  console.log(`   fileKey=${desktop.current.fileKey}${desktop.current.nodeId ? ` nodeId=${desktop.current.nodeId}` : ""}`);
  console.log(`   ${desktop.current.url}`);
  console.log("");
} else {
  console.log("0. Detect the currently open Figma desktop file:");
  console.log("   pnpm figma:desktop-discover");
  console.log("");
}

if (!readiness) {
  console.log("1. Run readiness and audit checks:");
  console.log("   pnpm figma:ready");
  console.log("   pnpm figma:access-audit");
  console.log("");
} else if (readiness.rest?.ready) {
  console.log("1. REST path is configured:");
  console.log("   pnpm figma:smoke");
  console.log("");
} else {
  console.log("1. REST path needs configuration:");
  console.log("   pnpm figma:inspect-url '<figma_node_url>'");
  console.log("   pnpm figma:configure -- --url '<figma_node_url>'");
  console.log("   pnpm figma:ready");
  console.log("   pnpm figma:smoke");
  console.log("");
}

if (readiness?.pluginBridge?.ready) {
  console.log("2. Plugin bridge path is ready:");
  console.log("   pnpm figma:plugin-wait");
  console.log("   In Figma, run UXCompiler Bridge, then Check Local API and Sync Selection.");
} else {
  console.log("2. Plugin bridge path:");
  console.log("   pnpm figma:bridge-smoke");
  console.log("   pnpm figma:plugin-start");
  console.log("   pnpm figma:plugin-wait");
  console.log("   In Figma, import apps/figma-plugin/manifest.json and sync a selected frame.");
}
console.log("");

console.log("3. Codex Figma connector path:");
console.log("   Provide a node-specific Figma URL. Codex can use fileKey + nodeId with the Figma connector.");
console.log("   pnpm figma:inspect-url '<figma_node_url>' shows the exact fileKey/nodeId pair.");
console.log("");

console.log("4. After any real run, verify completion evidence:");
console.log("   pnpm figma:access-audit");

async function readJsonIfExists(path) {
  if (!existsSync(path)) return undefined;
  return JSON.parse(await readFile(path, "utf8"));
}
