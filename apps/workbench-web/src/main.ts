import {
  asArray,
  asRecord,
  buildWorkbenchModel,
  booleanFrom,
  numberFrom,
  stringFrom,
  type JsonRecord,
  type WorkbenchArtifacts,
  type WorkbenchModel
} from "./model.js";

type ViewId = "dashboard" | "tasks" | "tree" | "components" | "tokens" | "assets" | "i18n" | "preview" | "codegen" | "settings";
type PreviewMode = "side-by-side" | "overlay" | "heatmap" | "difference";

interface ArtifactSpec {
  key: keyof WorkbenchArtifacts;
  files: string[];
}

interface AppState {
  activeView: ViewId;
  artifactRoot: string;
  artifacts: WorkbenchArtifacts;
  model?: WorkbenchModel;
  loading: boolean;
  error?: string;
  selectedSourceNodeId?: string;
  selectedNormalizedNodeId?: string;
  previewMode: PreviewMode;
  actionMessage?: { tone: "good" | "warn" | "bad"; text: string };
  pendingAction?: string;
  pendingTreeOperation?: string;
  pendingStudioOperation?: string;
}

const appElement = document.querySelector<HTMLDivElement>("#app");
const artifactInputElement = document.querySelector<HTMLInputElement>("#artifactInput");

if (!appElement || !artifactInputElement) {
  throw new Error("Workbench root elements are missing.");
}

const app = appElement;
const artifactInput = artifactInputElement;

const jsonArtifacts: ArtifactSpec[] = [
  { key: "reviewedNormalizedDesignIR", files: ["reviewed_normalized_design_ir.json"] },
  { key: "normalizedDesignIR", files: ["normalized_design_ir.json"] },
  { key: "visualIR", files: ["visual_ir.json"] },
  { key: "reviewTasks", files: ["review_tasks.json", "incremental_review_tasks.json"] },
  { key: "taskStatusReport", files: ["task_status_report.json"] },
  { key: "overrideSet", files: ["override_set.json"] },
  { key: "reviewedInferredTokens", files: ["reviewed_inferred_tokens.json"] },
  { key: "inferredTokens", files: ["inferred_tokens.json"] },
  { key: "tokenRegistry", files: ["token_registry.json"] },
  { key: "finalAssetManifest", files: ["final_asset_manifest.json"] },
  { key: "reviewedAssetManifest", files: ["reviewed_asset_manifest.json"] },
  { key: "assetManifest", files: ["asset_manifest.json"] },
  { key: "finalI18nManifest", files: ["final_i18n_manifest.json"] },
  { key: "reviewedI18nManifest", files: ["reviewed_i18n_manifest.json"] },
  { key: "i18nManifest", files: ["i18n_manifest.json"] },
  { key: "componentRegistry", files: ["component_registry.json"] },
  { key: "studioReport", files: ["studio_report.json"] },
  { key: "codegenReview", files: ["codegen_review.json"] },
  { key: "nodeRemapReport", files: ["node_remap_report.json"] },
  { key: "staleOverrideReport", files: ["stale_override_report.json"] },
  { key: "overrideConflictReport", files: ["override_conflict_report.json"] },
  { key: "visualDiffReport", files: ["visual_diff_report.json", "diff/visual_diff_report.json"] },
  { key: "flutterPreviewCaptureReport", files: ["flutter_preview_capture_report.json"] },
  { key: "fidelityGenerationManifest", files: ["fidelity_generation_manifest.json"] }
];

const navItems: Array<{ id: ViewId; label: string }> = [
  { id: "dashboard", label: "Project" },
  { id: "tasks", label: "Review Tasks" },
  { id: "tree", label: "Tree" },
  { id: "components", label: "Components" },
  { id: "tokens", label: "Tokens" },
  { id: "assets", label: "Assets" },
  { id: "i18n", label: "i18n" },
  { id: "preview", label: "Preview" },
  { id: "codegen", label: "Codegen" },
  { id: "settings", label: "Settings" }
];

const layoutOptions = ["column", "row", "grid", "stack", "absolute", "leaf"];
const renderOptions = ["semantic_widget", "semantic_layout", "absolute_widget", "custom_painter", "asset_slice", "hybrid_region", "ignore"];
const assetStrategyOptions = ["real_text", "svg_icon", "image_asset", "decorative_slice", "custom_painter", "ignored"];
const assetFormatOptions = ["", "svg", "png", "webp", "jpg"];

let objectUrls: string[] = [];
const initialArtifactRoot = new URLSearchParams(window.location.search).get("artifacts") ?? "/artifacts/sample";
const state: AppState = {
  activeView: normalizeView(location.hash.replace("#", "")) ?? "dashboard",
  artifactRoot: initialArtifactRoot,
  artifacts: { artifactRoot: initialArtifactRoot },
  loading: true,
  previewMode: "side-by-side"
};

app.addEventListener("click", onAppClick);
artifactInput.addEventListener("change", () => {
  void handleArtifactDirectory(artifactInput.files);
});
window.addEventListener("resize", fitPreviewStages);
window.addEventListener("hashchange", () => {
  const nextView = normalizeView(location.hash.replace("#", ""));
  if (nextView && nextView !== state.activeView) {
    state.activeView = nextView;
    render();
  }
});

void loadFromArtifactRoot(initialArtifactRoot);

async function loadFromArtifactRoot(root: string): Promise<void> {
  state.loading = true;
  state.error = undefined;
  state.artifactRoot = root;
  state.artifacts = { artifactRoot: root };
  render();

  try {
    const artifacts = await fetchArtifacts(root);
    state.artifacts = artifacts;
    state.model = buildWorkbenchModel(artifacts);
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.loading = false;
    render();
  }
}

async function fetchArtifacts(root: string): Promise<WorkbenchArtifacts> {
  const artifacts: WorkbenchArtifacts = { artifactRoot: root };
  await Promise.all(
    jsonArtifacts.map(async (spec) => {
      (artifacts as Record<string, unknown>)[String(spec.key)] = await fetchFirstJson(root, spec.files);
    })
  );
  artifacts.flutterPreviewUrl = await fetchFirstAsset(root, ["flutter_preview.png"]);
  artifacts.diffHeatmapUrl = await fetchFirstAsset(root, ["diff_heatmap.png", "diff/diff_heatmap.png"]);
  return artifacts;
}

async function fetchFirstJson(root: string, files: string[]): Promise<unknown> {
  for (const file of files) {
    const url = artifactUrl(root, file);
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (!response.ok) continue;
      return await response.json();
    } catch {
      // Ignore missing optional artifacts and continue probing candidates.
    }
  }
  return undefined;
}

async function fetchFirstAsset(root: string, files: string[]): Promise<string | undefined> {
  for (const file of files) {
    const url = artifactUrl(root, file);
    try {
      const response = await fetch(url, { cache: "no-store" });
      if (response.ok) return url;
    } catch {
      // Ignore and continue.
    }
  }
  return undefined;
}

