const input = process.argv[2] || process.env.FIGMA_FILE_URL || process.env.FIGMA_FILE_KEY;
const explicitNode = process.env.FIGMA_NODE_ID;

if (!input || isPlaceholder(input)) {
  console.log("UXCompiler Figma URL inspector");
  console.log("");
  console.log("Pass a Figma design URL or set FIGMA_FILE_URL:");
  console.log("");
  console.log("pnpm figma:inspect-url 'https://www.figma.com/design/FILE_KEY/File-Name?node-id=1-2'");
  console.log("");
  process.exitCode = 2;
} else {
  const target = parseFigmaTarget(input);
  const nodeId = explicitNode || target.nodeId;
  console.log("UXCompiler Figma URL inspector");
  console.log("");
  console.log(`File key: ${target.fileKey}`);
  console.log(`Node id: ${nodeId ?? "(missing)"}`);
  console.log(`Source type: ${target.sourceType}`);
  if (target.sourceUrl) console.log(`Source URL: ${target.sourceUrl}`);
  console.log("");
  if (nodeId) {
    console.log("Ready for node-specific access.");
    console.log(`REST smoke: FIGMA_FILE_URL='${input}' pnpm figma:smoke`);
    console.log(`CLI check: node apps/cli/dist/index.js figma check --file '${target.fileKey}' --node '${nodeId}'`);
    console.log(`Codex Figma connector: fileKey=${target.fileKey}, nodeId=${nodeId}`);
  } else {
    console.log("This target does not include a node id.");
    console.log(`List frames: node apps/cli/dist/index.js figma frames --file '${target.fileKey}'`);
    console.log(`Then set FIGMA_NODE_ID=1:2 or FIGMA_FRAME_INDEX=1 before pnpm figma:smoke.`);
  }
}

function parseFigmaTarget(value) {
  if (!value.startsWith("http://") && !value.startsWith("https://")) {
    return {
      fileKey: value,
      sourceType: "file-key"
    };
  }

  const url = new URL(value);
  const parts = url.pathname.split("/").filter(Boolean);
  const fileTypeIndex = parts.findIndex((part) => ["file", "design", "proto", "board", "slides"].includes(part));
  const fileKey = fileTypeIndex >= 0 ? parts[fileTypeIndex + 1] : undefined;
  if (!fileKey) {
    throw new Error("Could not parse Figma file key from URL.");
  }
  const branchIndex = parts.findIndex((part) => part === "branch");
  return {
    fileKey: branchIndex >= 0 && parts[branchIndex + 1] ? parts[branchIndex + 1] : fileKey,
    nodeId: normalizeNodeId(url.searchParams.get("node-id") ?? undefined),
    sourceType: parts[fileTypeIndex],
    sourceUrl: value
  };
}

function normalizeNodeId(nodeId) {
  return nodeId ? nodeId.replace(/-/g, ":") : undefined;
}

function isPlaceholder(value) {
  return value.includes("FILE_KEY") || value.includes("File-Name");
}
