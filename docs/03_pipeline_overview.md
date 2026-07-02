# 03. Pipeline 总览

## 摘要

本文档列出完整端到端 Pipeline。每一步都必须有明确的输入、输出、质量门禁和失败 fallback。其他 AI 或工程师可以按此文档逐步实现，不能跳过中间 artifacts。

---

## Step 1：Raw Figma Extraction

### 摘要

读取 Figma 原始节点、截图和资源候选，不做任何语义推断。

### 输入

- Figma file/page/frame id
- 用户选择范围
- 用户导出配置

### 输出

- `raw_figma_scene.json`
- `figma_reference.png`
- `raw_assets/`
- `extraction_report.json`

### 总结

这是证据层，后续所有推断都必须能追溯到 Raw 数据。

---

## Step 2：Canonical Scene

### 摘要

机械清洗节点树，删除无效节点、统一坐标、标记复杂效果。

### 输入

- `raw_figma_scene.json`

### 输出

- `canonical_scene.json`
- `canonicalization_report.json`

### 总结

清洗不等于语义化，不允许破坏视觉。

---

## Step 3：Token Mining

### 摘要

从没有 Variables / Styles 的设计稿中统计并聚类出 Shadow Design Tokens。

### 输入

- `canonical_scene.json`
- 可选 Figma Variables / Styles

### 输出

- `inferred_tokens.json`
- `token_usage_map.json`

### 总结

Token 是后续优雅代码和视觉一致性的基础。

---

## Step 4：Region Segmentation + Layout Inference

### 摘要

先把页面切成区域，再从坐标推断 Row / Column / Grid / Stack / Absolute。

### 输入

- `canonical_scene.json`
- `inferred_tokens.json`

### 输出

- `regions.json`
- `layout_candidates.json`
- `layout_decisions.json`

### 总结

不规范设计稿的规范化核心在这一层。

---

## Step 5：Component Mining

### 摘要

从未组件化设计稿中发现重复结构，抽象虚拟组件。

### 输入

- `regions.json`
- `layout_candidates.json`
- text / image / style signatures

### 输出

- `inferred_components.json`
- `component_instance_map.json`

### 总结

组件挖掘能让代码从“能跑”变成“可维护”。

---

## Step 6：Semantic Naming + AI Labeling

### 摘要

AI 基于截图、结构、文本和候选信息，为区域、节点、组件、资源和文案命名。

### 输入

- region screenshots
- normalized candidates
- text contents
- component candidates

### 输出

- `semantic_labels.json`
- `ai_decision_report.json`

### 总结

AI 只做标注和候选排序，不直接生成最终 Dart。

---

## Step 7：Asset + i18n Normalization

### 摘要

判断哪些节点应保留为 Text，哪些导出为 SVG / PNG / WebP，哪些作为 decorative slice。

### 输入

- `canonical_scene.json`
- `semantic_labels.json`
- `inferred_components.json`

### 输出

- `asset_manifest.json`
- `i18n_manifest.json`
- `assets/`
- `arb/`

### 总结

可交互和需要国际化的内容不能轻易切图，装饰性复杂视觉可以局部切图。

---

## Step 8：VisualIR + Fidelity Renderer

### 摘要

先生成一个尽可能像 Figma 的视觉版本，作为还原度基线。

### 输入

- `normalized_design_ir.json`
- `asset_manifest.json`

### 输出

- `visual_ir.json`
- fidelity Flutter widgets
- `fidelity_generation_manifest.json`

### 总结

即使设计稿混乱，也必须先兜住视觉。

---

## Step 9：Semantic Uplift

### 摘要

把可以语义化的区域从 Stack / absolute / slice 提升为 Row / Column / reusable widget。

### 输入

- `visual_ir.json`
- `semantic_labels.json`
- `inferred_components.json`
- diff baseline

### 输出

- `semantic_ir.json`
- `uplift_decisions.json`

### 总结

每次语义提升都必须重新验证视觉，不达标就回退。

---

## Step 10：Flutter Code Generation

### 摘要

使用结构化 Renderer 生成 Dart、theme、assets、i18n 和 manifest。

