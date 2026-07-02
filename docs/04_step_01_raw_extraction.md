# 04. Step 1 — Raw Figma Extraction

## 摘要

本步骤负责从 Figma 中提取完整原始信息，生成不可变的 `raw_figma_scene.json`。它是整个系统的“证据层”。任何后续 Token、布局、组件、资源、语义和修复判断，都必须能追溯到这里的 source node。

---

## 输入

### 必需输入

- Figma file key
- page id 或 frame node id
- 用户选择范围：File / Page / Frame / Selection
- 导出配置：DPR、图片格式、是否导出 reference screenshot

### Figma 节点字段

必须尽可能保存：

```text
id / name / type / visible / locked
absoluteBoundingBox / absoluteRenderBounds
relativeTransform
constraints
layoutMode / layoutPositioning / itemSpacing / padding / alignment
fills / strokes / effects / opacity / blendMode
cornerRadius / rectangleCornerRadii
characters / fontName / fontSize / fontWeight / lineHeight / letterSpacing
vectorNetwork / imageHash
componentId / componentKey / variantProperties / overrides
children
```

### 可选输入

- Figma Variables
- Figma Styles
- Component / Instance 元数据
- Local component set 信息
- 用户指定的资源导出黑白名单

---

## 输出

```text
raw_figma_scene.json
figma_reference.png
raw_assets/
extraction_report.json
```

### `extraction_report.json` 示例

```json
{
  "source": {
    "fileKey": "xxx",
    "frameNodeId": "123:456"
  },
  "stats": {
    "nodes": 421,
    "textNodes": 76,
    "vectorNodes": 108,
    "imageNodes": 12,
    "componentInstances": 18
  },
  "warnings": [
    {
      "nodeId": "88:90",
      "type": "missing_font",
      "message": "Font metadata exists but local font file is not available."
    }
  ]
}
```

---

## 详细实施

### 1. Selection Resolver

实现一个入口：

```ts
resolveSelection(mode: 'file' | 'page' | 'frame' | 'selection'): FigmaScope
```

要求：

- 如果用户选择多个节点，生成多个 root scene。
- 如果用户选择的是 Group，向上找到最合理的 Frame 作为 viewport。
- 如果没有选择，提示用户选择 Frame。

### 2. Node Serializer

递归序列化所有节点：

```ts
serializeNode(node: SceneNode): RawFigmaNode
```

规则：

- 不过滤 invisible 节点，只标记 `visible=false`。
- 不丢弃 opacity、effects、constraints、absolute bounds。
- 保留 Figma 原名，不做规范化重命名。
- 所有字段无法读取时记录 warning，不要静默失败。

### 3. Screenshot Exporter

对选中 Frame 导出：

```text
figma_reference.png
```

要求：

- 固定 scale，比如 1x 或项目配置 DPR。
- 记录 screenshot 的 width、height、scale。
- 后续 Flutter screenshot 必须使用同尺寸对比。

### 4. Asset Candidate Exporter

初步导出候选资源：

- Vector / Icon candidate
- Image candidate
- Complex visual candidate
- Full node slice candidate

此时不决定最终策略，只记录候选。

---

## 质量门禁

- `raw_figma_scene.json` 必须可解析。
- root node 必须包含 viewport width / height。
- 每个节点必须有 `id`、`type`、`name`、`bounds`。
- reference screenshot 必须存在。
- 如果某些节点导出失败，必须在 report 中记录。

---

## 常见失败与处理

| 问题 | 处理 |
|---|---|
| 节点缺少 bounds | 标记为 invalidBounds，不参与布局推断，但保留原始节点 |
| 字体不可用 | 记录 missing_font，后续 Text Fidelity Engine 处理 |
| imageHash 不可导出 | 标记 asset_missing，后续 fallback 为 node slice |
| 超大 Frame 导出失败 | 降 scale 导出，并记录 scale |

---

## 总结

Step 1 不追求聪明，只追求完整。绝对坐标、effect、opacity、constraints 这些在旧语义 IR 中不应该出现，但在 RawFigmaScene 中必须保留。否则不规范设计稿无法做高保真还原。
