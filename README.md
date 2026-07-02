# UXCompiler

Local-first pipeline for turning a Figma frame into normalized design artifacts and, eventually, Flutter UI.

## Current MVP

This repo currently supports:

- RawFigmaScene validation and fixtures.
- CanonicalScene generation.
- Shadow token mining.
- Region and layout inference.
- Asset strategy and i18n/ARB extraction.
- Figma REST fetch through a local CLI.
- Flutter fidelity preview project generation.
- Flutter golden capture to `flutter_preview.png`.
- PNG visual diff with page and node-level reports.
- A Figma Plugin Bridge that posts selected-frame snapshots to a local API.

## Tech Stack

- TypeScript monorepo managed with pnpm workspaces.
- Node.js CLI and local HTTP API, using native `node:http` and filesystem modules.
- Figma REST API for file/node/image fetches, plus a Figma Plugin API bridge for selected-frame snapshots.
- JSON IR contracts for each compiler stage.
- Flutter and Dart for generated fidelity previews and golden screenshot capture.
- `pixelmatch` and `pngjs` for visual diff heatmaps and reports.

## Install And Verify

```bash
pnpm install
pnpm verify
```

`pnpm verify` runs the local fixture pipeline, a mock Figma REST API pipeline, and the local Figma Plugin Bridge API smoke test.

Check local tools and token setup:

```bash
node apps/cli/dist/index.js doctor
```

Get one consolidated readiness report for both Figma access paths:

```bash
pnpm figma:ready
```

It also writes `artifacts/figma-readiness/figma_readiness_report.json` without storing or printing the token, and summarizes the latest `figma:access-audit` completion evidence when available.

Audit whether this workspace has already produced a successful real Figma access report:

```bash
pnpm figma:access-audit
```

This writes `artifacts/figma-access-audit/figma_access_audit_report.json` and treats local mock/smoke reports separately from real Figma file reports.

Ask for the next concrete action across REST, plugin bridge, and Codex connector paths:

```bash
pnpm figma:next
```

Inspect a Figma link without using a token:

```bash
pnpm figma:inspect-url 'https://www.figma.com/design/FILE_KEY/File-Name?node-id=1-2'
```

## Compile A Local RawFigmaScene

```bash
pnpm build
node apps/cli/dist/index.js compile \
  --input examples/fixtures/login_raw_figma_scene.json \
  --out artifacts/sample
```

## Fetch And Compile A Real Figma Frame

Create a Figma personal access token with file read access, then export it:

```bash
export FIGMA_ACCESS_TOKEN="YOUR_TOKEN"
```

You can also put it in a local `.env` file:

```text
FIGMA_ACCESS_TOKEN=YOUR_TOKEN
FIGMA_FILE_URL=https://www.figma.com/design/FILE_KEY/File-Name?node-id=1-2
# Optional when the URL does not include node-id:
FIGMA_NODE_ID=1:2
# Or select from the 1-based frame list printed by pnpm figma:smoke:
FIGMA_FRAME_INDEX=1
UXCOMPILER_FIGMA_OUT=artifacts/my-figma-frame
# Optional for a Figma-compatible proxy or test server:
FIGMA_API_BASE_URL=https://api.figma.com
```

Or write `.env` with the helper. Set `FIGMA_ACCESS_TOKEN` in your shell or secret manager first; the helper reads it and does not print it:

```bash
pnpm figma:configure -- \
  --url 'https://www.figma.com/design/FILE_KEY/File-Name?node-id=1-2' \
  --out artifacts/my-figma-frame
```

When the URL includes `node-id`, the helper removes stale `FIGMA_NODE_ID` and `FIGMA_FRAME_INDEX` values from `.env`; when you pass `--node` or `--frame-index`, it keeps only that selector.

Use a Figma URL that includes `node-id` when possible. Quote the URL in zsh/bash because it contains `?` and `&`.

Fast path for a real Figma access smoke test:

```bash
pnpm figma:inspect-url 'https://www.figma.com/design/FILE_KEY/File-Name?node-id=1-2'
pnpm figma:ready
pnpm figma:smoke
```

This reads `.env`, checks local tools, verifies Figma access, and lists candidate frames. If `FIGMA_FILE_URL` includes `node-id`, `FIGMA_NODE_ID` is set, or `FIGMA_FRAME_INDEX` selects a listed frame, it also runs the full compile/preview/diff pipeline and writes `pipeline_run_report.json`.

The `FIGMA_FRAME_INDEX` path is covered by a local mock verifier:

```bash
pnpm verify:figma-smoke-mock
```

Check access first:

```bash
pnpm build
node apps/cli/dist/index.js figma check \
  --file 'https://www.figma.com/design/FILE_KEY/File-Name?node-id=1-2'
```

List candidate frames if you do not know the node id:

```bash
node apps/cli/dist/index.js figma frames \
  --file 'https://www.figma.com/design/FILE_KEY/File-Name'
```