### 输入

- `visual_ir.json`
- `semantic_ir.json`
- `inferred_tokens.json`
- `asset_manifest.json`
- `i18n_manifest.json`

### 输出

- Flutter source files
- `pubspec.yaml` patch
- `assets.gen.dart`
- `flutter_generation_manifest.json`

### 总结

最终代码不能是 AI 拼接字符串，必须通过结构化生成。

---

## Step 11：Visual Diff + Auto Repair

### 摘要

渲染 Flutter 页面截图，与 Figma reference screenshot 对比，定位差异并自动修复。

### 输入

- `figma_reference.png`
- Flutter screenshot
- node-to-pixel map
- generation manifest

### 输出

- `visual_diff_report.json`
- `repair_patch.json`
- patched Flutter files / IR patches

### 总结

这是达到 99%+ 的必要闭环，不是可选优化。


---

## Step 12：Figma Bridge Plugin

### 摘要

本地优先平台的数据桥。读取 Figma 选中 Frame，导出 RawFigmaScene、reference screenshot 和资源候选，并同步 selection 到 Workbench。

### 输入

- Figma selected Frame / Page。
- 导出配置。
- Local Workbench 连接信息。

### 输出

- `raw_figma_scene.json`
- `figma_reference.png`
- `raw_assets/`
- `extraction_report.json`

### 总结

插件只读 Figma，不保存主 Override，不运行 Flutter。

---

## Step 13：Local Project Store + Override Store

### 摘要

保存 SourceSnapshot、NormalizedIR、人工 Override、Review Tasks、Preview Artifacts、Codegen Builds。

### 输入

- snapshot artifacts。
- 用户人工操作。
- preview / codegen 输出。

### 输出

- `project.json`
- `override_set.json`
- `review_tasks.json`
- `preview_artifacts.json`

### 总结

这是“不修改 Figma 但能人工规范化”的基础。

---

## Step 14：Review Task System

### 摘要

把低置信度和高风险推断转成可处理任务。

### 输入

- `normalization_report.json`
- `visual_diff_report.json`
- `stale_override_report.json`

### 输出

- `review_tasks.json`
- task action 生成的 overrides

### 总结

用户只处理系统没把握的地方。

---

## Step 15：Normalized Tree Editor

### 摘要

人工修正虚拟规范化 UI 树：固定层级、创建区域、合并拆分、改名、锁定布局与渲染策略。

### 输入

- reviewed / candidate `normalized_design_ir.json`
- source node mapping
- current override set

### 输出

- tree / naming / layout / render overrides
- updated reviewed NormalizedDesignIR

### 总结

编辑的是 Shadow UI Tree，不是 Figma 原树。

---

## Step 16：Component / Token / Asset / i18n Studios

### 摘要

人工确认虚拟组件、Shadow Tokens、资源策略和 i18n key。

### 输入

- inferred components / tokens / assets / i18n manifests
- semantic labels
- current overrides

### 输出

- component registry
- token registry
- final asset manifest
- final i18n manifest

### 总结

这一层把混乱设计稿提升为虚拟设计系统。

---

## Step 17：Local Preview & Diff Runner

### 摘要

提供 Web Preview 和真实 Flutter Preview，并与 Figma reference screenshot 做视觉 Diff。

### 输入

- reviewed NormalizedDesignIR
- VisualIR / SemanticIR
- Figma reference screenshot

### 输出

- `flutter_preview.png`
- `diff_heatmap.png`
- `visual_diff_report.json`
- `repair_patch.json`

### 总结

人工规范化必须可预览、可验证、可回滚。

---

## Step 18：Codegen Review + Incremental Sync

### 摘要

写入 Flutter 项目前展示文件、patch、assets、arb、visual score 和 analyze 结果；设计稿更新后复用旧 Override。

### 输入

- reviewed NormalizedDesignIR
- preview/diff report
- existing Flutter project
- previous generation manifest

### 输出

- `codegen_review.json`
- `flutter_generation_manifest.json`
- patches
- `incremental_sync_report.json`

### 总结

这是从一次性工具走向长期工程平台的关键。
