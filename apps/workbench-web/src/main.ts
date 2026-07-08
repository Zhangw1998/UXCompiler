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

type ViewId = "dashboard" | "tasks" | "tree" | "elements" | "components" | "tokens" | "assets" | "i18n" | "preview" | "codegen" | "settings";
type PreviewMode = "side-by-side" | "overlay" | "heatmap" | "difference";
type PipelineGateId = "tasks" | "preview" | "flutter" | "codegen" | "sync";
type ElementTab = "tokens" | "components" | "assets" | "docs";

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
  pendingStudioRollback?: string;
  pendingCodegenOperation?: string;
  pendingSyncOperation?: string;
  pendingDiffRepair?: string;
  pendingDiffRollback?: string;
  pendingProjectPreset?: boolean;
  pendingPrototypeLink?: string;
  codegenProjectPath?: string;
  selectedGateId?: PipelineGateId;
  selectedCanvasPage?: string;
  elementsTab?: ElementTab;
  projectPreset?: unknown;
  projectElements?: ProjectElementsReport;
  projectPages?: ProjectPagesReport;
  projectList?: ProjectListReport;
}

interface ProjectPresetSettings {
  version?: string;
  generatedAt?: string;
  source?: string;
  design: {
    width: number;
    height: number;
    dpr: number;
  };
  fonts: {
    defaultFamily: string;
    families: string[];
    resources: Array<{ family: string; path: string; weight?: string; style?: string }>;
  };
  assets: {
    root: string;
    images: string;
    slices: string;
    frames: string;
  };
  notes: string;
}

interface PipelineGate {
  id: PipelineGateId;
  label: string;
  status: string;
  description: string;
  view?: ViewId;
  details: Array<{ label: string; value: string; tone?: "neutral" | "good" | "warn" | "bad" }>;
}

interface ProjectPagesReport {
  projectName: string;
  projectRoot: string;
  currentArtifactRoot: string;
  pages: ProjectPageEntry[];
  prototypeFlow: {
    version?: string;
    updatedAt?: string;
    links: PrototypeLink[];
  };
}

interface ProjectListReport {
  currentProjectName: string;
  projects: Array<{ name: string; artifactRoot: string; pageCount: number; current?: boolean }>;
}

interface ProjectElementsReport {
  projectName: string;
  projectRoot: string;
  pages: ProjectPageEntry[];
  tokens: ProjectElementEntry[];
  components: ProjectElementEntry[];
  assets: ProjectElementEntry[];
  docs: ProjectElementEntry[];
}

interface ProjectElementEntry {
  pageName: string;
  type?: string;
  id?: string;
  name?: string;
  key?: string;
  value?: unknown;
  source?: string;
  path?: string;
  strategy?: string;
}

interface ProjectPageEntry {
  name: string;
  artifactRoot: string;
  current?: boolean;
  status?: string;
  frameName?: string;
  frameNodeId?: string;
  updatedAt?: string;
  viewport?: { width: number; height: number };
}

interface PrototypeLink {
  id: string;
  fromPage: string;
  toPage: string;
  trigger?: string;
  note?: string;
}

const appElement = document.querySelector<HTMLDivElement>("#app");
const artifactInputElement = document.querySelector<HTMLInputElement>("#artifactInput");

if (!appElement || !artifactInputElement) {
  throw new Error("Workbench root elements are missing.");
}

const app = appElement;
const artifactInput = artifactInputElement;
const defaultLocale = "zh-CN";

document.documentElement.lang = defaultLocale;
document.title = "UXCompiler 工作台";

const jsonArtifacts: ArtifactSpec[] = [
  { key: "reviewedNormalizedDesignIR", files: ["reviewed_normalized_design_ir.json"] },
  { key: "normalizedDesignIR", files: ["normalized_design_ir.json"] },
  { key: "visualIR", files: ["visual_ir.json"] },
  { key: "webPreviewState", files: ["web_preview_state.json"] },
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
  { key: "workbenchStudioActionReport", files: ["workbench_studio_action_report.json"] },
  { key: "workbenchStudioRollbackReport", files: ["workbench_studio_rollback_report.json"] },
  { key: "codegenReview", files: ["codegen_review.json"] },
  { key: "codegenPromotionRules", files: ["codegen_promotion_rules.json"] },
  { key: "assetsToAdd", files: ["assets_to_add.json"] },
  { key: "arbPatch", files: ["arb_patch.json"] },
  { key: "pubspecPatch", files: ["pubspec_patch.json"] },
  { key: "mergeReport", files: ["merge_report.json"] },
  { key: "workbenchCodegenReviewReport", files: ["workbench_codegen_review_report.json"] },
  { key: "projectWriteReport", files: ["project_write_report.json"] },
  { key: "nodeRemapReport", files: ["node_remap_report.json"] },
  { key: "tokenMigrationReport", files: ["token_migration_report.json"] },
  { key: "workbenchSyncRemapReport", files: ["workbench_sync_remap_report.json"] },
  { key: "staleOverrideReport", files: ["stale_override_report.json"] },
  { key: "overrideConflictReport", files: ["override_conflict_report.json"] },
  { key: "visualDiffReport", files: ["visual_diff_report.json", "diff/visual_diff_report.json"] },
  { key: "diffRepairReport", files: ["workbench_diff_repair_report.json", "diff_repair_report.json"] },
  { key: "repairPatch", files: ["repair_patch.json"] },
  { key: "flutterPreviewFormatReport", files: ["flutter_preview_format_report.json"] },
  { key: "flutterPreviewAnalyzeReport", files: ["flutter_preview_analyze_report.json"] },
  { key: "flutterPreviewCaptureReport", files: ["flutter_preview_capture_report.json"] },
  { key: "fidelityGenerationManifest", files: ["fidelity_generation_manifest.json"] },
  { key: "projectPreset", files: ["project_preset.json"] }
];

const navItems: Array<{ id: ViewId; label: string }> = [
  { id: "dashboard", label: "项目" },
  { id: "tasks", label: "任务" },
  { id: "tree", label: "结构树" },
  { id: "elements", label: "项目元素" },
  { id: "preview", label: "预览" },
  { id: "codegen", label: "代码生成" },
  { id: "settings", label: "设置" }
];

const layoutOptions = ["column", "row", "grid", "stack", "absolute", "leaf"];
const renderOptions = ["semantic_widget", "semantic_layout", "absolute_widget", "custom_painter", "asset_slice", "hybrid_region", "ignore"];
const assetStrategyOptions = ["real_text", "svg_icon", "image_asset", "decorative_slice", "custom_painter", "ignored"];
const assetFormatOptions = ["", "svg", "png", "webp", "jpg"];
const componentPropTypeOptions = ["text", "asset", "boolean", "number", "slot", "enum"];

let objectUrls: string[] = [];
const initialArtifactRoot = new URLSearchParams(window.location.search).get("artifacts") ?? "/artifacts/sample";
const state: AppState = {
  activeView: normalizeView(location.hash.replace("#", "")) ?? "dashboard",
  artifactRoot: initialArtifactRoot,
  artifacts: { artifactRoot: initialArtifactRoot },
  loading: true,
  previewMode: "side-by-side",
  elementsTab: "tokens",
  codegenProjectPath: savedCodegenProjectPath(initialArtifactRoot)
};

app.addEventListener("click", onAppClick);
app.addEventListener("input", onAppInput);
app.addEventListener("change", onAppChange);
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

async function loadFromArtifactRoot(root: string): Promise<void> {
  const previousRoot = state.artifactRoot;
  state.loading = true;
  state.error = undefined;
  state.artifactRoot = root;
  if (root !== previousRoot) state.codegenProjectPath = savedCodegenProjectPath(root);
  state.artifacts = { artifactRoot: root };
  state.projectPreset = undefined;
  state.projectElements = undefined;
  state.projectPages = undefined;
  state.projectList = undefined;
  render();

  try {
    const artifacts = await fetchArtifacts(root);
    const [projectPages, projectList, projectPreset, projectElements] = await Promise.all([
      fetchProjectPages(root),
      fetchProjectList(root),
      fetchProjectPreset(root),
      fetchProjectElements(root)
    ]);
    state.projectPages = projectPages;
    state.projectList = projectList;
    state.projectPreset = projectPreset;
    state.projectElements = projectElements;
    state.selectedCanvasPage = projectPages?.pages.find((page) => page.current)?.name ?? projectPages?.pages[0]?.name;
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

async function fetchProjectList(root: string): Promise<ProjectListReport | undefined> {
  if (root === "selected directory") return undefined;
  try {
    const url = new URL("/api/workbench/projects", window.location.origin);
    url.searchParams.set("artifactRoot", root);
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return undefined;
    const result = (await response.json()) as { ok?: boolean; report?: ProjectListReport };
    return result.ok ? result.report : undefined;
  } catch {
    return undefined;
  }
}

async function fetchProjectPages(root: string): Promise<ProjectPagesReport | undefined> {
  if (root === "selected directory") return undefined;
  try {
    const url = new URL("/api/workbench/project-pages", window.location.origin);
    url.searchParams.set("artifactRoot", root);
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return undefined;
    const result = (await response.json()) as { ok?: boolean; report?: ProjectPagesReport };
    return result.ok ? result.report : undefined;
  } catch {
    return undefined;
  }
}

async function fetchProjectPreset(root: string): Promise<unknown> {
  if (root === "selected directory") return undefined;
  try {
    const url = new URL("/api/workbench/project-preset", window.location.origin);
    url.searchParams.set("artifactRoot", root);
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return undefined;
    const result = (await response.json()) as { ok?: boolean; preset?: unknown };
    return result.ok ? result.preset : undefined;
  } catch {
    return undefined;
  }
}

async function fetchProjectElements(root: string): Promise<ProjectElementsReport | undefined> {
  if (root === "selected directory") return undefined;
  try {
    const url = new URL("/api/workbench/project-elements", window.location.origin);
    url.searchParams.set("artifactRoot", root);
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) return undefined;
    const result = (await response.json()) as { ok?: boolean; report?: ProjectElementsReport };
    return result.ok ? result.report : undefined;
  } catch {
    return undefined;
  }
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
    renderApp(renderShell(`<section class="empty-state"><div class="spinner"></div><strong>Loading artifacts</strong></section>`));
    return;
  }

  if (state.error || !state.model) {
    renderApp(renderShell(`
      <section class="empty-state empty-state--error">
        <strong>Workbench could not load this artifact set.</strong>
        <p>${escapeHtml(state.error ?? "Unknown load error")}</p>
        <button class="button button--primary" data-action="reload">Retry</button>
      </section>
    `));
    return;
  }

  renderApp(renderShell(renderActiveView(state.model)));
  window.requestAnimationFrame(fitPreviewStages);
}

function renderApp(html: string): void {
  app.innerHTML = html;
  localizeRenderedPage();
}

function localizeRenderedPage(): void {
  const walker = document.createTreeWalker(app, NodeFilter.SHOW_TEXT);
  const textNodes: Text[] = [];
  while (walker.nextNode()) {
    if (walker.currentNode instanceof Text) textNodes.push(walker.currentNode);
  }
  for (const node of textNodes) {
    const translated = translateText(node.textContent ?? "");
    if (translated !== undefined) node.textContent = translated;
  }
}

function translateText(value: string): string | undefined {
  const leading = value.match(/^\s*/)?.[0] ?? "";
  const trailing = value.match(/\s*$/)?.[0] ?? "";
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const exact = zhCn[trimmed];
  if (exact) return `${leading}${exact}${trailing}`;
  const tasksLoaded = trimmed.match(/^(\d+) tasks loaded$/);
  if (tasksLoaded) return `${leading}已加载 ${tasksLoaded[1]} 个任务${trailing}`;
  const treeHeader = trimmed.match(/^(\d+) nodes · (\d+) open tasks$/);
  if (treeHeader) return `${leading}${treeHeader[1]} 个节点 · ${treeHeader[2]} 个待处理任务${trailing}`;
  const components = trimmed.match(/^(\d+) components$/);
  if (components) return `${leading}${components[1]} 个组件${trailing}`;
  const open = trimmed.match(/^(\d+) open$/);
  if (open) return `${leading}${open[1]} 个待处理${trailing}`;
  return undefined;
}

const zhCn: Record<string, string> = {
  "UXCompiler Workbench": "UXCompiler 工作台",
  "Loading artifacts": "正在加载产物",
  "Workbench could not load this artifact set.": "Workbench 无法加载这组产物。",
  "Unknown load error": "未知加载错误",
  "Retry": "重试",
  "Open Artifacts": "打开产物",
  "Reload": "刷新",
  "loading": "加载中",
  "review-blocked": "审查阻塞",
  "needs-review": "待审查",
  "ready": "就绪",
  "blocked": "已阻塞",
  "missing": "缺失",
  "review": "需审查",
  "not-generated": "未生成",
  "Project Dashboard": "项目看板",
  "Review Distribution": "任务分布",
  "Pipeline Gates": "流水线门禁",
  "Tasks": "任务",
  "Preview": "预览",
  "Flutter": "Flutter",
  "Codegen": "代码生成",
  "Sync": "同步",
  "Review Tasks": "审查任务",
  "No review tasks in this artifact set.": "这组产物没有审查任务。",
  "Review task": "审查任务",
  "No action": "无操作",
  "Applying...": "正在应用...",
  "Normalized Tree": "规范化结构树",
  "Name": "名称",
  "Type": "类型",
  "Layout": "布局",
  "Confidence": "置信度",
  "Source": "来源",
  "Node Detail": "节点详情",
  "Children": "子节点",
  "Bounds": "边界",
  "Render": "渲染",
  "Reason": "原因",
  "Save Name": "保存名称",
  "Save Layout": "保存布局",
  "Save Render": "保存渲染",
  "Ignore Node": "忽略节点",
  "Region ID": "区域 ID",
  "Region Name": "区域名称",
  "Role": "角色",
  "Source IDs": "来源 ID",
  "Parent ID": "父级 ID",
  "Merge IDs": "合并 ID",
  "Create Region": "创建区域",
  "Split Region": "拆分区域",
  "Move Node": "移动节点",
  "Merge Regions": "合并区域",
  "Select a tree row.": "请选择一个结构树节点。",
  "Component Studio": "组件工作台",
  "Create / Review Component": "创建/审查组件",
  "manual": "手动",
  "Instances": "实例",
  "Token Studio": "Token 工作台",
  "Asset Studio": "资源工作台",
  "Asset Name": "资源名称",
  "Current": "当前",
  "Write Strategy": "写入策略",
  "Path": "路径",
  "Format": "格式",
  "Scale": "缩放",
  "Crop JSON": "裁剪 JSON",
  "Exclude Text": "排除文本",
  "Action": "操作",
  "i18n Studio": "文案工作台",
  "Preview & Diff": "预览与差异",
  "Web Preview": "Web 预览",
  "Flutter Preview": "Flutter 预览",
  "Codegen Review": "代码生成审查",
  "Write Control": "写入控制",
  "Project Path": "项目路径",
  "Write files": "写入文件",
  "Dry Run": "试运行",
  "Write": "写入",
  "Gate Blockers": "门禁阻塞项",
  "Incremental Sync": "增量同步",
  "Token Migration": "Token 迁移",
  "Files To Create": "待创建文件",
  "Files To Modify": "待修改文件",
  "Assets To Add": "待添加资源",
  "ARB Changes": "ARB 变更",
  "Pubspec Patch": "Pubspec 补丁",
  "Merge Report": "合并报告",
  "Generated Widgets": "生成的 Widget",
  "Fallback Regions": "兜底区域",
  "Unresolved Review Tasks": "未解决审查任务",
  "Manual Overrides": "人工覆盖",
  "Settings": "设置",
  "Artifact Root": "产物根目录",
  "Loaded JSON": "已加载 JSON",
  "Last Studio Action": "最近一次 Studio 操作",
  "Component": "组件"
};

void loadFromArtifactRoot(initialArtifactRoot);