```bash
pnpm build
node apps/cli/dist/index.js figma compile \
  --file 'https://www.figma.com/design/FILE_KEY/File-Name?node-id=1-2' \
  --out artifacts/my-figma-frame
```

Or run the full pipeline in one command:

```bash
node apps/cli/dist/index.js figma run \
  --file 'https://www.figma.com/design/FILE_KEY/File-Name?node-id=1-2' \
  --out artifacts/my-figma-frame
```

`figma run` fetches the Figma frame, compiles normalized artifacts, renders `flutter_preview.png`, runs visual diff, and writes `pipeline_run_report.json`.

You can also pass the node separately:

```bash
node apps/cli/dist/index.js figma compile \
  --file FILE_KEY \
  --node 1:2 \
  --out artifacts/my-figma-frame
```

Outputs include:

- `raw_figma_scene.json`
- `figma_reference.png`
- `extraction_report.json`
- `canonical_scene.json`
- `inferred_tokens.json`
- `asset_manifest.json`
- `i18n_manifest.json`
- `arb/app_en.arb`
- `regions.json`
- `layout_decisions.json`
- `normalized_design_ir.json`
- `visual_ir.json`
- `fidelity_generation_manifest.json`
- `node_pixel_map.json`
- `flutter_preview/`

Analyze the generated Flutter preview:

```bash
cd artifacts/my-figma-frame/flutter_preview
flutter pub get
flutter analyze
flutter test test/preview_test.dart
```

Capture a Flutter-rendered preview PNG:

```bash
node apps/cli/dist/index.js preview capture \
  --project artifacts/my-figma-frame/flutter_preview \
  --out artifacts/my-figma-frame/flutter_preview.png
```

The CLI uses Figma's REST API with `X-Figma-Token`, `GET /v1/files/:key/nodes`, and `GET /v1/images/:key`.

## Run A Visual Diff

When you have both the Figma reference PNG and a Flutter-rendered PNG:

```bash
node apps/cli/dist/index.js preview diff \
  --reference artifacts/my-figma-frame/figma_reference.png \
  --candidate artifacts/my-figma-frame/flutter_preview.png \
  --node-pixel-map artifacts/my-figma-frame/node_pixel_map.json \
  --out artifacts/my-figma-frame/diff \
  --viewport 390x844 \
  --dpr 1
```

Outputs:

- `visual_diff_report.json`
- `node_diff_report.json`
- `diff_heatmap.png`

## Optional Figma Plugin Bridge

The REST CLI path is the fastest route, but the repo also includes a minimal Figma Bridge Plugin and local API.

The plugin manifest uses Figma's required `documentAccess: "dynamic-page"` mode and only reads the currently selected node.
For local development it intentionally omits the plugin `id`; if your Figma client asks for one, create a development plugin in Figma to get a Figma-assigned numeric id and paste it into the manifest.
It also enables Figma's private plugin API so local/private runs can include the current `figma.fileKey`; if Figma does not expose the key, the bridge still syncs the selected node with a local fallback id.

Before opening Figma, run a local bridge smoke test:

```bash
pnpm figma:bridge-smoke
```

This starts or reuses the local API, posts a plugin-shaped sample snapshot, generates Flutter preview and diff artifacts, then prints the artifact directory.

Start the local API in the background and wait for a health check:

```bash
pnpm figma:plugin-start
```

Check that it is reachable:

```bash
pnpm local-api:health
```

Stop the background local API when you are done:

```bash
pnpm figma:plugin-stop
```

To use a different artifact directory:

```bash
UXCOMPILER_ARTIFACTS_DIR=artifacts/figma-bridge pnpm figma:plugin-start
```

For the Figma plugin path, keep the default port `8787` unless you also update `apps/figma-plugin/manifest.json` `networkAccess.allowedDomains` and `networkAccess.devAllowedDomains`, then reload the development plugin.

Then in Figma:

1. Open `Plugins > Development > Import plugin from manifest...`.
2. Select `apps/figma-plugin/manifest.json`.
3. Select a Frame, Component, Instance, Section, or visible node.
4. Run `UXCompiler Bridge`.
5. Click `Check Local API`.
6. Click `Sync Selection`.

To wait for a real plugin sync and run the completion audit automatically:

```bash
pnpm figma:plugin-wait
```

The plugin posts a read-only snapshot to:

```text
http://127.0.0.1:8787/api/snapshots
```

The local API compiles the snapshot, formats the generated Flutter preview, captures `flutter_preview.png`, and runs visual diff when the plugin-provided Figma screenshot is available.

Artifacts are written under timestamped folders in:

```text
artifacts/figma-bridge/
```

Important outputs include:

- `raw_figma_scene.json`
- `normalized_design_ir.json`
- `visual_ir.json`
- `flutter_preview/`
- `flutter_preview.png`
- `diff/visual_diff_report.json`
- `diff/diff_heatmap.png`
- `pipeline_run_report.json`
