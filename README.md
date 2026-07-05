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
- Review Task Engine for low-confidence, fallback, resource, and diff issues.
- Override Engine for deterministic reviewed IR, conflict reports, and stale override reports.
- Local Project Store for `.uxcompiler/` project memory, artifact persistence, and `.uxcproj.zip` import/export.
- Headless Tree Editor operations for reviewed tree drafts and override mutations.
- Headless Component / Token / Asset / i18n Studios for registries and final reviewed manifests.
- Headless Codegen Review for generated Flutter files, patches, write gates, and incremental sync reports.
- Headless Project Writer for safe Flutter project writes with generated-marker checks, backups, ARB/pubspec updates, and reports.
- Headless Generated Widget Promotion for moving generated widgets into the Component Registry with future codegen skip rules.
- Headless Incremental Sync remap for reusing overrides across Figma snapshots and surfacing low-confidence remaps.
- Local Workbench Web shell for reviewing project status, review tasks, normalized tree, studios, preview/diff, codegen, and sync artifacts.
- A Figma Plugin Bridge that posts selected-frame snapshots to a local API.

## Tech Stack

- TypeScript monorepo managed with pnpm workspaces.
- Node.js CLI and local HTTP API, using native `node:http` and filesystem modules.
- Figma REST API for file/node/image fetches, plus a Figma Plugin API bridge for selected-frame snapshots.
- JSON IR contracts for each compiler stage.
- Flutter and Dart for generated fidelity previews and golden screenshot capture.
- `pixelmatch` and `pngjs` for visual diff heatmaps and reports.
- Deterministic TypeScript review-task generation for Workbench decisions and codegen gates.
- Deterministic TypeScript override application for local-first human review decisions.
- File-backed local project catalog with a SQLite schema contract and pure Node archive import/export.
- Headless TypeScript tree-edit validation for region, hierarchy, layout, render, and naming operations.
- Headless TypeScript studio review engine for component, token, asset, and i18n overrides.
- Headless TypeScript codegen review engine for generated-file manifests, patch review, pubspec/ARB plans, and incremental sync reports.
- Headless TypeScript project writer for gated generated-file writes, asset copy, ARB merge, pubspec asset declaration, and backups.
- Headless TypeScript component promotion engine for generated widget promotion, Component Registry updates, and future codegen rules.
- Headless TypeScript incremental sync engine for source node remap, stale override detection, and remap review tasks.
- Vanilla TypeScript Workbench Web app served from local static files, with no frontend framework dependency.

## Install And Verify

```bash
pnpm install
pnpm verify
```

`pnpm verify` runs the local fixture pipeline, override-engine, project-store, tree-editor, studio, codegen-review, project-writer, component-promoter, incremental-sync, Workbench Web smoke tests, mock Figma REST API pipeline, and the local Figma Plugin Bridge API smoke test.

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

Discover the currently open Figma desktop file and print its file key, node id, and URL:

```bash
pnpm figma:desktop-discover
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

Apply a saved OverrideSet while compiling:

```bash
node apps/cli/dist/index.js compile \
  --input examples/fixtures/login_raw_figma_scene.json \
  --out artifacts/sample-reviewed \
  --override-set artifacts/my-overrides/override_set.json
```

The same `--override-set` option is supported by `figma compile` and `figma run`.

## Save Artifacts In A Local Project Store

```bash
node apps/cli/dist/index.js project init --root .uxcompiler
node apps/cli/dist/index.js project create \
  --root .uxcompiler \
  --id proj_login \
  --name "Login Page"
node apps/cli/dist/index.js project save-artifacts \
  --root .uxcompiler \
  --project proj_login \
  --artifacts artifacts/sample \
  --snapshot-id snap_login
```

Export or import a portable project archive:

```bash
node apps/cli/dist/index.js project export \
  --root .uxcompiler \
  --project proj_login \
  --out login_page.uxcproj.zip
node apps/cli/dist/index.js project import \
  --root .uxcompiler \
  --input login_page.uxcproj.zip \
  --new-project-id proj_login_copy
```

## Preview Normalized Tree Edits

Create a JSON operations file:

```json
[
  {
    "id": "force_footer_stack",
    "kind": "force_layout",
    "sourceNodeId": "1:15",
    "strategy": "stack",
    "reason": "Lock footer layout for manual review."
  }
]
```

Apply it as a Tree Editor draft:

```bash
node apps/cli/dist/index.js tree apply \
  --artifacts artifacts/sample \
  --operations tree_operations.json \
  --out artifacts/tree-draft \
  --actor user
