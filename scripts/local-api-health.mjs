const port = Number(process.env.UXCOMPILER_LOCAL_API_PORT ?? 8787);
const healthUrl = `http://127.0.0.1:${port}/health`;

try {
  const response = await fetch(healthUrl);
  const body = await response.json().catch(() => undefined);
  if (!response.ok || !body?.ok) {
    throw new Error(body?.error || `Local API returned ${response.status}`);
  }
  console.log("UXCompiler local API is online.");
  console.log(`URL: ${healthUrl}`);
  console.log(`Artifacts root: ${body.artifactRoot}`);
} catch (error) {
  console.log("UXCompiler local API is not reachable.");
  console.log(`URL: ${healthUrl}`);
  console.log("Start it with:");
  console.log("pnpm figma:plugin-start");
  console.log("");
  console.log(error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
}
