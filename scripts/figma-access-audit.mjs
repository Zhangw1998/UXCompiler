import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const reportPath = resolve(
  process.cwd(),
  process.env.UXCOMPILER_ACCESS_AUDIT_REPORT ?? "artifacts/figma-access-audit/figma_access_audit_report.json"
);

const searchRoots = [
  "artifacts/real-figma-smoke",
  "artifacts/my-figma-frame",
  "artifacts/figma-bridge",
  "artifacts/figma-mock",
  "artifacts/figma-smoke-mock",
  "artifacts/figma-bridge-smoke",
  "artifacts/local-api-smoke"
];

const reports = [];
for (const root of searchRoots) {
  const absoluteRoot = resolve(process.cwd(), root);
  if (!existsSync(absoluteRoot)) continue;
  for (const path of await findPipelineReports(absoluteRoot)) {
    const report = JSON.parse(await readFile(path, "utf8"));
    reports.push(classifyReport(path, report));
  }
}

reports.sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)));
const realSuccesses = reports.filter((report) => report.classification === "real_figma_access" && report.success);
const audit = {
  version: "0.1.0",
  generatedAt: new Date().toISOString(),
  status: realSuccesses.length > 0 ? "verified" : "not_verified",
  reportPath,
  latestRealAccess: realSuccesses[0] ?? null,
  reports
};

await writeJson(reportPath, audit);

console.log("UXCompiler Figma access audit");
console.log("");
console.log(`Status: ${audit.status}`);
console.log(`Reports scanned: ${reports.length}`);
console.log(`Real successful accesses: ${realSuccesses.length}`);
if (audit.latestRealAccess) {
  console.log(`Latest real file: ${audit.latestRealAccess.fileKey}`);
  console.log(`Frame node: ${audit.latestRealAccess.frameNodeId}`);
  console.log(`Report: ${audit.latestRealAccess.path}`);
} else {
  console.log("No successful real Figma access report found yet.");
  console.log("Next: run pnpm figma:smoke with real FIGMA_ACCESS_TOKEN and FIGMA_FILE_URL, or sync a real frame through the Figma plugin.");
}
console.log(`Audit report: ${reportPath}`);

async function findPipelineReports(root) {
  const results = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await findPipelineReports(path)));
    } else if (entry.isFile() && entry.name === "pipeline_run_report.json") {
      results.push(path);
    }
  }
  return results;
}

function classifyReport(path, report) {
  const sourceKind = report.source?.sourceKind;
  const fileKey = report.source?.fileKey;
  const fileName = report.source?.fileName;
  const frameNodeId = report.source?.frameNodeId;
  const success =
    report.steps?.compile?.status === "success" &&
    report.steps?.flutterCapture?.status === "success" &&
    (report.steps?.figmaFetch?.status === "success" || report.steps?.snapshot?.status === "success");
  const classification = classifySource(path, sourceKind, fileKey, fileName);
  return {
    path,
    generatedAt: report.generatedAt,
    sourceKind,
    fileKey,
    fileName,
    frameNodeId,
    success,
    classification,
    reason: reasonFor(classification)
  };
}

function classifySource(path, sourceKind, fileKey, fileName) {
  if (sourceKind === "local_smoke") return "local_smoke";
  if (sourceKind === "figma_plugin") return "real_figma_access";
  if (fileKey === "mock" || path.includes("figma-mock") || path.includes("figma-smoke-mock")) return "mock";
  if (
    fileKey === "plugin_file" ||
    fileName === "figma_plugin_smoke" ||
    path.includes("figma-bridge-smoke") ||
    path.includes("local-api-smoke")
  ) {
    return "local_smoke";
  }
  if (!fileKey) return "unknown";
  return "real_figma_access";
}

function reasonFor(classification) {
  if (classification === "real_figma_access") return "real Figma REST or plugin pipeline report";
  if (classification === "mock") return "mock Figma API verification";
  if (classification === "local_smoke") return "local plugin/API smoke test";
  return "missing file key";
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
