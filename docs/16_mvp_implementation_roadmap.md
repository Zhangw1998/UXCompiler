# 16. MVP 实施路线

## 摘要

本文档把完整系统拆成可执行的 MVP 阶段。建议先实现“虚拟规范化设计稿”的核心闭环，再实现高保真渲染和 Diff，最后加入语义提升和增量更新。

---

## MVP 总目标

```text
输入：一个不规范 Figma 移动端 Frame
输出：
1. NormalizedDesignIR
2. 可运行 Flutter 页面
3. assets / theme / i18n
4. screenshot diff report
5. generation manifest
```

---

## Phase 0：工程骨架

### 摘要

建立 monorepo、schema、CLI、样例数据和测试框架。

### 输入

- 项目初始化配置
- 示例 Figma JSON

### 输出

```text
pnpm workspace
packages/ir-schemas
packages/cli
examples/fixtures
```

### 任务

- 定义 JSON Schema。
- 建立 artifact 输出目录。
- 建立 `uxc compile --input sample.json --out artifacts/` 命令。

### 总结

没有工程骨架，后续模块容易变成一次性脚本。

---

## Phase 1：Raw Extraction + Canonical Scene

### 摘要

先不做 AI，完成原始读取和机械清洗。

### 输入

- Figma plugin export 或 mock JSON

### 输出

- `raw_figma_scene.json`
- `canonical_scene.json`
- `node_mapping.json`

### 验收

- 能处理 Text / Rect / Image / Vector / Frame / Group。
- 所有 canonical node 可追溯 source node。
- 不丢 bounds / opacity / effects。

### 总结

这是所有智能推断的基础。

---

## Phase 2：Token Mining

### 摘要

实现 Shadow Design Tokens。

### 输入

- `canonical_scene.json`

### 输出

- `inferred_tokens.json`
- `token_usage_map.json`

### 验收

- 能提取颜色、字体、spacing、radius。
- 生成 Dart token 文件。
- 页面代码不直接写颜色和常用间距。

### 总结

Token Mining 让不规范设计稿具备虚拟设计系统。

---

## Phase 3：Region + Layout Inference

### 摘要

实现页面分区和 Row / Column / Stack / Absolute 判断。

### 输入

- `canonical_scene.json`
- `inferred_tokens.json`

### 输出

- `regions.json`
- `layout_decisions.json`
- 初版 `normalized_design_ir.json`

### 验收

- 简单垂直页面能推断 column。
- 横向按钮组能推断 row。
- 重叠区域能推断 stack。
- 低置信度能 fallback absolute。

### 总结

这是“把混乱设计稿虚拟规范化”的核心 MVP。

---

## Phase 4：Asset + i18n

### 摘要

实现资源导出策略和文本抽取。

### 输入

- `canonical_scene.json`
- `regions.json`

### 输出

- `asset_manifest.json`
- `i18n_manifest.json`
- `assets/`
- `arb/`

### 验收

- SVG / PNG 资源可引用。
- Text 生成 ARB key。
- decorative slice 可导出。

### 总结

资源与文案规范化是可运行 Flutter 页面必须条件。

---

## Phase 5：VisualIR + Fidelity Renderer

### 摘要

先实现高保真渲染，不追求最优雅代码。

### 输入

- `normalized_design_ir.json`
- `asset_manifest.json`

### 输出

- `visual_ir.json`
- Flutter fidelity page

### 验收

- 页面能运行。
- Stack / Positioned 能覆盖自由布局。
- Text / Image / Rect 基础视觉准确。

### 总结

先让任意不规范设计稿可被还原。

---

## Phase 6：Visual Diff

### 摘要

建立还原度验证。

### 输入

- Figma reference screenshot
- Flutter screenshot
- node_pixel_map

### 输出

- `visual_diff_report.json`
- `diff_heatmap.png`

### 验收

- 能生成页面级 score。
- 能输出差异区域。
- 能对文本 baseline / position 做简单 repair。

### 总结

没有 Diff，99%+ 只是主观判断。

---

## Phase 7：AI Semantic Labeling

### 摘要

加入 AI，但只做命名和语义标注。

### 输入

- region summaries
- screenshots
- component candidates

### 输出

- `semantic_labels.json`

### 验收

- JSON Schema 校验通过。
- AI 不输出 Dart。
- 命名能用于文件和 Widget。

### 总结

AI 的第一阶段价值是让代码可读。

---

## Phase 8：Component Mining + Semantic Uplift

### 摘要

将重复结构抽组件，将可语义化区域提升为优雅代码。

### 输入

- `regions.json`
- `semantic_labels.json`
- `visual_ir.json`

### 输出