function renderShell(content: string): string {
  const model = state.model;
  const title = model?.project.frameName ?? "UXCompiler Workbench";
  const status = model?.project.status ?? "loading";
  const subpageTitle = navItems.find((item) => item.id === state.activeView)?.label ?? "项目";
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
      <main class="content">
        ${
          state.activeView === "dashboard"
            ? ""
            : `
              <section class="subpage-bar">
                <button class="button" data-view="dashboard">返回项目看板</button>
                <div>
                  <strong>${escapeHtml(subpageTitle)}</strong>
                  <span>${escapeHtml(model?.project.frameNodeId ?? "")}</span>
                </div>
                <nav class="subpage-tabs" aria-label="Workbench subpages">
                  ${navItems
                    .filter((item) => item.id !== "dashboard")
                    .map(
                      (item) => `
                        <button class="nav-item ${item.id === state.activeView ? "is-active" : ""}" data-view="${item.id}">
                          ${escapeHtml(item.label)}
                        </button>
                      `
                    )
                    .join("")}
                </nav>
              </section>
            `
        }
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
    case "elements":
      return renderElements(model);
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
  const report = state.projectPages;
  const pages = report?.pages ?? [
    {
      name: pageNameFromArtifactRoot(state.artifactRoot),
      artifactRoot: state.artifactRoot,
      current: true,
      status: model.project.status,
      frameName: model.project.frameName,
      frameNodeId: model.project.frameNodeId,
      viewport: model.viewport
    }
  ];
  const selectedPage = pages.find((page) => page.name === state.selectedCanvasPage) ?? pages.find((page) => page.current) ?? pages[0];
  const links = report?.prototypeFlow.links ?? [];
  return `
    ${state.actionMessage ? `<section class="notice notice--${state.actionMessage.tone}">${escapeHtml(state.actionMessage.text)}</section>` : ""}
    <section class="home-canvas-shell">
      <div class="home-toolbar">
        <div>
          <h1>项目画布</h1>
          <p>${escapeHtml(report?.projectName ?? "当前项目")} · ${pages.length} 个页面</p>
        </div>
        <label class="project-picker">
          <span>项目</span>
          <select class="studio-input codegen-input" data-project-selector ${state.projectList && state.projectList.projects.length > 1 ? "" : "disabled"}>
            ${(state.projectList?.projects ?? [{ name: report?.projectName ?? "当前项目", artifactRoot: state.artifactRoot, pageCount: pages.length, current: true }])
              .map(
                (project) => `
                  <option value="${escapeAttr(project.artifactRoot)}" ${project.current ? "selected" : ""}>
                    ${escapeHtml(project.name)} (${project.pageCount})
                  </option>
                `
              )
              .join("")}
          </select>
        </label>
        <div class="home-actions">
          <button class="button" data-view="settings">设置资源</button>
          <button class="button button--primary" data-view="elements">项目元素</button>
        </div>
      </div>
      <div class="infinite-canvas-layout">
        <div class="infinite-canvas" data-canvas>
          <div class="canvas-plane" style="width:${canvasWidth(pages)}px;height:${canvasHeight(pages)}px;">
            ${renderCanvasPrototypeLinks(pages, links)}
            ${pages.map((page, index) => renderCanvasPageNode(page, index, selectedPage?.name === page.name)).join("")}
          </div>
        </div>
        <article class="canvas-page-inspector">
          ${selectedPage ? renderCanvasPageInspector(selectedPage, pages, links) : renderEmpty("请选择一个页面。")}
        </article>
      </div>
    </section>
  `;
}

function renderCanvasPageNode(page: ProjectPageEntry, index: number, selected: boolean): string {
  const position = canvasNodePosition(index);
  const viewport = page.viewport ? `${page.viewport.width}x${page.viewport.height}` : "-";
  return `
    <button
      class="canvas-page-node ${selected ? "is-selected" : ""}"
      data-canvas-page="${escapeAttr(page.name)}"
      style="left:${position.x}px;top:${position.y}px;"
    >
      <span class="canvas-page-thumb">
        <img src="${escapeAttr(artifactUrl(page.artifactRoot, "flutter_preview.png"))}" alt="" />
      </span>
      <strong>${escapeHtml(page.name)}</strong>
      <span>${escapeHtml(page.frameName ?? page.frameNodeId ?? "设计稿页面")}</span>
      <small>${escapeHtml(page.status ?? "unknown")} · ${escapeHtml(viewport)}</small>
    </button>
  `;
}

function renderCanvasPrototypeLinks(pages: ProjectPageEntry[], links: PrototypeLink[]): string {
  const pageIndex = new Map(pages.map((page, index) => [page.name, index]));
  const lines = links
    .map((link) => {
      const fromIndex = pageIndex.get(link.fromPage);
      const toIndex = pageIndex.get(link.toPage);
      if (fromIndex === undefined || toIndex === undefined) return "";
      const from = canvasNodePosition(fromIndex);
      const to = canvasNodePosition(toIndex);
      const x1 = from.x + 260;
      const y1 = from.y + 82;
      const x2 = to.x;
      const y2 = to.y + 82;
      const mid = Math.max(70, Math.abs(x2 - x1) / 2);
      return `<path class="prototype-canvas-link" d="M ${x1} ${y1} C ${x1 + mid} ${y1}, ${x2 - mid} ${y2}, ${x2} ${y2}" marker-end="url(#arrow)" />`;
    })
    .join("");
  return `
    <svg class="prototype-canvas-links" width="${canvasWidth(pages)}" height="${canvasHeight(pages)}" aria-hidden="true">
      <defs>
        <marker id="arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
          <path d="M0,0 L0,6 L9,3 z" fill="#1769e0" />
        </marker>
      </defs>
      ${lines}
    </svg>
  `;
}

function renderCanvasPageInspector(page: ProjectPageEntry, pages: ProjectPageEntry[], links: PrototypeLink[]): string {
  const outgoingLinks = links.filter((link) => link.fromPage === page.name);
  const incomingLinks = links.filter((link) => link.toPage === page.name);
  const targets = pages.filter((candidate) => candidate.name !== page.name);
  return `
    <div class="canvas-inspector-header">
      <span>当前页面</span>
      <strong>${escapeHtml(page.name)}</strong>
      <small>${escapeHtml(page.frameName ?? page.frameNodeId ?? "设计稿页面")}</small>
    </div>
    <div class="canvas-page-preview">
      <img src="${escapeAttr(artifactUrl(page.artifactRoot, "flutter_preview.png"))}" alt="${escapeAttr(page.name)}" />
    </div>
    <div class="canvas-inspector-actions">
      <button class="action-button" data-edit-page="${escapeAttr(page.artifactRoot)}">编辑页面</button>
      <button class="action-button action-button--secondary" data-open-page="${escapeAttr(page.artifactRoot)}">设为审查页面</button>
    </div>
    <div class="canvas-link-form">
      <label class="codegen-field">
        <span>连接到</span>
        <select class="studio-input codegen-input" data-prototype-field="to" ${targets.length > 0 ? "" : "disabled"}>
          ${targets.map((target) => `<option value="${escapeAttr(target.name)}">${escapeHtml(target.name)}</option>`).join("")}
        </select>
      </label>
      <input type="hidden" data-prototype-field="from" value="${escapeAttr(page.name)}" />
      <label class="codegen-field">
        <span>触发方式</span>
        <input class="studio-input codegen-input" data-prototype-field="trigger" value="tap" />
      </label>
      <label class="codegen-field">
        <span>说明</span>
        <input class="studio-input codegen-input" data-prototype-field="note" placeholder="例如：点击开始按钮" />
      </label>
      <button class="action-button action-button--secondary" data-prototype-link-add ${targets.length > 0 && state.pendingPrototypeLink !== "add" ? "" : "disabled"}>
        ${escapeHtml(state.pendingPrototypeLink === "add" ? "保存中..." : "连接页面")}
      </button>
    </div>
    <div class="canvas-link-summary">
      <strong>页面连接</strong>
      ${
        outgoingLinks.length + incomingLinks.length === 0
          ? renderEmpty("还没有连接。")
          : [...outgoingLinks, ...incomingLinks]
              .map((link) => renderPrototypeLinkRow(link, true))
              .join("")
      }
    </div>
  `;
}

function canvasNodePosition(index: number): { x: number; y: number } {
  const column = index % 3;
  const row = Math.floor(index / 3);
  return {
    x: 96 + column * 340,
    y: 88 + row * 250
  };
}

function canvasWidth(pages: ProjectPageEntry[]): number {
  const columns = Math.min(Math.max(pages.length, 1), 3);
  return Math.max(1120, 96 + columns * 340 + 120);
}

function canvasHeight(pages: ProjectPageEntry[]): number {
  const rows = Math.ceil(Math.max(pages.length, 1) / 3);
  return Math.max(720, 88 + rows * 250 + 120);
}

function renderProjectPagesPanel(model: WorkbenchModel): string {
  const report = state.projectPages;
  const fallbackPageName = pageNameFromArtifactRoot(state.artifactRoot);
  const pages = report?.pages ?? [
    {
      name: fallbackPageName,
      artifactRoot: state.artifactRoot,
      current: true,
      status: model.project.status,
      frameName: model.project.frameName,
      frameNodeId: model.project.frameNodeId,
      viewport: model.viewport
    }
  ];
  const currentPage = pages.find((page) => page.current) ?? pages.find((page) => page.artifactRoot === state.artifactRoot) ?? pages[0];
  const links = report?.prototypeFlow.links ?? [];
  const canEditPrototype = Boolean(report && pages.length > 0 && state.artifactRoot !== "selected directory");
  const defaultFrom = currentPage?.name ?? pages[0]?.name ?? "";
  const defaultTo = pages.find((page) => page.name !== defaultFrom)?.name ?? pages[0]?.name ?? "";
  return `
    <section class="panel project-pages-panel">
      <div class="panel-header">
        <h2>页面与原型</h2>
        <span>${escapeHtml(report?.projectName ?? "当前页面")}</span>
      </div>
      <div class="project-pages-body">
        <div class="page-review-selector">
          <label class="codegen-field">
            <span>正在审查的页面</span>
            <select class="studio-input codegen-input" data-page-selector ${pages.length > 1 ? "" : "disabled"}>
              ${pages
                .map(
                  (page) => `
                    <option value="${escapeAttr(page.artifactRoot)}" ${page.artifactRoot === currentPage?.artifactRoot ? "selected" : ""}>
                      ${escapeHtml(page.name)}
                    </option>
                  `
                )
                .join("")}
            </select>
          </label>
          <div class="current-page-summary">
            <strong>${escapeHtml(currentPage?.name ?? fallbackPageName)}</strong>
            <span>${escapeHtml(currentPage?.frameName ?? model.project.frameName)} · ${escapeHtml(currentPage?.frameNodeId ?? model.project.frameNodeId)}</span>
          </div>
        </div>
        <div class="page-card-grid">
          ${pages.map((page) => renderProjectPageCard(page, currentPage?.artifactRoot === page.artifactRoot)).join("")}
        </div>
        <div class="prototype-builder">
          <div class="prototype-form">
            <label class="codegen-field">
              <span>从页面</span>
              <select class="studio-input codegen-input" data-prototype-field="from" ${canEditPrototype ? "" : "disabled"}>
                ${pages.map((page) => `<option value="${escapeAttr(page.name)}" ${page.name === defaultFrom ? "selected" : ""}>${escapeHtml(page.name)}</option>`).join("")}
              </select>
            </label>
            <label class="codegen-field">
              <span>到页面</span>
              <select class="studio-input codegen-input" data-prototype-field="to" ${canEditPrototype ? "" : "disabled"}>
                ${pages.map((page) => `<option value="${escapeAttr(page.name)}" ${page.name === defaultTo ? "selected" : ""}>${escapeHtml(page.name)}</option>`).join("")}
              </select>
            </label>
            <label class="codegen-field">
              <span>触发方式</span>
              <input class="studio-input codegen-input" data-prototype-field="trigger" value="tap" placeholder="tap / swipe / button" ${canEditPrototype ? "" : "disabled"} />
            </label>
            <label class="codegen-field prototype-note-field">
              <span>说明</span>
              <input class="studio-input codegen-input" data-prototype-field="note" placeholder="例如：点击开始按钮" ${canEditPrototype ? "" : "disabled"} />
            </label>
            <button class="action-button action-button--secondary" data-prototype-link-add ${canEditPrototype && state.pendingPrototypeLink !== "add" ? "" : "disabled"}>
              ${escapeHtml(state.pendingPrototypeLink === "add" ? "保存中..." : "连接页面")}
            </button>
          </div>
          <div class="prototype-map">
            <div class="prototype-node-row">
              ${pages.map((page) => `<span class="prototype-node ${page.artifactRoot === currentPage?.artifactRoot ? "is-current" : ""}">${escapeHtml(page.name)}</span>`).join("")}
            </div>
            <div class="prototype-link-list">
              ${
                links.length === 0
                  ? renderEmpty("还没有原型连接。")
                  : links.map((link) => renderPrototypeLinkRow(link, canEditPrototype)).join("")
              }
            </div>
          </div>
        </div>
      </div>
    </section>
  `;
}

function renderProjectPageCard(page: ProjectPageEntry, current: boolean): string {
  const viewport = page.viewport ? `${page.viewport.width}x${page.viewport.height}` : "-";
  return `
    <button class="page-card ${current ? "is-current" : ""}" data-open-page="${escapeAttr(page.artifactRoot)}">
      <strong>${escapeHtml(page.name)}</strong>
      <span>${escapeHtml(page.frameName ?? page.frameNodeId ?? "页面")}</span>
      <small>${escapeHtml(page.status ?? "unknown")} · ${escapeHtml(viewport)}</small>
    </button>
  `;
}

function renderPrototypeLinkRow(link: PrototypeLink, enabled: boolean): string {
  const pending = state.pendingPrototypeLink === link.id;
  return `
    <div class="prototype-link-row">
      <strong>${escapeHtml(link.fromPage)}</strong>
      <span>${escapeHtml(link.trigger ?? "tap")}</span>
      <strong>${escapeHtml(link.toPage)}</strong>
      <em>${escapeHtml(link.note ?? "")}</em>
      <button class="table-action table-action--danger" data-prototype-link-delete="${escapeAttr(link.id)}" ${enabled && !pending ? "" : "disabled"}>
        ${escapeHtml(pending ? "删除中..." : "删除")}
      </button>
    </div>
  `;
}

