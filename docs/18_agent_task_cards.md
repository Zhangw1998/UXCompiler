# 18. 可分配给 AI / 工程师的任务卡

## 摘要

本文档把功能拆成可以交给其他 AI 或工程师执行的任务卡。每张任务卡包含摘要、输入、输出、实施要点和完成标准。

---

## Task 01：实现 RawFigmaScene Schema

### 摘要

定义 TypeScript 类型和 JSON Schema，覆盖 Figma 原始字段。

### 输入

- `02_ir_contracts.md`
- Figma mock node JSON

### 输出

- `packages/ir-schemas/src/raw-figma-scene.ts`
- `schemas/raw_figma_scene.schema.json`
- 单元测试

### 完成标准

- 能校验示例 JSON。
- 支持 sourceNodeId、bounds、styles、effects、children。
- 不把 absolute / effects / opacity 排除在 Raw 层之外。

### 总结

这是所有数据层的基础。

---

## Task 02：实现 Canonicalizer

### 摘要

把 RawFigmaScene 转成 CanonicalScene。

### 输入

- `raw_figma_scene.json`

### 输出

- `canonical_scene.json`
- `node_mapping.json`
- `canonicalization_report.json`

### 完成标准

- 坐标转为 root-relative。
- wrapper 压平可解释。
- 所有节点可追溯。

### 总结

先做机械清洗，不做语义推断。

---

## Task 03：实现 Token Miner

### 摘要

从 CanonicalScene 统计并聚类 Token。

### 输入

- `canonical_scene.json`

### 输出

- `inferred_tokens.json`
- `token_usage_map.json`

### 完成标准

- 支持颜色、字体、spacing、radius。
- 保留 aliases 和 confidence。
- 生成 Dart token 文件草案。

### 总结

Token 是虚拟设计系统的核心。

---

## Task 04：实现 Layout Inferencer

### 摘要

根据几何关系推断 Row / Column / Grid / Stack / Absolute。

### 输入

- `canonical_scene.json`
- `inferred_tokens.json`

### 输出

- `layout_candidates.json`
- `layout_decisions.json`

### 完成标准

- 每个 decision 有 score、evidence、fallback。
- 至少 5 个 fixture 测试通过。

### 总结

该模块决定代码能否从绝对定位提升到语义布局。

---

## Task 05：实现 Region Segmenter

### 摘要

将页面拆成 app_bar、hero、content、list、bottom 等区域。

### 输入

- `canonical_scene.json`

### 输出

- `regions.json`
- region screenshots metadata

### 完成标准

- 主要视觉内容被 region 覆盖。
- region bounds 正确。
- 大间距断点有效。

### 总结

先分区，再做语义和代码生成。

---

## Task 06：实现 Component Miner

### 摘要

发现重复结构并抽象虚拟组件。

### 输入

- `regions.json`
- `layout_decisions.json`

### 输出

- `inferred_components.json`
- `component_instance_map.json`

### 完成标准

- 支持 Button / Card / ListItem。
- props 来自实例差异。
- 低置信度不自动抽公共组件。

### 总结

组件挖掘负责代码可维护性。

---

## Task 07：实现 AI Adapter

### 摘要

封装 AI 请求和响应校验。

### 输入

- `15_ai_collaboration_protocol.md`
- region summaries

### 输出

- `semantic_labels.json`
- `ai_decision_report.json`

### 完成标准

- JSON only。
- schema validate。
- sourceId validate。
- 禁止 Dart 输出。

### 总结

AI 是受控标注器，不是代码生成器。

---

## Task 08：实现 Asset + i18n Normalizer

### 摘要

输出资源清单、资源文件、ARB 文案。

### 输入

- `canonical_scene.json`
- `semantic_labels.json`

### 输出

- `asset_manifest.json`
- `i18n_manifest.json`
- assets files
- arb files

### 完成标准

- 所有 asset path 存在。
- 所有文本有 i18n key 或 reason。
- decorative slice 不包含交互文本。

### 总结

资源和文案规范化保证代码可运行、可国际化。

---

## Task 09：实现 VisualIR Builder

### 摘要

将 NormalizedDesignIR 转成高保真 VisualIR。

### 输入

- `normalized_design_ir.json`
- `asset_manifest.json`

### 输出

- `visual_ir.json`
- `node_pixel_map.json`

### 完成标准

- 支持 scene / stack / positioned / rect / text / image / slice。
- 每个 visible node 有 render decision。

### 总结

VisualIR 是视觉兜底。

---

## Task 10：实现 Flutter Fidelity Renderer

### 摘要

把 VisualIR 转成可运行 Flutter 页面。

### 输入

- `visual_ir.json`
- tokens / assets / i18n

### 输出

- Flutter Dart files
- generation manifest

### 完成标准

- `dart format` 通过。
- `flutter analyze` 无 error。
- Stack / Positioned 视觉正确。

### 总结

先保证任意设计稿都能被高保真渲染。

---

## Task 11：实现 Visual Diff Engine

### 摘要

对比 Figma 和 Flutter 截图。

### 输入

- `figma_reference.png`
- `flutter_rendered.png`
- `node_pixel_map.json`

### 输出

- `visual_diff_report.json`
- `diff_heatmap.png`

### 完成标准

- 输出 visualScore。
- 输出 region/node 差异。
- 能提出简单 repair patch。

### 总结

没有 Diff，就无法证明还原度。

---

## Task 12：实现 Semantic Uplift

### 摘要

把 fidelity region 提升成语义 widget。

### 输入

- `visual_ir.json`
- `semantic_labels.json`
- `inferred_components.json`

