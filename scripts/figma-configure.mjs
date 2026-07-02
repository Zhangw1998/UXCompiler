import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { mkdir } from "node:fs/promises";

const envPath = resolve(process.cwd(), process.env.UXCOMPILER_ENV_FILE ?? ".env");
const args = parseArgs(process.argv.slice(2));
const existing = await readEnvFile(envPath);

const tokenEnvName = args.tokenEnv ?? "FIGMA_ACCESS_TOKEN";
const token = process.env[tokenEnvName] || existing.values.get("FIGMA_ACCESS_TOKEN");
const explicitFileUrl = args.url ?? process.env.FIGMA_FILE_URL;
const explicitFileKey = args.fileKey ?? process.env.FIGMA_FILE_KEY;
const explicitNode = args.node ?? process.env.FIGMA_NODE_ID;
const explicitFrameIndex = args.frameIndex ?? process.env.FIGMA_FRAME_INDEX;
const fileUrl = explicitFileUrl ?? existing.values.get("FIGMA_FILE_URL");
const fileKey = explicitFileKey ?? existing.values.get("FIGMA_FILE_KEY");
const urlNode = readNodeIdFromUrl(fileUrl);
const shouldUseUrlNodeSelector = !!(explicitFileUrl && urlNode && !explicitNode && !explicitFrameIndex);
const node = shouldUseUrlNodeSelector || explicitFrameIndex ? undefined : explicitNode ?? existing.values.get("FIGMA_NODE_ID");
const frameIndex = shouldUseUrlNodeSelector || explicitNode ? undefined : explicitFrameIndex ?? existing.values.get("FIGMA_FRAME_INDEX");
const out = args.out ?? process.env.UXCOMPILER_FIGMA_OUT ?? existing.values.get("UXCOMPILER_FIGMA_OUT") ?? "artifacts/my-figma-frame";
const apiBaseUrl = args.apiBaseUrl ?? process.env.FIGMA_API_BASE_URL ?? existing.values.get("FIGMA_API_BASE_URL");

if (!hasUsableInput({ token, fileUrl, fileKey, node, frameIndex, out, apiBaseUrl })) {
  printUsage();
  process.exitCode = 2;
} else {
  const updates = new Map();
  const deletes = new Set();
  if (token) updates.set("FIGMA_ACCESS_TOKEN", token);
  if (fileUrl) {
    updates.set("FIGMA_FILE_URL", fileUrl);
    deletes.add("FIGMA_FILE_KEY");
  }
  if (fileKey && !fileUrl) {
    updates.set("FIGMA_FILE_KEY", fileKey);
    deletes.add("FIGMA_FILE_URL");
  }
  if (node) updates.set("FIGMA_NODE_ID", normalizeNodeId(node));
  if (frameIndex) updates.set("FIGMA_FRAME_INDEX", validateFrameIndex(frameIndex));
  if (explicitNode) deletes.add("FIGMA_FRAME_INDEX");
  if (explicitFrameIndex) deletes.add("FIGMA_NODE_ID");
  if (shouldUseUrlNodeSelector) {
    deletes.add("FIGMA_NODE_ID");
    deletes.add("FIGMA_FRAME_INDEX");
  }
  if (out) updates.set("UXCOMPILER_FIGMA_OUT", out);
  if (apiBaseUrl) updates.set("FIGMA_API_BASE_URL", apiBaseUrl);

  if (!updates.has("FIGMA_ACCESS_TOKEN") || isPlaceholder(updates.get("FIGMA_ACCESS_TOKEN"))) {
    console.log("FIGMA_ACCESS_TOKEN is not configured. Set it in your shell and rerun:");
    console.log("FIGMA_ACCESS_TOKEN=figd_... pnpm figma:configure -- --url 'https://www.figma.com/design/...?...'");
    process.exitCode = 2;
  } else if (!updates.has("FIGMA_FILE_URL") && !updates.has("FIGMA_FILE_KEY")) {
    console.log("Figma file is not configured. Pass --url or --file-key.");
    process.exitCode = 2;
  } else {
    const next = applyUpdates(existing.lines, updates, deletes);
    await mkdir(dirname(envPath), { recursive: true });
    await writeFile(envPath, `${next.join("\n").replace(/\n*$/, "")}\n`, "utf8");
    console.log("UXCompiler Figma configuration updated.");
    console.log(`File: ${envPath}`);
    console.log(`FIGMA_ACCESS_TOKEN: configured`);
    console.log(`Figma target: ${updates.get("FIGMA_FILE_URL") ?? updates.get("FIGMA_FILE_KEY")}`);
    console.log(`Target selector: ${updates.get("FIGMA_NODE_ID") ? `FIGMA_NODE_ID=${updates.get("FIGMA_NODE_ID")}` : updates.get("FIGMA_FRAME_INDEX") ? `FIGMA_FRAME_INDEX=${updates.get("FIGMA_FRAME_INDEX")}` : "URL node-id or frame list required"}`);
    console.log("");
    console.log("Next:");
    console.log("pnpm figma:ready");
    console.log("pnpm figma:smoke");
  }
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--") {
      continue;
    } else if (arg === "--url") {
      if (!next) throw new Error("Missing value for --url.");
      options.url = next;
      index += 1;
    } else if (arg === "--file-key") {
      if (!next) throw new Error("Missing value for --file-key.");
      options.fileKey = next;
      index += 1;
    } else if (arg === "--node" || arg === "--node-id") {
      if (!next) throw new Error(`Missing value for ${arg}.`);
      options.node = next;
      index += 1;
    } else if (arg === "--frame-index") {
      if (!next) throw new Error("Missing value for --frame-index.");
      options.frameIndex = next;
      index += 1;
    } else if (arg === "--out") {
      if (!next) throw new Error("Missing value for --out.");
      options.out = next;
      index += 1;
    } else if (arg === "--api-base-url") {
      if (!next) throw new Error("Missing value for --api-base-url.");
      options.apiBaseUrl = next;
      index += 1;
    } else if (arg === "--token-env") {
      if (!next) throw new Error("Missing value for --token-env.");
      options.tokenEnv = next;
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`Unknown option "${arg}".`);
    }
  }
  return options;
}