```

The draft directory contains `tree_edit_report.json`, updated `override_set.json`, `reviewed_normalized_design_ir.json`, `override_conflict_report.json`, and `stale_override_report.json`.

## Apply Studio Reviews

Create a JSON operations file:

```json
[
  {
    "id": "rename_button_label_key",
    "kind": "rename_i18n_key",
    "messageKey": "button_label",
    "key": "loginSubmitLabel",
    "description": "Primary login form submit button label.",
    "reason": "Use project i18n key naming."
  }
]
```

Apply it as a Studio review:

```bash
node apps/cli/dist/index.js studio apply \
  --artifacts artifacts/sample \
  --operations studio_operations.json \
  --out artifacts/studio-review \
  --actor user
```

The review directory contains `studio_report.json`, `component_registry.json`, `token_registry.json`, `final_asset_manifest.json`, `final_i18n_manifest.json`, `arb/app_en.arb`, updated `override_set.json`, and override reports.

## Review Generated Flutter Output

Generate codegen review artifacts without writing to a real Flutter project:

```bash
node apps/cli/dist/index.js codegen review \
  --artifacts artifacts/sample \
  --out artifacts/codegen-review \
  --project-id proj_login \
  --normalized-ir-id nir_login
```

To detect conflicts against an existing Flutter checkout, add `--project-path <flutter_project>`. Existing files are read only; UXCompiler writes review artifacts and patches under `--out`.

The review directory contains `codegen_review.json`, `flutter_generation_manifest.json`, `files_to_create.json`, `files_to_modify.json`, `assets_to_add.json`, `arb_patch.json`, `pubspec.yaml.patch`, `merge_report.json`, `incremental_sync_report.json`, `generated/`, and `patches/`.

Write an approved review into a Flutter project:

```bash
node apps/cli/dist/index.js codegen write \
  --review artifacts/codegen-review \
  --project-path /path/to/flutter_project \
  --asset-root artifacts/codegen-review/assets
```

Use `--dry-run` to produce `project_write_report.json` without writing files. Project Writer does not overwrite manual conflicts; generated updates are backed up under the project `.uxcompiler/backups/` directory unless `--backup-root` is provided.

Promote a generated widget into the Component Registry:

```bash
node apps/cli/dist/index.js codegen promote \
  --review artifacts/codegen-review \
  --file lib/generated/fidelity/preview_page.dart \
  --component-id cmp_login_preview \
  --name LoginPreview \
  --source-node-id 1:1 \
  --import package:app/features/login/login_preview.dart \
  --constructor LoginPreview \
  --reason "Promote generated login preview into a handwritten component."
```

This writes `promote_report.json`, `component_registry.json`, and `codegen_promotion_rules.json`. The promotion rule tells future codegen to skip rewriting that generated region and update call sites only.

## Remap Overrides For Incremental Sync

When a Figma snapshot changes, remap existing overrides onto the new raw scene:

```bash
node apps/cli/dist/index.js sync remap \
  --old-raw artifacts/old/raw_figma_scene.json \
  --new-raw artifacts/new/raw_figma_scene.json \
  --override-set artifacts/old/override_set.json \
  --old-snapshot-id snap_old \
  --new-snapshot-id snap_new \
  --out artifacts/incremental-sync