async function handleArtifactDirectory(fileList: FileList | null): Promise<void> {
  if (!fileList || fileList.length === 0) return;
  revokeObjectUrls();
  state.loading = true;
  state.error = undefined;
  render();

  try {
    const files = Array.from(fileList);
    const index = indexSelectedFiles(files);
    const artifacts: WorkbenchArtifacts = {
      artifactRoot: "selected directory"
    };
    for (const spec of jsonArtifacts) {
      const file = findSelectedFile(index, spec.files);
      if (file) (artifacts as Record<string, unknown>)[String(spec.key)] = JSON.parse(await file.text());
    }
    const flutterPreview = findSelectedFile(index, ["flutter_preview.png"]);
    if (flutterPreview) artifacts.flutterPreviewUrl = objectUrlFor(flutterPreview);
    const diffHeatmap = findSelectedFile(index, ["diff_heatmap.png", "diff/diff_heatmap.png"]);
    if (diffHeatmap) artifacts.diffHeatmapUrl = objectUrlFor(diffHeatmap);
    state.artifactRoot = "selected directory";
    state.artifacts = artifacts;
    state.model = buildWorkbenchModel(artifacts);
  } catch (error) {
    state.error = error instanceof Error ? error.message : String(error);
  } finally {
    state.loading = false;
    render();
  }
}

function render(): void {
  if (state.loading) {
    app.innerHTML = renderShell(`<section class="empty-state"><div class="spinner"></div><strong>Loading artifacts</strong></section>`);
    return;
  }

  if (state.error || !state.model) {
    app.innerHTML = renderShell(`
      <section class="empty-state empty-state--error">
        <strong>Workbench could not load this artifact set.</strong>
        <p>${escapeHtml(state.error ?? "Unknown load error")}</p>
        <button class="button button--primary" data-action="reload">Retry</button>
      </section>
    `);
    return;
  }

  app.innerHTML = renderShell(renderActiveView(state.model));
  window.requestAnimationFrame(fitPreviewStages);
}

function renderShell(content: string): string {
  const model = state.model;
  const title = model?.project.frameName ?? "UXCompiler Workbench";
  const status = model?.project.status ?? "loading";
  return `
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">UX</div>
        <div>
          <div class="brand-title">${escapeHtml(title)}</div>
          <div class="brand-subtitle">${escapeHtml(state.artifactRoot)}</div>
        </div>
      </div>
      <div class="topbar-actions">
        <span class="status-pill status-pill--${statusTone(status)}">${escapeHtml(status)}</span>
        <button class="button" data-action="load-folder">Open Artifacts</button>
        <button class="button button--primary" data-action="reload">Reload</button>
      </div>
    </header>
    <div class="workspace-shell">
      <aside class="sidebar" aria-label="Workbench navigation">
        ${navItems
          .map(
            (item) => `
              <button class="nav-item ${item.id === state.activeView ? "is-active" : ""}" data-view="${item.id}">
                ${escapeHtml(item.label)}
              </button>
            `
          )
          .join("")}
      </aside>
      <main class="content">
        ${content}
      </main>
    </div>
  `;
}

function renderActiveView(model: WorkbenchModel): string {
  switch (state.activeView) {
    case "dashboard":
      return renderDashboard(model);
    case "tasks":
      return renderTasks(model);
    case "tree":
      return renderTree(model);
    case "components":
      return renderComponents(model);
    case "tokens":
      return renderTokens(model);
    case "assets":
      return renderAssets(model);
    case "i18n":
      return renderI18n(model);
    case "preview":
      return renderPreview(model);
    case "codegen":
      return renderCodegen(model);
    case "settings":
      return renderSettings(model);
  }
}

function renderDashboard(model: WorkbenchModel): string {
  return `
    <section class="view-header">
      <div>
        <h1>Project Dashboard</h1>
        <p>${escapeHtml(model.project.frameNodeId)} · ${model.viewport.width}x${model.viewport.height}</p>
      </div>
      <span class="confidence">${formatConfidence(model.project.confidence)}</span>
    </section>
    <section class="metric-grid">
      ${model.metrics.map((entry) => renderMetric(entry.label, entry.value, entry.tone)).join("")}
    </section>
    <section class="two-column">
      <div class="panel">
        <div class="panel-header">
          <h2>Artifact Status</h2>
        </div>
        <div class="status-list">
          ${model.artifactStatus
            .map(
              (entry) => `
                <div class="status-row">
                  <span class="status-dot ${entry.present ? "is-good" : "is-muted"}"></span>
                  <strong>${escapeHtml(entry.label)}</strong>
                  <span>${escapeHtml(entry.note)}</span>
                </div>
              `
            )
            .join("")}
        </div>
      </div>
      <div class="panel">
        <div class="panel-header">
          <h2>Review Distribution</h2>
        </div>
        <div class="compact-grid">
          ${renderKeyValues(model.reviewSummary.byPriority)}
          ${renderKeyValues(model.reviewSummary.byType)}
        </div>
      </div>
    </section>
    <section class="panel">
      <div class="panel-header">
        <h2>Pipeline Gates</h2>
      </div>
      <div class="gate-strip">
        ${renderGate("Tasks", model.reviewSummary.blocked ? "blocked" : model.reviewSummary.open > 0 ? "review" : "ready")}
        ${renderGate("Preview", model.preview.hasVisualIR ? "ready" : "missing")}
        ${renderGate("Flutter", model.preview.hasFlutterPreview ? "ready" : "missing")}
        ${renderGate("Codegen", model.codegen.status)}
        ${renderGate("Sync", model.sync.matches > 0 ? "ready" : "not-generated")}
      </div>
    </section>
  `;
}

function renderTasks(_model: WorkbenchModel): string {
  const tasks = asArray(state.artifacts.reviewTasks).map(asRecord);
  const canApplyActions = state.artifactRoot !== "selected directory";
  return `
    <section class="view-header">
      <div>
        <h1>Review Tasks</h1>
        <p>${tasks.length} tasks loaded</p>
      </div>
    </section>
    ${state.actionMessage ? `<section class="notice notice--${state.actionMessage.tone}">${escapeHtml(state.actionMessage.text)}</section>` : ""}
    <section class="task-list">
      ${
        tasks.length === 0
          ? renderEmpty("No review tasks in this artifact set.")
          : tasks
              .map((task) => {
                const priority = stringFrom(task.priority) ?? "P?";
                const title = stringFrom(task.title) ?? stringFrom(task.id) ?? "Review task";
                const description = stringFrom(task.description) ?? "";
                const taskId = stringFrom(task.id) ?? "";
                const target = asRecord(task.target);
                const sourceNodeIds = asArray(target.sourceNodeIds)
                  .map((entry) => stringFrom(entry))
                  .filter((entry): entry is string => Boolean(entry));
                const actions = asArray(task.suggestedActions).map(asRecord);
                return `
                  <article class="task-item">
                    <div class="task-priority ${priority.toLowerCase()}">${escapeHtml(priority)}</div>
                    <div class="task-body">
                      <div class="task-title">${escapeHtml(title)}</div>
                      <p>${escapeHtml(description)}</p>
                      <div class="tag-row">
                        <span>${escapeHtml(stringFrom(task.type) ?? "unknown")}</span>
                        <span>${escapeHtml(stringFrom(task.status) ?? "open")}</span>
                        <span>${formatConfidence(numberFrom(task.confidence))}</span>
                        ${sourceNodeIds.map((id) => `<button class="mini-link" data-node-id="${escapeAttr(id)}">${escapeHtml(id)}</button>`).join("")}
                      </div>
                    </div>
                    <div class="task-actions">
                      ${
                        actions.length === 0
                          ? `<span>No action</span>`
                          : actions
                              .map((action, index) => {
                                const actionKey = `${taskId}:${index}`;
                                const isPending = state.pendingAction === actionKey;
                                const label = stringFrom(action.label) ?? `Action ${index + 1}`;
                                return `
                                  <button
                                    class="action-button"
                                    data-task-action="${escapeAttr(taskId)}"
                                    data-action-index="${index}"
                                    ${canApplyActions && !isPending ? "" : "disabled"}
                                  >
                                    ${escapeHtml(isPending ? "Applying..." : label)}
                                  </button>
                                `;
                              })
                              .join("")
                      }
                    </div>
                  </article>
                `;
              })
              .join("")
      }
    </section>
  `;
}

