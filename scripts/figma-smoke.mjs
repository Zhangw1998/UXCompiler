import { execFile } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const dotenv = await readDotenv();
const file = readSetting("FIGMA_FILE_URL", dotenv) ?? readSetting("FIGMA_FILE_KEY", dotenv);
const node = readSetting("FIGMA_NODE_ID", dotenv);
const frameIndexSetting = readSetting("FIGMA_FRAME_INDEX", dotenv);
const out = readSetting("UXCOMPILER_FIGMA_OUT", dotenv) ?? "artifacts/real-figma-smoke";
const token = readSetting("FIGMA_ACCESS_TOKEN", dotenv);
const apiBaseUrl = readSetting("FIGMA_API_BASE_URL", dotenv);
const hasRequiredConfig = isRealToken(token) && isRealFigmaTarget(file);
const urlNode = readNodeIdFromUrl(file);

if (!hasRequiredConfig) {
  console.log("UXCompiler real Figma smoke");
  console.log("");
  console.log("Missing setup. Add these values to .env or export them in your shell:");
  console.log("");
  console.log("FIGMA_ACCESS_TOKEN=figd_...");
  console.log("FIGMA_FILE_URL=https://www.figma.com/design/FILE_KEY/File-Name?node-id=1-2");
  console.log("# Optional when the URL does not include node-id:");
  console.log("FIGMA_NODE_ID=1:2");
  console.log("# Or select by the 1-based frame list index printed by this script:");
  console.log("FIGMA_FRAME_INDEX=1");
  console.log("# Optional output directory:");
  console.log("UXCOMPILER_FIGMA_OUT=artifacts/my-figma-frame");
  console.log("# Optional custom Figma-compatible API base URL:");
  console.log("FIGMA_API_BASE_URL=https://api.figma.com");
  console.log("");
  console.log("Then run:");
  console.log("pnpm figma:smoke");
  process.exitCode = 2;
} else {
  const frameIndex = readFrameIndex(frameIndexSetting);
  await mkdir(resolve(process.cwd(), out), { recursive: true });
  await run("pnpm", ["build"]);
  await run("node", ["apps/cli/dist/index.js", "doctor"]);
  let selectedNode = node;

  if (!selectedNode && !urlNode) {
    const framesJson = await runCapture(
      "node",
      compact(["apps/cli/dist/index.js", "figma", "frames", "--file", file, "--json", apiBaseUrl ? "--api-base-url" : undefined, apiBaseUrl])
    );
    const framesResult = JSON.parse(framesJson.stdout);
    printFrames(framesResult);

    if (frameIndex !== undefined) {
      const frame = framesResult.frames?.[frameIndex - 1];
      if (!frame) {
        throw new Error(`FIGMA_FRAME_INDEX=${frameIndex} is out of range. Available frames: ${framesResult.frames?.length ?? 0}.`);
      }
      selectedNode = frame.id;
      console.log("");
      console.log(`Selected frame ${frameIndex}: ${frame.path} (${frame.id})`);
    }
  } else {
    await run(
      "node",
      compact(["apps/cli/dist/index.js", "figma", "frames", "--file", file, apiBaseUrl ? "--api-base-url" : undefined, apiBaseUrl])
    );
  }

  if (!selectedNode && !urlNode) {
    console.log("");
    console.log("Figma access works, but no target frame node is configured.");
    console.log("Pick a frame id or index from the list above, then add one of these:");
    console.log("");
    console.log("FIGMA_NODE_ID=1:2");
    console.log("FIGMA_FRAME_INDEX=1");
    console.log("or");
    console.log("FIGMA_FILE_URL=https://www.figma.com/design/FILE_KEY/File-Name?node-id=1-2");
    process.exitCode = 2;
  } else {
    await run(
      "node",
      compact([
        "apps/cli/dist/index.js",
        "figma",
        "check",
        "--file",
        file,
        selectedNode ? "--node" : undefined,
        selectedNode,
        apiBaseUrl ? "--api-base-url" : undefined,
        apiBaseUrl
      ])
    );
    await run(
      "node",
      compact([
        "apps/cli/dist/index.js",
        "figma",
        "run",
        "--file",
        file,
        selectedNode ? "--node" : undefined,
        selectedNode,
        "--out",
        out,
        apiBaseUrl ? "--api-base-url" : undefined,
        apiBaseUrl
      ])
    );
    console.log("");
    console.log("Real Figma smoke completed.");
    console.log(`Artifacts: ${resolve(process.cwd(), out)}`);
    console.log(`Report: ${resolve(process.cwd(), out, "pipeline_run_report.json")}`);
  }
}

async function run(command, args) {
  console.log("");
  console.log(`$ ${[command, ...args].map(shellQuote).join(" ")}`);
  const result = await execFileAsync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    maxBuffer: 20 * 1024 * 1024
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

async function runCapture(command, args) {
  console.log("");
  console.log(`$ ${[command, ...args].map(shellQuote).join(" ")}`);
  const result = await execFileAsync(command, args, {
    cwd: process.cwd(),
    env: process.env,
    maxBuffer: 20 * 1024 * 1024
  });
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
}

function compact(values) {
  return values.filter((value) => value !== undefined && value !== "");
}

function readSetting(name, envFile) {
  return process.env[name] || envFile.get(name);
}

function readFrameIndex(value) {
  if (!value) return undefined;
  const frameIndex = Number(value);
  if (!Number.isInteger(frameIndex) || frameIndex <= 0) {
    throw new Error("FIGMA_FRAME_INDEX must be a positive integer, for example 1.");
  }
  return frameIndex;
}

function printFrames(result) {
  console.log(`UXCompiler Figma frames`);
  console.log(`File: ${result.fileName ?? result.fileKey}`);
  console.log(`Frames: ${result.frames?.length ?? 0}`);
  for (const [index, frame] of (result.frames ?? []).entries()) {
    const size = frame.width && frame.height ? `${Math.round(frame.width)}x${Math.round(frame.height)}` : "?x?";
    console.log(`${index + 1}. [${frame.type}] ${frame.id} (${size}) ${frame.path}`);
  }
}

function isRealToken(value) {
  return !!value && !["replace_with_your_figma_token", "YOUR_TOKEN", "figd_..."].includes(value);
}

function isRealFigmaTarget(value) {
  if (!value || value.includes("FILE_KEY") || value.includes("File-Name")) return false;
  return true;
}

function readNodeIdFromUrl(value) {
  if (!value || (!value.startsWith("http://") && !value.startsWith("https://"))) return undefined;
  return new URL(value).searchParams.get("node-id") ?? undefined;
}

async function readDotenv() {
  const values = new Map();
  try {
    const content = await readFile(resolve(process.cwd(), ".env"), "utf8");
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

function shellQuote(value) {
  if (/^[a-zA-Z0-9_./:=@-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}
