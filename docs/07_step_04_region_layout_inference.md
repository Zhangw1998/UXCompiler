# 07. Step 4 — Region Segmentation + Layout Inference

## 摘要

本步骤负责把页面先切成区域，再从几何关系反推出布局结构。对于不规范设计稿，不应直接从原始 Figma 层级生成 Flutter，而要先根据视觉边界、间距、对齐、重叠和重复模式重建规范化布局树。

---

## 输入

- `canonical_scene.json`
- `inferred_tokens.json`
- `token_usage_map.json`
- 可选：用户布局策略配置

---

## 输出

```text
regions.json
layout_candidates.json
layout_decisions.json
region_tree.json
```

---

## 详细实施

### 1. 构建几何关系图

对每个父节点或候选区域内的 children 计算：

```text
left / right / top / bottom
centerX / centerY
width / height
horizontal gap / vertical gap
overlap ratio
containment relation
alignment variance
z-index order
```

输出中间结构：

```json
{
  "nodeId": "12:34",
  "relations": [
    {
      "targetNodeId": "12:35",
      "type": "vertical_next",
      "gap": 16,
      "overlapRatio": 0
    }
  ]
}
```

### 2. 页面分区 Region Segmentation

分区依据：

```text
- 大 Frame / Group 边界
- 大背景色块
- 大间距断点
- 顶部 / 底部固定区域
- z-index 层级
- 文本密度 / 图片密度变化
- 重复卡片 / 列表模式
```

区域类型候选：

```text
app_bar
hero
content_section
form_section
list_section
grid_section
bottom_bar
floating_layer
modal
decorative_background
unknown_region
```

输出示例：

```json
{
  "regionId": "region_hero",
  "sourceNodeIds": ["10:1", "10:2"],
  "bounds": { "x": 0, "y": 88, "w": 390, "h": 220 },
  "roleCandidate": "hero",
  "confidence": 0.82
}
```

### 3. 布局候选生成

对每个 region 生成多个布局候选：

```text
column
row
grid
stack
absolute
flow_with_overlay
asset_slice
```

### 4. 布局评分

#### Column score

```text
columnScore =
  xAlignmentScore * 0.30
+ verticalOrderScore * 0.25
+ gapConsistencyScore * 0.25
+ nonOverlapScore * 0.20
```

#### Row score

```text
rowScore =
  yAlignmentScore * 0.30
+ horizontalOrderScore * 0.25
+ gapConsistencyScore * 0.25
+ nonOverlapScore * 0.20
```

#### Grid score

```text
gridScore =
  columnLineScore * 0.30
+ rowLineScore * 0.30
+ cellSizeSimilarity * 0.20
+ gapConsistencyScore * 0.20
```

#### Stack score

```text
stackScore =
  overlapScore * 0.40
+ zIndexImportance * 0.25
+ freePositionScore * 0.20
+ decorationOverlayScore * 0.15
```

### 5. 选择与 fallback

规则：

```text
score >= 0.90 → semantic layout
0.70 <= score < 0.90 → semantic layout + fidelity fallback
score < 0.70 → absolute / stack fallback
complex_visual = true → asset_slice candidate
```

### 6. 混合布局

Auto Layout 中可能存在 absolute children，或普通区域中存在 overlay decoration。统一表达为：

```json
{
  "layout": {
    "type": "column",
    "children": ["main_flow_nodes"],
    "overlays": ["absolute_decoration_nodes"]
  }
}
```

---

## 输出示例

```json
{
  "regionId": "login_form",
  "layoutCandidates": [
    {
      "type": "column",
      "score": 0.93,
      "evidence": {
        "xAlignmentVariance": 1.1,
        "gapValues": [12, 12, 13],
        "overlapRatio": 0
      }
    },
    {
      "type": "stack",
      "score": 0.28
    }
  ],
  "selected": {
    "type": "column",
    "gap": "space_12",
    "crossAxisAlignment": "stretch",
    "fallback": "absolute_stack"
  }
}
```

---

## 质量门禁

- 每个 region 必须有 bounds。
- 每个布局决策必须有 score 和 evidence。
- 低置信度布局必须保留 fallback。
- 不允许因为追求语义化而移动视觉位置超过阈值。
- 所有 region 必须覆盖页面主要视觉内容。

---

## 失败与 fallback

| 场景 | fallback |
|---|---|
| 子节点大量自由定位 | absolute_widget |
| 明显覆盖关系 | stack |
| 复杂装饰背景 | asset_slice |
| 列表模式不稳定 | generate separate widgets |
| 语义不明确 | keep visual region + AI label candidate |

---

## 总结

布局推断的目标不是“永远生成 Row / Column”，而是找到在视觉还原和代码优雅之间最安全的策略。对不规范设计稿，Stack / Absolute / Slice 是合理 fallback，但应局部化、命名化、可替换。