function renderTree(model: WorkbenchModel): string {
  const selected = selectedTreeRow(model);
  const canApplyTreeEdit = state.artifactRoot !== "selected directory" && !!selected && selected.depth > 0;
  return `
    <section class="view-header">
      <div>
        <h1>Normalized Tree</h1>
        <p>${model.treeRows.length} nodes · ${model.reviewSummary.open} open tasks</p>
      </div>
    </section>
    ${state.actionMessage ? `<section class="notice notice--${state.actionMessage.tone}">${escapeHtml(state.actionMessage.text)}</section>` : ""}
    <section class="split-view">
      <div class="panel table-panel">
        <table class="data-table tree-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Layout</th>
              <th>Confidence</th>
              <th>Source</th>
            </tr>
          </thead>
          <tbody>
            ${model.treeRows
              .map(
                (row) => `
                  <tr
                    class="${selected?.id === row.id ? "is-selected" : ""}"
                    data-node-id="${escapeAttr(row.sourceNodeIds[0] ?? "")}"
                    data-normalized-id="${escapeAttr(row.id)}"
                  >
                    <td>
                      <span class="tree-name" style="--depth:${row.depth}">
                        ${escapeHtml(row.name)}
                      </span>
                    </td>
                    <td>${escapeHtml(row.type)}</td>
                    <td>${escapeHtml(row.layout)}</td>
                    <td>${formatConfidence(row.confidence)}</td>
                    <td>${escapeHtml(row.sourceNodeIds[0] ?? "-")}</td>
                  </tr>
                `
              )
              .join("")}
          </tbody>
        </table>
      </div>
      <aside class="panel detail-panel">
        <div class="panel-header">
          <h2>Node Detail</h2>
        </div>
        ${
          selected
            ? `
              <dl class="detail-list">
                <dt>ID</dt><dd>${escapeHtml(selected.id)}</dd>
                <dt>Name</dt><dd>${escapeHtml(selected.name)}</dd>
                <dt>Type</dt><dd>${escapeHtml(selected.type)}</dd>
                <dt>Layout</dt><dd>${escapeHtml(selected.layout)}</dd>
                <dt>Children</dt><dd>${selected.childCount}</dd>
                <dt>Bounds</dt><dd>${selected.bounds ? `${selected.bounds.x}, ${selected.bounds.y}, ${selected.bounds.w}, ${selected.bounds.h}` : "-"}</dd>
                <dt>Source</dt><dd>${selected.sourceNodeIds.map(escapeHtml).join(", ") || "-"}</dd>
              </dl>
              <div class="tree-editor-form">
                <label>
                  <span>Name</span>
                  <input class="tree-input" data-tree-field="name" value="${escapeAttr(selected.name)}" ${canApplyTreeEdit ? "" : "disabled"} />
                </label>
                <label>
                  <span>Layout</span>
                  <select class="tree-input" data-tree-field="layout" ${canApplyTreeEdit ? "" : "disabled"}>
                    ${layoutOptions.map((option) => `<option value="${option}" ${option === selected.layout ? "selected" : ""}>${option}</option>`).join("")}
                  </select>
                </label>
                <label>
                  <span>Render</span>
                  <select class="tree-input" data-tree-field="render" ${canApplyTreeEdit ? "" : "disabled"}>
                    ${renderOptions.map((option) => `<option value="${option}">${option}</option>`).join("")}
                  </select>
                </label>
                <label>
                  <span>Reason</span>
                  <input class="tree-input" data-tree-field="reason" value="Reviewed in Workbench Tree Editor." ${canApplyTreeEdit ? "" : "disabled"} />
                </label>
                <div class="tree-editor-actions">
                  ${renderTreeActionButton("rename", "Save Name", canApplyTreeEdit)}
                  ${renderTreeActionButton("layout", "Save Layout", canApplyTreeEdit)}
                  ${renderTreeActionButton("render", "Save Render", canApplyTreeEdit)}
                  ${renderTreeActionButton("ignore", "Ignore Node", canApplyTreeEdit)}
                </div>
              </div>
            `
            : renderEmpty("Select a tree row.")
        }
      </aside>
    </section>
  `;
}

function renderComponents(model: WorkbenchModel): string {
  const normalized = asRecord(state.artifacts.reviewedNormalizedDesignIR ?? state.artifacts.normalizedDesignIR);
  const registry = asRecord(state.artifacts.componentRegistry);
  const components = asArray(registry.components ?? normalized.components).map(asRecord);
  return `
    <section class="view-header">
      <div>
        <h1>Component Studio</h1>
        <p>${model.componentCount} components</p>
      </div>
    </section>
    <section class="panel">
      ${
        components.length === 0
          ? renderEmpty("No component registry entries are present yet.")
          : `<div class="item-grid">${components.map((component) => renderObjectCard(component, "name", "id")).join("")}</div>`
      }
    </section>
  `;
}

function renderTokens(model: WorkbenchModel): string {
  const tokens = asRecord(state.artifacts.reviewedInferredTokens ?? state.artifacts.inferredTokens ?? asRecord(state.artifacts.reviewedNormalizedDesignIR).tokens);
  const groups = ["colors", "spacing", "typography", "radii", "shadows"];
  const canApplyStudio = state.artifactRoot !== "selected directory";
  return `
    <section class="view-header">
      <div>
        <h1>Token Studio</h1>
        <p>${Object.values(model.tokenCounts).reduce((sum, count) => sum + count, 0)} tokens</p>
      </div>
    </section>
    ${state.actionMessage ? `<section class="notice notice--${state.actionMessage.tone}">${escapeHtml(state.actionMessage.text)}</section>` : ""}
    <section class="token-layout">
      ${groups
        .map((group) => {
          const entries = asArray(tokens[group]).map(asRecord);
          return `
            <div class="panel token-panel">
              <div class="panel-header">
                <h2>${escapeHtml(group)}</h2>
                <span>${entries.length}</span>
              </div>
              <div class="token-list">
                ${entries.length === 0 ? renderEmpty("Empty") : entries.map((entry) => renderTokenRow(entry, group, canApplyStudio)).join("")}
              </div>
            </div>
          `;
        })
        .join("")}
    </section>
  `;
}

