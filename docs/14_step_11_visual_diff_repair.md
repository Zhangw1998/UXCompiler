# 14. Step 11 — Visual Diff + Auto Repair

## 摘要

本步骤通过截图对比判断 Flutter 渲染是否达到目标还原度，并把差异映射回具体节点或 region。它是 99%+ 还原的必要闭环。没有 visual diff，系统无法知道规范化和语义提升是否破坏了视觉。

---

## 输入

- `figma_reference.png`
- Flutter rendered screenshot
- `node_pixel_map.json`
- `flutter_generation_manifest.json`
- `normalized_design_ir.json`
- 当前 viewport / DPR / font config

---

## 输出

```text
visual_diff_report.json
diff_heatmap.png
node_diff_report.json
repair_patch.json
repair_iteration_log.json
```

---

## 详细实施

### 1. 固定渲染环境

必须固定：

```text
viewport width / height
DPR
Flutter version
platform renderer
fonts
theme brightness
locale
text scale factor = 1.0
safe area config
```

### 2. 截图生成

生成：

```text
figma_reference.png
flutter_rendered.png
diff_heatmap.png
```

### 3. 页面级指标

建议指标：

```text
SSIM score
pixel diff ratio
weighted visual score
critical region score
```

示例阈值：

```text
page visualScore >= 0.990
critical text / CTA regions >= 0.995
non-critical decorative regions >= 0.985
```

### 4. 节点级指标

```text
bbox delta x/y/w/h
text baseline delta
color delta
radius delta
shadow delta
asset crop delta
```

示例：

```json
{
  "sourceNodeId": "12:34",
  "type": "text",
  "diff": {
    "bboxDelta": { "x": 0, "y": 1, "w": 0, "h": 0 },
    "baselineDeltaY": 1,
    "colorDelta": 0.6
  },
  "repairSuggestion": {
    "type": "baseline_shift",
    "value": -1
  }
}
```

### 5. 自动修复类型

允许自动修复：

```text
- gap ±1/2 px
- padding ±1/2 px
- baselineShift ±1 px
- lineHeight 微调
- asset fit / crop 修正
- radius ±1 px
- border width 修正
- position offset ±1/2 px
```

不建议自动修复：

```text
- 大幅重构布局
- 删除节点
- 更换语义组件
- 更改业务相关结构
- 大范围切图替换
```

### 6. Repair Loop

```text
1. 生成 Flutter
2. 截图
3. diff
4. 生成 repair_patch
5. 应用 patch
6. 重新截图
7. 最多迭代 N 次
8. 达标或输出人工报告
```

默认最多 3 次，避免无限循环。

---

## 输出示例

```json
{
  "page": "LoginPage",
  "score": {
    "visualScore": 0.992,
    "pixelDiffRatio": 0.008,
    "ssim": 0.994
  },
  "pass": true,
  "regions": [
    {
      "regionId": "login_form",
      "score": 0.996,
      "issues": []
    },
    {
      "regionId": "hero_bg",
      "score": 0.986,
      "issues": ["shadow_blur_delta"]
    }
  ],
  "autoRepairs": [
    {
      "type": "baseline_shift",
      "sourceNodeId": "12:34",
      "from": 0,
      "to": -1,
      "accepted": true
    }
  ]
}
```

---

## 质量门禁

- 如果没有 reference screenshot，不允许声称 99%+。
- 如果 Flutter screenshot 尺寸不同，diff 失败。
- 每个修复 patch 必须可回滚。
- 修复后必须重新跑 analyze 和 screenshot。
- diff report 必须保存到 artifacts。

---

## 失败与 fallback

| 场景 | fallback |
|---|---|
| 差异集中在字体 | Text Fidelity calibration |
| 差异集中在复杂装饰 | asset_slice |
| 差异来自组件替换 | 回退 fidelity region |
| 差异来自响应式推断 | fixed viewport mode |
| 修复 3 次不达标 | 输出 manual review report |

---

## 总结

Visual Diff 不是 UI 展示功能，而是质量控制核心。它让系统能够在“规范化”和“代码优雅化”过程中持续证明没有破坏视觉，是高还原系统必不可少的一环。
