import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

await verifyNodeUrl();
await verifyFileKey();
await verifyPlaceholder();
console.log("figma URL inspector verification passed");

async function verifyNodeUrl() {
  const result = await execFileAsync("node", [
    "scripts/figma-inspect-url.mjs",
    "https://www.figma.com/design/abc123/Example?node-id=1-2"
  ]);
  assert.match(result.stdout, /File key: abc123/);
  assert.match(result.stdout, /Node id: 1:2/);
  assert.match(result.stdout, /Ready for node-specific access/);
}

async function verifyFileKey() {
  const result = await execFileAsync("node", ["scripts/figma-inspect-url.mjs", "abc123"]);
  assert.match(result.stdout, /File key: abc123/);
  assert.match(result.stdout, /Node id: \(missing\)/);
  assert.match(result.stdout, /List frames/);
}

async function verifyPlaceholder() {
  try {
    await execFileAsync("node", [
      "scripts/figma-inspect-url.mjs",
      "https://www.figma.com/design/FILE_KEY/File-Name?node-id=1-2"
    ]);
    throw new Error("placeholder URL should exit with code 2");
  } catch (error) {
    assert.equal(error.code, 2);
    assert.match(error.stdout, /Pass a Figma design URL/);
  }
}