function renderAssets(model: WorkbenchModel): string {
  const manifest = asRecord(state.artifacts.finalAssetManifest ?? state.artifacts.reviewedAssetManifest ?? state.artifacts.assetManifest);
  const assets = asArray(manifest.assets).map(asRecord);
  const canApplyStudio = state.artifactRoot !== "selected directory";
  return `
    <section class="view-header">
      <div>
        <h1>Asset Studio</h1>
        <p>${model.assetCount} asset decisions</p>
      </div>
    </section>
    ${state.actionMessage ? `<section class="notice notice--${state.actionMessage.tone}">${escapeHtml(state.actionMessage.text)}</section>` : ""}
    <section class="panel table-panel">
      <table class="data-table">
        <thead><tr><th>ID</th><th>Source</th><th>Current</th><th>Write Strategy</th><th>Path</th><th>Format</th><th>Confidence</th><th>Action</th></tr></thead>
        <tbody>
          ${assets
            .map(
              (asset) => {
                const assetId = stringFrom(asset.id) ?? "";
                const sourceNodeId = stringFrom(asset.sourceNodeId) ?? "";
                const currentStrategy = stringFrom(asset.strategy) ?? "";
                const defaultStrategy = assetStrategyOptions.includes(currentStrategy) ? currentStrategy : "image_asset";
                const format = stringFrom(asset.format) ?? "";
                const pendingKey = `set_asset_strategy:${assetId || sourceNodeId}`;
                const isPending = state.pendingStudioOperation === pendingKey;
                return `
                <tr data-node-id="${escapeAttr(sourceNodeId)}" data-studio-row>
                  <td>${escapeHtml(stringFrom(asset.id) ?? "-")}</td>
                  <td>${escapeHtml(stringFrom(asset.sourceName) ?? stringFrom(asset.sourceNodeId) ?? "-")}</td>
                  <td>${escapeHtml(currentStrategy || "-")}</td>
                  <td>
                    <select class="studio-input" data-studio-field="asset-strategy" ${canApplyStudio ? "" : "disabled"}>
                      ${assetStrategyOptions.map((option) => `<option value="${option}" ${option === defaultStrategy ? "selected" : ""}>${option}</option>`).join("")}
                    </select>
                  </td>
                  <td><input class="studio-input studio-input--wide" data-studio-field="asset-path" value="${escapeAttr(stringFrom(asset.path) ?? "")}" ${canApplyStudio ? "" : "disabled"} /></td>
                  <td>
                    <select class="studio-input" data-studio-field="asset-format" ${canApplyStudio ? "" : "disabled"}>
                      ${assetFormatOptions.map((option) => `<option value="${option}" ${option === format ? "selected" : ""}>${option || "-"}</option>`).join("")}
                    </select>
                  </td>
                  <td>${formatConfidence(numberFrom(asset.confidence))}</td>
                  <td>
                    <button
                      class="table-action"
                      data-studio-operation="set_asset_strategy"
                      data-studio-key="${escapeAttr(pendingKey)}"
                      data-asset-id="${escapeAttr(assetId)}"
                      data-source-node-id="${escapeAttr(sourceNodeId)}"
                      ${canApplyStudio && !isPending ? "" : "disabled"}
                    >
                      ${escapeHtml(isPending ? "Saving..." : "Save")}
                    </button>
                  </td>
                </tr>
              `;
              }
            )
            .join("")}
        </tbody>
      </table>
    </section>
  `;
}

function renderI18n(model: WorkbenchModel): string {
  const manifest = asRecord(state.artifacts.finalI18nManifest ?? state.artifacts.reviewedI18nManifest ?? state.artifacts.i18nManifest);
  const messages = asArray(manifest.messages).map(asRecord);
  const canApplyStudio = state.artifactRoot !== "selected directory";
  return `
    <section class="view-header">
      <div>
        <h1>i18n Studio</h1>
        <p>${model.i18nCount} messages · ${escapeHtml(stringFrom(manifest.locale) ?? "locale")}</p>
      </div>
    </section>
    ${state.actionMessage ? `<section class="notice notice--${state.actionMessage.tone}">${escapeHtml(state.actionMessage.text)}</section>` : ""}
    <section class="panel table-panel">
      <table class="data-table">
        <thead><tr><th>Key</th><th>Value</th><th>Source</th><th>Confidence</th><th>Action</th></tr></thead>
        <tbody>
          ${messages
            .map(
              (message) => {
                const key = stringFrom(message.key) ?? "";
                const sourceNodeId = stringFrom(message.sourceNodeId) ?? "";
                const pendingKey = `rename_i18n_key:${sourceNodeId || key}`;
                const isPending = state.pendingStudioOperation === pendingKey;
                return `
                <tr data-node-id="${escapeAttr(sourceNodeId)}" data-studio-row>
                  <td><input class="studio-input studio-input--wide" data-studio-field="i18n-key" value="${escapeAttr(key)}" ${canApplyStudio ? "" : "disabled"} /></td>
                  <td>${escapeHtml(stringFrom(message.value) ?? "-")}</td>
                  <td>${escapeHtml(stringFrom(message.sourceNodeId) ?? "-")}</td>
                  <td>${formatConfidence(numberFrom(message.confidence))}</td>
                  <td>
                    <button
                      class="table-action"
                      data-studio-operation="rename_i18n_key"
                      data-studio-key="${escapeAttr(pendingKey)}"
                      data-message-key="${escapeAttr(key)}"
                      data-source-node-id="${escapeAttr(sourceNodeId)}"
                      data-description="${escapeAttr(stringFrom(message.description) ?? "")}"
                      ${canApplyStudio && !isPending ? "" : "disabled"}
                    >
                      ${escapeHtml(isPending ? "Saving..." : "Save")}
                    </button>
                  </td>
                </tr>
              `;
              }
            )
            .join("")}
        </tbody>
      </table>
    </section>
  `;
}

function renderPreview(model: WorkbenchModel): string {
  const visualPreview = renderVisualScene(state.artifacts.visualIR);
  const flutterPreview = state.artifacts.flutterPreviewUrl
    ? `<img class="flutter-preview-img" src="${escapeAttr(state.artifacts.flutterPreviewUrl)}" alt="Flutter preview" />`
    : renderEmpty("No Flutter preview image.");
  const heatmap = state.artifacts.diffHeatmapUrl
    ? `<img class="flutter-preview-img" src="${escapeAttr(state.artifacts.diffHeatmapUrl)}" alt="Diff heatmap" />`
    : renderDiffSummary();

  return `
    <section class="view-header">
      <div>
        <h1>Preview & Diff</h1>
        <p>${model.visualNodes.length} visual nodes · ${model.preview.hasDiffReport ? "diff loaded" : "diff pending"}</p>
      </div>
      <div class="segmented-control">
        ${renderModeButton("side-by-side", "Side")}
        ${renderModeButton("overlay", "Overlay")}
        ${renderModeButton("heatmap", "Heatmap")}
        ${renderModeButton("difference", "Issues")}
      </div>
    </section>
    ${
      state.previewMode === "overlay"
        ? `
          <section class="panel overlay-panel">
            <div class="overlay-stage">
              ${visualPreview}
              <div class="overlay-image">${flutterPreview}</div>
            </div>
          </section>
        `
        : state.previewMode === "heatmap"
          ? `<section class="preview-grid preview-grid--single"><div class="panel preview-panel">${heatmap}</div></section>`
          : state.previewMode === "difference"
            ? `<section class="panel">${renderDiffSummary()}</section>`
            : `
              <section class="preview-grid">
                <div class="panel preview-panel">
                  <div class="panel-header"><h2>Web Preview</h2></div>
                  ${visualPreview}
                </div>
                <div class="panel preview-panel">
                  <div class="panel-header"><h2>Flutter Preview</h2></div>
                  ${flutterPreview}
                </div>
              </section>
            `
    }
  `;
}

