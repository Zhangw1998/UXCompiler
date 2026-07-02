# UXCompiler Normalized Design Pipeline 文档索引

> 版本：v2.1  
> 目标：面向**不规范 Figma 设计稿**，在不修改原设计稿的前提下，自动生成“虚拟规范化设计稿”，再生成高还原、可编辑、可持续迭代的 Flutter UI 代码。

---

## 0. 一句话定位

旧方案偏向：

```text
Figma → MCP / Plugin → Design IR → Flutter Code
```

新方案改为：

```text
Figma Raw Scene
→ Canonical Scene
→ Normalized Design IR
→ VisualIR / SemanticIR
→ Flutter Code
→ Screenshot Diff / Auto Repair
```

系统不要求设计师修改 Figma，也不假设设计稿天然遵守设计系统。系统会从设计稿本身自动推断出：Token、布局、组件、命名、资源策略、代码生成策略，并用视觉回归闭环保证还原度。

---

## 1. 文档阅读顺序

| 顺序 | 文档 | 用途 |
|---:|---|---|
| 1 | [00_product_revision.md](./00_product_revision.md) | 解释为什么要重构旧 PRD，以及哪些旧约束被替换 |
| 2 | [01_system_architecture.md](./01_system_architecture.md) | 系统整体架构、模块边界、数据流 |
| 3 | [02_ir_contracts.md](./02_ir_contracts.md) | RawFigmaScene、CanonicalScene、NormalizedDesignIR、VisualIR、SemanticIR 的职责和 Schema |
| 4 | [03_pipeline_overview.md](./03_pipeline_overview.md) | 端到端 Pipeline 总览，每一步摘要、输入、输出 |
| 5 | [04_step_01_raw_extraction.md](./04_step_01_raw_extraction.md) | Step 1：读取 Figma 原始设计数据 |
| 6 | [05_step_02_canonical_scene.md](./05_step_02_canonical_scene.md) | Step 2：机械清洗，不改视觉 |
| 7 | [06_step_03_token_mining.md](./06_step_03_token_mining.md) | Step 3：从不规范设计稿推断 Shadow Design Tokens |
| 8 | [07_step_04_region_layout_inference.md](./07_step_04_region_layout_inference.md) | Step 4：分区与布局反推 |
| 9 | [08_step_05_component_mining.md](./08_step_05_component_mining.md) | Step 5：从未组件化设计中挖掘虚拟组件 |
| 10 | [09_step_06_semantic_naming_ai.md](./09_step_06_semantic_naming_ai.md) | Step 6：AI 语义命名与角色标注 |
| 11 | [10_step_07_asset_i18n_normalization.md](./10_step_07_asset_i18n_normalization.md) | Step 7：资源、切图、i18n 规范化 |
| 12 | [11_step_08_visual_ir_fidelity_renderer.md](./11_step_08_visual_ir_fidelity_renderer.md) | Step 8：VisualIR 与高保真 Flutter Renderer |
| 13 | [12_step_09_semantic_uplift.md](./12_step_09_semantic_uplift.md) | Step 9：从高保真结构逐步提升为优雅代码 |
| 14 | [13_step_10_flutter_code_generation.md](./13_step_10_flutter_code_generation.md) | Step 10：Flutter AST / 文件生成 / 增量更新 |
| 15 | [14_step_11_visual_diff_repair.md](./14_step_11_visual_diff_repair.md) | Step 11：截图对比、节点归因、自动修复 |
| 16 | [15_ai_collaboration_protocol.md](./15_ai_collaboration_protocol.md) | 给其他 AI 使用的输入输出协议、Prompt 模板、约束 |
| 17 | [16_mvp_implementation_roadmap.md](./16_mvp_implementation_roadmap.md) | MVP 分阶段实施路线、任务拆分、验收标准 |
| 18 | [17_acceptance_testing_checklist.md](./17_acceptance_testing_checklist.md) | 工程验收、质量门禁、测试清单 |
| 19 | [18_agent_task_cards.md](./18_agent_task_cards.md) | 可直接分配给其他 AI / 工程师的任务卡 |
| 20 | [19_appendix_example_schemas.md](./19_appendix_example_schemas.md) | 示例 JSON、策略枚举、Manifest 样例 |
| 21 | [20_local_first_workbench_overview.md](./20_local_first_workbench_overview.md) | 新增：本地优先 Normalization Workbench 总览、平台边界、目录结构 |
| 22 | [21_step_12_figma_bridge_plugin.md](./21_step_12_figma_bridge_plugin.md) | Step 12：Figma Bridge Plugin，负责本地数据桥和选区同步 |
| 23 | [22_step_13_local_project_override_store.md](./22_step_13_local_project_override_store.md) | Step 13：Local Project Store 与 Override Store |
| 24 | [23_step_14_review_task_system.md](./23_step_14_review_task_system.md) | Step 14：Review Task System，把不确定点转成人工任务 |
| 25 | [24_step_15_normalized_tree_editor.md](./24_step_15_normalized_tree_editor.md) | Step 15：Normalized Tree Editor，人工修正虚拟 UI 树 |
| 26 | [25_step_16_component_token_asset_i18n_studio.md](./25_step_16_component_token_asset_i18n_studio.md) | Step 16：Component / Token / Asset / i18n Studios |
| 27 | [26_step_17_preview_diff_runner.md](./26_step_17_preview_diff_runner.md) | Step 17：本地 Preview & Diff Runner |
| 28 | [27_step_18_codegen_review_incremental_sync.md](./27_step_18_codegen_review_incremental_sync.md) | Step 18：Codegen Review 与 Incremental Sync |
| 29 | [28_appendix_workbench_schemas.md](./28_appendix_workbench_schemas.md) | Workbench Project / Override / Task / Preview Schema 示例 |