```

The sync directory contains `override_set.json`, `node_remap_report.json`, `reapplied_overrides.json`, `stale_overrides.json`, and `incremental_review_tasks.json`. Exact node id matches are reused automatically; stable-key matches are reused when confident; lower-confidence remaps are preserved but produce review tasks; unmatched nodes disable stale overrides.

## Open The Local Workbench

Generate or refresh sample artifacts:

```bash
pnpm compile:sample
```

Start the local Workbench:

```bash
pnpm workbench:web
```

Then open:

```text
http://127.0.0.1:8788/apps/workbench-web/?artifacts=/artifacts/sample
```

The Workbench can also load another local artifact folder from the `Open Artifacts` button. It expects the same files produced by `compile`, `studio apply`, `codegen review`, or `sync remap`, such as `reviewed_normalized_design_ir.json`, `visual_ir.json`, `review_tasks.json`, `override_set.json`, `codegen_review.json`, and `node_remap_report.json`.

When opened through `pnpm workbench:web`, Review Task action buttons can write back to artifact folders under `/artifacts/*`. A task action appends or updates a structured override in `override_set.json`, rebuilds reviewed IR/token/asset/i18n artifacts, refreshes `review_tasks.json` and `task_status_report.json`, and writes `review_task_action_report.json` for traceability. Directly loaded browser folders remain read-only.

The Tree view also supports local Tree Editor writeback for selected non-root nodes: save a reviewed name, force layout, force render strategy, ignore the node, create a reviewed region, split a region, move a node into another parent, or merge sibling regions. These operations run through the headless Tree Editor validator, append structured overrides, rebuild reviewed artifacts, and write `tree_edit_report.json` plus `workbench_tree_edit_action_report.json`.

Component, Token, Asset, and i18n Studio rows can also save local edits when the Workbench is served through `pnpm workbench:web`. Component edits can approve/reject candidates, define props/variants, and map Flutter components; Token edits can rename, merge, or split tokens; Asset edits write `set_asset_strategy` operations; and i18n edits can rename/accept keys, edit ARB descriptions, define placeholders, merge messages, or mark text as non-i18n with a reason. Successful saves update `override_set.json`, reviewed artifacts, `review_tasks.json`, `task_status_report.json`, Studio registry/final manifest files, `studio_report.json`, and `workbench_studio_action_report.json`.

The Codegen view can run local codegen review and Project Writer dry-run/write checks from the same served Workbench. Enter a Flutter project path, run `Review` to write `codegen_review.json`, generated files, patches, and `workbench_codegen_review_report.json` into the artifact folder, then run `Dry Run` or an explicitly confirmed `Write` to produce `project_write_report.json`.

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
- `override_set.json`
- `reviewed_normalized_design_ir.json`
- `reviewed_asset_manifest.json`
- `reviewed_i18n_manifest.json`
- `reviewed_inferred_tokens.json`
- `reviewed_arb/app_en.arb`
- `override_conflict_report.json`
- `stale_override_report.json`
- `regions.json`
- `layout_candidates.json`
- `layout_decisions.json`
- `inferred_components.json`
- `component_instance_map.json`
- `component_confidence_report.json`
- `semantic_labels.json`
- `ai_decision_report.json`
- `naming_map.json`
- `i18n_key_suggestions.json`
- `semantic_ir.json`
- `uplift_decisions.json`
- `uplift_diff_report.json`
- `normalization_report.json`
- `render_strategy_manifest.json`
- `normalized_design_ir.json`
- `visual_ir.json`
- `fidelity_generation_manifest.json`
- `node_pixel_map.json`
- `review_tasks.json`
- `task_status_report.json`
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
It declares both `"figma"` and `"dev"` editor types plus the `"inspect"` capability so the same bridge can run from Design Mode or from the Dev Mode inspect panel when the file is view-only.
For local development it intentionally omits the plugin `id`; if your Figma client asks for one, create a development plugin in Figma to get a Figma-assigned numeric id and paste it into the manifest.
It also enables Figma's private plugin API so local/private runs can include the current `figma.fileKey`; if Figma does not expose the key, the bridge still syncs the selected node with a local fallback id.
Local HTTP access belongs in `networkAccess.devAllowedDomains`; `allowedDomains` is kept as `["none"]` so Figma accepts the development manifest.
If localhost is unavailable, use the plugin's `Export Snapshot ZIP` action. It downloads `uxcompiler_snapshot.zip` with `source_snapshot.json`, `raw_figma_scene.json`, `figma_reference.png`, `extraction_report.json`, `raw_assets_manifest.json`, and `raw_assets/`. A Workbench or script can import it by sending the base64 zip to `POST /api/snapshot-zip` on the local API.

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

For the Figma plugin path, keep the default port `8787` unless you also update the plugin endpoint and `apps/figma-plugin/manifest.json` `networkAccess.devAllowedDomains`, then reload the development plugin. Keep `allowedDomains` as `["none"]` for local development; only published HTTPS domains belong there.

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
http://localhost:8787/api/snapshots
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
- `review_tasks.json`
- `task_status_report.json`
- `flutter_preview/`
- `flutter_preview.png`
- `diff/visual_diff_report.json`
- `diff/diff_heatmap.png`
- `pipeline_run_report.json`