function renderCodegen(model: WorkbenchModel): string {
  const review = asRecord(state.artifacts.codegenReview);
  const gates = asRecord(review.gates);
  const blockers = asArray(gates.blockers).map(asRecord);
  const createFiles = asArray(review.filesToCreate);
  const modifyFiles = asArray(review.filesToModify);
  const sync = asRecord(state.artifacts.nodeRemapReport);
  return `
    <section class="view-header">
      <div>
        <h1>Codegen Review</h1>
        <p>${escapeHtml(model.codegen.status)} · ${model.codegen.filesToCreate} creates · ${model.codegen.filesToModify} modifies</p>
      </div>
      <span class="status-pill status-pill--${statusTone(model.codegen.status)}">${escapeHtml(model.codegen.status)}</span>
    </section>
    <section class="two-column">
      <div class="panel">
        <div class="panel-header"><h2>Gate Blockers</h2></div>
        ${
          blockers.length === 0
            ? renderEmpty(model.codegen.status === "not-generated" ? "No codegen review artifact loaded." : "No blockers.")
            : blockers.map((blocker) => renderObjectCard(blocker, "type", "filePath")).join("")
        }
      </div>
      <div class="panel">
        <div class="panel-header"><h2>Incremental Sync</h2></div>
        <div class="status-list">
          <div class="status-row"><strong>Matches</strong><span>${asArray(sync.matches).length}</span></div>
          <div class="status-row"><strong>Stale</strong><span>${asArray(sync.staleOverrides).length}</span></div>
          <div class="status-row"><strong>Review Required</strong><span>${asArray(sync.matches).map(asRecord).filter((entry) => booleanFrom(entry.reviewRequired)).length}</span></div>
        </div>
      </div>
    </section>
    <section class="two-column">
      <div class="panel">
        <div class="panel-header"><h2>Files To Create</h2></div>
        ${renderFileList(createFiles)}
      </div>
      <div class="panel">
        <div class="panel-header"><h2>Files To Modify</h2></div>
        ${renderFileList(modifyFiles)}
      </div>
    </section>
  `;
}

function renderSettings(model: WorkbenchModel): string {
  const capture = asRecord(state.artifacts.flutterPreviewCaptureReport);
  const conflicts = asRecord(state.artifacts.overrideConflictReport);
  return `
    <section class="view-header">
      <div>
        <h1>Settings</h1>
        <p>${escapeHtml(model.artifactRoot)}</p>
      </div>
    </section>
    <section class="two-column">
      <div class="panel">
        <div class="panel-header"><h2>Artifact Root</h2></div>
        <dl class="detail-list">
          <dt>Root</dt><dd>${escapeHtml(model.artifactRoot)}</dd>
          <dt>Viewport</dt><dd>${model.viewport.width}x${model.viewport.height}</dd>
          <dt>Frame</dt><dd>${escapeHtml(model.project.frameNodeId)}</dd>
          <dt>Flutter Capture</dt><dd>${escapeHtml(stringFrom(capture.status) ?? "not loaded")}</dd>
          <dt>Override Conflicts</dt><dd>${asArray(conflicts.conflicts).length}</dd>
        </dl>
      </div>
      <div class="panel">
        <div class="panel-header"><h2>Loaded JSON</h2></div>
        <div class="status-list">
          ${jsonArtifacts
            .map((spec) => {
              const loaded = Boolean(state.artifacts[spec.key]);
              return `
                <div class="status-row">
                  <span class="status-dot ${loaded ? "is-good" : "is-muted"}"></span>
                  <strong>${escapeHtml(String(spec.key))}</strong>
                  <span>${loaded ? "loaded" : "missing"}</span>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
    </section>
  `;
}

function renderVisualScene(visualIR: unknown): string {
  const root = asRecord(asRecord(visualIR).root);
  const size = asRecord(root.size);
  const width = numberFrom(size.w) ?? 390;
  const height = numberFrom(size.h) ?? 844;
  const children = asArray(root.children).map(asRecord);
  if (children.length === 0) return renderEmpty("No VisualIR nodes.");
  return `
    <div class="preview-stage" data-fit-stage>
      <div class="visual-canvas" data-width="${width}" data-height="${height}" style="width:${width}px;height:${height}px;">
        ${children.map((child) => renderVisualNode(child)).join("")}
      </div>
    </div>
  `;
}

function renderVisualNode(positioned: JsonRecord): string {
  const child = asRecord(positioned.child);
  const type = stringFrom(child.type) ?? "node";
  const sourceNodeId = stringFrom(positioned.sourceNodeId) ?? stringFrom(child.sourceNodeId) ?? "";
  const selected = sourceNodeId && state.selectedSourceNodeId === sourceNodeId ? " is-selected" : "";
  const x = numberFrom(positioned.x) ?? 0;
  const y = numberFrom(positioned.y) ?? 0;
  const w = numberFrom(positioned.w) ?? numberFrom(child.w) ?? 0;
  const h = numberFrom(positioned.h) ?? numberFrom(child.h) ?? 0;
  const baseStyle = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;`;
  const common = `data-node-id="${escapeAttr(sourceNodeId)}" title="${escapeAttr(sourceNodeId)}"`;

  if (type === "text") {
    const text = stringFrom(child.text) ?? "";
    const fontSize = numberFrom(child.fontSize) ?? 14;
    const lineHeight = numberFrom(child.lineHeight) ?? Math.round(fontSize * 1.2);
    const fontWeight = numberFrom(child.fontWeight) ?? 400;
    const color = cssColor(stringFrom(child.color) ?? "#111111");
    const fontFamily = stringFrom(child.fontFamily) ?? "Inter, system-ui, sans-serif";
    return `
      <div class="viz-node viz-text${selected}" ${common} style="${baseStyle}color:${color};font-size:${fontSize}px;line-height:${lineHeight}px;font-weight:${fontWeight};font-family:${escapeAttr(fontFamily)};">
        ${escapeHtml(text)}
      </div>
    `;
  }

  if (type === "image") {
    return `<div class="viz-node viz-image${selected}" ${common} style="${baseStyle}">IMG</div>`;
  }

  const fill = cssColor(stringFrom(child.fill) ?? "transparent");
  const stroke = stringFrom(child.stroke) ? cssColor(stringFrom(child.stroke) ?? "") : "transparent";
  const strokeWidth = numberFrom(child.strokeWidth) ?? 0;
  const radius = numberFrom(child.radius) ?? 0;
  const opacity = numberFrom(child.opacity) ?? 1;
  const shadow = shadowCss(asArray(child.shadow));
  return `
    <div class="viz-node viz-rect${selected}" ${common} style="${baseStyle}background:${fill};border:${strokeWidth}px solid ${stroke};border-radius:${radius}px;opacity:${opacity};box-shadow:${shadow};"></div>
  `;
}