---

## 2. 新版方案的关键变化

### 2.1 不修改 Figma 原稿

系统只读取 Figma 文件，输出虚拟规范化结果：

```text
inferred_tokens.json
inferred_components.json
normalized_tree.json
asset_manifest.json
normalization_report.json
```

这些文件构成“虚拟规范化设计稿”，后续所有代码生成都基于它们。

### 2.2 AI 不再直接拥有最终 Dart 代码

AI 只负责：

- 语义识别
- 命名
- 组件候选排序
- i18n key 建议
- 低置信度决策辅助
- diff report 修复建议

最终 Dart 由确定性 Compiler / Renderer 生成。

### 2.3 Visual Diff 从“后续扩展”变成核心闭环

当目标是 99%+ 视觉还原时，必须固定 viewport、字体、DPR、主题环境，并自动导出 Figma screenshot 与 Flutter screenshot 做对比。

### 2.4 保留旧 IR 原则，但扩展前置 IR 层

旧的 `Design IR v1` 仍适合作为最终语义 IR，因为它强调 UI Only、Deterministic、Renderer Dumb。但对不规范设计稿，它不能作为第一层输入。新版新增：

```text
RawFigmaScene → CanonicalScene → NormalizedDesignIR → VisualIR / SemanticIR
```



## 2.5 新增：本地优先 Normalization Workbench

当系统需要人工干预来修正规范化结果时，不应修改 Figma 原稿，而应在本地维护一层 Shadow Overrides：

```text
Figma 原稿只读
→ RawFigmaScene
→ 自动 NormalizedDesignIR candidate
→ 用户在 Workbench 中创建 Override
→ Rebuild reviewed NormalizedDesignIR
→ Preview / Diff
→ Codegen Review
```

Workbench 优先本地部署：

```text
Figma Plugin = 数据桥
Local Workbench = 人工规范化界面
Local Project Store = 保存 Override / Snapshot / Preview
Local Flutter Runner = 真实预览与 Diff
Project Writer = patch review 后写入项目
```

这部分从 [20_local_first_workbench_overview.md](./20_local_first_workbench_overview.md) 开始阅读。

---

## 3. 给其他 AI 的执行建议

当你把这套文档交给其他 AI 或 Agent 时，建议使用如下指令：

```text
请按照 README.md 的顺序阅读文档。
先不要写代码。
先输出你将实现的模块、输入输出契约、文件结构和测试计划。
每完成一个 Step，必须产出该 Step 文档里定义的 output artifacts。
不得跳过 NormalizedDesignIR。
不得让 AI 直接生成最终 Dart，最终 Dart 必须由结构化 Renderer 生成。
```

---

## 4. 推荐落地优先级

第一优先级：

```text
Raw Extraction → Canonical Scene → Token Mining → Layout Inference → NormalizedDesignIR → Local Workbench Review
```

第二优先级：

```text
Local Project Store → Override Store → Preview Runner → Screenshot Diff
```

第三优先级：

```text
Component Mining → Semantic Uplift → Clean Flutter Code
```

第四优先级：

```text
Incremental Regeneration → Agent Automation → Multi-page Component Mining
```


---

## 5. v2.1 新增文档说明

v2.1 在 v2.0 的自动规范化 Pipeline 之后，补充了本地优先的人机协同平台。核心新增能力：

```text
- Figma Bridge Plugin。
- Local Project Store / Override Store。
- Review Task System。
- Normalized Tree Editor。
- Component / Token / Asset / i18n Studios。
- Local Preview & Diff Runner。
- Codegen Review。
- Incremental Sync。
```

这些文档用于回答：当“从设计稿反编译虚拟设计系统和规范化 UI 树”需要人工干预时，应该如何搭建平台、如何保存决策、如何预览、如何在本地生成代码。
