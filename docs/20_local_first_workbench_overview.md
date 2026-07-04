# 20. Local-first Normalization Workbench 总览

## 摘要

本文档补充“人工干预 + 预览”的平台方案。系统不修改 Figma 原稿，而是在本地维护一层 **Shadow Normalization**：用户在 Workbench 中修正规范化结果，例如固定层级、改名、确认组件、合并 Token、指定资源策略、查看预览与 Diff。所有人工操作都保存为结构化 `Override`，并在重新生成 `NormalizedDesignIR` 时确定性应用。

本阶段优先采用 **Local-first**：Figma 插件只做数据桥；Workbench、Project Store、Compiler、Flutter Preview Runner 全部运行在用户本机，避免上传设计稿和 Flutter 项目。

---

## 1. 背景与目标

旧 Pipeline 可以自动从不规范设计稿推断出虚拟设计系统和规范化 UI 树，但仅靠自动推断会遇到不确定问题：

```text
- 某些节点应固定到 Header / Content / Overlay 的哪个层级？
- 某些 Group 是否应该抽成组件？
- 某个区域应该用 Row / Column / Stack / Asset Slice？
- Token 聚类是否过度合并？
- AI 命名是否符合项目语义？
- 语义化重构后视觉是否仍然接近 Figma？
```

因此需要一个本地工作台，目标是：

```text
自动生成 80%～90% 的规范化结果；
人工只处理低置信度、高风险、影响代码质量的 10%～20%；
人工操作保存为可复用 Override；
后续同步设计稿时自动复用 Override；
每次变更都能预览和做视觉 Diff。
```

---

## 2. 一句话定位

```text
Normalization Workbench 不是 Figma 编辑器，也不是单纯代码生成面板；
它是一个本地虚拟规范化工作台，用于审查、修正、预览和版本化 NormalizedDesignIR。
```

原始 Figma 文件不变：

```text
Figma 原稿
  ↓ 只读
RawFigmaScene
  ↓ 自动推断
NormalizedDesignIR candidate
  ↓ 人工 Override
NormalizedDesignIR reviewed
  ↓ 预览 / Diff / 代码生成
Flutter UI
```

---

## 3. 本地优先架构

```text
┌─────────────────────────────┐
│        Figma Plugin          │
│  selection / export / sync   │
└──────────────┬──────────────┘
               │ localhost / file export
               ▼
┌─────────────────────────────┐
│ Local Workbench Web App      │
│ Review / Tree / Studio / UI  │
└──────────────┬──────────────┘
               │ local API
               ▼
┌─────────────────────────────┐
│ Local Normalization Service  │
│ Canonical / Token / Layout   │
│ Component / AI Adapter       │
└──────────────┬──────────────┘
               │ artifacts
               ▼
┌─────────────────────────────┐
│ Local Project Store          │
│ SQLite + .uxcompiler files   │
└──────────────┬──────────────┘
               │ build request
               ▼
┌─────────────────────────────┐
│ Local Flutter Preview Runner │
│ temp app / analyze / shot    │
│ visual diff / repair         │
└──────────────┬──────────────┘
               │ approved patch
               ▼
┌─────────────────────────────┐
│ Project Writer               │
│ generated regions / patches  │
└─────────────────────────────┘
```

---

## 4. 模块边界

### 4.1 Figma Plugin

职责：

```text
- 读取选中 Frame / Page。
- 导出 raw_figma_scene.json。
- 导出 figma_reference.png。
- 导出候选资源。
- 同步当前 Figma selection 到 Workbench。
- 接收 Workbench 的 locate/highlight 请求。
```

不负责：

```text
- 不保存主要 Override。
- 不直接写 Flutter 项目。
- 不运行 flutter analyze / test。
- 不做复杂树编辑。
```

### 4.2 Local Workbench Web App

职责：

```text
- Project Dashboard。
- Review Task List。
- Normalized Tree Editor。
- Component Studio。
- Token Studio。
- Asset / i18n Studio。
- Preview & Diff。
- Codegen Review。
```

Preview & Diff 中的修复按钮会把接受的 visual diff 修复写入 `override_set.json`，同时生成 `repair_patch.json` 和 `repair_iteration_log.json`。当 `repair_patch.json` 仍处于 `applied` 状态时，Workbench 会显示 Rollback Repair，可将最近一次修复回滚为禁用 override 或恢复旧 override，并重新生成 review tasks。

Component / Token / Asset / i18n Studios 的人工操作也必须以 `ovr_studio_*` override 形式保存。Workbench 会在 Studio 页面展示最近一次 Studio 操作，并允许禁用该操作对应的 active override，然后基于新的 `override_set.json` 重新生成 component registry、token registry、final asset/i18n manifests 与 review tasks。

### 4.3 Local Normalization Service

职责：