function renderTasks(_model: WorkbenchModel): string {
  const tasks = asArray(state.artifacts.reviewTasks).map(asRecord);
  const canApplyActions = state.artifactRoot !== "selected directory";
  return `
    <section class="view-header">
      <div>
        <h1>审查任务</h1>
        <p>已加载 ${tasks.length} 个任务，请优先处理 P0/P1。</p>
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
                const summary = describeReviewTask(task);
                const taskId = stringFrom(task.id) ?? "";
                const target = asRecord(task.target);
                const sourceNodeIds = asArray(target.sourceNodeIds)
                  .map((entry) => stringFrom(entry))
                  .filter((entry): entry is string => Boolean(entry));
                const actions = asArray(task.suggestedActions).map(asRecord);
                return `
                  <article class="task-item">
                    <div class="task-priority ${priority.toLowerCase()}" title="${escapeAttr(priorityDescription(priority))}">${escapeHtml(priority)}</div>
                    <div class="task-body">
                      <div class="task-title">${escapeHtml(summary.title)}</div>
                      <p>${escapeHtml(summary.description)}</p>
                      ${summary.nextStep ? `<p class="task-next-step"><strong>建议：</strong>${escapeHtml(summary.nextStep)}</p>` : ""}
                      <div class="tag-row">
                        <span>${escapeHtml(reviewTaskTypeLabel(stringFrom(task.type)))}</span>
                        <span>${escapeHtml(reviewTaskStatusLabel(stringFrom(task.status)))}</span>
                        <span>${escapeHtml(priorityDescription(priority))}</span>
                        <span>${formatConfidence(numberFrom(task.confidence))}</span>
                        ${sourceNodeIds.map((id) => `<button class="mini-link" data-node-id="${escapeAttr(id)}">${escapeHtml(id)}</button>`).join("")}
                      </div>
                    </div>
                    <div class="task-actions">
                      ${
                        actions.length === 0
                          ? `<span>无建议操作</span>`
                          : actions
                              .map((action, index) => {
                                const actionKey = `${taskId}:${index}`;
                                const isPending = state.pendingAction === actionKey;
                                const label = reviewTaskActionLabel(stringFrom(action.label), index);
                                return `
                                  <button
                                    class="action-button"
                                    data-task-action="${escapeAttr(taskId)}"
                                    data-action-index="${index}"
                                    ${canApplyActions && !isPending ? "" : "disabled"}
                                  >
                                    ${escapeHtml(isPending ? "正在应用..." : label)}
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

function renderElements(_model: WorkbenchModel): string {
  const active = state.elementsTab ?? "tokens";
  const report = state.projectElements;
  const pageCount = report?.pages.length ?? state.projectPages?.pages.length ?? 1;
  return `
    <section class="view-header">
      <div>
        <h1>项目元素</h1>
        <p>${escapeHtml(report?.projectName ?? "当前项目")} · ${pageCount} 个页面 · 项目级汇总</p>
      </div>
      <div class="element-tabbar" role="tablist" aria-label="项目元素">
        ${renderElementTab("tokens", "设计 Token", active)}
        ${renderElementTab("components", "组件", active)}
        ${renderElementTab("assets", "图片资源", active)}
        ${renderElementTab("docs", "文档", active)}
      </div>
    </section>
    <section class="element-tab-panel">
      ${renderProjectElementTabContent(report, active)}
    </section>
  `;
}

function renderElementTab(tab: ElementTab, label: string, active: ElementTab): string {
  return `<button class="${tab === active ? "is-active" : ""}" data-element-tab="${tab}">${escapeHtml(label)}</button>`;
}

function renderProjectElementTabContent(report: ProjectElementsReport | undefined, active: ElementTab): string {
  if (!report) return renderEmpty("暂无项目级元素数据。请使用本地服务打开项目产物目录。");
  if (active === "tokens") {
    return renderProjectElementTable("设计 Token", report.tokens, ["pageName", "type", "name", "value"], ["页面", "类型", "名称", "值"]);
  }
  if (active === "components") {
    return renderProjectElementTable("组件", report.components, ["pageName", "name", "id", "source"], ["页面", "名称", "ID", "来源"]);
  }
  if (active === "assets") {
    return renderProjectElementTable("图片资源", report.assets, ["pageName", "name", "strategy", "path"], ["页面", "名称", "策略", "路径"]);
  }
  return renderProjectElementTable("文档", report.docs, ["pageName", "key", "value", "source"], ["页面", "Key", "文案/文件", "来源"]);
}

function renderProjectElementTable(
  title: string,
  entries: ProjectElementEntry[],
  keys: Array<keyof ProjectElementEntry>,
  labels: string[]
): string {
  return `
    <section class="panel table-panel project-element-panel">
      <div class="panel-header">
        <h2>${escapeHtml(title)}</h2>
        <span>${entries.length} 条 · 项目级</span>
      </div>
      ${
        entries.length === 0
          ? renderEmpty("暂无项目级元素。")
          : `
            <table class="data-table">
              <thead>
                <tr>${labels.map((label) => `<th>${escapeHtml(label)}</th>`).join("")}</tr>
              </thead>
              <tbody>
                ${entries
                  .slice(0, 120)
                  .map(
                    (entry) => `
                      <tr>
                        ${keys.map((key) => `<td>${escapeHtml(projectElementValue(entry[key]))}</td>`).join("")}
                      </tr>
                    `
                  )
                  .join("")}
              </tbody>
            </table>
            ${entries.length > 120 ? `<p class="table-note">已显示前 120 条。</p>` : ""}
          `
      }
    </section>
  `;
}

function describeReviewTask(task: JsonRecord): { title: string; description: string; nextStep?: string } {
  const type = stringFrom(task.type);
  const title = stringFrom(task.title) ?? stringFrom(task.id) ?? "审查任务";
  const description = stringFrom(task.description) ?? "";
  const target = asRecord(task.target);
  const evidence = asRecord(task.evidence);
  const nodeId = firstString(asArray(target.sourceNodeIds)) ?? stringFrom(target.normalizedNodeId) ?? stringFrom(evidence.sourceNodeId);

  switch (type) {
    case "resource_export_failed":
      return {
        title: "资源导出需要处理",
        description: nodeId ? `节点 ${nodeId} 的图片/切片资源没有可用导出，预览或代码生成可能会使用占位内容。` : "有资源没有成功导出，预览或代码生成可能会使用占位内容。",
        nextStep: description.includes("contains visible Text")
          ? "确认切片里的文字是否必须保持可编辑；如果只是装饰图，可以选择保留资源策略。"
          : "在资源页确认导出策略，或使用建议操作强制生成切片资源。"
      };
    case "asset_strategy_uncertain":
      return {
        title: "资源策略需要确认",
        description: nodeId ? `节点 ${nodeId} 的资源处理方式还不确定。` : "有资源处理方式还不确定。",
        nextStep: description.includes("full-frame screenshot")
          ? "如果当前只需要视觉还原，可以保留整帧截图；如果要生成可编辑代码，请切换到可编辑结构。"
          : "确认它应该是图片资源、装饰切片、真实文本，还是忽略。"
      };
    case "font_missing":
      return {
        title: "字体映射缺失",
        description: "当前设计里的字体还没有可靠映射，文字还原可能不准确。",
        nextStep: "配置项目字体映射，让预览和生成代码使用正确字体。"
      };
    case "low_confidence_layout":
      return {
        title: "布局判断置信度较低",
        description: nodeId ? `节点 ${nodeId} 的布局方向或定位策略不够确定。` : "有节点的布局方向或定位策略不够确定。",
        nextStep: "在结构树里确认它应该是横向、纵向、绝对定位或其他布局。"
      };
    case "component_mapping_required":
      return {
        title: "组件需要映射到 Flutter",
        description: "已确认的组件还没有完整的 Flutter import 和构造函数映射。",
        nextStep: "在组件页补齐 Flutter 组件映射，或者使用本任务的建议操作。"
      };
    case "component_candidate":
      return {
        title: "发现可复用组件候选",
        description: "系统发现一组相似节点，可能可以抽成可复用组件。",
        nextStep: "确认是否应该创建组件；不确定时先查看组件页的实例列表。"
      };
    case "token_conflict":
      return {
        title: "Token 需要确认",
        description: stringFrom(target.tokenName) ? `Token ${stringFrom(target.tokenName)} 的置信度较低。` : "有设计 Token 的置信度较低。",
        nextStep: "在 Token 页确认命名、合并或保留策略。"
      };
    case "i18n_key_uncertain":
      return {
        title: "文案 Key 需要确认",
        description: "有文案的 i18n key 还不够确定。",
        nextStep: "在文案页确认 key、描述、占位符或是否需要翻译。"
      };
    case "stale_override":
      return {
        title: "人工覆盖已过期",
        description: "之前保存的人工覆盖无法稳定匹配到当前节点。",
        nextStep: "在增量同步或对应 Studio 页面重新确认覆盖关系。"
      };
    case "visual_diff_failed":
      return {
        title: "视觉对比未通过",
        description: nodeId ? `节点 ${nodeId} 或整页预览和 Figma 存在明显差异。` : "页面预览和 Figma 存在明显差异。",
        nextStep: "先查看预览页的差异区域；必要时应用修复、切片或校准文本。"
      };
    case "semantic_uplift_pending":
      return {
        title: "可尝试语义化结构优化",
        description: "当前区域可以尝试更语义化的布局，但需要用前后视觉对比证明不破坏还原度。",
        nextStep: "想提升代码可读性时运行 uplift diff；只追求还原时可以保留 fidelity 结构。"
      };
    case "flutter_capture_failed":
      return {
        title: "Flutter 预览截图失败",
        description: description || "Flutter 预览截图没有成功生成。",
        nextStep: "检查 Flutter 环境、依赖和预览工程，再重新运行。"
      };
    default:
      return {
        title: translateReviewTaskTitle(title),
        description: translateReviewTaskDescription(description) || description || "该任务需要人工确认后才能继续。",
        nextStep: "查看任务详情和建议操作，确认后再继续生成或同步。"
      };
  }
}

function reviewTaskTypeLabel(type: string | undefined): string {
  const labels: Record<string, string> = {
    low_confidence_layout: "布局置信度低",
    component_candidate: "组件候选",
    component_mapping_required: "组件映射",
    resource_export_failed: "资源导出",
    asset_strategy_uncertain: "资源策略",
    font_missing: "字体映射",
    token_conflict: "Token 确认",
    i18n_key_uncertain: "文案确认",
    stale_override: "过期覆盖",
    visual_diff_failed: "视觉差异",
    semantic_uplift_pending: "语义优化",
    flutter_capture_failed: "Flutter 截图"
  };
  return type ? (labels[type] ?? type) : "未知类型";
}

function reviewTaskStatusLabel(status: string | undefined): string {
  const labels: Record<string, string> = {
    open: "待处理",
    resolved: "已处理",
    closed: "已关闭",
    ignored: "已忽略"
  };
  return status ? (labels[status] ?? status) : "待处理";
}

function priorityDescription(priority: string): string {
  if (priority === "P0") return "阻塞生成";
  if (priority === "P1") return "需要优先确认";
  if (priority === "P2") return "建议优化";
  return "待确认";
}

function reviewTaskActionLabel(label: string | undefined, index: number): string {
  const labels: Record<string, string> = {
    "Keep generated asset strategy": "保留当前资源策略",
    "Force decorative slice export": "强制导出装饰切片",
    "Configure font mapping": "配置字体映射",
    "Keep frame screenshot fallback": "保留整帧截图",
    "Use editable fidelity tree": "使用可编辑结构",
    "Force absolute": "设为绝对定位",
    "Force column": "设为纵向布局",
    "Force row": "设为横向布局",
    "Run uplift diff": "运行语义优化对比",
    "Keep fidelity for region": "保留高保真结构",
    "Keep token": "保留 Token",
    "Map Flutter component": "映射 Flutter 组件",
    "Keep blocked": "保持阻塞",
    "Apply text calibration": "应用文字校准",
    "Accept low visual score": "接受当前视觉分数",
    "Use asset slice": "改用资源切片"
  };
  return label ? (labels[label] ?? label) : `操作 ${index + 1}`;
}

function translateReviewTaskTitle(title: string): string {
  const labels: Record<string, string> = {
    "Review low-confidence layout strategy": "检查低置信度布局策略",
    "Review inferred component candidate": "检查组件候选",
    "Map approved component to Flutter": "把已确认组件映射到 Flutter",
    "Resolve blocking asset strategy": "处理阻塞的资源策略",
    "Confirm asset strategy": "确认资源策略",
    "Export missing render asset": "导出缺失的渲染资源",
    "Replace full-frame screenshot fallback when ready": "准备好后替换整帧截图兜底",
    "Review fidelity warning": "检查高保真预览警告",
    "Map missing text font": "映射缺失字体",
    "Review low-confidence token": "检查低置信度 Token",
    "Review low-confidence i18n key": "检查低置信度文案 Key",
    "Review stale override": "检查过期人工覆盖",
    "Resolve failing visual diff before codegen": "代码生成前处理视觉差异",
    "Review visual diff region": "检查视觉差异区域",
    "Review semantic uplift candidate": "检查语义优化候选",
    "Run semantic uplift diff candidate": "运行语义优化对比候选",
    "Fix Flutter preview capture failure": "修复 Flutter 预览截图失败"
  };
  return labels[title] ?? title;
}

function translateReviewTaskDescription(description: string): string {
  if (!description) return "";
  if (description.includes("No concrete exported asset is available")) return "缺少可用的导出资源，预览会先显示占位内容。";
  if (description.includes("No typography samples were discovered")) return "没有发现可用的字体样本，需要先配置字体映射。";
  if (description.includes("The preview is visually exact because it uses the exported Figma frame screenshot")) {
    return "当前预览依赖整帧截图，所以视觉还原准确，但还不是可编辑的生产代码结构。";
  }
  if (description.includes("does not have a complete Flutter import and constructor mapping")) return "该组件缺少 Flutter import 和构造函数映射。";
  if (description.includes("fidelity remains authoritative")) return "可以尝试更语义化结构，但必须先通过视觉对比验证。";
  return description;
}

function firstString(values: unknown[]): string | undefined {
  for (const value of values) {
    const entry = stringFrom(value);
    if (entry) return entry;
  }
  return undefined;
}

function renderTree(model: WorkbenchModel): string {
  const selected = selectedTreeRow(model);
  const canApplyTreeEdit = state.artifactRoot !== "selected directory" && !!selected && selected.depth > 0;
  const defaultRegionId = selected ? `region_${safeId(selected.name || selected.id)}` : "region_reviewed";
  const defaultRegionName = selected ? `${pascalCase(selected.name)}Region` : "ReviewedRegion";
  const defaultSourceNodeIds = selected?.sourceNodeIds.join(", ") ?? "";
  const siblingRegionIds = selected ? model.treeRows.filter((row) => row.depth === selected.depth && row.id !== selected.id && row.type === "region").map((row) => row.id) : [];
  const defaultMergeRegionIds = selected ? [selected.id, siblingRegionIds[0]].filter(Boolean).join(", ") : "";
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
                <div class="tree-editor-form tree-editor-form--advanced">
                  <label>
                    <span>Region ID</span>
                    <input class="tree-input" data-tree-field="region-id" value="${escapeAttr(defaultRegionId)}" ${canApplyTreeEdit ? "" : "disabled"} />
                  </label>
                  <label>
                    <span>Region Name</span>
                    <input class="tree-input" data-tree-field="region-name" value="${escapeAttr(defaultRegionName)}" ${canApplyTreeEdit ? "" : "disabled"} />
                  </label>
                  <label>
                    <span>Role</span>
                    <input class="tree-input" data-tree-field="region-role" value="content" ${canApplyTreeEdit ? "" : "disabled"} />
                  </label>
                  <label>
                    <span>Source IDs</span>
                    <input class="tree-input" data-tree-field="source-node-ids" value="${escapeAttr(defaultSourceNodeIds)}" placeholder="1:3, 1:4" ${canApplyTreeEdit ? "" : "disabled"} />
                  </label>
                  <label>
                    <span>Parent ID</span>
                    <input class="tree-input" data-tree-field="target-parent-id" value="${escapeAttr(selected?.id ?? "")}" ${canApplyTreeEdit ? "" : "disabled"} />
                  </label>
                  <label>
                    <span>Merge IDs</span>
                    <input class="tree-input" data-tree-field="merge-region-ids" value="${escapeAttr(defaultMergeRegionIds)}" placeholder="region_a, region_b" ${canApplyTreeEdit ? "" : "disabled"} />
                  </label>
                  <div class="tree-editor-actions">
                    ${renderTreeActionButton("create-region", "Create Region", canApplyTreeEdit)}
                    ${renderTreeActionButton("split-region", "Split Region", canApplyTreeEdit)}
                    ${renderTreeActionButton("move-node", "Move Node", canApplyTreeEdit)}
                    ${renderTreeActionButton("merge-regions", "Merge Regions", canApplyTreeEdit)}
                  </div>
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
  const selected = selectedTreeRow(model);
  const selectedSources = selected?.sourceNodeIds.length ? selected.sourceNodeIds.join(", ") : "";
  const defaultComponentId = selected ? `cmp_${safeId(selected.name || selected.id)}` : "cmp_reviewed_component";
  const defaultComponentName = pascalCase(selected?.name ?? "ReviewedComponent");
  const canApplyStudio = state.artifactRoot !== "selected directory";
  const createPending = state.pendingStudioOperation === "approve_component:create";
  const rejectPending = state.pendingStudioOperation === "reject_component:create";
  return `
    <section class="view-header">
      <div>
        <h1>Component Studio</h1>
        <p>${model.componentCount} components</p>
      </div>
    </section>
    ${state.actionMessage ? `<section class="notice notice--${state.actionMessage.tone}">${escapeHtml(state.actionMessage.text)}</section>` : ""}
    ${renderStudioRollbackPanel(canApplyStudio)}
    <section class="panel">
      <div class="panel-header">
        <h2>Create / Review Component</h2>
        <span>${selected ? escapeHtml(selected.name) : "manual"}</span>
      </div>
      <div class="component-create-grid" data-studio-row>
        <label>
          <span>ID</span>
          <input class="studio-input studio-input--wide" data-studio-field="component-id" value="${escapeAttr(defaultComponentId)}" ${canApplyStudio ? "" : "disabled"} />
        </label>
        <label>
          <span>Name</span>
          <input class="studio-input studio-input--wide" data-studio-field="component-name" value="${escapeAttr(defaultComponentName)}" ${canApplyStudio ? "" : "disabled"} />
        </label>
        <label class="component-field--wide">
          <span>Instances</span>
          <input class="studio-input studio-input--wide" data-studio-field="component-instances" value="${escapeAttr(selectedSources)}" placeholder="1:12, 1:13" ${canApplyStudio ? "" : "disabled"} />
        </label>
        <label class="checkbox-row">
          <input type="checkbox" data-studio-field="component-allow-single" ${canApplyStudio ? "" : "disabled"} />
          <span>Allow single-use</span>
        </label>
        <div class="component-actions">
          <button
            class="table-action"
            data-studio-operation="approve_component"
            data-studio-key="approve_component:create"
            ${canApplyStudio && !createPending ? "" : "disabled"}
          >
            ${escapeHtml(createPending ? "Saving..." : "Approve")}
          </button>
          <button
            class="table-action table-action--danger"
            data-studio-operation="reject_component"
            data-studio-key="reject_component:create"
            ${canApplyStudio && !rejectPending ? "" : "disabled"}
          >
            ${escapeHtml(rejectPending ? "Saving..." : "Reject")}
          </button>
        </div>
      </div>
    </section>
    <section class="component-list">
      ${
        components.length === 0
          ? renderEmpty("No component registry entries are present yet.")
          : components.map((component) => renderComponentEditor(component, canApplyStudio)).join("")
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
    ${renderStudioRollbackPanel(canApplyStudio)}
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
              ${renderTokenGroupActions(entries, group, canApplyStudio)}
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
    ${renderStudioRollbackPanel(canApplyStudio)}
    <section class="panel table-panel">
      <table class="data-table">
        <thead><tr><th>ID</th><th>Source</th><th>Asset Name</th><th>Current</th><th>Write Strategy</th><th>Path</th><th>Format</th><th>Scale</th><th>Crop JSON</th><th>Exclude Text</th><th>Confidence</th><th>Action</th></tr></thead>
        <tbody>
          ${assets
            .map(
              (asset) => {
                const assetId = stringFrom(asset.id) ?? "";
                const sourceNodeId = stringFrom(asset.sourceNodeId) ?? "";
                const currentStrategy = stringFrom(asset.strategy) ?? "";
                const defaultStrategy = assetStrategyOptions.includes(currentStrategy) ? currentStrategy : "image_asset";
                const format = stringFrom(asset.format) ?? "";
                const scale = numberFrom(asset.scale) ?? 1;
                const cropBounds = asRecord(asset.cropBounds);
                const cropValue = Object.keys(cropBounds).length > 0 ? JSON.stringify(cropBounds) : "";
                const excludeTextNodes = asset.excludeTextNodes === true;
                const pendingKey = `set_asset_strategy:${assetId || sourceNodeId}`;
                const isPending = state.pendingStudioOperation === pendingKey;
                return `
                <tr data-node-id="${escapeAttr(sourceNodeId)}" data-studio-row>
                  <td>${escapeHtml(stringFrom(asset.id) ?? "-")}</td>
                  <td>${escapeHtml(stringFrom(asset.sourceName) ?? stringFrom(asset.sourceNodeId) ?? "-")}</td>
                  <td><input class="studio-input studio-input--wide" data-studio-field="asset-source-name" value="${escapeAttr(stringFrom(asset.sourceName) ?? "")}" ${canApplyStudio ? "" : "disabled"} /></td>
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
                  <td><input class="studio-input studio-input--small" type="number" min="0.01" max="4" step="0.25" data-studio-field="asset-scale" value="${escapeAttr(String(scale))}" ${canApplyStudio ? "" : "disabled"} /></td>
                  <td><input class="studio-input studio-input--wide" data-studio-field="asset-crop" value="${escapeAttr(cropValue)}" placeholder='{"x":0,"y":0,"w":24,"h":24}' ${canApplyStudio ? "" : "disabled"} /></td>
                  <td>
                    <label class="checkbox-row checkbox-row--compact">
                      <input type="checkbox" data-studio-field="asset-exclude-text" ${excludeTextNodes ? "checked" : ""} ${canApplyStudio ? "" : "disabled"} />
                      <span>Text</span>
                    </label>
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
    ${renderStudioRollbackPanel(canApplyStudio)}
    <section class="panel table-panel">
      <table class="data-table">
        <thead><tr><th>Key</th><th>Description</th><th>Value</th><th>Source</th><th>Confidence</th><th>Placeholder</th><th>Merge Into</th><th>Non-i18n Reason</th><th>Action</th></tr></thead>
        <tbody>
          ${messages
            .map(
              (message) => {
                const key = stringFrom(message.key) ?? "";
                const sourceNodeId = stringFrom(message.sourceNodeId) ?? "";
                const pendingKey = `rename_i18n_key:${sourceNodeId || key}`;
                const isPending = state.pendingStudioOperation === pendingKey;
                const acceptPendingKey = `accept_i18n_key:${sourceNodeId || key}`;
                const isAcceptPending = state.pendingStudioOperation === acceptPendingKey;
                const nonI18nPendingKey = `mark_non_i18n:${sourceNodeId || key}`;
                const isNonI18nPending = state.pendingStudioOperation === nonI18nPendingKey;
                const placeholderPendingKey = `define_i18n_placeholder:${sourceNodeId || key}`;
                const isPlaceholderPending = state.pendingStudioOperation === placeholderPendingKey;
                const mergePendingKey = `merge_i18n_messages:${sourceNodeId || key}`;
                const isMergePending = state.pendingStudioOperation === mergePendingKey;
                return `
                <tr data-node-id="${escapeAttr(sourceNodeId)}" data-studio-row>
                  <td><input class="studio-input studio-input--wide" data-studio-field="i18n-key" value="${escapeAttr(key)}" ${canApplyStudio ? "" : "disabled"} /></td>
                  <td><input class="studio-input studio-input--wide" data-studio-field="i18n-description" value="${escapeAttr(stringFrom(message.description) ?? "")}" ${canApplyStudio ? "" : "disabled"} /></td>
                  <td>${escapeHtml(stringFrom(message.value) ?? "-")}</td>
                  <td>${escapeHtml(stringFrom(message.sourceNodeId) ?? "-")}</td>
                  <td>${formatConfidence(numberFrom(message.confidence))}</td>
                  <td>
                    <input class="studio-input studio-input--wide" data-studio-field="i18n-placeholder-name" value="value" ${canApplyStudio ? "" : "disabled"} />
                    <input class="studio-input studio-input--wide" data-studio-field="i18n-placeholder-type" value="String" ${canApplyStudio ? "" : "disabled"} />
                    <input class="studio-input studio-input--wide" data-studio-field="i18n-placeholder-example" value="${escapeAttr(stringFrom(message.value) ?? "")}" ${canApplyStudio ? "" : "disabled"} />
                  </td>
                  <td><input class="studio-input studio-input--wide" data-studio-field="i18n-merge-target" value="" ${canApplyStudio ? "" : "disabled"} /></td>
                  <td><input class="studio-input studio-input--wide" data-studio-field="i18n-non-reason" value="Reviewed as non-translatable copy." ${canApplyStudio ? "" : "disabled"} /></td>
                  <td>
                    <button
                      class="table-action"
                      data-studio-operation="rename_i18n_key"
                      data-studio-key="${escapeAttr(pendingKey)}"
                      data-message-key="${escapeAttr(key)}"
                      data-source-node-id="${escapeAttr(sourceNodeId)}"
                      ${canApplyStudio && !isPending ? "" : "disabled"}
                    >
                      ${escapeHtml(isPending ? "Saving..." : "Save")}
                    </button>
                    <button
                      class="table-action"
                      data-studio-operation="accept_i18n_key"
                      data-studio-key="${escapeAttr(acceptPendingKey)}"
                      data-message-key="${escapeAttr(key)}"
                      data-source-node-id="${escapeAttr(sourceNodeId)}"
                      ${canApplyStudio && !isAcceptPending ? "" : "disabled"}
                    >
                      ${escapeHtml(isAcceptPending ? "Saving..." : "Accept")}
                    </button>
                    <button
                      class="table-action table-action--danger"
                      data-studio-operation="mark_non_i18n"
                      data-studio-key="${escapeAttr(nonI18nPendingKey)}"
                      data-message-key="${escapeAttr(key)}"
                      data-source-node-id="${escapeAttr(sourceNodeId)}"
                      ${canApplyStudio && !isNonI18nPending ? "" : "disabled"}
                    >
                      ${escapeHtml(isNonI18nPending ? "Saving..." : "Non-i18n")}
                    </button>
                    <button
                      class="table-action"
                      data-studio-operation="define_i18n_placeholder"
                      data-studio-key="${escapeAttr(placeholderPendingKey)}"
                      data-message-key="${escapeAttr(key)}"
                      data-source-node-id="${escapeAttr(sourceNodeId)}"
                      ${canApplyStudio && !isPlaceholderPending ? "" : "disabled"}
                    >
                      ${escapeHtml(isPlaceholderPending ? "Saving..." : "Placeholder")}
                    </button>
                    <button
                      class="table-action"
                      data-studio-operation="merge_i18n_messages"
                      data-studio-key="${escapeAttr(mergePendingKey)}"
                      data-message-key="${escapeAttr(key)}"
                      data-source-node-id="${escapeAttr(sourceNodeId)}"
                      ${canApplyStudio && !isMergePending ? "" : "disabled"}
                    >
                      ${escapeHtml(isMergePending ? "Saving..." : "Merge")}
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
  const visualPreview = state.artifacts.webPreviewState
    ? renderWebPreviewState(state.artifacts.webPreviewState)
    : renderVisualScene(state.artifacts.visualIR);
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
        <p>${model.visualNodes.length} visual nodes · ${model.preview.hasWebPreviewState ? "web state loaded" : "web state pending"} · ${model.preview.hasDiffReport ? "diff loaded" : "diff pending"}</p>
      </div>
      <div class="segmented-control">
        ${renderModeButton("side-by-side", "Side")}
        ${renderModeButton("overlay", "Overlay")}
        ${renderModeButton("heatmap", "Heatmap")}
        ${renderModeButton("difference", "Issues")}
      </div>
    </section>
    ${state.actionMessage ? `<section class="notice notice--${state.actionMessage.tone}">${escapeHtml(state.actionMessage.text)}</section>` : ""}
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
  const format = asRecord(review.format);
  const analyze = asRecord(review.analyze);
  const blockers = asArray(gates.blockers).map(asRecord);
  const createFiles = asArray(review.filesToCreate);
  const modifyFiles = asArray(review.filesToModify);
  const assetsToAdd = asArray(state.artifacts.assetsToAdd ?? review.assetsToAdd).map(asRecord);
  const arbPatch = asRecord(state.artifacts.arbPatch);
  const arbKeysToAdd = asArray(arbPatch.keysToAdd).map(asRecord);
  const arbKeysToModify = asArray(arbPatch.keysToModify).map(asRecord);
  const pubspecPatch = asRecord(state.artifacts.pubspecPatch);
  const pubspecPatchText = stringFrom(pubspecPatch.patch) ?? "";
  const mergeReport = asRecord(state.artifacts.mergeReport);
  const mergeFiles = asArray(mergeReport.files).map(asRecord);
  const mergeConflicts = asArray(mergeReport.conflicts).map(asRecord);
  const generatedWidgets = asArray(review.generatedWidgets).map(asRecord);
  const fallbackRegions = asArray(review.fallbackRegions).map(asRecord);
  const unresolvedReviewTasks = asArray(review.unresolvedReviewTasks).map(asRecord);
  const manualOverrideSummary = asRecord(review.manualOverrideSummary);
  const latestOverrides = asArray(manualOverrideSummary.latest).map(asRecord);
  const overrideTypeCounts = Object.entries(asRecord(manualOverrideSummary.byType))
    .map(([type, count]) => `${type}: ${numberFrom(count) ?? 0}`)
    .sort((left, right) => left.localeCompare(right));
  const writeReport = asRecord(state.artifacts.projectWriteReport);
  const workbenchReviewReport = asRecord(state.artifacts.workbenchCodegenReviewReport);
  const syncReport = asRecord(state.artifacts.workbenchSyncRemapReport);
  const tokenMigration = asRecord(state.artifacts.tokenMigrationReport);
  const tokenMigrationSummary = asRecord(tokenMigration.summary);
  const writeFiles = asArray(writeReport.files).map(asRecord);
  const canRunCodegen = state.artifactRoot !== "selected directory";
  const sync = asRecord(state.artifacts.nodeRemapReport);
  const visualDiffChange = asRecord(sync.visualDiffChange ?? syncReport.visualDiffChange);
  const tokenMigrationStatus = stringFrom(tokenMigration.status) ?? stringFrom(syncReport.tokenMigrationStatus) ?? "not-run";
  const tokenMigrationChanges =
    (numberFrom(tokenMigrationSummary.added) ?? 0) + (numberFrom(tokenMigrationSummary.removed) ?? 0) + (numberFrom(tokenMigrationSummary.valueChanged) ?? 0);
  const syncPending = state.pendingSyncOperation === "remap";
  return `
    <section class="view-header">
      <div>
        <h1>Codegen Review</h1>
        <p>${escapeHtml(model.codegen.status)} · ${model.codegen.filesToCreate} creates · ${model.codegen.filesToModify} modifies</p>
      </div>
      <span class="status-pill status-pill--${statusTone(model.codegen.status)}">${escapeHtml(model.codegen.status)}</span>
    </section>
    ${state.actionMessage ? `<section class="notice notice--${state.actionMessage.tone}">${escapeHtml(state.actionMessage.text)}</section>` : ""}
    <section class="panel codegen-control-panel">
      <div class="panel-header"><h2>Write Control</h2></div>
      <div class="codegen-controls">
        <label class="codegen-field codegen-field--wide">
          <span>Project Path</span>
          <input class="studio-input codegen-input" data-codegen-field="project-path" value="${escapeAttr(state.codegenProjectPath || stringFrom(writeReport.projectPath) || stringFrom(workbenchReviewReport.projectPath) || "")}" placeholder="apps/flutter-app" ${canRunCodegen ? "" : "disabled"} />
        </label>
        <label class="codegen-toggle">
          <input type="checkbox" data-codegen-field="allow-low-visual-score" />
          <span>Low score</span>
        </label>
        <label class="codegen-toggle">
          <input type="checkbox" data-codegen-field="allow-blocked" />
          <span>Blocked gate</span>
        </label>
        <label class="codegen-toggle">
          <input type="checkbox" data-codegen-field="confirm-write" />
          <span>Write files</span>
        </label>
        ${renderCodegenButton("review", "Review", canRunCodegen)}
        ${renderCodegenButton("dry-run", "Dry Run", canRunCodegen && Boolean(state.artifacts.codegenReview))}
        ${renderCodegenButton("write", "Write", canRunCodegen && Boolean(state.artifacts.codegenReview))}
      </div>
      <div class="codegen-summary">
        <div><strong>${escapeHtml(formatMaybePercent(numberFrom(review.visualScore)))}</strong><span>Visual Score</span></div>
        <div><strong>${escapeHtml(stringFrom(writeReport.mode) ?? "not-run")}</strong><span>Mode</span></div>
        <div><strong>${escapeHtml(String(booleanFrom(writeReport.wrote) ?? false))}</strong><span>Wrote</span></div>
        <div><strong>${writeFiles.filter((file) => stringFrom(file.status) === "created" || stringFrom(file.status) === "updated").length}</strong><span>Changed</span></div>
        <div><strong>${asArray(writeReport.blockers).length}</strong><span>Blockers</span></div>
        <div><strong>${escapeHtml(stringFrom(format.status) ?? "unknown")}</strong><span>Dart Format</span></div>
        <div><strong>${numberFrom(analyze.errors) ?? 0}</strong><span>Analyze Errors</span></div>
        <div><strong>${numberFrom(analyze.warnings) ?? 0}</strong><span>Analyze Warnings</span></div>
        <div><strong>${escapeHtml(stringFrom(format.source) ?? "none")}</strong><span>Format Source</span></div>
        <div><strong>${escapeHtml(stringFrom(analyze.source) ?? "none")}</strong><span>Analyze Source</span></div>
      </div>
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
        <div class="codegen-controls codegen-controls--stacked">
          <label class="codegen-field codegen-field--wide">
            <span>New Raw Path</span>
            <input class="studio-input codegen-input" data-sync-field="new-raw-path" value="${escapeAttr(stringFrom(syncReport.newRawPath) ?? "")}" placeholder="artifacts/next/raw_figma_scene.json" ${canRunCodegen ? "" : "disabled"} />
          </label>
          <button class="action-button action-button--secondary" data-sync-operation="remap" ${canRunCodegen && !syncPending ? "" : "disabled"}>
            ${escapeHtml(syncPending ? "Syncing..." : "Sync Remap")}
          </button>
        </div>
        <div class="status-list">
          <div class="status-row"><strong>Matches</strong><span>${asArray(sync.matches).length}</span></div>
          <div class="status-row"><strong>Stale</strong><span>${asArray(sync.staleOverrides).length}</span></div>
          <div class="status-row"><strong>Review Required</strong><span>${asArray(sync.matches).map(asRecord).filter((entry) => booleanFrom(entry.reviewRequired)).length}</span></div>
          <div class="status-row"><strong>Reapplied</strong><span>${numberFrom(syncReport.reappliedOverrides) ?? 0}</span></div>
          <div class="status-row"><strong>Token Migration</strong><span>${escapeHtml(tokenMigrationStatus)}</span></div>
          <div class="status-row"><strong>Token Changes</strong><span>${tokenMigrationChanges}</span></div>
          <div class="status-row"><strong>Diff Score</strong><span>${formatMaybePercent(numberFrom(visualDiffChange.newVisualScore) ?? numberFrom(visualDiffChange.oldVisualScore))}</span></div>
          <div class="status-row"><strong>Diff Delta</strong><span>${formatSignedMaybePercent(numberFrom(visualDiffChange.visualScoreDelta)) || escapeHtml(stringFrom(visualDiffChange.status) ?? "missing")}</span></div>
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
    <section class="two-column">
      <div class="panel">
        <div class="panel-header"><h2>Assets To Add</h2></div>
        ${assetsToAdd.length === 0 ? renderEmpty("No asset additions.") : assetsToAdd.map((asset) => renderObjectCard(asset, "path", "strategy")).join("")}
      </div>
      <div class="panel">
        <div class="panel-header"><h2>ARB Changes</h2></div>
        ${renderKeyList("Add", arbKeysToAdd.map((entry) => stringFrom(entry.key)).filter((entry): entry is string => Boolean(entry)))}
        ${renderKeyList("Modify", arbKeysToModify.map((entry) => stringFrom(entry.key)).filter((entry): entry is string => Boolean(entry)))}
      </div>
    </section>
    <section class="two-column">
      <div class="panel">
        <div class="panel-header"><h2>Pubspec Patch</h2></div>
        ${pubspecPatchText ? `<pre class="code-block">${escapeHtml(pubspecPatchText)}</pre>` : renderEmpty("No pubspec asset patch.")}
      </div>
      <div class="panel">
        <div class="panel-header"><h2>Merge Report</h2></div>
        <div class="status-list">
          <div class="status-row"><strong>Files</strong><span>${mergeFiles.length}</span></div>
          <div class="status-row"><strong>Conflicts</strong><span>${mergeConflicts.length}</span></div>
        </div>
        ${mergeConflicts.length === 0 ? renderEmpty("No merge conflicts.") : mergeConflicts.map((conflict) => renderObjectCard(conflict, "path", "reason")).join("")}
      </div>
    </section>
    <section class="two-column">
      <div class="panel">
        <div class="panel-header"><h2>Generated Widgets</h2></div>
        ${generatedWidgets.length === 0 ? renderEmpty("No generated widget summary.") : generatedWidgets.map((widget) => renderObjectCard(widget, "path", "strategy")).join("")}
      </div>
      <div class="panel">
        <div class="panel-header"><h2>Fallback Regions</h2></div>
        ${fallbackRegions.length === 0 ? renderEmpty("No fallback regions.") : fallbackRegions.map((region) => renderObjectCard(region, "name", "strategy")).join("")}
      </div>
    </section>
    <section class="two-column">
      <div class="panel">
        <div class="panel-header"><h2>Unresolved Review Tasks</h2></div>
        ${unresolvedReviewTasks.length === 0 ? renderEmpty("No unresolved review tasks.") : unresolvedReviewTasks.map((task) => renderObjectCard(task, "title", "priority")).join("")}
      </div>
      <div class="panel">
        <div class="panel-header"><h2>Manual Overrides</h2></div>
        <div class="status-list">
          <div class="status-row"><strong>Active</strong><span>${numberFrom(manualOverrideSummary.active) ?? 0}</span></div>
          <div class="status-row"><strong>Disabled</strong><span>${numberFrom(manualOverrideSummary.disabled) ?? 0}</span></div>
        </div>
        ${renderKeyList("Types", overrideTypeCounts)}
        ${latestOverrides.length === 0 ? renderEmpty("No manual overrides.") : latestOverrides.map((override) => renderObjectCard(override, "id", "type")).join("")}
      </div>
    </section>
  `;
}

function renderSettings(model: WorkbenchModel): string {
  const format = asRecord(state.artifacts.flutterPreviewFormatReport);
  const capture = asRecord(state.artifacts.flutterPreviewCaptureReport);
  const conflicts = asRecord(state.artifacts.overrideConflictReport);
  const preset = projectPresetForSettings(model);
  const canSavePreset = state.artifactRoot !== "selected directory";
  const presetPending = state.pendingProjectPreset === true;
  return `
    <section class="view-header">
      <div>
        <h1>设置</h1>
        <p>${escapeHtml(state.projectPages?.projectRoot ?? model.artifactRoot)} · 项目级资源配置</p>
      </div>
    </section>
    ${state.actionMessage ? `<section class="notice notice--${state.actionMessage.tone}">${escapeHtml(state.actionMessage.text)}</section>` : ""}
    <section class="panel project-preset-panel">
      <div class="panel-header">
        <h2>项目预设资源</h2>
        <span>项目级 project_preset.json</span>
      </div>
      <div class="project-preset-grid" data-project-preset>
        <label class="codegen-field">
          <span>设计稿宽度</span>
          <input class="studio-input codegen-input" data-preset-field="design-width" type="number" min="1" step="1" value="${escapeAttr(String(preset.design.width))}" ${canSavePreset ? "" : "disabled"} />
        </label>
        <label class="codegen-field">
          <span>设计稿高度</span>
          <input class="studio-input codegen-input" data-preset-field="design-height" type="number" min="1" step="1" value="${escapeAttr(String(preset.design.height))}" ${canSavePreset ? "" : "disabled"} />
        </label>
        <label class="codegen-field">
          <span>设备倍率</span>
          <input class="studio-input codegen-input" data-preset-field="design-dpr" type="number" min="0.1" step="0.1" value="${escapeAttr(String(preset.design.dpr))}" ${canSavePreset ? "" : "disabled"} />
        </label>
        <label class="codegen-field">
          <span>默认字体</span>
          <input class="studio-input codegen-input" data-preset-field="default-font" value="${escapeAttr(preset.fonts.defaultFamily)}" placeholder="Inter" ${canSavePreset ? "" : "disabled"} />
        </label>
        <label class="codegen-field codegen-field--wide">
          <span>字体族</span>
          <input class="studio-input codegen-input" data-preset-field="font-families" value="${escapeAttr(preset.fonts.families.join(", "))}" placeholder="Inter, SF Pro Display" ${canSavePreset ? "" : "disabled"} />
        </label>
        <label class="codegen-field codegen-field--wide">
          <span>字体资源</span>
          <textarea class="studio-input studio-input--textarea codegen-input" data-preset-field="font-resources" placeholder="Inter=assets/fonts/Inter.ttf" ${canSavePreset ? "" : "disabled"}>${escapeHtml(fontResourcesText(preset.fonts.resources))}</textarea>
        </label>
        <label class="codegen-field">
          <span>资源根目录</span>
          <input class="studio-input codegen-input" data-preset-field="asset-root" value="${escapeAttr(preset.assets.root)}" ${canSavePreset ? "" : "disabled"} />
        </label>
        <label class="codegen-field">
          <span>图片目录</span>
          <input class="studio-input codegen-input" data-preset-field="asset-images" value="${escapeAttr(preset.assets.images)}" ${canSavePreset ? "" : "disabled"} />
        </label>
        <label class="codegen-field">
          <span>切片目录</span>
          <input class="studio-input codegen-input" data-preset-field="asset-slices" value="${escapeAttr(preset.assets.slices)}" ${canSavePreset ? "" : "disabled"} />
        </label>
        <label class="codegen-field">
          <span>整帧目录</span>
          <input class="studio-input codegen-input" data-preset-field="asset-frames" value="${escapeAttr(preset.assets.frames)}" ${canSavePreset ? "" : "disabled"} />
        </label>
        <label class="codegen-field project-preset-notes">
          <span>备注</span>
          <textarea class="studio-input studio-input--textarea codegen-input" data-preset-field="notes" ${canSavePreset ? "" : "disabled"}>${escapeHtml(preset.notes)}</textarea>
        </label>
        <div class="project-preset-actions">
          <button class="action-button action-button--secondary" data-project-preset-save ${canSavePreset && !presetPending ? "" : "disabled"}>
            ${escapeHtml(presetPending ? "保存中..." : "保存预设")}
          </button>
        </div>
      </div>
    </section>
    <section class="two-column">
      <div class="panel">
        <div class="panel-header"><h2>产物目录</h2></div>
        <dl class="detail-list">
          <dt>目录</dt><dd>${escapeHtml(model.artifactRoot)}</dd>
          <dt>视口</dt><dd>${model.viewport.width}x${model.viewport.height}</dd>
          <dt>画框</dt><dd>${escapeHtml(model.project.frameNodeId)}</dd>
          <dt>Dart 格式化</dt><dd>${escapeHtml(stringFrom(format.status) ?? "未加载")}</dd>
          <dt>Flutter 截图</dt><dd>${escapeHtml(stringFrom(capture.status) ?? "未加载")}</dd>
          <dt>覆盖冲突</dt><dd>${asArray(conflicts.conflicts).length}</dd>
        </dl>
      </div>
      <div class="panel">
        <div class="panel-header"><h2>已加载 JSON</h2></div>
        <div class="status-list">
          ${jsonArtifacts
            .map((spec) => {
              const loaded = Boolean(state.artifacts[spec.key]);
              return `
                <div class="status-row">
                  <span class="status-dot ${loaded ? "is-good" : "is-muted"}"></span>
                  <strong>${escapeHtml(String(spec.key))}</strong>
                  <span>${loaded ? "已加载" : "缺失"}</span>
                </div>
              `;
            })
            .join("")}
        </div>
      </div>
    </section>
  `;
}

function projectPresetForSettings(model: WorkbenchModel): ProjectPresetSettings {
  const preset = asRecord(state.projectPreset ?? state.artifacts.projectPreset);
  const design = asRecord(preset.design);
  const fonts = asRecord(preset.fonts);
  const assets = asRecord(preset.assets);
  const inferredFamilies = collectPresetFontFamilies();
  const storedFamilies = asArray(fonts.families)
    .map((entry) => stringFrom(entry))
    .filter((entry): entry is string => Boolean(entry));
  const families = uniqueStrings([...storedFamilies, ...inferredFamilies]);
  const defaultFamily = stringFrom(fonts.defaultFamily) ?? families[0] ?? "Inter";
  if (!families.includes(defaultFamily)) families.unshift(defaultFamily);
  return {
    version: stringFrom(preset.version),
    generatedAt: stringFrom(preset.generatedAt),
    source: stringFrom(preset.source),
    design: {
      width: numberFrom(design.width) ?? model.viewport.width,
      height: numberFrom(design.height) ?? model.viewport.height,
      dpr: numberFrom(design.dpr) ?? 1
    },
    fonts: {
      defaultFamily,
      families,
      resources: asArray(fonts.resources).map(normalizePresetResource).filter((entry): entry is ProjectPresetSettings["fonts"]["resources"][number] => Boolean(entry))
    },
    assets: {
      root: stringFrom(assets.root) ?? "assets",
      images: stringFrom(assets.images) ?? "assets/images",
      slices: stringFrom(assets.slices) ?? "assets/slices",
      frames: stringFrom(assets.frames) ?? "assets/frames"
    },
    notes: stringFrom(preset.notes) ?? ""
  };
}

function collectPresetFontFamilies(): string[] {
  const tokens = asRecord(state.artifacts.reviewedInferredTokens ?? state.artifacts.inferredTokens);
  const typography = asArray(tokens.typography).map(asRecord);
  const normalized = asRecord(state.artifacts.reviewedNormalizedDesignIR ?? state.artifacts.normalizedDesignIR);
  const normalizedTokens = asRecord(normalized.tokens);
  const normalizedTypography = asArray(normalizedTokens.typography).map(asRecord);
  return uniqueStrings(
    [...typography, ...normalizedTypography]
      .map((token) => stringFrom(token.fontFamily) ?? stringFrom(token.value))
      .filter((entry): entry is string => Boolean(entry))
  );
}

function normalizePresetResource(entry: unknown): ProjectPresetSettings["fonts"]["resources"][number] | undefined {
  if (typeof entry === "string" && entry.trim()) return { family: entry.trim(), path: "" };
  const record = asRecord(entry);
  const family = stringFrom(record.family) ?? stringFrom(record.name);
  if (!family) return undefined;
  return {
    family,
    path: stringFrom(record.path) ?? "",
    ...(stringFrom(record.weight) ? { weight: stringFrom(record.weight) } : {}),
    ...(stringFrom(record.style) ? { style: stringFrom(record.style) } : {})
  };
}

function fontResourcesText(resources: ProjectPresetSettings["fonts"]["resources"]): string {
  return resources
    .map((resource) => {
      const suffix = [resource.weight, resource.style].filter(Boolean).join(",");
      const right = suffix ? `${resource.path} ${suffix}` : resource.path;
      return right ? `${resource.family}=${right}` : resource.family;
    })
    .join("\n");
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
    const assetPath = stringFrom(child.assetPath);
    if (assetPath) {
      return `
        <div class="viz-node viz-image${selected}" ${common} style="${baseStyle}">
          <img src="${escapeAttr(artifactUrl(state.artifactRoot, assetPath))}" alt="" />
        </div>
      `;
    }
    return `<div class="viz-node viz-image viz-image--placeholder${selected}" ${common} style="${baseStyle}">IMG</div>`;
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
  const score = asRecord(page.score);
  const threshold = asRecord(page.threshold);
  const issues = asArray(report.issues).map(asRecord);
  const canRepair = state.artifactRoot !== "selected directory";
  const repairPatch = asRecord(state.artifacts.repairPatch);
  const repairPatchRollback = asRecord(repairPatch.rollback);
  const rollbackOverrideId = stringFrom(repairPatch.overrideId);
  const canRollback = canRepair && stringFrom(repairPatch.status) === "applied" && Boolean(rollbackOverrideId) && Boolean(stringFrom(repairPatchRollback.type));
  const rollbackPending = state.pendingDiffRollback === (rollbackOverrideId ?? "last");
  const pageRepairPending = state.pendingDiffRepair === "page_frame_fallback:page";
  return `
    <div class="diff-summary">
      <div class="metric-grid metric-grid--compact">
        ${renderMetric("Visual Score", formatMaybePercent(numberFrom(score.visualScore)), (numberFrom(score.visualScore) ?? 0) >= (numberFrom(threshold.visualScore) ?? 0.98) ? "good" : "warn")}
        ${renderMetric("Pixel Diff", formatMaybePercent(numberFrom(score.pixelDiffRatio)), "warn")}
        ${renderMetric("Issues", String(issues.length), issues.length > 0 ? "warn" : "good")}
      </div>
      <div class="diff-actions">
        <button
          class="action-button"
          data-diff-repair="page_frame_fallback"
          data-diff-issue-id="page"
          ${canRepair && !pageRepairPending ? "" : "disabled"}
        >
          ${escapeHtml(pageRepairPending ? "Repairing..." : "Use Frame Fallback")}
        </button>
        <button
          class="action-button action-button--secondary"
          data-diff-rollback="${escapeAttr(rollbackOverrideId ?? "")}"
          ${canRollback && !rollbackPending ? "" : "disabled"}
        >
          ${escapeHtml(rollbackPending ? "Rolling Back..." : "Rollback Repair")}
        </button>
      </div>
      <div class="status-list">
        ${
          issues.length === 0
            ? `<div class="status-row"><strong>No node issues</strong><span>pass</span></div>`
            : issues
                .map(
                  (issue) => {
                    const issueId = stringFrom(issue.issueId) ?? "";
                    const sourceNodeId = stringFrom(issue.sourceNodeId) ?? "";
                    const issueScore = asRecord(issue.score);
                    const pendingKey = `issue_asset_slice:${issueId}`;
                    const isPending = state.pendingDiffRepair === pendingKey;
                    return `
                    <div class="status-row diff-issue-row" data-node-id="${escapeAttr(sourceNodeId)}">
                      <strong>${escapeHtml(stringFrom(issue.type) ?? "diff_issue")}</strong>
                      <span>${escapeHtml(sourceNodeId || issueId || "-")} · ${formatMaybePercent(numberFrom(issueScore.pixelDiffRatio))}</span>
                      <button
                        class="table-action"
                        data-diff-repair="issue_asset_slice"
                        data-diff-issue-id="${escapeAttr(issueId)}"
                        ${canRepair && sourceNodeId && !isPending ? "" : "disabled"}
                      >
                        ${escapeHtml(isPending ? "Repairing..." : "Asset Slice")}
                      </button>
                    </div>
                  `;
                  }
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

function renderWorkbenchLauncherItem(view: ViewId, label: string, meta: string, tone: "neutral" | "good" | "warn" | "bad"): string {
  return `
    <button class="launcher-item launcher-item--${tone}" data-view="${escapeAttr(view)}">
      <strong>${escapeHtml(label)}</strong>
      <span>${escapeHtml(meta)}</span>
    </button>
  `;
}

function renderPipelineGate(gate: PipelineGate, index: number, selected: boolean): string {
  return `
    <button class="pipeline-gate ${selected ? "is-selected" : ""} gate--${statusTone(gate.status)}" data-pipeline-gate="${escapeAttr(gate.id)}">
      <span class="pipeline-step">${index + 1}</span>
      <span class="pipeline-gate-main">
        <strong>${escapeHtml(gate.label)}</strong>
        <span>${escapeHtml(gate.description)}</span>
      </span>
      <span class="status-pill status-pill--${statusTone(gate.status)}">${escapeHtml(gate.status)}</span>
    </button>
  `;
}

function buildPipelineGates(model: WorkbenchModel): PipelineGate[] {
  const taskStatusReport = asRecord(state.artifacts.taskStatusReport);
  const blockedReasons = asArray(taskStatusReport.blockedReasons)
    .map((entry) => stringFrom(entry))
    .filter((entry): entry is string => Boolean(entry));
  const visualDiffReport = asRecord(state.artifacts.visualDiffReport);
  const visualDiffPage = asRecord(visualDiffReport.page);
  const visualDiffScore = asRecord(visualDiffPage.score);
  const formatReport = asRecord(state.artifacts.flutterPreviewFormatReport);
  const analyzeReport = asRecord(state.artifacts.flutterPreviewAnalyzeReport);
  const captureReport = asRecord(state.artifacts.flutterPreviewCaptureReport);
  const nodeRemapReport = asRecord(state.artifacts.nodeRemapReport);
  const tokenMigrationReport = asRecord(state.artifacts.tokenMigrationReport);
  const previewStatus = !model.preview.hasVisualIR ? "missing" : visualDiffPage.pass === false ? "review" : "ready";
  const flutterCaptureStatus = stringFrom(captureReport.status);
  const flutterStatus = !model.preview.hasFlutterPreview ? "missing" : flutterCaptureStatus === "failed" ? "blocked" : "ready";
  const syncStatus = model.sync.matches > 0 ? "ready" : "not-generated";
  return [
    {
      id: "tasks",
      label: "审查任务",
      status: model.reviewSummary.blocked ? "blocked" : model.reviewSummary.open > 0 ? "review" : "ready",
      description: model.reviewSummary.blocked ? "存在会阻塞代码写入的高优先级任务。" : model.reviewSummary.open > 0 ? "还有审查任务需要处理。" : "审查任务已经处理完成。",
      view: "tasks",
      details: [
        { label: "待处理", value: String(model.reviewSummary.open), tone: model.reviewSummary.open > 0 ? "warn" : "good" },
        { label: "P0", value: String(model.reviewSummary.byPriority.P0 ?? 0), tone: (model.reviewSummary.byPriority.P0 ?? 0) > 0 ? "bad" : "good" },
        { label: "P1", value: String(model.reviewSummary.byPriority.P1 ?? 0), tone: (model.reviewSummary.byPriority.P1 ?? 0) > 0 ? "warn" : "good" },
        { label: "阻塞原因", value: blockedReasons[0] ?? "无", tone: blockedReasons.length > 0 ? "bad" : "good" }
      ]
    },
    {
      id: "preview",
      label: "Web 预览",
      status: previewStatus,
      description: model.preview.hasVisualIR ? "Web 预览已从结构化命令生成，可继续查看视觉差异。" : "缺少视觉 IR，暂时无法生成可编辑预览。",
      view: "preview",
      details: [
        { label: "视觉 IR", value: model.preview.hasVisualIR ? "已加载" : "缺失", tone: model.preview.hasVisualIR ? "good" : "bad" },
        { label: "Web 命令", value: model.preview.hasWebPreviewState ? "已加载" : "缺失", tone: model.preview.hasWebPreviewState ? "good" : "bad" },
        { label: "视觉对比", value: model.preview.hasDiffReport ? (visualDiffPage.pass === false ? "未通过" : "已生成") : "未生成", tone: visualDiffPage.pass === false ? "warn" : model.preview.hasDiffReport ? "good" : "neutral" },
        { label: "视觉分数", value: formatMaybePercent(numberFrom(visualDiffScore.visualScore)) || "-", tone: visualDiffPage.pass === false ? "warn" : "neutral" }
      ]
    },
    {
      id: "flutter",
      label: "Flutter 预览",
      status: flutterStatus,
      description: model.preview.hasFlutterPreview ? "Flutter 预览截图已生成，可用于和 Web/设计稿对齐。" : "Flutter 预览图片缺失，需要先生成预览。",
      view: "preview",
      details: [
        { label: "预览图片", value: model.preview.hasFlutterPreview ? "可用" : "缺失", tone: model.preview.hasFlutterPreview ? "good" : "bad" },
        { label: "截图", value: flutterCaptureStatus ?? "未生成", tone: statusTone(flutterCaptureStatus ?? "not-generated") },
        { label: "格式化", value: stringFrom(formatReport.status) ?? "未生成", tone: statusTone(stringFrom(formatReport.status) ?? "not-generated") },
        { label: "Analyze", value: stringFrom(analyzeReport.status) ?? "未生成", tone: statusTone(stringFrom(analyzeReport.status) ?? "not-generated") }
      ]
    },
    {
      id: "codegen",
      label: "代码生成",
      status: model.codegen.status,
      description: model.codegen.status === "blocked" || model.codegen.status === "review-blocked" ? "代码写入仍被门禁阻塞。" : "代码生成审查状态已就绪或等待进一步检查。",
      view: "codegen",
      details: [
        { label: "阻塞项", value: String(model.codegen.blockers), tone: model.codegen.blockers > 0 ? "bad" : "good" },
        { label: "待创建", value: String(model.codegen.filesToCreate), tone: "neutral" },
        { label: "待修改", value: String(model.codegen.filesToModify), tone: "neutral" },
        { label: "审查状态", value: model.codegen.status, tone: statusTone(model.codegen.status) }
      ]
    },
    {
      id: "sync",
      label: "增量同步",
      status: syncStatus,
      description: model.sync.matches > 0 ? "已生成节点映射，可用于处理新旧设计稿差异。" : "还没有增量同步结果。",
      view: "codegen",
      details: [
        { label: "节点匹配", value: String(model.sync.matches), tone: model.sync.matches > 0 ? "good" : "neutral" },
        { label: "需复核", value: String(model.sync.reviewRequired), tone: model.sync.reviewRequired > 0 ? "warn" : "good" },
        { label: "过期覆盖", value: String(model.sync.staleOverrides), tone: model.sync.staleOverrides > 0 ? "warn" : "good" },
        { label: "Token 迁移", value: stringFrom(tokenMigrationReport.status) ?? stringFrom(nodeRemapReport.tokenMigrationStatus) ?? "未生成", tone: "neutral" }
      ]
    }
  ];
}

function isPipelineGateId(value: string): value is PipelineGateId {
  return value === "tasks" || value === "preview" || value === "flutter" || value === "codegen" || value === "sync";
}

function isElementTab(value: string): value is ElementTab {
  return value === "tokens" || value === "components" || value === "assets" || value === "docs";
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

function renderCodegenButton(operation: string, label: string, enabled: boolean): string {
  const isPending = state.pendingCodegenOperation === operation;
  return `
    <button class="action-button" data-codegen-operation="${escapeAttr(operation)}" ${enabled && !isPending ? "" : "disabled"}>
      ${escapeHtml(isPending ? "Running..." : label)}
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

function renderComponentEditor(component: JsonRecord, enabled: boolean): string {
  const componentId = stringFrom(component.id) ?? "";
  const name = stringFrom(component.name) ?? componentId;
  const source = stringFrom(component.source) ?? "-";
  const instances = asArray(component.instances).map((entry) => stringFrom(entry)).filter(Boolean).join(", ");
  const props = asArray(component.props).map(asRecord);
  const variants = asArray(component.variants).map(asRecord);
  const flutter = asRecord(component.flutter);
  return `
    <article class="panel component-editor" data-studio-row data-component-id="${escapeAttr(componentId)}">
      <div class="panel-header">
        <h2>${escapeHtml(name || "Component")}</h2>
        <span>${escapeHtml(source)} · ${escapeHtml(instances || "no instances")}</span>
      </div>
      <div class="component-editor-grid">
        <label>
          <span>Prop</span>
          <input class="studio-input studio-input--wide" data-studio-field="component-prop-name" value="${escapeAttr(stringFrom(props[0]?.name) ?? "label")}" ${enabled ? "" : "disabled"} />
        </label>
        <label>
          <span>Type</span>
          <select class="studio-input" data-studio-field="component-prop-type" ${enabled ? "" : "disabled"}>
            ${componentPropTypeOptions.map((option) => `<option value="${option}" ${option === (stringFrom(props[0]?.type) ?? "text") ? "selected" : ""}>${option}</option>`).join("")}
          </select>
        </label>
        <label>
          <span>Source Selector</span>
          <input class="studio-input studio-input--wide" data-studio-field="component-prop-selector" value="${escapeAttr(stringFrom(props[0]?.sourceSelector) ?? "")}" placeholder="sourceNodeId:1:14" ${enabled ? "" : "disabled"} />
        </label>
        <label class="checkbox-row">
          <input type="checkbox" data-studio-field="component-prop-optional" ${props[0]?.optional === true ? "checked" : ""} ${enabled ? "" : "disabled"} />
          <span>Optional</span>
        </label>
        <button class="table-action" data-studio-operation="define_component_prop" data-studio-key="define_component_prop:${escapeAttr(componentId)}" ${enabled && state.pendingStudioOperation !== `define_component_prop:${componentId}` ? "" : "disabled"}>
          ${escapeHtml(state.pendingStudioOperation === `define_component_prop:${componentId}` ? "Saving..." : "Save Prop")}
        </button>
        <label>
          <span>Variant</span>
          <input class="studio-input studio-input--wide" data-studio-field="component-variant-name" value="${escapeAttr(stringFrom(variants[0]?.name) ?? "state")}" ${enabled ? "" : "disabled"} />
        </label>
        <label class="component-field--wide">
          <span>Values</span>
          <input class="studio-input studio-input--wide" data-studio-field="component-variant-values" value="${escapeAttr(asArray(variants[0]?.values).map((entry) => stringFrom(entry)).filter(Boolean).join(", ") || "default, selected")}" ${enabled ? "" : "disabled"} />
        </label>
        <button class="table-action" data-studio-operation="define_component_variant" data-studio-key="define_component_variant:${escapeAttr(componentId)}" ${enabled && state.pendingStudioOperation !== `define_component_variant:${componentId}` ? "" : "disabled"}>
          ${escapeHtml(state.pendingStudioOperation === `define_component_variant:${componentId}` ? "Saving..." : "Save Variant")}
        </button>
        <label class="component-field--wide">
          <span>Flutter Import</span>
          <input class="studio-input studio-input--wide" data-studio-field="component-flutter-import" value="${escapeAttr(stringFrom(flutter.import) ?? "")}" placeholder="package:app/ui/component.dart" ${enabled ? "" : "disabled"} />
        </label>
        <label>
          <span>Constructor</span>
          <input class="studio-input studio-input--wide" data-studio-field="component-flutter-constructor" value="${escapeAttr(stringFrom(flutter.constructor) ?? "")}" placeholder="AppButton.primary" ${enabled ? "" : "disabled"} />
        </label>
        <label class="component-field--wide">
          <span>Props JSON</span>
          <textarea class="studio-input studio-input--wide studio-input--textarea" data-studio-field="component-flutter-props" ${enabled ? "" : "disabled"}>${escapeHtml(JSON.stringify(asRecord(flutter.props), null, 2))}</textarea>
        </label>
        <button class="table-action" data-studio-operation="map_flutter_component" data-studio-key="map_flutter_component:${escapeAttr(componentId)}" ${enabled && state.pendingStudioOperation !== `map_flutter_component:${componentId}` ? "" : "disabled"}>
          ${escapeHtml(state.pendingStudioOperation === `map_flutter_component:${componentId}` ? "Saving..." : "Save Mapping")}
        </button>
      </div>
    </article>
  `;
}

function renderTokenGroupActions(entries: JsonRecord[], group: string, enabled: boolean): string {
  const tokenType = tokenTypeForGroup(group);
  const names = entries.map((entry) => stringFrom(entry.name)).filter((entry): entry is string => Boolean(entry));
  const mergeSources = names.slice(0, 2).join(", ");
  const mergeCanonical = names.length >= 2 ? `${tokenType}_${safeId(names.slice(0, 2).join("_"))}` : names[0] || `${tokenType}_reviewed`;
  const splitSource = names[0] ?? "";
  const splitOutputs = JSON.stringify(defaultSplitTokens(entries[0], splitSource), null, 2);
  const mergePendingKey = `merge_tokens:${tokenType}`;
  const splitPendingKey = `split_token:${tokenType}`;
  const isMergePending = state.pendingStudioOperation === mergePendingKey;
  const isSplitPending = state.pendingStudioOperation === splitPendingKey;
  return `
    <div class="token-group-actions" data-studio-row>
      <label>
        <span>Merge Sources</span>
        <input class="studio-input studio-input--wide" data-studio-field="token-merge-sources" value="${escapeAttr(mergeSources)}" placeholder="space_10, space_12" ${enabled ? "" : "disabled"} />
      </label>
      <label>
        <span>Canonical</span>
        <input class="studio-input studio-input--wide" data-studio-field="token-merge-canonical" value="${escapeAttr(mergeCanonical)}" ${enabled ? "" : "disabled"} />
      </label>
      <button
        class="table-action"
        data-studio-operation="merge_tokens"
        data-studio-key="${escapeAttr(mergePendingKey)}"
        data-token-type="${escapeAttr(tokenType)}"
        ${enabled && !isMergePending && names.length >= 2 ? "" : "disabled"}
      >
        ${escapeHtml(isMergePending ? "Saving..." : "Merge")}
      </button>
      <label>
        <span>Split Source</span>
        <input class="studio-input studio-input--wide" data-studio-field="token-split-source" value="${escapeAttr(splitSource)}" ${enabled ? "" : "disabled"} />
      </label>
      <label class="token-json-field">
        <span>Outputs JSON</span>
        <textarea class="studio-input studio-input--wide studio-input--textarea" data-studio-field="token-split-outputs" ${enabled ? "" : "disabled"}>${escapeHtml(splitOutputs)}</textarea>
      </label>
      <button
        class="table-action"
        data-studio-operation="split_token"
        data-studio-key="${escapeAttr(splitPendingKey)}"
        data-token-type="${escapeAttr(tokenType)}"
        ${enabled && !isSplitPending && Boolean(splitSource) ? "" : "disabled"}
      >
        ${escapeHtml(isSplitPending ? "Saving..." : "Split")}
      </button>
    </div>
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

function renderKeyList(label: string, keys: string[]): string {
  if (keys.length === 0) return `<div class="status-row"><strong>${escapeHtml(label)}</strong><span>0</span></div>`;
  return `
    <div class="status-row"><strong>${escapeHtml(label)}</strong><span>${keys.length}</span></div>
    <ul class="file-list">
      ${keys.map((key) => `<li>${escapeHtml(key)}</li>`).join("")}
    </ul>
  `;
}

function renderEmpty(message: string): string {
  return `<div class="empty-inline">${escapeHtml(message)}</div>`;
}

function renderWebPreviewState(webPreviewState: unknown): string {
  const stateRecord = asRecord(webPreviewState);
  const viewport = asRecord(stateRecord.viewport);
  const width = numberFrom(viewport.width) ?? 390;
  const height = numberFrom(viewport.height) ?? 844;
  const commands = asArray(stateRecord.commands).map(asRecord);
  if (commands.length === 0) return renderEmpty("No web preview commands.");
  return `
    <div class="preview-stage" data-fit-stage>
      <div class="visual-canvas" data-width="${width}" data-height="${height}" style="width:${width}px;height:${height}px;">
        ${commands.map((command) => renderWebPreviewCommand(command)).join("")}
      </div>
    </div>
  `;
}

function renderWebPreviewCommand(command: JsonRecord): string {
  const type = stringFrom(command.type) ?? "node";
  const sourceNodeId = stringFrom(command.sourceNodeId) ?? "";
  const selected = sourceNodeId && state.selectedSourceNodeId === sourceNodeId ? " is-selected" : "";
  const x = numberFrom(command.x) ?? 0;
  const y = numberFrom(command.y) ?? 0;
  const w = numberFrom(command.w) ?? 0;
  const h = numberFrom(command.h) ?? 0;
  const baseStyle = `left:${x}px;top:${y}px;width:${w}px;height:${h}px;`;
  const common = `data-node-id="${escapeAttr(sourceNodeId)}" title="${escapeAttr(sourceNodeId)}"`;

  if (type === "text") {
    const fontSize = numberFrom(command.fontSize) ?? 14;
    const lineHeight = numberFrom(command.lineHeight) ?? Math.round(fontSize * 1.2);
    const fontWeight = numberFrom(command.fontWeight) ?? 400;
    const color = cssColor(stringFrom(command.color) ?? "#111111");
    const fontFamily = stringFrom(command.fontFamily) ?? "Inter, system-ui, sans-serif";
    return `
      <div class="viz-node viz-text${selected}" ${common} style="${baseStyle}color:${color};font-size:${fontSize}px;line-height:${lineHeight}px;font-weight:${fontWeight};font-family:${escapeAttr(fontFamily)};">
        ${escapeHtml(stringFrom(command.text) ?? "")}
      </div>
    `;
  }

  if (type === "image") {
    const assetPath = stringFrom(command.assetPath);
    if (assetPath) {
      return `
        <div class="viz-node viz-image${selected}" ${common} style="${baseStyle}">
          <img src="${escapeAttr(artifactUrl(state.artifactRoot, assetPath))}" alt="" />
        </div>
      `;
    }
    return `
      <div class="viz-node viz-image viz-image--placeholder${selected}" ${common} style="${baseStyle}">
        <span>${escapeHtml(stringFrom(command.mode) === "asset" ? "asset" : "image")}</span>
      </div>
    `;
  }

  const fill = cssColor(stringFrom(command.fill) ?? "#f8fafc");
  const stroke = cssColor(stringFrom(command.stroke) ?? "rgba(17, 24, 39, 0.12)");
  const strokeWidth = numberFrom(command.strokeWidth) ?? 1;
  const radius = numberFrom(command.radius) ?? 0;
  const opacity = numberFrom(command.opacity) ?? 1;
  return `
    <div class="viz-node viz-rect${selected}" ${common} style="${baseStyle}background:${fill};border:${strokeWidth}px solid ${stroke};border-radius:${radius}px;opacity:${opacity};"></div>
  `;
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

  const studioRollbackButton = target.closest<HTMLButtonElement>("[data-studio-rollback]");
  if (studioRollbackButton) {
    const overrideIds = splitList(studioRollbackButton.dataset.studioRollback ?? "");
    void applyStudioRollback(overrideIds);
    return;
  }

  const codegenOperationButton = target.closest<HTMLButtonElement>("[data-codegen-operation]");
  if (codegenOperationButton?.dataset.codegenOperation) {
    void applyCodegenOperation(codegenOperationButton.dataset.codegenOperation);
    return;
  }

  const syncOperationButton = target.closest<HTMLButtonElement>("[data-sync-operation]");
  if (syncOperationButton?.dataset.syncOperation) {
    void applySyncOperation(syncOperationButton.dataset.syncOperation);
    return;
  }

  const openPageButton = target.closest<HTMLButtonElement>("[data-open-page]");
  if (openPageButton?.dataset.openPage) {
    void switchArtifactPage(openPageButton.dataset.openPage);
    return;
  }

  const canvasPageButton = target.closest<HTMLButtonElement>("[data-canvas-page]");
  if (canvasPageButton?.dataset.canvasPage) {
    state.selectedCanvasPage = canvasPageButton.dataset.canvasPage;
    render();
    return;
  }

  const editPageButton = target.closest<HTMLButtonElement>("[data-edit-page]");
  if (editPageButton?.dataset.editPage) {
    void switchArtifactPage(editPageButton.dataset.editPage, "preview");
    return;
  }

  const elementTabButton = target.closest<HTMLButtonElement>("[data-element-tab]");
  if (elementTabButton?.dataset.elementTab && isElementTab(elementTabButton.dataset.elementTab)) {
    state.elementsTab = elementTabButton.dataset.elementTab;
    render();
    return;
  }

  const addPrototypeButton = target.closest<HTMLButtonElement>("[data-prototype-link-add]");
  if (addPrototypeButton) {
    void addPrototypeLink();
    return;
  }

  const deletePrototypeButton = target.closest<HTMLButtonElement>("[data-prototype-link-delete]");
  if (deletePrototypeButton?.dataset.prototypeLinkDelete) {
    void deletePrototypeLink(deletePrototypeButton.dataset.prototypeLinkDelete);
    return;
  }

  const pipelineGateButton = target.closest<HTMLButtonElement>("[data-pipeline-gate]");
  if (pipelineGateButton?.dataset.pipelineGate && isPipelineGateId(pipelineGateButton.dataset.pipelineGate)) {
    state.selectedGateId = pipelineGateButton.dataset.pipelineGate;
    render();
    return;
  }

  const projectPresetButton = target.closest<HTMLButtonElement>("[data-project-preset-save]");
  if (projectPresetButton) {
    void saveProjectPreset();
    return;
  }

  const diffRepairButton = target.closest<HTMLButtonElement>("[data-diff-repair]");
  if (diffRepairButton?.dataset.diffRepair) {
    void applyDiffRepair(diffRepairButton.dataset.diffRepair, diffRepairButton.dataset.diffIssueId);
    return;
  }

  const diffRollbackButton = target.closest<HTMLButtonElement>("[data-diff-rollback]");
  if (diffRollbackButton) {
    void applyDiffRollback(diffRollbackButton.dataset.diffRollback);
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

function onAppInput(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.dataset.codegenField === "project-path") {
    state.codegenProjectPath = target.value;
    saveCodegenProjectPath(state.artifactRoot, target.value);
  }
}

function onAppChange(event: Event): void {
  const target = event.target;
  if (target instanceof HTMLSelectElement && target.dataset.pageSelector) {
    void switchArtifactPage(target.value);
  }
  if (target instanceof HTMLSelectElement && target.dataset.projectSelector) {
    void switchArtifactPage(target.value);
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

async function applyStudioRollback(overrideIds: string[]): Promise<void> {
  const pendingKey = overrideIds.join(",") || "last";
  state.pendingStudioRollback = pendingKey;
  state.actionMessage = undefined;
  render();
  try {
    const response = await fetch("/api/workbench/studio-rollback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        artifactRoot: state.artifactRoot,
        overrideIds,
        actor: "user"
      })
    });
    const result = (await response.json()) as {
      ok?: boolean;
      error?: string;
      report?: { rollbackOverrideIds?: string[]; afterOpenTasks?: number };
    };
    if (!response.ok || !result.ok) {
      throw new Error(result.error ?? `Studio rollback failed with ${response.status}`);
    }
    await loadFromArtifactRoot(state.artifactRoot);
    state.actionMessage = {
      tone: "good",
      text: `Disabled ${result.report?.rollbackOverrideIds?.join(", ") ?? "studio override"}; ${result.report?.afterOpenTasks ?? state.model?.reviewSummary.open ?? 0} tasks remain.`
    };
  } catch (error) {
    state.actionMessage = {
      tone: "bad",
      text: error instanceof Error ? error.message : String(error)
    };
  } finally {
    state.pendingStudioRollback = undefined;
    render();
  }
}

function renderStudioRollbackPanel(canApplyStudio: boolean): string {
  const actionReport = asRecord(state.artifacts.workbenchStudioActionReport);
  const overrideIds = asArray(actionReport.overrideIds).map((entry) => stringFrom(entry)).filter((entry): entry is string => Boolean(entry));
  if (overrideIds.length === 0) return "";
  const overrides = asArray(asRecord(state.artifacts.overrideSet).overrides).map(asRecord);
  const activeOverrideIds = overrideIds.filter((overrideId) => {
    const override = overrides.find((entry) => stringFrom(entry.id) === overrideId);
    return stringFrom(override?.status) === "active";
  });
  const pendingKey = activeOverrideIds.join(",") || "last";
  const isPending = state.pendingStudioRollback === pendingKey;
  return `
    <section class="panel">
      <div class="panel-header">
        <h2>Last Studio Action</h2>
        <span>${escapeHtml(overrideIds.join(", "))}</span>
      </div>
      <button
        class="action-button action-button--secondary"
        data-studio-rollback="${escapeAttr(activeOverrideIds.join(","))}"
        ${canApplyStudio && activeOverrideIds.length > 0 && !isPending ? "" : "disabled"}
      >
        ${escapeHtml(isPending ? "Disabling..." : "Disable Last Studio Override")}
      </button>
    </section>
  `;
}

async function applyCodegenOperation(operation: string): Promise<void> {
  const payload = buildCodegenPayload(operation);
  if (payload.error) {
    state.actionMessage = { tone: "bad", text: payload.error };
    render();
    return;
  }
  state.pendingCodegenOperation = operation;
  state.actionMessage = undefined;
  render();
  try {
    const endpoint = operation === "review" ? "/api/workbench/codegen-review" : "/api/workbench/codegen-write";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload.body)
    });
    const result = (await response.json()) as {
      ok?: boolean;
      error?: string;
      report?: {
        gateStatus?: string;
        mode?: string;
        wrote?: boolean;
        filesToCreate?: number;
        filesToModify?: number;
        blockers?: number | unknown[];
      };
    };
    if (!response.ok || !result.ok) {
      throw new Error(result.error ?? `Codegen ${operation} failed with ${response.status}`);
    }
    await loadFromArtifactRoot(state.artifactRoot);
    state.actionMessage = {
      tone: result.report?.gateStatus === "blocked" ? "warn" : "good",
      text: codegenResultMessage(operation, result.report)
    };
  } catch (error) {
    state.actionMessage = {
      tone: "bad",
      text: error instanceof Error ? error.message : String(error)
    };
  } finally {
    state.pendingCodegenOperation = undefined;
    render();
  }
}

async function applySyncOperation(operation: string): Promise<void> {
  const payload = buildSyncPayload(operation);
  if (payload.error) {
    state.actionMessage = { tone: "bad", text: payload.error };
    render();
    return;
  }
  state.pendingSyncOperation = operation;
  state.actionMessage = undefined;
  render();
  try {
    const response = await fetch("/api/workbench/sync-remap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload.body)
    });
    const result = (await response.json()) as {
      ok?: boolean;
      error?: string;
      report?: { matches?: number; staleOverrides?: number; reappliedOverrides?: number; reviewTasks?: number; tokenMigrationStatus?: string };
    };
    if (!response.ok || !result.ok) {
      throw new Error(result.error ?? `Sync remap failed with ${response.status}`);
    }
    await loadFromArtifactRoot(state.artifactRoot);
    state.actionMessage = {
      tone: result.report?.staleOverrides ? "warn" : "good",
      text: `Sync remap finished; ${result.report?.reappliedOverrides ?? 0} reapplied, ${result.report?.staleOverrides ?? 0} stale, ${result.report?.reviewTasks ?? 0} review tasks, token migration ${result.report?.tokenMigrationStatus ?? "not-run"}.`
    };
  } catch (error) {
    state.actionMessage = {
      tone: "bad",
      text: error instanceof Error ? error.message : String(error)
    };
  } finally {
    state.pendingSyncOperation = undefined;
    render();
  }
}

async function saveProjectPreset(): Promise<void> {
  if (state.artifactRoot === "selected directory") {
    state.actionMessage = { tone: "bad", text: "请选择本地产物目录后再保存项目预设。" };
    render();
    return;
  }
  const payload = buildProjectPresetPayload();
  if (payload.error) {
    state.actionMessage = { tone: "bad", text: payload.error };
    render();
    return;
  }
  state.pendingProjectPreset = true;
  state.actionMessage = undefined;
  render();
  try {
    const response = await fetch("/api/workbench/project-preset", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        artifactRoot: state.artifactRoot,
        preset: payload.preset
      })
    });
    const result = (await response.json()) as { ok?: boolean; error?: string; report?: { resources?: number; fontFamilies?: number } };
    if (!response.ok || !result.ok) {
      throw new Error(result.error ?? `Project preset save failed with ${response.status}`);
    }
    await loadFromArtifactRoot(state.artifactRoot);
    state.actionMessage = {
      tone: "good",
      text: `项目预设已保存到项目目录的 project_preset.json；${result.report?.fontFamilies ?? 0} 个字体族，${result.report?.resources ?? 0} 个字体资源。`
    };
  } catch (error) {
    state.actionMessage = {
      tone: "bad",
      text: error instanceof Error ? error.message : String(error)
    };
  } finally {
    state.pendingProjectPreset = undefined;
    render();
  }
}

async function switchArtifactPage(artifactRoot: string, nextView: ViewId = "dashboard"): Promise<void> {
  if (!artifactRoot) return;
  if (artifactRoot === state.artifactRoot) {
    state.activeView = nextView;
    location.hash = nextView;
    render();
    return;
  }
  state.activeView = nextView;
  state.selectedGateId = undefined;
  const nextUrl = new URL(window.location.href);
  nextUrl.searchParams.set("artifacts", artifactRoot);
  nextUrl.hash = nextView;
  window.history.replaceState(null, "", nextUrl);
  await loadFromArtifactRoot(artifactRoot);
}

async function addPrototypeLink(): Promise<void> {
  const fromPage = inputValue("[data-prototype-field='from']").trim();
  const toPage = inputValue("[data-prototype-field='to']").trim();
  const trigger = inputValue("[data-prototype-field='trigger']").trim() || "tap";
  const note = inputValue("[data-prototype-field='note']").trim();
  if (!fromPage || !toPage) {
    state.actionMessage = { tone: "bad", text: "请选择要连接的两个页面。" };
    render();
    return;
  }
  if (fromPage === toPage) {
    state.actionMessage = { tone: "bad", text: "原型连接的起点和终点不能是同一个页面。" };
    render();
    return;
  }
  state.pendingPrototypeLink = "add";
  state.actionMessage = undefined;
  render();
  try {
    await savePrototypeLinkMutation({
      operation: "add",
      link: { fromPage, toPage, trigger, note }
    });
    state.projectPages = await fetchProjectPages(state.artifactRoot);
    state.actionMessage = { tone: "good", text: `已连接 ${fromPage} -> ${toPage}。` };
  } catch (error) {
    state.actionMessage = {
      tone: "bad",
      text: error instanceof Error ? error.message : String(error)
    };
  } finally {
    state.pendingPrototypeLink = undefined;
    render();
  }
}

async function deletePrototypeLink(linkId: string): Promise<void> {
  state.pendingPrototypeLink = linkId;
  state.actionMessage = undefined;
  render();
  try {
    await savePrototypeLinkMutation({
      operation: "delete",
      linkId
    });
    state.projectPages = await fetchProjectPages(state.artifactRoot);
    state.actionMessage = { tone: "good", text: "已删除原型连接。" };
  } catch (error) {
    state.actionMessage = {
      tone: "bad",
      text: error instanceof Error ? error.message : String(error)
    };
  } finally {
    state.pendingPrototypeLink = undefined;
    render();
  }
}

async function savePrototypeLinkMutation(body: Record<string, unknown>): Promise<void> {
  const response = await fetch("/api/workbench/prototype-link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      artifactRoot: state.artifactRoot,
      ...body
    })
  });
  const result = (await response.json()) as { ok?: boolean; error?: string };
  if (!response.ok || !result.ok) {
    throw new Error(result.error ?? `Prototype link update failed with ${response.status}`);
  }
}

async function applyDiffRepair(repairKind: string, issueId: string | undefined): Promise<void> {
  const pendingKey = `${repairKind}:${issueId ?? "page"}`;
  state.pendingDiffRepair = pendingKey;
  state.actionMessage = undefined;
  render();
  try {
    const response = await fetch("/api/workbench/diff-repair", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        artifactRoot: state.artifactRoot,
        repairKind,
        issueId,
        actor: "user"
      })
    });
    const result = (await response.json()) as {
      ok?: boolean;
      error?: string;
      report?: { overrideId?: string; afterOpenTasks?: number };
    };
    if (!response.ok || !result.ok) {
      throw new Error(result.error ?? `Diff repair failed with ${response.status}`);
    }
    await loadFromArtifactRoot(state.artifactRoot);
    state.actionMessage = {
      tone: "good",
      text: `Saved ${result.report?.overrideId ?? "diff repair"}; ${result.report?.afterOpenTasks ?? state.model?.reviewSummary.open ?? 0} tasks remain.`
    };
  } catch (error) {
    state.actionMessage = {
      tone: "bad",
      text: error instanceof Error ? error.message : String(error)
    };
  } finally {
    state.pendingDiffRepair = undefined;
    render();
  }
}

async function applyDiffRollback(overrideId: string | undefined): Promise<void> {
  const pendingKey = overrideId || "last";
  state.pendingDiffRollback = pendingKey;
  state.actionMessage = undefined;
  render();
  try {
    const response = await fetch("/api/workbench/diff-repair-rollback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        artifactRoot: state.artifactRoot,
        overrideId,
        actor: "user"
      })
    });
    const result = (await response.json()) as {
      ok?: boolean;
      error?: string;
      report?: { overrideId?: string; afterOpenTasks?: number };
    };
    if (!response.ok || !result.ok) {
      throw new Error(result.error ?? `Diff repair rollback failed with ${response.status}`);
    }
    await loadFromArtifactRoot(state.artifactRoot);
    state.actionMessage = {
      tone: "good",
      text: `Rolled back ${result.report?.overrideId ?? "diff repair"}; ${result.report?.afterOpenTasks ?? state.model?.reviewSummary.open ?? 0} tasks remain.`
    };
  } catch (error) {
    state.actionMessage = {
      tone: "bad",
      text: error instanceof Error ? error.message : String(error)
    };
  } finally {
    state.pendingDiffRollback = undefined;
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
  if (kind === "create-region") {
    return {
      id: operationId,
      kind: "create_region",
      regionId: inputValue("[data-tree-field='region-id']").trim(),
      name: inputValue("[data-tree-field='region-name']").trim(),
      role: inputValue("[data-tree-field='region-role']").trim() || "content",
      sourceNodeIds: splitList(inputValue("[data-tree-field='source-node-ids']")),
      layout: inputValue("[data-tree-field='layout']"),
      reason: safeReason
    };
  }
  if (kind === "split-region") {
    return {
      id: operationId,
      kind: "split_region",
      sourceRegionId: selected.id,
      regionId: inputValue("[data-tree-field='region-id']").trim(),
      name: inputValue("[data-tree-field='region-name']").trim(),
      role: inputValue("[data-tree-field='region-role']").trim() || "content",
      sourceNodeIds: splitList(inputValue("[data-tree-field='source-node-ids']")),
      layout: inputValue("[data-tree-field='layout']"),
      reason: safeReason
    };
  }
  if (kind === "move-node") {
    return {
      id: operationId,
      kind: "move_node",
      ...target,
      targetNormalizedParentId: inputValue("[data-tree-field='target-parent-id']").trim(),
      reason: safeReason
    };
  }
  if (kind === "merge-regions") {
    return {
      id: operationId,
      kind: "merge_regions",
      sourceRegionIds: splitList(inputValue("[data-tree-field='merge-region-ids']")),
      targetRegionId: inputValue("[data-tree-field='region-id']").trim(),
      name: inputValue("[data-tree-field='region-name']").trim(),
      role: inputValue("[data-tree-field='region-role']").trim() || "content",
      layout: inputValue("[data-tree-field='layout']"),
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
  if (kind === "approve_component") {
    const componentId = studioFieldValue(row, "component-id").trim();
    const name = studioFieldValue(row, "component-name").trim();
    const instances = splitList(studioFieldValue(row, "component-instances"));
    const allowSingleUse = studioCheckedValue(row, "component-allow-single");
    if (!componentId || !name) throw new Error("Component approval requires an ID and name.");
    if (instances.length === 0) throw new Error("Component approval requires at least one instance.");
    return {
      id: `workbench_approve_component_${safeId(componentId)}_${safeId(name)}`,
      kind,
      componentId,
      name,
      instances,
      allowSingleUse,
      reason
    };
  }
  if (kind === "reject_component") {
    const componentId = studioFieldValue(row, "component-id").trim();
    if (!componentId) throw new Error("Component rejection requires an ID.");
    return {
      id: `workbench_reject_component_${safeId(componentId)}`,
      kind,
      componentId,
      reason
    };
  }
  if (kind === "define_component_prop") {
    const componentId = button.closest<HTMLElement>("[data-component-id]")?.dataset.componentId ?? "";
    const name = studioFieldValue(row, "component-prop-name").trim();
    const type = studioFieldValue(row, "component-prop-type");
    const sourceSelector = studioFieldValue(row, "component-prop-selector").trim();
    if (!componentId || !name || !sourceSelector) throw new Error("Component prop requires a component, name, and source selector.");
    return {
      id: `workbench_component_prop_${safeId(componentId)}_${safeId(name)}`,
      kind,
      componentId,
      prop: {
        name,
        type,
        sourceSelector,
        optional: studioCheckedValue(row, "component-prop-optional")
      },
      reason
    };
  }
  if (kind === "define_component_variant") {
    const componentId = button.closest<HTMLElement>("[data-component-id]")?.dataset.componentId ?? "";
    const name = studioFieldValue(row, "component-variant-name").trim();
    const values = splitList(studioFieldValue(row, "component-variant-values"));
    if (!componentId || !name || values.length === 0) throw new Error("Component variant requires a component, name, and values.");
    return {
      id: `workbench_component_variant_${safeId(componentId)}_${safeId(name)}`,
      kind,
      componentId,
      variant: {
        name,
        values
      },
      reason
    };
  }
  if (kind === "map_flutter_component") {
    const componentId = button.closest<HTMLElement>("[data-component-id]")?.dataset.componentId ?? "";
    const importPath = studioFieldValue(row, "component-flutter-import").trim();
    const constructorName = studioFieldValue(row, "component-flutter-constructor").trim();
    const propsText = studioFieldValue(row, "component-flutter-props").trim();
    if (!componentId || !importPath || !constructorName) throw new Error("Flutter mapping requires a component, import, and constructor.");
    return {
      id: `workbench_component_flutter_${safeId(componentId)}_${safeId(constructorName)}`,
      kind,
      componentId,
      flutter: {
        import: importPath,
        constructor: constructorName,
        ...(propsText ? { props: parseJsonObject(propsText, "Flutter props JSON") } : {})
      },
      reason
    };
  }
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
  if (kind === "merge_tokens") {
    const tokenType = button.dataset.tokenType ?? "";
    const sourceTokenNames = splitList(studioFieldValue(row, "token-merge-sources"));
    const canonicalTokenName = studioFieldValue(row, "token-merge-canonical").trim();
    if (!tokenType || sourceTokenNames.length < 2 || !canonicalTokenName) throw new Error("Token merge requires a type, at least two sources, and a canonical name.");
    return {
      id: `workbench_merge_tokens_${safeId(tokenType)}_${safeId(canonicalTokenName)}`,
      kind,
      tokenType,
      sourceTokenNames,
      canonicalTokenName,
      reason
    };
  }
  if (kind === "split_token") {
    const tokenType = button.dataset.tokenType ?? "";
    const sourceTokenName = studioFieldValue(row, "token-split-source").trim();
    const tokens = parseJsonArray(studioFieldValue(row, "token-split-outputs").trim(), "Token split outputs");
    if (!tokenType || !sourceTokenName || tokens.length === 0) throw new Error("Token split requires a type, source token, and output tokens.");
    return {
      id: `workbench_split_token_${safeId(tokenType)}_${safeId(sourceTokenName)}`,
      kind,
      tokenType,
      sourceTokenName,
      tokens,
      reason
    };
  }
  if (kind === "set_asset_strategy") {
    const assetId = button.dataset.assetId ?? "";
    const sourceNodeId = button.dataset.sourceNodeId ?? "";
    const strategy = studioFieldValue(row, "asset-strategy");
    const sourceName = studioFieldValue(row, "asset-source-name").trim();
    const format = studioFieldValue(row, "asset-format");
    const path = studioFieldValue(row, "asset-path").trim();
    const scaleText = studioFieldValue(row, "asset-scale").trim();
    const cropText = studioFieldValue(row, "asset-crop").trim();
    const scale = scaleText ? Number(scaleText) : undefined;
    if (!assetId && !sourceNodeId) throw new Error("Asset strategy requires an asset or source node target.");
    if (!strategy) throw new Error("Asset strategy is missing.");
    if (scale !== undefined && (!Number.isFinite(scale) || scale <= 0 || scale > 4)) throw new Error("Asset scale must be between 0.01 and 4.");
    return {
      id: `workbench_asset_strategy_${safeId(assetId || sourceNodeId)}_${safeId(strategy)}_${safeId(path || format || "default")}`,
      kind,
      ...(assetId ? { assetId } : { sourceNodeId }),
      strategy,
      ...(sourceName ? { sourceName } : {}),
      ...(format ? { format } : {}),
      ...(path ? { path } : {}),
      ...(scale !== undefined ? { scale } : {}),
      ...(cropText ? { cropBounds: parseBoundsObject(cropText, "Asset crop JSON") } : {}),
      excludeTextNodes: studioCheckedValue(row, "asset-exclude-text"),
      reason
    };
  }
  if (kind === "rename_i18n_key") {
    const messageKey = button.dataset.messageKey ?? "";
    const sourceNodeId = button.dataset.sourceNodeId ?? "";
    const key = studioFieldValue(row, "i18n-key").trim();
    const description = studioFieldValue(row, "i18n-description").trim();
    if (!messageKey && !sourceNodeId) throw new Error("i18n rename requires a message or source node target.");
    if (!key) throw new Error("i18n key is missing.");
    return {
      id: `workbench_rename_i18n_${safeId(sourceNodeId || messageKey)}_${safeId(key)}`,
      kind,
      ...(messageKey ? { messageKey } : {}),
      ...(sourceNodeId ? { sourceNodeId } : {}),
      key,
      ...(description ? { description } : {}),
      reason
    };
  }
  if (kind === "accept_i18n_key") {
    const messageKey = button.dataset.messageKey ?? "";
    const sourceNodeId = button.dataset.sourceNodeId ?? "";
    if (!messageKey && !sourceNodeId) throw new Error("i18n accept requires a message or source node target.");
    return {
      id: `workbench_accept_i18n_${safeId(sourceNodeId || messageKey)}`,
      kind,
      ...(messageKey ? { messageKey } : {}),
      ...(sourceNodeId ? { sourceNodeId } : {}),
      reason
    };
  }
  if (kind === "define_i18n_placeholder") {
    const messageKey = button.dataset.messageKey ?? "";
    const sourceNodeId = button.dataset.sourceNodeId ?? "";
    const name = studioFieldValue(row, "i18n-placeholder-name").trim();
    const type = studioFieldValue(row, "i18n-placeholder-type").trim();
    const example = studioFieldValue(row, "i18n-placeholder-example").trim();
    if (!messageKey && !sourceNodeId) throw new Error("i18n placeholder requires a message or source node target.");
    if (!name || !type) throw new Error("i18n placeholder requires a name and type.");
    return {
      id: `workbench_i18n_placeholder_${safeId(sourceNodeId || messageKey)}_${safeId(name)}`,
      kind,
      ...(messageKey ? { messageKey } : {}),
      ...(sourceNodeId ? { sourceNodeId } : {}),
      placeholder: {
        name,
        type,
        ...(example ? { example } : {})
      },
      reason
    };
  }
  if (kind === "merge_i18n_messages") {
    const messageKey = button.dataset.messageKey ?? "";
    const sourceNodeId = button.dataset.sourceNodeId ?? "";
    const targetMessageKey = studioFieldValue(row, "i18n-merge-target").trim();
    if (!messageKey && !sourceNodeId) throw new Error("i18n merge requires a message or source node target.");
    if (!targetMessageKey) throw new Error("i18n merge requires a canonical target key.");
    return {
      id: `workbench_merge_i18n_${safeId(sourceNodeId || messageKey)}_${safeId(targetMessageKey)}`,
      kind,
      ...(messageKey ? { messageKey } : {}),
      ...(sourceNodeId ? { sourceNodeId } : {}),
      targetMessageKey,
      reason
    };
  }
  if (kind === "mark_non_i18n") {
    const messageKey = button.dataset.messageKey ?? "";
    const sourceNodeId = button.dataset.sourceNodeId ?? "";
    const nonI18nReason = studioFieldValue(row, "i18n-non-reason").trim();
    if (!messageKey && !sourceNodeId) throw new Error("Non-i18n marking requires a message or source node target.");
    if (!nonI18nReason) throw new Error("Non-i18n marking requires a reason.");
    return {
      id: `workbench_non_i18n_${safeId(sourceNodeId || messageKey)}`,
      kind,
      ...(messageKey ? { messageKey } : {}),
      ...(sourceNodeId ? { sourceNodeId } : {}),
      reason: nonI18nReason
    };
  }
  throw new Error(`Unsupported Studio operation: ${kind}`);
}

function buildCodegenPayload(operation: string): { body?: Record<string, unknown>; error?: string } {
  const enteredProjectPath = inputValue("[data-codegen-field='project-path']").trim();
  const writeReport = asRecord(state.artifacts.projectWriteReport);
  const workbenchReviewReport = asRecord(state.artifacts.workbenchCodegenReviewReport);
  const projectPath =
    enteredProjectPath || state.codegenProjectPath || stringFrom(writeReport.projectPath) || stringFrom(workbenchReviewReport.projectPath) || "";
  state.codegenProjectPath = projectPath || state.codegenProjectPath;
  if (state.codegenProjectPath) saveCodegenProjectPath(state.artifactRoot, state.codegenProjectPath);
  const allowLowVisualScore = checkedValue("[data-codegen-field='allow-low-visual-score']");
  const allowBlocked = checkedValue("[data-codegen-field='allow-blocked']");
  const confirmWrite = checkedValue("[data-codegen-field='confirm-write']");
  if ((operation === "dry-run" || operation === "write") && !projectPath) {
    return { error: "Project path is required for Codegen write." };
  }
  if (operation === "write" && !confirmWrite) {
    return { error: "Enable Write files before running an actual project write." };
  }
  if (operation === "review") {
    return {
      body: {
        artifactRoot: state.artifactRoot,
        ...(projectPath ? { projectPath } : {}),
        allowLowVisualScore
      }
    };
  }
  if (operation === "dry-run" || operation === "write") {
    return {
      body: {
        artifactRoot: state.artifactRoot,
        projectPath,
        dryRun: operation !== "write",
        allowBlocked
      }
    };
  }
  return { error: `Unsupported Codegen operation: ${operation}` };
}

function buildSyncPayload(operation: string): { body?: Record<string, unknown>; error?: string } {
  if (operation !== "remap") return { error: `Unsupported Sync operation: ${operation}` };
  const newRawPath = inputValue("[data-sync-field='new-raw-path']").trim();
  if (!newRawPath) return { error: "New Raw Path is required for Sync Remap." };
  return {
    body: {
      artifactRoot: state.artifactRoot,
      newRawPath
    }
  };
}

function buildProjectPresetPayload(): { preset?: ProjectPresetSettings; error?: string } {
  const current = projectPresetForSettings(state.model ?? buildWorkbenchModel(state.artifacts));
  const width = Number(inputValue("[data-preset-field='design-width']"));
  const height = Number(inputValue("[data-preset-field='design-height']"));
  const dpr = Number(inputValue("[data-preset-field='design-dpr']"));
  if (!Number.isFinite(width) || width <= 0) return { error: "设计稿宽度必须是大于 0 的数字。" };
  if (!Number.isFinite(height) || height <= 0) return { error: "设计稿高度必须是大于 0 的数字。" };
  if (!Number.isFinite(dpr) || dpr <= 0) return { error: "设备倍率必须是大于 0 的数字。" };

  const defaultFamily = inputValue("[data-preset-field='default-font']").trim();
  const families = uniqueStrings([...splitList(inputValue("[data-preset-field='font-families']")), defaultFamily].filter(Boolean));
  const resources = parseFontResources(inputValue("[data-preset-field='font-resources']"));
  return {
    preset: {
      version: current.version,
      generatedAt: current.generatedAt,
      source: "workbench",
      design: {
        width,
        height,
        dpr
      },
      fonts: {
        defaultFamily,
        families,
        resources
      },
      assets: {
        root: inputValue("[data-preset-field='asset-root']").trim() || "assets",
        images: inputValue("[data-preset-field='asset-images']").trim() || "assets/images",
        slices: inputValue("[data-preset-field='asset-slices']").trim() || "assets/slices",
        frames: inputValue("[data-preset-field='asset-frames']").trim() || "assets/frames"
      },
      notes: inputValue("[data-preset-field='notes']")
    }
  };
}

function parseFontResources(value: string): ProjectPresetSettings["fonts"]["resources"] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [familyPart, rest = ""] = line.split("=");
      const family = familyPart.trim();
      const [path = "", metadata = ""] = rest.trim().split(/\s+/, 2);
      const [weight = "", style = ""] = metadata.split(",").map((entry) => entry.trim());
      return {
        family,
        path,
        ...(weight ? { weight } : {}),
        ...(style ? { style } : {})
      };
    })
    .filter((entry) => entry.family);
}

function codegenResultMessage(operation: string, report: { gateStatus?: string; mode?: string; wrote?: boolean; filesToCreate?: number; filesToModify?: number; blockers?: number | unknown[] } | undefined): string {
  if (operation === "review") {
    return `Codegen review ${report?.gateStatus ?? "updated"}; ${report?.filesToCreate ?? 0} creates, ${report?.filesToModify ?? 0} modifies.`;
  }
  const blockerCount = Array.isArray(report?.blockers) ? report?.blockers.length : report?.blockers ?? 0;
  return `Codegen ${report?.mode ?? operation} finished; wrote ${String(report?.wrote ?? false)}, ${blockerCount} blockers.`;
}

function studioFieldValue(row: HTMLElement, fieldName: string): string {
  const field = row.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(`[data-studio-field='${fieldName}']`);
  return field?.value ?? "";
}

function studioCheckedValue(row: HTMLElement, fieldName: string): boolean {
  const field = row.querySelector<HTMLInputElement>(`[data-studio-field='${fieldName}']`);
  return field?.checked ?? false;
}

function splitList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((entry) => entry.trim()).filter(Boolean))];
}

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(`${label} must be a JSON object.`);
  return parsed as Record<string, unknown>;
}

function parseBoundsObject(value: string, label: string): { x: number; y: number; w: number; h: number } {
  const parsed = parseJsonObject(value, label);
  const x = Number(parsed.x);
  const y = Number(parsed.y);
  const w = Number(parsed.w);
  const h = Number(parsed.h);
  if (![x, y, w, h].every(Number.isFinite) || w <= 0 || h <= 0) throw new Error(`${label} requires numeric x, y, w, h with positive width and height.`);
  return { x, y, w, h };
}

function parseJsonArray(value: string, label: string): Array<Record<string, unknown> & { name: string }> {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed)) throw new Error(`${label} must be a JSON array.`);
  return parsed.map((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof (entry as { name?: unknown }).name !== "string") {
      throw new Error(`${label} item ${index + 1} must be an object with a name.`);
    }
    return entry as Record<string, unknown> & { name: string };
  });
}

function tokenTypeForGroup(group: string): string {
  if (group === "colors") return "color";
  if (group === "radii") return "radius";
  if (group === "shadows") return "shadow";
  if (group === "typography") return "typography";
  return "spacing";
}

function inputValue(selector: string): string {
  const field = document.querySelector<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>(selector);
  return field?.value ?? "";
}

function checkedValue(selector: string): boolean {
  const field = document.querySelector<HTMLInputElement>(selector);
  return field?.checked ?? false;
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

function defaultSplitTokens(token: JsonRecord | undefined, sourceName: string): Array<Record<string, unknown> & { name: string }> {
  const baseName = sourceName || "token";
  const sourceNodeIds = asArray(token?.sourceNodeIds).map((entry) => stringFrom(entry)).filter((entry): entry is string => Boolean(entry));
  const firstSource = sourceNodeIds[0] ? [sourceNodeIds[0]] : undefined;
  const secondSource = sourceNodeIds[1] ? [sourceNodeIds[1]] : firstSource;
  const value = token?.value;
  return [
    {
      name: `${baseName}_primary`,
      ...(value !== undefined ? { value } : {}),
      ...(firstSource ? { sourceNodeIds: firstSource } : {})
    },
    {
      name: `${baseName}_secondary`,
      ...(value !== undefined ? { value } : {}),
      ...(secondSource ? { sourceNodeIds: secondSource } : {})
    }
  ];
}

function pascalCase(value: string): string {
  const words = value.match(/[a-zA-Z0-9]+/g) ?? ["Component"];
  const result = words.map((word) => `${word.charAt(0).toUpperCase()}${word.slice(1)}`).join("");
  return /^[A-Z]/.test(result) ? result : `Component${result}`;
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

function projectElementValue(value: unknown): string {
  if (value === undefined || value === null) return "-";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
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

function formatSignedMaybePercent(value: number | undefined): string {
  if (value === undefined) return "";
  const formatted = formatMaybePercent(Math.abs(value));
  return `${value >= 0 ? "+" : "-"}${formatted}`;
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

function pageNameFromArtifactRoot(root: string): string {
  const parts = root.replace(/\\/g, "/").split("/").filter(Boolean);
  return decodeURIComponent(parts.at(-1) ?? "当前页面");
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

function savedCodegenProjectPath(artifactRoot: string): string | undefined {
  try {
    return window.sessionStorage.getItem(codegenProjectPathKey(artifactRoot)) ?? undefined;
  } catch {
    return undefined;
  }
}

function saveCodegenProjectPath(artifactRoot: string, value: string): void {
  try {
    const key = codegenProjectPathKey(artifactRoot);
    if (value) window.sessionStorage.setItem(key, value);
    else window.sessionStorage.removeItem(key);
  } catch {
    // The in-memory state still preserves the current edit if storage is unavailable.
  }
}

function codegenProjectPathKey(artifactRoot: string): string {
  return `uxcompiler:codegen-project-path:${artifactRoot}`;
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
