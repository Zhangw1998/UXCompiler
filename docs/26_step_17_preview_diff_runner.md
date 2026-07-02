# 26. Step 17：Local Preview & Diff Runner

## 摘要

Preview & Diff Runner 让人工规范化过程可视化、可验证。它提供两种预览：快速 Web Preview 用于编辑时即时反馈；真实 Flutter Preview 用于最终还原度验证，并与 Figma Reference Screenshot 做视觉 Diff。

---

## 输入

```text
- figma_reference.png。
- normalized_design_ir.json。
- visual_ir.json。
- semantic_ir.json。
- inferred_tokens.json。
- asset_manifest.json。
- i18n_manifest.json。
- current override_set.json。
- Flutter project settings。
```

---

## 输出

```text
- web_preview.png 或 canvas state。
- flutter_preview.png。
- diff_heatmap.png。
- visual_diff_report.json。
- diff_issues.json。
- repair_patch.json。
- preview_artifact.json。
```

---

## 详细实施

### 1. 两级预览

#### 1.1 Web Preview

用途：

```text
- 树编辑时快速反馈。
- 预览布局层级变化。
- 不依赖 Flutter SDK。
```

实现方式：

```text
NormalizedDesignIR / VisualIR → Canvas / SVG / HTML renderer。
```

限制：

```text
- 字体 baseline 不完全可信。
- Flutter 特有裁剪、阴影、Text 渲染不完全可信。
- 不能作为 99%+ 验证依据。
```

#### 1.2 Flutter Preview

用途：

```text
- 验证真实 Flutter 渲染。
- 生成 screenshot。
- 执行 analyze / format。
- 计算视觉 Diff。
```

实现方式：

```text
NormalizedDesignIR → temp Flutter app → flutter screenshot/golden runner → flutter_preview.png。
```

### 2. Local Flutter Runner 目录

```text
.uxcompiler/cache/flutter_tmp/
  preview_<id>/
    pubspec.yaml
    lib/
      main.dart
      generated_page.dart
      theme/
      generated/
    assets/
    test/
      preview_golden_test.dart
```

### 3. Runner 命令

```text
uxc preview build --project proj_001 --normalized nir_001
uxc preview flutter --project proj_001 --device-size 390x844 --dpr 3
uxc preview diff --preview preview_001
```

内部步骤：

```text
1. 生成临时 Flutter project。
2. 写入 tokens / assets / page。
3. 执行 dart format。
4. 执行 flutter analyze。
5. 运行 screenshot/golden test。
6. 输出 flutter_preview.png。
7. 与 figma_reference.png 比对。
8. 生成 diff_heatmap.png 和 visual_diff_report.json。
```

### 4. 视觉 Diff 指标

```text
page.ssim
page.pixelDiffRatio
region.visualScore
node.bboxDelta
node.colorDelta
text.baselineDelta
text.lineHeightDelta
asset.cropDelta
shadow.blurDelta
```

建议阈值：

```text
page visualScore >= 0.990
critical text visualScore >= 0.995
bbox delta <= 1px
baseline delta <= 1px
pixelDiffRatio <= 0.01
```

### 5. Node-level Diff 映射

输入 `node_pixel_map.json`：

```json
{
  "sourceNodeId": "123:456",
  "normalizedNodeId": "loginTitle",
  "expectedBounds": { "x": 24, "y": 88, "w": 300, "h": 32 },
  "renderedBounds": { "x": 24, "y": 89, "w": 300, "h": 32 }
}
```

输出 issue：

```json
{
  "issueId": "diff_001",
  "type": "text_baseline_offset",
  "sourceNodeId": "123:456",
  "normalizedNodeId": "loginTitle",
  "deltaY": 1.2,
  "suggestedFixes": [
    {
      "type": "text_calibration_override",
      "payload": { "baselineShift": -1 }
    }
  ]
}
```

### 6. Diff UI

支持模式：

```text
- Side by Side。
- Overlay。
- Heatmap。
- Difference only。
- Region outline。
- Node issue list。
```

点击差异区域：

```text
1. 定位到 normalized node。
2. 显示 source Figma node。
3. 显示相关 Override。
4. 显示建议修复。
5. 允许创建 repair Override。
```

### 7. Repair Loop

```text
Diff Issue → Suggested Fix → User Apply / Auto Apply → Override → Rebuild IR → Re-run Preview
```

可自动修复：

```text
- text baseline shift。
- small bbox offset。
- lineHeight conversion。
- asset crop bounds。
- spacing snap correction。
```

需要人工确认：

```text
- 切图策略改变。
- 组件语义化回退。
- 大范围 layout strategy 改变。
- 覆盖用户 override。
```

---

## 质量门禁

```text
- Flutter Preview 不通过时不能声明 99%+ 还原。
- diff report 必须记录 viewport、DPR、字体、Flutter 版本。
- 每个 repair patch 必须可回滚。
- analyze error 为 0 才能进入 Codegen Review。
- Web Preview 只能作为编辑辅助，不作为最终验收。
```

---

## 失败与 fallback

```text
Flutter SDK 不存在：
- 提示配置 Flutter path。
- 只允许 Web Preview。

字体缺失：
- 创建 font_missing issue。
- 提供 Font Mapping 设置。

截图失败：
- 保存 build log。
- 创建 flutter_preview_failed task。

Diff 映射不到节点：
- 降级为 region-level issue。
```

---

## 总结

Preview & Diff Runner 是人工规范化闭环的核心。它让用户每次修正层级、命名、组件或 Token 后都能看到真实视觉影响，并把“高还原”从主观判断变成可测量、可回滚、可迭代的工程流程。
