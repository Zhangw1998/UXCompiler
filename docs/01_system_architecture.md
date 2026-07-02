# 01. 系统总体架构

## 摘要

本系统采用 “Figma Plugin + Local Workbench + Local Compiler + AI Agent + Verification Runner” 五段式架构。Figma 插件只负责读取设计和导出数据；Local Compiler 负责规范化与代码生成；AI Agent 负责语义辅助；Verification Runner 负责 Flutter 编译、截图、Diff 和修复闭环。

---

## 1. 总体架构图

```text
┌────────────────────────┐
│       Figma Plugin      │
│  selection / export     │
└───────────┬────────────┘
            │ raw scene, screenshot, assets
            ▼
┌────────────────────────┐
│     Local Compiler      │
│ raw → canonical → norm  │
└───────────┬────────────┘
            │ normalized IR
            ▼
┌────────────────────────┐
│     Flutter Generator   │
│ VisualIR / SemanticIR   │
└───────────┬────────────┘
            │ dart files, assets, arb
            ▼
┌────────────────────────┐
│ Verification Runner     │
│ analyze / screenshot    │
│ diff / repair           │
└───────────┬────────────┘
            │ reports, patches
            ▼
┌────────────────────────┐
│        AI Agent         │
│ semantic / naming / fix │
└────────────────────────┘
```

---

## 2. 模块边界

### 2.1 Figma Plugin

职责：

- 读取用户选择的 Frame / Page / File。
- 提取 Figma 节点树。
- 导出 frame reference screenshot。
- 导出候选资源，包括 icon、image、复杂装饰区域。
- 收集用户配置。
- 展示分析进度和报告。

不负责：

- 不直接写入 Flutter 项目。
- 不直接运行 Flutter 命令。
- 不直接让 AI 生成最终 Dart。

### 2.2 Local Compiler

职责：

- 构建 RawFigmaScene。
- 构建 CanonicalScene。
- Token Mining。
- Region Segmentation。
- Layout Inference。
- Component Mining。
- Asset / i18n Normalization。
- 构建 NormalizedDesignIR。
- 生成 VisualIR / SemanticIR。

### 2.3 Flutter Generator

职责：

- 生成 Flutter Widget Tree。
- 生成 Dart AST 或结构化代码模板。
- 生成 theme、spacing、text styles、assets index、arb。
- 维护 generated region。
- 执行增量更新和冲突检测。

### 2.4 Verification Runner

职责：

- `dart format`
- `flutter analyze`
- Flutter screenshot render
- Golden / visual diff
- node-level diff attribution
- 自动修复候选 patch

### 2.5 AI Agent

职责：

- 区域语义识别。
- 节点和资源命名。
- 组件候选排序。
- i18n key 建议。
- 低置信度布局辅助判断。
- 根据 diff report 提供修复建议。

硬约束：

```text
AI 不直接输出最终 Dart 文件。
AI 不覆盖 compiler 的高置信度确定性判断。
AI 输出必须是 JSON，并符合 schema。
```

---

## 3. 数据流

```text
raw_figma_scene.json
  ↓
canonical_scene.json
  ↓
inferred_tokens.json
inferred_components.json
asset_manifest.json
i18n_manifest.json
  ↓
normalized_design_ir.json
  ↓
visual_ir.json + semantic_ir.json
  ↓
flutter_generation_manifest.json
  ↓
flutter files / assets / arb
  ↓
visual_diff_report.json
  ↓
repair_patch.json
```

---

## 4. 技术栈建议

| 层 | 建议技术 | 理由 |
|---|---|---|
| Figma Plugin | TypeScript + Figma Plugin API | 原生读取节点、导出资源 |
| Local Compiler | TypeScript / Node.js | 与 Figma 数据结构贴近，便于 JSON pipeline |
| AI Adapter | TypeScript | 统一 schema 校验和 prompt 封装 |
| Flutter Generator | TypeScript 结构化模板 + Dart formatter | 稳定可控 |
| Visual Diff | Node.js + image processing / Flutter test | 便于本地闭环 |
| CLI | Node.js + pnpm monorepo | 与旧 MVP 技术方向一致 |

---

## 5. 推荐 Monorepo 结构

```text
uxcompiler/
  apps/
    figma-plugin/
    desktop-helper/
    cli/
  packages/
    figma-extractor/
    scene-canonicalizer/
    token-miner/
    layout-inferencer/
    component-miner/
    ai-adapter/
    ir-schemas/
    flutter-generator/
    visual-diff/
    project-writer/
  examples/
    flutter_app/
    figma_exports/
  docs/
```

---

## 6. 输入

- Figma selection / file metadata
- Raw node JSON
- Reference screenshot
- Exported asset bytes / names
- User config
- Optional component registry
- Optional existing Flutter project path

---

## 7. 输出

- 一套 IR JSON artifacts
- Flutter 源码
- 资源文件
- ARB 文案文件
- 验证报告
- 可审计 manifest

---

## 总结

系统必须把“读取 Figma、规范化、生成代码、验证还原”拆成独立模块。这样即使未来更换 AI 模型、Flutter 版本、Figma 数据来源，核心 IR 和 Compiler 仍然稳定。


---

## 8. v2.1 补充：Local-first Normalization Workbench

当自动 Normalization 需要人工干预时，系统新增本地 Workbench。它位于自动规范化 Pipeline 与最终 Codegen 之间：

```text
Auto Normalization
  ↓ candidate NormalizedDesignIR
Local Workbench Review
  ↓ OverrideSet
Reviewed NormalizedDesignIR
  ↓ Preview / Diff
Codegen Review
```

### 8.1 为什么优先本地

```text
- 设计稿和 Flutter 项目通常包含商业敏感信息。
- Flutter Preview 需要访问本机 Flutter SDK 和项目依赖。
- 代码写入、patch review、analyze 更适合在本机执行。
- MVP 不需要多人协作和云权限系统。
```

### 8.2 新增模块

```text
apps/
  figma-plugin/
  workbench-web/
  local-api/
  flutter-preview-runner/

packages/
  project-store/
  override-engine/
  review-task-engine/
  workbench-schemas/
  patch-writer/
```

### 8.3 新增数据流

```text
source_snapshot.json
  ↓
normalized_design_ir.candidate.json
  ↓ user actions
override_set.json
  ↓ deterministic apply
normalized_design_ir.reviewed.json
  ↓
preview_artifact.json
  ↓
codegen_review.json
```

### 8.4 新增质量规则

```text
- 用户操作不直接修改 Figma，也不直接修改 RawFigmaScene。
- 所有人工决策必须保存为 Override。
- P0 Review Task 未处理时不能写入真实 Flutter 项目。
- Web Preview 只能作为快速反馈，最终还原度以 Flutter Preview + Diff 为准。
```