```text
- 运行 Raw → Canonical → Normalized Pipeline。
- 应用 OverrideSet。
- 生成 Review Tasks。
- 调用 AI Adapter 生成语义建议。
- 输出 artifacts。
```

### 4.4 Local Project Store

职责：

```text
- 保存 source snapshots。
- 保存 override sets。
- 保存 review tasks。
- 保存 preview artifacts。
- 保存 codegen build artifacts。
- 支持导入 / 导出项目包。
```

### 4.5 Local Flutter Preview Runner

职责：

```text
- 生成临时 Flutter preview app。
- 执行 dart format / flutter analyze。
- 截取真实 Flutter screenshot。
- 与 Figma reference 做 diff。
- 输出 visual_diff_report.json 和 diff_heatmap.png。
```

---

## 5. 本地目录结构

```text
.uxcompiler/
  workspace.json
  projects/
    proj_login_page/
      project.json
      settings.json
      snapshots/
        snap_001/
          raw_figma_scene.json
          canonical_scene.json
          figma_reference.png
          assets/
          extraction_report.json
      normalized/
        normalized_ir_001.json
        normalization_report_001.json
      overrides/
        override_set_001.json
        override_history.ndjson
      review_tasks/
        tasks_001.json
      previews/
        preview_001/
          web_preview.png
          flutter_preview.png
          diff_heatmap.png
          visual_diff_report.json
      codegen/
        build_001/
          flutter_generation_manifest.json
          pubspec.yaml.patch
          files.patch
  cache/
    figma_exports/
    flutter_tmp/
    ai_responses/
```

MVP 可以使用 SQLite 记录索引，同时把大 JSON、图片、资源放在文件系统：

```text
SQLite：项目、版本、任务、状态、索引。
File Store：截图、assets、IR JSON、diff heatmap、patch。
```

---

## 6. Workbench 主导航

```text
Project
Review Tasks
Tree
Components
Tokens
Assets
i18n
Preview
Codegen
Settings
```

### 6.1 Project

展示项目来源、同步状态、当前 NormalizedIR 版本、待处理任务、视觉分数、代码生成状态。

### 6.2 Review Tasks

只展示低置信度或高风险问题，让用户通过任务卡处理，不要求用户理解全部节点树。

### 6.3 Tree

编辑虚拟规范化 UI 树：固定层级、合并区域、拆分区域、改名、锁定布局策略。

### 6.4 Components

确认组件候选，编辑 props / slots / variants，映射已有 Flutter Widget。

### 6.5 Tokens

审查 Shadow Tokens，合并 / 拆分 / 重命名 / 映射项目现有 Token。

### 6.6 Assets / i18n

确认切图策略、资源命名、导出格式、文案 key、placeholder、ARB description。

### 6.7 Preview

展示 Figma Reference、Normalized Web Preview、Flutter Screenshot、Diff Heatmap，并允许点击差异区域定位节点。

### 6.8 Codegen

展示将创建/修改的文件、patch、assets、arb、analyze 结果，用户确认后写入真实项目。

---

## 7. 输入

```text
- Figma selected Frame / Page。
- raw_figma_scene.json。
- figma_reference.png。
- exported assets。
- 自动推断 artifacts。
- AI semantic suggestions。
- 用户 Override 操作。
- 现有 Flutter 项目路径和项目规范。
```

---

## 8. 输出

```text
- override_set.json。
- reviewed normalized_design_ir.json。
- review_tasks.json。
- preview_artifacts。
- visual_diff_report.json。
- codegen_manifest.json。
- Flutter files / patches / assets / arb。
```

---

## 9. 质量门禁

```text
- Workbench 中所有人工操作必须保存为结构化 Override。
- 同一 RawFigmaScene + 同一 OverrideSet 必须生成同一 NormalizedDesignIR。
- Override 不能直接修改 RawFigmaScene。
- P0 Review Task 未处理时不能写入真实 Flutter 项目。
- Preview Runner 不可用时，只允许导出 IR 和 Web Preview，不允许标记 99%+ 通过。
```

---

## 10. 失败与 fallback

```text
Workbench 连接不上 Figma Plugin：
- 支持从插件导出 zip，再手动导入 Workbench。

Flutter SDK 不可用：
- 跳过真实 Flutter Preview，只显示 Web Preview，并标记未验证。

AI Adapter 不可用：
- 使用规则命名和 node hash，创建 naming review tasks。

Override 无法应用：
- 标记 stale_override，进入 Review Tasks。

设计稿巨大：
- 先按选中 Frame 项目化，不做全文件分析。
```

---

## 总结

Local-first Workbench 是本系统从“自动生成器”升级为“可用工程平台”的关键。它不修改 Figma，而是保存可版本化、可复用、可预览、可审计的 Shadow Overrides，让不规范设计稿可以被人机协同地规范化，并稳定生成高还原、可维护的 Flutter 代码。
