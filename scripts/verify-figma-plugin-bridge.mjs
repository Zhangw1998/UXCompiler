import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const manifestPath = resolve(process.cwd(), "apps/figma-plugin/manifest.json");
const uiPath = resolve(process.cwd(), "apps/figma-plugin/src/ui.html");
const mainPath = resolve(process.cwd(), "apps/figma-plugin/src/main.ts");
const builtMainPath = resolve(process.cwd(), "apps/figma-plugin/dist/main.js");

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const ui = await readFile(uiPath, "utf8");
const main = await readFile(mainPath, "utf8");
const builtMain = await readFile(builtMainPath, "utf8");

assertEqual(manifest.main, "dist/main.js", "manifest main path");
assertEqual(manifest.ui, "src/ui.html", "manifest UI path");
assertEqual(manifest.documentAccess, "dynamic-page", "manifest document access");
assertEqual(manifest.enablePrivatePluginApi, true, "manifest private plugin API access");
assertValidDevelopmentPluginId(manifest.id);
assertIncludes(manifest.editorType ?? [], "figma", "manifest editor type");
assertIncludes(manifest.editorType ?? [], "dev", "manifest editor type");
assertIncludes(manifest.capabilities ?? [], "inspect", "manifest dev mode capabilities");

const endpoint = readDefaultEndpoint(ui);
const endpointOrigin = new URL(endpoint).origin;
assertIncludes(manifest.networkAccess?.allowedDomains ?? [], "none", "manifest published network access");
assertIncludes(manifest.networkAccess?.devAllowedDomains ?? [], endpointOrigin, "manifest dev network access");
assertIncludes(ui, "type: \"check-health\"", "UI health message");
assertIncludes(ui, "type: \"sync-selection\"", "UI sync message");
assertIncludes(ui, "type: \"export-snapshot-zip\"", "UI offline export message");
assertIncludes(ui, "Export Snapshot ZIP", "UI offline export button");
assertIncludes(ui, "application/zip", "UI downloads snapshot zip");
assertIncludes(main, "message.type === \"check-health\"", "main health handler");
assertIncludes(main, "message.type === \"export-snapshot-zip\"", "main offline export handler");
assertIncludes(main, "message.type !== \"sync-selection\"", "main sync handler");
assertIncludes(main, "/health", "main health URL derivation");
assertIncludes(main, "exportNodeAssets(root)", "main exports node assets");
assertIncludes(main, "writeStoredZip(entries)", "main writes offline snapshot zip");
assertIncludes(main, "source_snapshot.json", "main exports source snapshot");
assertIncludes(main, "raw_figma_scene.json", "main exports raw scene");
assertIncludes(main, "figma_reference.png", "main exports reference screenshot");
assertIncludes(main, "raw_assets/", "main exports raw assets");
assertIncludes(main, "preferFrameScreenshotFallback: true", "main requests frame screenshot fallback");
assertIncludes(main, "assets,", "main sends exported assets");
assertIncludes(main, "hasImageFill", "main detects image fills");
assertIncludes(main, "hasNodeSliceAsset", "main detects slice assets");
assertIncludes(main, "hasBlurEffect", "main detects blurred slice assets");
assertNotIncludes(main, "new URL(", "main should avoid URL global unavailable in Figma plugin runtime");
assertNotIncludes(main, "figma.root", "main should avoid document root access");
assertIncludes(builtMain, "message.type === \"check-health\"", "built main health handler");
assertIncludes(builtMain, "message.type === \"export-snapshot-zip\"", "built main offline export handler");
assertIncludes(builtMain, "message.type !== \"sync-selection\"", "built main sync handler");
assertIncludes(builtMain, "exportNodeAssets(root)", "built main exports node assets");
assertIncludes(builtMain, "writeStoredZip(entries)", "built main writes offline snapshot zip");
assertIncludes(builtMain, "source_snapshot.json", "built main exports source snapshot");
assertIncludes(builtMain, "raw_figma_scene.json", "built main exports raw scene");
assertIncludes(builtMain, "figma_reference.png", "built main exports reference screenshot");
assertIncludes(builtMain, "raw_assets/", "built main exports raw assets");
assertIncludes(builtMain, "preferFrameScreenshotFallback: true", "built main requests frame screenshot fallback");
assertIncludes(builtMain, "assets,", "built main sends exported assets");
assertIncludes(builtMain, "hasImageFill", "built main detects image fills");
assertIncludes(builtMain, "hasNodeSliceAsset", "built main detects slice assets");
assertIncludes(builtMain, "hasBlurEffect", "built main detects blurred slice assets");
assertNotIncludes(builtMain, "new URL(", "built main should avoid URL global unavailable in Figma plugin runtime");
assertNotIncludes(builtMain, "figma.root", "built main should avoid document root access");

console.log("figma plugin bridge verification passed");

function readDefaultEndpoint(uiHtml) {
  const match = uiHtml.match(/id="endpoint" value="([^"]+)"/);
  if (!match) throw new Error("Could not find default endpoint input value in figma plugin UI.");
  return match[1];
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, received ${actual}`);
  }
}

function assertIncludes(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`${label}: expected to include ${expected}`);
  }
}

function assertNotIncludes(value, expected, label) {
  if (value.includes(expected)) {
    throw new Error(`${label}: expected not to include ${expected}`);
  }
}

function assertValidDevelopmentPluginId(id) {
  if (id === undefined) return;
  if (typeof id !== "string" || !/^\d+$/.test(id)) {
    throw new Error("manifest id should be omitted for local development or set to a Figma-assigned numeric plugin id.");
  }
}