function renderDiffSummary(): string {
  const report = asRecord(state.artifacts.visualDiffReport);
  if (Object.keys(report).length === 0) return renderEmpty("No visual diff report.");
  const page = asRecord(report.page);
  const issues = asArray(report.issues).map(asRecord);
  return `
    <div class="diff-summary">
      <div class="metric-grid metric-grid--compact">
        ${renderMetric("Visual Score", formatMaybePercent(numberFrom(page.visualScore)), "good")}
        ${renderMetric("Pixel Diff", formatMaybePercent(numberFrom(page.pixelDiffRatio)), "warn")}
        ${renderMetric("Issues", String(issues.length), issues.length > 0 ? "warn" : "good")}
      </div>
      <div class="status-list">
        ${
          issues.length === 0
            ? `<div class="status-row"><strong>No node issues</strong><span>pass</span></div>`
            : issues
                .map(
                  (issue) => `
                    <div class="status-row">
                      <strong>${escapeHtml(stringFrom(issue.type) ?? "diff_issue")}</strong>
                      <span>${escapeHtml(stringFrom(issue.sourceNodeId) ?? "-")}</span>
                    </div>
                  `
                )
                .join("")
        }
      </div>
    </div>
  `;
}

function renderMetric(label: string, value: string, tone: "neutral" | "good" | "warn" | "bad"): string {
  return `
    <article class="metric-card metric-card--${tone}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </article>
  `;
}

function renderGate(label: string, status: string): string {
  return `
    <div class="gate gate--${statusTone(status)}">
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(status)}</span>
    </div>
  `;
}

function renderModeButton(mode: PreviewMode, label: string): string {
  return `<button class="${state.previewMode === mode ? "is-active" : ""}" data-preview-mode="${mode}">${escapeHtml(label)}</button>`;
}

function renderTreeActionButton(operation: string, label: string, enabled: boolean): string {
  const isPending = state.pendingTreeOperation === operation;
  return `
    <button class="action-button" data-tree-operation="${escapeAttr(operation)}" ${enabled && !isPending ? "" : "disabled"}>
      ${escapeHtml(isPending ? "Saving..." : label)}
    </button>
  `;
}

function renderKeyValues(value: Record<string, number>): string {
  const entries = Object.entries(value);
  if (entries.length === 0) return `<div class="kv-row"><strong>none</strong><span>0</span></div>`;
  return entries.map(([key, count]) => `<div class="kv-row"><strong>${escapeHtml(key)}</strong><span>${count}</span></div>`).join("");
}

function renderObjectCard(record: JsonRecord, primaryKey: string, secondaryKey: string): string {
  const primary = stringFrom(record[primaryKey]) ?? stringFrom(record.id) ?? "Entry";
  const secondary = stringFrom(record[secondaryKey]) ?? "";
  return `
    <article class="object-card">
      <strong>${escapeHtml(primary)}</strong>
      <span>${escapeHtml(secondary)}</span>
      <pre>${escapeHtml(JSON.stringify(record, null, 2))}</pre>
    </article>
  `;
}

function renderTokenRow(token: JsonRecord, group: string, enabled: boolean): string {
  const value = tokenValue(token);
  const color = stringFrom(token.value);
  const swatch = color?.startsWith("#") ? `<span class="swatch" style="background:${cssColor(color)}"></span>` : "";
  const name = stringFrom(token.name) ?? "token";
  const tokenType = tokenTypeForGroup(group);
  const pendingKey = `rename_token:${tokenType}:${name}`;
  const isPending = state.pendingStudioOperation === pendingKey;
  return `
    <div class="token-row" data-studio-row>
      ${swatch}
      <input class="studio-input studio-input--wide" data-studio-field="token-name" value="${escapeAttr(name)}" ${enabled ? "" : "disabled"} />
      <span>${escapeHtml(value)}</span>
      <em>${formatConfidence(numberFrom(token.confidence))}</em>
      <button
        class="table-action"
        data-studio-operation="rename_token"
        data-studio-key="${escapeAttr(pendingKey)}"
        data-token-type="${escapeAttr(tokenType)}"
        data-token-name="${escapeAttr(name)}"
        ${enabled && !isPending ? "" : "disabled"}
      >
        ${escapeHtml(isPending ? "Saving..." : "Save")}
      </button>
    </div>
  `;
}

function renderFileList(files: unknown[]): string {
  if (files.length === 0) return renderEmpty("No files.");
  return `
    <ul class="file-list">
      ${files.map((file) => `<li>${escapeHtml(fileLabel(file))}</li>`).join("")}
    </ul>
  `;
}

function renderEmpty(message: string): string {
  return `<div class="empty-inline">${escapeHtml(message)}</div>`;
}

function onAppClick(event: MouseEvent): void {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const viewButton = target.closest<HTMLElement>("[data-view]");
  if (viewButton?.dataset.view) {
    const nextView = normalizeView(viewButton.dataset.view);
    if (nextView) {
      state.activeView = nextView;
      location.hash = nextView;
      render();
      return;
    }
  }

  const actionButton = target.closest<HTMLElement>("[data-action]");
  if (actionButton?.dataset.action) {
    if (actionButton.dataset.action === "load-folder") {
      artifactInput.click();
      return;
    }
    if (actionButton.dataset.action === "reload") {
      void loadFromArtifactRoot(state.artifactRoot === "selected directory" ? initialArtifactRoot : state.artifactRoot);
      return;
    }
  }

  const taskActionButton = target.closest<HTMLButtonElement>("[data-task-action]");
  if (taskActionButton?.dataset.taskAction) {
    const actionIndex = Number(taskActionButton.dataset.actionIndex);
    void applyTaskAction(taskActionButton.dataset.taskAction, actionIndex);
    return;
  }

  const treeOperationButton = target.closest<HTMLButtonElement>("[data-tree-operation]");
  if (treeOperationButton?.dataset.treeOperation) {
    void applyTreeOperation(treeOperationButton.dataset.treeOperation);
    return;
  }

  const studioOperationButton = target.closest<HTMLButtonElement>("[data-studio-operation]");
  if (studioOperationButton?.dataset.studioOperation) {
    void applyStudioOperation(studioOperationButton);
    return;
  }

  const modeButton = target.closest<HTMLElement>("[data-preview-mode]");
  if (modeButton?.dataset.previewMode) {
    state.previewMode = modeButton.dataset.previewMode as PreviewMode;
    render();
    return;
  }

  if (target.closest("input, select, textarea")) return;

  const nodeTarget = target.closest<HTMLElement>("[data-node-id]");
  const nodeId = nodeTarget?.dataset.nodeId;
  const normalizedNodeId = nodeTarget?.dataset.normalizedId;
  if (nodeId || normalizedNodeId) {
    state.selectedSourceNodeId = nodeId || undefined;
    state.selectedNormalizedNodeId = normalizedNodeId || undefined;
    if (state.activeView !== "preview" && target.closest(".task-list")) state.activeView = "preview";
    render();
  }
}

