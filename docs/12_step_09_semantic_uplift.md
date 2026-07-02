# 12. Step 9 — Semantic Uplift

## 摘要

Semantic Uplift 的目标是把已经高保真的视觉结构，逐步提升为更优雅、可编辑、可复用的 Flutter 代码。它不是一次性重写整页，而是按 region 或 component 小步替换，每次替换后都跑 visual diff，不达标就回退。

---

## 输入

- `visual_ir.json`
- `semantic_labels.json`
- `inferred_components.json`
- `layout_decisions.json`
- `fidelity_generation_manifest.json`
- baseline visual diff score
- 可选：用户 Flutter Component Registry

---

## 输出

```text
semantic_ir.json
uplift_decisions.json
uplift_diff_report.json
```

---

## 详细实施

### 1. Uplift 候选

可以提升的区域：

```text
Button-like group → AppButton / GeneratedButton
TextField-like group → AppTextField / GeneratedTextField
Card-like region → Card widget
List repeated regions → ListView / Column of component instances
Aligned absolute group → Row / Column
Grid-like group → GridView / Wrap
```

### 2. Uplift 评分

```text
upliftScore =
  semanticConfidence * 0.30
+ layoutConfidence * 0.25
+ componentConfidence * 0.25
+ expectedDiffSafety * 0.20
```

选择规则：

```text
score >= 0.90 → auto uplift
0.75 <= score < 0.90 → uplift with review flag
score < 0.75 → keep fidelity region
```

### 3. 替换策略

#### absolute → Column

如果 children 垂直排列，gap 稳定，x 对齐：

```text
Stack + Positioned → Column + SizedBox gap + Padding
```

#### repeated regions → Component

如果多个区域结构相似：

```text
separate fidelity widgets → GeneratedComponent + props
```

#### visual button → component

如果矩形 + 文本 + optional icon：

```text
Container stack → AppButton / GeneratedButton
```

### 4. Diff 验证

每个 uplift 必须跑局部或页面级 diff：

```json
{
  "regionId": "login_form",
  "beforeScore": 0.996,
  "afterScore": 0.993,
  "accepted": true,
  "threshold": 0.990
}
```

### 5. 回退

如果 uplift 后视觉下降超过阈值：

```text
restore fidelity region
record reason
keep uplift candidate for manual review
```

---

## 输出示例

```json
{
  "decisions": [
    {
      "regionId": "login_form",
      "from": "absolute_widget",
      "to": "semantic_layout",
      "strategy": "column",
      "confidence": 0.91,
      "visualScoreBefore": 0.996,
      "visualScoreAfter": 0.993,
      "accepted": true
    },
    {
      "regionId": "hero_bg",
      "from": "asset_slice",
      "to": "custom_painter",
      "confidence": 0.52,
      "accepted": false,
      "reason": "visual diff worsened around blur boundary"
    }
  ]
}
```

---

## 质量门禁

- 不允许整页大范围语义重写。
- 每次 uplift 必须有 before / after score。
- 可交互主要组件优先 uplift。
- 装饰复杂区域可以保留 fidelity fallback。
- accepted uplift 必须写入 semantic_ir。

---

## 失败与 fallback

| 场景 | fallback |
|---|---|
| Row / Column 替换导致偏移 | 保留 absolute_widget |
| AppButton 视觉差异大 | 生成 private button 或 fidelity button |
| List 推断不稳定 | 保持多个 child widgets |
| Props 抽取不完整 | 保留 separate widgets |

---

## 总结

Semantic Uplift 是“视觉优先，优雅渐进”的关键机制。它解决了高还原和可维护之间的矛盾：先用 fidelity 保证像，再用局部验证安全地变优雅。