- `inferred_components.json`
- `semantic_ir.json`
- uplifted Flutter widgets

### 验收

- 至少支持 Button / Card / ListItem。
- 每次 uplift 后 diff 仍达阈值。

### 总结

这一阶段开始显著提升代码质量。

---

## Phase 9：Incremental Regeneration

### 摘要

支持代码再次生成且保留人工修改。

### 输入

- 旧 generation manifest
- 新 normalized IR
- existing Flutter files

### 输出

- patch
- merge report

### 验收

- generated region 可更新。
- 手改区域不被静默覆盖。
- 冲突生成 report。

### 总结

这是从工具走向工程产品的关键。

---

## 推荐里程碑

| 阶段 | 目标 | 是否必须 |
|---|---|---|
| Phase 0-3 | 虚拟规范化核心 | 必须 |
| Phase 4-6 | 高保真可验证生成 | 必须 |
| Phase 7 | AI 命名 | 强烈建议 |
| Phase 8 | 代码优雅化 | 第二阶段 |
| Phase 9 | 增量更新 | 产品化阶段 |

---

## 总结

MVP 不要一上来追求“AI 生成优雅完整项目”。先做 NormalizedDesignIR 和 Fidelity Renderer，再通过 Diff 证明视觉，再逐步语义提升。这个顺序最稳。


---

## Local-first Workbench 增量路线

### Workbench Phase 0：本地工程骨架

#### 摘要

建立 `workbench-web`、`local-api`、`project-store`、`figma-plugin bridge` 的最小联通。

#### 输入

- 现有 monorepo。
- 示例 raw_figma_scene.json。

#### 输出

```text
apps/workbench-web
apps/local-api
packages/project-store
packages/override-engine
.uxcompiler workspace
```

#### 验收

- Workbench 能创建 Project。
- Local API 能保存 snapshot。
- Override 能保存和读取。

#### 总结

这是本地优先平台的基础，不依赖云端。

---

### Workbench Phase 1：Figma Bridge + Snapshot Import

#### 摘要

Figma 插件把选中 Frame 同步到本地 Workbench；连接失败时支持 zip 导入。

#### 输入

- Figma selected Frame。

#### 输出

```text
source_snapshot.json
raw_figma_scene.json
figma_reference.png
raw_assets/
```

#### 验收

- 能从插件同步。
- 能从 zip 导入。
- sourceNodeId 可追溯。

#### 总结

先把真实设计稿数据稳定带入本地平台。

---

### Workbench Phase 2：Review Tasks + Tree Editor

#### 摘要

用户能处理低置信度任务，并通过 Tree Editor 固定层级、改名、锁定策略。

#### 输入

- candidate NormalizedDesignIR。
- normalization_report。

#### 输出

```text
override_set.json
review_tasks.json
reviewed_normalized_design_ir.json
```

#### 验收

- 用户操作全部生成 Override。
- P0 task 可阻止写入项目。
- Tree Editor 修改后可 rebuild IR。

#### 总结

这一阶段实现“人工规范化”。

---

### Workbench Phase 3：Component / Token / Asset / i18n Studios

#### 摘要

用户能确认组件、合并 Token、指定资源策略、确认 i18n key。

#### 输入

- inferred components / tokens / asset / i18n manifests。

#### 输出

```text
component_registry.json
token_registry.json
final_asset_manifest.json
final_i18n_manifest.json
```

#### 验收

- 组件 props 可编辑。
- token merge/split 可保存。
- dynamic text 不会被默认切图。
- 所有可见文本有 key 或 reason。

#### 总结

这一阶段将不规范设计稿转成虚拟设计系统。

---

### Workbench Phase 4：Preview & Diff Runner

#### 摘要

实现 Web Preview 和真实 Flutter Preview。

#### 输入

- reviewed NormalizedDesignIR。
- figma_reference.png。

#### 输出

```text
web_preview.png
flutter_preview.png
diff_heatmap.png
visual_diff_report.json
```

#### 验收

- Flutter SDK 可配置。
- analyze error = 0。
- Diff 能输出 page score 和 region issues。

#### 总结

这一阶段让人工规范化可验证。

---

### Workbench Phase 5：Codegen Review + Incremental Sync

#### 摘要

写入项目之前显示 patch；设计稿变化后复用旧 Override。

#### 输入

- reviewed NormalizedDesignIR。
- existing Flutter project。
- previous snapshot / overrides。

#### 输出

```text
codegen_review.json
files.patch
node_remap_report.json
stale_overrides.json
```

#### 验收

- 不覆盖 manual code。
- generated region 可更新。
- stale overrides 进入 review。

#### 总结

这一阶段让工具可以长期用于真实项目。
