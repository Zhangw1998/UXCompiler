# 00. 产品方案修订说明

## 摘要

本文档说明为什么需要从旧版 “Figma → Flutter 智能代码生成插件” 方案升级为 “Normalized Design Pipeline”。旧文档的方向是正确的：提取 Token、导出资源、识别组件、生成 Flutter 代码。但它默认设计稿相对规范，并把高还原度、运行验证和 Diff 放在弱约束或未来扩展里。新目标是：即使设计稿不规范、不能修改 Figma 原稿，也要尽可能高保真生成 Flutter，并保持代码可继续编辑。

---

## 1. 需要替换的旧假设

### 1.1 旧假设：插件不追求 100% 像素级 UI

旧 PRD 中曾把“不追求 100% 还原像素级 UI”作为非目标。新版目标改为：

```text
在指定 viewport / DPR / 字体 / 平台渲染环境下，追求 99%+ 视觉还原。
```

这意味着必须新增：

- Figma reference screenshot 导出
- Flutter screenshot 渲染
- visual diff
- 自动修复循环
- fidelity fallback

### 1.2 旧假设：插件不直接编译或运行 Flutter 项目

如果要做视觉回归，系统必须有本地 CLI / Desktop Helper / Agent 来运行：

```text
dart format
flutter analyze
flutter test / golden
screenshot capture
```

因此新边界应改成：

```text
Figma 插件不直接运行 Flutter，但本地 Compiler / Helper 必须运行 Flutter 验证链路。
```

### 1.3 旧假设：AI 直接参与 Flutter 代码生成

新版调整为：

```text
AI 只输出结构化语义建议，不直接拥有最终 Dart 文件。
```

原因是 99% 还原依赖确定性布局、资源、字体、坐标和 diff 修复；AI 直接写 Dart 容易随机、不可重复、不可测试。

### 1.4 旧假设：Design IR v1 是唯一 IR

旧 `Design IR v1` 强调跨平台最小公分母，并禁止 absolute、constraints、effects、opacity、confidence 等字段。这适合作为最终语义层，但不适合作为不规范设计稿的第一层输入。

新版新增前置层：

```text
RawFigmaScene      // 无损保存 Figma 原始信息
CanonicalScene     // 机械清洗，不改变视觉
NormalizedDesignIR // 自动推断出的虚拟规范化设计稿
VisualIR           // 面向高保真渲染
SemanticIR         // 面向优雅代码生成
```

---

## 2. 新产品定义

### 2.1 产品定位

一个面向 Flutter 工程师和 AI 工程协作团队的：

```text
不规范 Figma 设计稿 → 虚拟规范化设计稿 → 高还原 Flutter UI → 可编辑工程代码
```

的编译系统。

### 2.2 核心目标

- 不修改 Figma 原稿。
- 从设计稿本身推断 Shadow Design System。
- 自动清洗混乱节点层级。
- 自动推断 Row / Column / Grid / Stack / Absolute。
- 自动挖掘未组件化的重复组件。
- 自动导出、命名、去重资源。
- 自动抽取文案和 i18n key。
- 通过 Visual Diff 验证视觉还原。
- 对可语义化区域生成优雅 Flutter 代码。
- 对复杂区域允许局部 high fidelity fallback。

### 2.3 非目标

- 不生成业务逻辑。
- 不承诺任意混乱设计稿都能生成完全手写级优雅代码。
- 不承诺没有响应式信息的设计稿自动具备完美多端适配。
- 不把整页切图作为常规方案。
- 不让 AI 无约束修改已有项目代码。

---

## 3. 修改后的用户流程

```text
1. 用户在 Figma 中选择 Frame / Page / File
2. 插件导出 RawFigmaScene + reference screenshot + assets candidate
3. Local Compiler 构建 CanonicalScene
4. Normalizer 推断 tokens / regions / layouts / components / assets / i18n
5. 生成 NormalizedDesignIR 和 normalization_report
6. Fidelity Renderer 先生成高保真 Flutter UI
7. Visual Diff 验证视觉相似度
8. Semantic Uplift 把可语义化区域提升为优雅代码
9. 再次 Visual Diff，确保语义化没有破坏还原
10. 输出可编辑 Flutter 文件、assets、theme、i18n、manifest
```

---

## 4. 输入

- Figma file key / page id / frame id
- Figma node tree
- 节点截图 / frame screenshot
- 字体、颜色、圆角、阴影、坐标、transform、clip、mask、effect
- 用户项目配置：Flutter 版本、目录结构、i18n、资源目录、代码风格
- 可选：已有 Flutter 组件库 registry

---

## 5. 输出

- `raw_figma_scene.json`
- `canonical_scene.json`
- `inferred_tokens.json`
- `inferred_components.json`
- `normalized_design_ir.json`
- `visual_ir.json`
- `semantic_ir.json`
- `asset_manifest.json`
- `i18n_manifest.json`
- `flutter_generation_manifest.json`
- `visual_diff_report.json`
- Flutter 代码文件与资源文件

---

## 总结

新版不是“更强 Prompt”，而是一个编译器。AI 是辅助推断器，Normalizer 是设计稿规范化核心，Renderer 是确定性代码生成核心，Visual Diff 是质量闭环。旧文档中 Token、组件、资源、i18n、Agent 预埋等方向保留；旧文档中“不追求像素级还原”“Diff 不需要”“AI 直接生成最终代码”等约束需要替换。
