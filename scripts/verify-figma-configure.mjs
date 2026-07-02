import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const tmp = await mkdtemp(join(tmpdir(), "uxcompiler-figma-configure-"));
const envPath = join(tmp, ".env");
const token = "figd_test_secret_token";

try {
  await writeFile(envPath, "# existing comment\nUXCOMPILER_FIGMA_OUT=artifacts/old\n", "utf8");
  const result = await execFileAsync(
    "node",
    [
      "scripts/figma-configure.mjs",
      "--url",
      "https://www.figma.com/design/abc123/Example?node-id=1-2",
      "--frame-index",
      "1",
      "--out",
      "artifacts/my-figma-frame"
    ],
    {
      cwd: resolve(import.meta.dirname, ".."),
      env: {
        ...process.env,
        UXCOMPILER_ENV_FILE: envPath,
        FIGMA_ACCESS_TOKEN: token
      },
      maxBuffer: 1024 * 1024
    }
  );

  assert.match(result.stdout, /UXCompiler Figma configuration updated/);
  assert.match(result.stdout, /FIGMA_ACCESS_TOKEN: configured/);
  assert.doesNotMatch(result.stdout, new RegExp(token));
  assert.equal(result.stderr, "");

  const env = await readFile(envPath, "utf8");
  assert.match(env, /# existing comment/);
  assert.match(env, /FIGMA_ACCESS_TOKEN=figd_test_secret_token/);
  assert.match(env, /FIGMA_FILE_URL=https:\/\/www\.figma\.com\/design\/abc123\/Example\?node-id=1-2/);
  assert.match(env, /FIGMA_FRAME_INDEX=1/);
  assert.match(env, /UXCOMPILER_FIGMA_OUT=artifacts\/my-figma-frame/);

  await verifyStaleSelectorCleanup();
  await verifyMissingToken(envPath);
  console.log("figma configure verification passed");
} finally {
  await rm(tmp, { recursive: true, force: true });
}

async function verifyMissingToken(path) {
  const missingPath = join(tmp, "missing-token.env");
  await writeFile(missingPath, "FIGMA_FILE_URL=https://www.figma.com/design/abc123/Example?node-id=1-2\n", "utf8");
  try {
    await execFileAsync("node", ["scripts/figma-configure.mjs", "--frame-index", "1"], {
      cwd: resolve(import.meta.dirname, ".."),
      env: {
        ...process.env,
        UXCOMPILER_ENV_FILE: missingPath,
        FIGMA_ACCESS_TOKEN: ""
      },
      maxBuffer: 1024 * 1024
    });
    throw new Error("figma-configure should fail when token is missing");
  } catch (error) {
    assert.equal(error.code, 2);
    assert.match(error.stdout, /FIGMA_ACCESS_TOKEN is not configured/);
  }
}

async function verifyStaleSelectorCleanup() {
  const cleanupPath = join(tmp, "cleanup.env");
  await writeFile(
    cleanupPath,
    [
      "FIGMA_ACCESS_TOKEN=old_token",
      "FIGMA_FILE_KEY=old_file_key",
      "FIGMA_NODE_ID=9:9",
      "FIGMA_FRAME_INDEX=4",
      "UXCOMPILER_FIGMA_OUT=artifacts/old",
      ""
    ].join("\n"),
    "utf8"
  );
  await execFileAsync(
    "node",
    ["scripts/figma-configure.mjs", "--url", "https://www.figma.com/design/newkey/Example?node-id=1-2"],
    {
      cwd: resolve(import.meta.dirname, ".."),
      env: {
        ...process.env,
        UXCOMPILER_ENV_FILE: cleanupPath,
        FIGMA_ACCESS_TOKEN: token
      },
      maxBuffer: 1024 * 1024
    }
  );
  const env = await readFile(cleanupPath, "utf8");
  assert.match(env, /FIGMA_ACCESS_TOKEN=figd_test_secret_token/);
  assert.match(env, /FIGMA_FILE_URL=https:\/\/www\.figma\.com\/design\/newkey\/Example\?node-id=1-2/);
  assert.doesNotMatch(env, /^FIGMA_FILE_KEY=/m);
  assert.doesNotMatch(env, /^FIGMA_NODE_ID=/m);
  assert.doesNotMatch(env, /^FIGMA_FRAME_INDEX=/m);
}