### 输出

- `semantic_ir.json`
- `uplift_decisions.json`

### 完成标准

- uplift 后跑 diff。
- 不达标回退。
- 支持 Button / Card / Column region。

### 总结

这是从“像”走向“可维护”的关键。

---

## Task 13：实现 Incremental Project Writer

### 摘要

支持重复生成并保留人工修改。

### 输入

- 新 generation manifest
- 旧 generation manifest
- existing Dart files

### 输出

- file patches
- merge report

### 完成标准

- 只覆盖 generated region。
- 手改冲突可检测。
- 支持 promote widget。

### 总结

产品化必须解决重复生成问题。


---

## Task 14：实现 Local Project Store

### 摘要

建立 SQLite + file storage 的本地项目存储，保存 snapshots、overrides、tasks、previews、codegen builds。

### 输入

- `20_local_first_workbench_overview.md`
- `22_step_13_local_project_override_store.md`

### 输出

- `packages/project-store`
- `db.sqlite` schema
- `.uxcompiler/` 目录管理
- 单元测试

### 完成标准

- 能创建 / 读取 / 更新 Project。
- 能保存 SourceSnapshot。
- 能保存 OverrideSet。
- 能导入 / 导出项目 zip。

### 总结

本地存储是“不修改 Figma”的基础。

---

## Task 15：实现 Override Engine

### 摘要

实现 Override schema、应用顺序、冲突检测和 stale override 检测。

### 输入

- `override_set.json`
- candidate NormalizedDesignIR

### 输出

- reviewed NormalizedDesignIR
- override_conflict_report
- stale_override_report

### 完成标准

- 同一输入输出确定性一致。
- 支持 node_parent / naming / layout / render / token / asset / i18n overrides。
- 冲突可报告。

### 总结

Override Engine 是人工规范化的确定性执行层。

---

## Task 16：实现 Figma Bridge Plugin

### 摘要

插件读取选中 Frame，导出 snapshot，并连接本地 Workbench。

### 输入

- Figma selection
- localhost config

### 输出

- raw_figma_scene.json
- figma_reference.png
- raw_assets
- extraction_report.json

### 完成标准

- 支持 localhost sync。
- 支持离线 zip 导出。
- 支持 selection sync。
- 不写 Figma pluginData 保存主数据。

### 总结

插件是数据桥，不是平台主体。

---

## Task 17：实现 Review Task Engine

### 摘要

把低置信度和高风险问题转成任务卡。

### 输入

- normalization_report
- visual_diff_report
- stale_override_report

### 输出

- review_tasks.json

### 完成标准

- 支持 P0/P1/P2。
- suggestedAction 生成合法 Override。
- P0 阻止 Codegen Write。

### 总结

Review Task Engine 降低人工干预成本。

---

## Task 18：实现 Normalized Tree Editor

### 摘要

实现虚拟 UI 树编辑器，支持层级、区域、命名、布局和渲染策略调整。

### 输入

- normalized_design_ir.json
- source_node_mapping.json
- override_set.json

### 输出

- override mutations
- reviewed NormalizedDesignIR preview

### 完成标准

- 支持拖拽层级。
- 支持 Create/Merge/Split Region。
- 支持 Force layout/render strategy。
- 阻止循环和非法引用。

### 总结

Tree Editor 是人工规范化主界面。

---

## Task 19：实现 Component / Token / Asset / i18n Studios

### 摘要

实现四个审查工作台，让用户确认组件、Token、资源和文案。

### 输入

- inferred_components
- inferred_tokens
- asset_manifest
- i18n_manifest

### 输出

- component_registry
- token_registry
- final_asset_manifest
- final_i18n_manifest
- overrides

### 完成标准

- 组件 props 可编辑。
- Token 可 merge/split/rename。
- 资源策略可切换。
- i18n key 可确认。

### 总结

Studios 将自动推断结果提升为虚拟设计系统。

---

## Task 20：实现 Local Preview & Diff Runner

### 摘要

实现 Web Preview、Flutter Preview、Diff Heatmap 和 Diff Issue 映射。

### 输入

- reviewed NormalizedDesignIR
- figma_reference.png
- VisualIR / SemanticIR

### 输出

- web_preview.png
- flutter_preview.png
- diff_heatmap.png
- visual_diff_report.json

### 完成标准

- Web Preview 可快速渲染。
- Flutter Preview 可执行 analyze。
- Diff 输出 page score 和 node/region issues。
- repair patch 可生成。

### 总结

Preview Runner 让人工规范化可验证。

---

## Task 21：实现 Codegen Review

### 摘要

写入 Flutter 项目前展示所有文件、patch、assets、arb、风险和视觉分数。

### 输入

- reviewed NormalizedDesignIR
- visual_diff_report
- existing Flutter project

### 输出

- codegen_review.json
- file patches
- generation manifest

### 完成标准

- analyze error 阻止写入。
- P0 task 阻止写入。
- 只覆盖 generated region。
- manual code 不被覆盖。

### 总结

Codegen Review 是真实项目安全门禁。

---

## Task 22：实现 Incremental Sync

### 摘要

设计稿更新后，重新匹配节点并复用旧 Override。

### 输入

- old snapshot
- new snapshot
- old override_set
- stable node keys

### 输出

- node_remap_report.json
- reapplied_overrides.json
- stale_overrides.json
- incremental_review_tasks.json

### 完成标准

- nodeId 精确匹配优先。
- visualHash/textHash fallback。
- 低置信度 remap 进入 review。
- stale override 不静默应用。

### 总结

Incremental Sync 让平台可以长期使用。
