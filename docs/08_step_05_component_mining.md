# 08. Step 5 — Component Mining

## 摘要

Component Mining 的目标是在没有 Figma Component / Instance 的情况下，从页面或多页面中发现重复 UI 结构，并抽象为虚拟组件。它是提升代码可维护性的关键步骤。

---

## 输入

- `regions.json`
- `layout_decisions.json`
- `canonical_scene.json`
- `inferred_tokens.json`
- text signatures
- image / vector signatures
- style signatures

---

## 输出

```text
inferred_components.json
component_instance_map.json
component_confidence_report.json
```

---

## 详细实施

### 1. 生成节点签名

对每个 region 或子树生成 signature：

```json
{
  "nodeId": "12:34",
  "signature": {
    "typeSequence": ["image", "text", "text", "icon"],
    "relativeGeometry": [[0,0,64,64], [80,8,180,20]],
    "styleHash": "surface_radius12_shadow1",
    "textPattern": ["title", "subtitle"],
    "assetPattern": ["leading_image", "trailing_icon"]
  }
}
```

### 2. 候选组件聚类

聚类维度：

```text
structure similarity
geometry similarity
style similarity
semantic similarity
position similarity
```

推荐评分：

```text
componentSimilarity =
  structureSimilarity * 0.35
+ geometrySimilarity * 0.25
+ styleSimilarity * 0.20
+ semanticSimilarity * 0.20
```

### 3. 组件类型候选

内置候选类型：

```text
PrimaryButton
SecondaryButton
IconButton
TextField
SearchField
ListItem
ProductCard
InfoCard
TabItem
NavigationItem
AppBar
BottomBar
Dialog
FormSection
```

AI 可以参与类型命名和候选排序。

### 4. Props 抽取

识别多个实例之间变化的内容，抽象成 props：

```text
不同 Text → String prop / i18n key
不同 Image → asset prop
不同 icon → icon prop
不同状态样式 → variant prop
不同颜色 / radius / shadow → style variant
```

输出示例：

```json
{
  "componentId": "product_card",
  "name": "ProductCard",
  "sourceInstances": ["12:1", "12:8", "12:15"],
  "props": [
    { "name": "image", "type": "asset", "source": "leadingImage" },
    { "name": "title", "type": "text", "source": "firstText" },
    { "name": "subtitle", "type": "text", "source": "secondText" },
    { "name": "trailingIcon", "type": "asset", "optional": true }
  ],
  "layout": {
    "type": "row",
    "gap": "space_12"
  },
  "confidence": 0.89,
  "fallback": "generate_separate_widgets"
}
```

### 5. Component Registry Adapter

如果用户已有 Flutter 组件库，尝试映射：

```json
{
  "inferredComponent": "PrimaryButton",
  "targetFlutterWidget": "AppButton.primary",
  "import": "package:app/ui/app_button.dart",
  "propMapping": {
    "label": "text",
    "enabled": "variant.enabled"
  },
  "confidence": 0.92
}
```

---

## 质量门禁

- 每个 inferred component 至少有 2 个实例；单实例只允许生成 private widget，不升级为 reusable component。
- props 必须来自实例差异，不得凭空发明。
- 置信度低于 0.75 的组件不自动抽象为公共组件。
- 组件替换后必须重新跑 visual diff。

---

## 失败与 fallback

| 场景 | fallback |
|---|---|
| 相似但结构不一致 | private widgets |
| 只有一个实例 | region widget |
| Props 无法稳定抽取 | separate widgets |
| 替换组件后 diff 变差 | 回退 fidelity region |

---

## 总结

不规范设计稿无法依赖 Figma Component，但可以通过结构、几何、样式和语义相似度挖掘“虚拟组件”。Component Mining 应先保守，后通过 diff 验证逐步提升。
