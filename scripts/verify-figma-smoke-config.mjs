import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const smokeScript = resolve(process.cwd(), "scripts/figma-smoke.mjs");

await verifyMissingConfig();
await verifyPlaceholderConfig();
await verifyMissingConfigWithInvalidFrameIndex();
console.log("figma smoke config verification passed");

async function verifyMissingConfig() {
  const result = await runSmoke({
    FIGMA_ACCESS_TOKEN: undefined,
    FIGMA_FILE_URL: undefined,
    FIGMA_FILE_KEY: undefined,
    FIGMA_NODE_ID: undefined,
    FIGMA_FRAME_INDEX: undefined
  });
  assertExitCode(result, 2, "missing config");
  assertIncludes(result.stdout, "Missing setup", "missing config prompt");
  assertNotIncludes(result.stdout, "$ pnpm build", "missing config should not build");
}

async function verifyPlaceholderConfig() {
  const result = await runSmoke({
    FIGMA_ACCESS_TOKEN: "replace_with_your_figma_token",
    FIGMA_FILE_URL: "https://www.figma.com/design/FILE_KEY/File-Name?node-id=1-2",
    FIGMA_FILE_KEY: undefined,
    FIGMA_NODE_ID: undefined,
    FIGMA_FRAME_INDEX: undefined
  });
  assertExitCode(result, 2, "placeholder config");
  assertIncludes(result.stdout, "Missing setup", "placeholder config prompt");
  assertNotIncludes(result.stdout, "$ pnpm build", "placeholder config should not build");
}

async function verifyMissingConfigWithInvalidFrameIndex() {
  const result = await runSmoke({
    FIGMA_ACCESS_TOKEN: undefined,
    FIGMA_FILE_URL: undefined,
    FIGMA_FILE_KEY: undefined,
    FIGMA_NODE_ID: undefined,
    FIGMA_FRAME_INDEX: "not-a-number"
  });
  assertExitCode(result, 2, "missing config with invalid frame index");
  assertIncludes(result.stdout, "Missing setup", "missing config with invalid frame index prompt");
  assertNotIncludes(result.stderr, "FIGMA_FRAME_INDEX must be a positive integer", "missing config should not parse frame index first");
}

async function runSmoke(overrides) {
  const env = { ...process.env };
  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }
  const cwd = await mkdtemp(join(tmpdir(), "uxcompiler-figma-smoke-config-"));
  try {
    const result = await execFileAsync("node", [smokeScript], {
      cwd,
      env,
      maxBuffer: 1024 * 1024
    });
    return {
      code: 0,
      stdout: result.stdout,
      stderr: result.stderr
    };
  } catch (error) {
    return {
      code: error.code,
      stdout: error.stdout ?? "",
      stderr: error.stderr ?? ""
    };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

function assertExitCode(result, expected, label) {
  if (result.code !== expected) {
    throw new Error(`${label}: expected exit code ${expected}, received ${result.code}\n${result.stdout}\n${result.stderr}`);
  }
}

function assertIncludes(value, needle, label) {
  if (!value.includes(needle)) {
    throw new Error(`${label}: expected output to include "${needle}"\n${value}`);
  }
}

function assertNotIncludes(value, needle, label) {
  if (value.includes(needle)) {
    throw new Error(`${label}: expected output not to include "${needle}"\n${value}`);
  }
}