async function applyTaskAction(taskId: string, actionIndex: number): Promise<void> {
  const actionKey = `${taskId}:${actionIndex}`;
  state.pendingAction = actionKey;
  state.actionMessage = undefined;
  render();
  try {
    const response = await fetch("/api/workbench/task-action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        artifactRoot: state.artifactRoot,
        taskId,
        actionIndex,
        actor: "user"
      })
    });
    const result = (await response.json()) as { ok?: boolean; error?: string; report?: { afterOpenTasks?: number; overrideId?: string } };
    if (!response.ok || !result.ok) {
      throw new Error(result.error ?? `Task action failed with ${response.status}`);
    }
    state.actionMessage = {
      tone: "good",
      text: `Applied ${result.report?.overrideId ?? "override"}; ${result.report?.afterOpenTasks ?? "updated"} tasks remain.`
    };
    await loadFromArtifactRoot(state.artifactRoot);
    state.actionMessage = {
      tone: "good",
      text: `Applied ${result.report?.overrideId ?? "override"}; ${result.report?.afterOpenTasks ?? state.model?.reviewSummary.open ?? 0} tasks remain.`
    };
  } catch (error) {
    state.actionMessage = {
      tone: "bad",
      text: error instanceof Error ? error.message : String(error)
    };
  } finally {
    state.pendingAction = undefined;
    render();
  }
}

async function applyTreeOperation(kind: string): Promise<void> {
  if (!state.model) return;
  const selected = selectedTreeRow(state.model);
  if (!selected || selected.depth === 0) return;
  const reason = inputValue("[data-tree-field='reason']").trim();
  const target = treeOperationTarget(selected);
  const operation = buildTreeOperation(kind, selected, target, reason);
  state.pendingTreeOperation = kind;
  state.actionMessage = undefined;
  render();
  try {
    const response = await fetch("/api/workbench/tree-edit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        artifactRoot: state.artifactRoot,
        operation,
        actor: "user"
      })
    });
    const result = (await response.json()) as {
      ok?: boolean;
      error?: string;
      report?: { overrideIds?: string[]; afterOpenTasks?: number };
    };
    if (!response.ok || !result.ok) {
      throw new Error(result.error ?? `Tree edit failed with ${response.status}`);
    }
    await loadFromArtifactRoot(state.artifactRoot);
    state.selectedNormalizedNodeId = selected.id;
    state.selectedSourceNodeId = selected.sourceNodeIds[0];
    state.actionMessage = {
      tone: "good",
      text: `Saved ${result.report?.overrideIds?.join(", ") ?? "tree override"}; ${result.report?.afterOpenTasks ?? state.model?.reviewSummary.open ?? 0} tasks remain.`
    };
  } catch (error) {
    state.actionMessage = {
      tone: "bad",
      text: error instanceof Error ? error.message : String(error)
    };
  } finally {
    state.pendingTreeOperation = undefined;
    render();
  }
}

async function applyStudioOperation(button: HTMLButtonElement): Promise<void> {
  const operationKind = button.dataset.studioOperation ?? "";
  const pendingKey = button.dataset.studioKey ?? operationKind;
  let operation: Record<string, unknown>;
  try {
    operation = buildStudioOperation(button);
  } catch (error) {
    state.actionMessage = {
      tone: "bad",
      text: error instanceof Error ? error.message : String(error)
    };
    render();
    return;
  }
  state.pendingStudioOperation = pendingKey;
  state.actionMessage = undefined;
  render();
  try {
    const response = await fetch("/api/workbench/studio-operation", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        artifactRoot: state.artifactRoot,
        operation,
        actor: "user"
      })
    });
    const result = (await response.json()) as {
      ok?: boolean;
      error?: string;
      report?: { overrideIds?: string[]; afterOpenTasks?: number };
    };
    if (!response.ok || !result.ok) {
      throw new Error(result.error ?? `Studio operation failed with ${response.status}`);
    }
    await loadFromArtifactRoot(state.artifactRoot);
    state.actionMessage = {
      tone: "good",
      text: `Saved ${result.report?.overrideIds?.join(", ") ?? "studio override"}; ${result.report?.afterOpenTasks ?? state.model?.reviewSummary.open ?? 0} tasks remain.`
    };
  } catch (error) {
    state.actionMessage = {
      tone: "bad",
      text: error instanceof Error ? error.message : String(error)
    };
  } finally {
    state.pendingStudioOperation = undefined;
    render();
  }
}

function buildTreeOperation(kind: string, selected: WorkbenchModel["treeRows"][number], target: Record<string, string>, reason: string): Record<string, unknown> {
  const operationId = `workbench_${kind}_${safeId(selected.id)}`;
  const safeReason = reason || "Reviewed in Workbench Tree Editor.";
  if (kind === "rename") {
    return {
      id: operationId,
      kind: "rename_node",
      ...target,
      name: inputValue("[data-tree-field='name']").trim(),
      reason: safeReason
    };
  }
  if (kind === "layout") {
    return {
      id: operationId,
      kind: "force_layout",
      ...target,
      strategy: inputValue("[data-tree-field='layout']"),
      reason: safeReason
    };
  }
  if (kind === "render") {
    return {
      id: operationId,
      kind: "force_render",
      ...target,
      strategy: inputValue("[data-tree-field='render']"),
      reason: safeReason
    };
  }
  if (kind === "ignore") {
    return {
      id: operationId,
      kind: "ignore_node",
      ...target,
      reason: safeReason
    };
  }
  throw new Error(`Unsupported tree operation: ${kind}`);
}

function treeOperationTarget(selected: WorkbenchModel["treeRows"][number]): Record<string, string> {
  const sourceNodeId = selected.sourceNodeIds[0];
  return sourceNodeId ? { sourceNodeId } : { normalizedNodeId: selected.id };
}