async function readEnvFile(path) {
  try {
    const content = await readFile(path, "utf8");
    const lines = content.split(/\r?\n/).filter((line, index, all) => index < all.length - 1 || line.length > 0);
    const values = new Map();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const match = trimmed.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!match) continue;
      values.set(match[1], unquote(match[2].trim()));
    }
    return { lines, values };
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    return { lines: [], values: new Map() };
  }
}

function applyUpdates(lines, updates, deletes = new Set()) {
  const remaining = new Map(updates);
  const next = [];
  for (const line of lines) {
    const match = line.match(/^([A-Z0-9_]+)\s*=/);
    if (match && deletes.has(match[1]) && !remaining.has(match[1])) continue;
    if (!match || !remaining.has(match[1])) {
      next.push(line);
      continue;
    }
    const value = remaining.get(match[1]);
    remaining.delete(match[1]);
    next.push(`${match[1]}=${quote(value)}`);
  }
  for (const [key, value] of remaining) {
    next.push(`${key}=${quote(value)}`);
  }
  return next;
}

function hasUsableInput(values) {
  return Object.values(values).some((value) => value !== undefined && value !== "");
}

function validateFrameIndex(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error("FIGMA_FRAME_INDEX must be a positive integer.");
  }
  return String(parsed);
}

function normalizeNodeId(value) {
  return value.replace(/-/g, ":");
}

function readNodeIdFromUrl(value) {
  if (!value || (!value.startsWith("http://") && !value.startsWith("https://"))) return undefined;
  return new URL(value).searchParams.get("node-id") ?? undefined;
}

function isPlaceholder(value) {
  return !value || ["replace_with_your_figma_token", "YOUR_TOKEN", "figd_..."].includes(value);
}

function quote(value) {
  if (/^[^\s"'#]+$/.test(value)) return value;
  return JSON.stringify(value);
}

function unquote(value) {
  return value.replace(/^['"]|['"]$/g, "");
}

function printUsage() {
  console.log("UXCompiler Figma configuration");
  console.log("");
  console.log("Set FIGMA_ACCESS_TOKEN in your shell or secret manager first; this helper reads it and never prints it.");
  console.log("pnpm figma:configure -- --url 'https://www.figma.com/design/FILE_KEY/File?node-id=1-2'");
  console.log("");
  console.log("Options:");
  console.log("  --url <figma_url>");
  console.log("  --file-key <file_key>");
  console.log("  --node <node_id>");
  console.log("  --frame-index <1-based_index>");
  console.log("  --out <artifact_dir>");
  console.log("  --api-base-url <url>");
  console.log("  --token-env <env_var_name>");
}