function buildStudioOperation(button: HTMLButtonElement): Record<string, unknown> {
  const kind = button.dataset.studioOperation;
  const row = button.closest<HTMLElement>("[data-studio-row]");
  if (!kind || !row) throw new Error("Missing Studio operation target.");
  const reason = "Reviewed in Workbench Studio.";
  if (kind === "rename_token") {
    const tokenType = button.dataset.tokenType ?? "";
    const from = button.dataset.tokenName ?? "";
    const to = studioFieldValue(row, "token-name").trim();
    if (!tokenType || !from || !to) throw new Error("Token rename requires a token type and name.");
    if (from === to) throw new Error("Token name is unchanged.");
    return {
      id: `workbench_rename_token_${safeId(tokenType)}_${safeId(from)}_${safeId(to)}`,
      kind,
      tokenType,
      from,
      to,
      reason
    };
  }
  if (kind === "set_asset_strategy") {
    const assetId = button.dataset.assetId ?? "";
    const sourceNodeId = button.dataset.sourceNodeId ?? "";
    const strategy = studioFieldValue(row, "asset-strategy");
    const format = studioFieldValue(row, "asset-format");
    const path = studioFieldValue(row, "asset-path").trim();
    if (!assetId && !sourceNodeId) throw new Error("Asset strategy requires an asset or source node target.");
    if (!strategy) throw new Error("Asset strategy is missing.");
    return {
      id: `workbench_asset_strategy_${safeId(assetId || sourceNodeId)}_${safeId(strategy)}_${safeId(path || format || "default")}`,
      kind,
      ...(assetId ? { assetId } : { sourceNodeId }),
      strategy,
      ...(format ? { format } : {}),
      ...(path ? { path } : {}),
      reason
    };
  }
  if (kind === "rename_i18n_key") {
    const messageKey = button.dataset.messageKey ?? "";
    const sourceNodeId = button.dataset.sourceNodeId ?? "";
    const key = studioFieldValue(row, "i18n-key").trim();
    if (!messageKey && !sourceNodeId) throw new Error("i18n rename requires a message or source node target.");
    if (!key) throw new Error("i18n key is missing.");
    return {
      id: `workbench_rename_i18n_${safeId(sourceNodeId || messageKey)}_${safeId(key)}`,
      kind,
      ...(messageKey ? { messageKey } : {}),
      ...(sourceNodeId ? { sourceNodeId } : {}),
      key,
      description: button.dataset.description || undefined,
      reason
    };
  }
  throw new Error(`Unsupported Studio operation: ${kind}`);
}

function studioFieldValue(row: HTMLElement, fieldName: string): string {
  const field = row.querySelector<HTMLInputElement | HTMLSelectElement>(`[data-studio-field='${fieldName}']`);
  return field?.value ?? "";
}

function tokenTypeForGroup(group: string): string {
  if (group === "colors") return "color";
  if (group === "radii") return "radius";
  if (group === "shadows") return "shadow";
  if (group === "typography") return "typography";
  return "spacing";
}

function inputValue(selector: string): string {
  const field = document.querySelector<HTMLInputElement | HTMLSelectElement>(selector);
  return field?.value ?? "";
}

function fitPreviewStages(): void {
  document.querySelectorAll<HTMLElement>("[data-fit-stage]").forEach((stage) => {
    const canvas = stage.querySelector<HTMLElement>(".visual-canvas");
    if (!canvas) return;
    const width = Number(canvas.dataset.width);
    const height = Number(canvas.dataset.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
    const available = Math.max(stage.clientWidth - 2, 1);
    const scale = Math.min(1, available / width);
    canvas.style.transform = `scale(${scale})`;
    stage.style.height = `${Math.ceil(height * scale)}px`;
  });
}

function selectedTreeRow(model: WorkbenchModel): WorkbenchModel["treeRows"][number] | undefined {
  const selectedNormalizedNodeId = state.selectedNormalizedNodeId;
  if (selectedNormalizedNodeId) {
    const byNormalizedId = model.treeRows.find((row) => row.id === selectedNormalizedNodeId);
    if (byNormalizedId) return byNormalizedId;
  }
  const selectedSourceNodeId = state.selectedSourceNodeId;
  if (selectedSourceNodeId) {
    return model.treeRows.find((row) => row.sourceNodeIds.includes(selectedSourceNodeId));
  }
  return model.treeRows.find((row) => row.depth > 0) ?? model.treeRows[0];
}

function tokenValue(token: JsonRecord): string {
  const value = token.value;
  if (typeof value === "string" || typeof value === "number") return String(value);
  const parts = [
    stringFrom(token.fontFamily),
    numberFrom(token.fontSize) ? `${numberFrom(token.fontSize)}px` : undefined,
    numberFrom(token.lineHeight) ? `${numberFrom(token.lineHeight)}px` : undefined
  ].filter(Boolean);
  return parts.join(" / ") || "-";
}

function fileLabel(file: unknown): string {
  if (typeof file === "string") return file;
  const record = asRecord(file);
  return stringFrom(record.path) ?? stringFrom(record.filePath) ?? stringFrom(record.patch) ?? JSON.stringify(record);
}

function statusTone(status: string): "neutral" | "good" | "warn" | "bad" {
  if (["ready", "success", "pass"].includes(status)) return "good";
  if (["blocked", "review-blocked", "failed", "error"].includes(status)) return "bad";
  if (["needs-review", "review", "warn"].includes(status)) return "warn";
  return "neutral";
}

function formatConfidence(value: number | undefined): string {
  if (value === undefined) return "-";
  return `${Math.round(value * 100)}%`;
}

function formatMaybePercent(value: number | undefined): string {
  if (value === undefined) return "-";
  if (value <= 1) return `${(value * 100).toFixed(2)}%`;
  return value.toFixed(2);
}

function cssColor(value: string): string {
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{8}$/.test(trimmed)) {
    const alpha = trimmed.slice(1, 3);
    const red = trimmed.slice(3, 5);
    const green = trimmed.slice(5, 7);
    const blue = trimmed.slice(7, 9);
    return `#${red}${green}${blue}${alpha}`;
  }
  return trimmed;
}

function shadowCss(shadows: unknown[]): string {
  const parts = shadows.map((shadow) => {
    const record = asRecord(shadow);
    const x = numberFrom(record.x) ?? 0;
    const y = numberFrom(record.y) ?? 0;
    const blur = numberFrom(record.blur) ?? numberFrom(record.radius) ?? 0;
    const spread = numberFrom(record.spread) ?? 0;
    const color = cssColor(stringFrom(record.color) ?? "rgba(0,0,0,0.16)");
    return `${x}px ${y}px ${blur}px ${spread}px ${color}`;
  });
  return parts.length > 0 ? parts.join(", ") : "none";
}

function artifactUrl(root: string, file: string): string {
  const cleanRoot = root.endsWith("/") ? root.slice(0, -1) : root;
  return `${cleanRoot}/${file}`;
}

function indexSelectedFiles(files: File[]): Map<string, File> {
  const index = new Map<string, File>();
  for (const file of files) {
    const webkitPath = (file as File & { webkitRelativePath?: string }).webkitRelativePath;
    const candidates = new Set([file.name]);
    if (webkitPath) {
      candidates.add(webkitPath);
      const withoutRoot = webkitPath.split("/").slice(1).join("/");
      if (withoutRoot) candidates.add(withoutRoot);
    }
    for (const candidate of candidates) index.set(candidate, file);
  }
  return index;
}

function findSelectedFile(index: Map<string, File>, files: string[]): File | undefined {
  for (const file of files) {
    const direct = index.get(file);
    if (direct) return direct;
    for (const [key, candidate] of index.entries()) {
      if (key.endsWith(`/${file}`)) return candidate;
    }
  }
  return undefined;
}

function objectUrlFor(file: File): string {
  const url = URL.createObjectURL(file);
  objectUrls.push(url);
  return url;
}

function revokeObjectUrls(): void {
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls = [];
}

function normalizeView(value: string): ViewId | undefined {
  return navItems.some((item) => item.id === value) ? (value as ViewId) : undefined;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value);
}

function safeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "_").replace(/^_+|_+$/g, "") || "node";
}
