# 02. IR 与数据契约设计

## 摘要

本文档定义新版 Pipeline 的核心中间表示。设计原则是：第一层必须无损，最终层必须干净，中间层必须可解释。旧 Design IR v1 保留为最终语义 IR 的基础，但不能作为不规范设计稿的第一层输入。

---

## 1. IR 层级

```text
RawFigmaScene
  ↓
CanonicalScene
  ↓
NormalizedDesignIR
  ↓             ↓
VisualIR        SemanticIR
  ↓             ↓
Fidelity Code   Clean Code
```

---

## 2. RawFigmaScene

### 摘要

RawFigmaScene 是 Figma 设计稿的无损快照。它不追求简洁，只追求完整。

### 输入

- Figma file / page / frame node JSON
- absoluteBoundingBox / absoluteRenderBounds
- relativeTransform
- fills / strokes / effects / opacity / blendMode
- layoutMode / layoutPositioning / constraints
- text style / vector data / image refs
- component / instance metadata

### 输出

`raw_figma_scene.json`

### Schema 示例

```json
{
  "version": "2.0",
  "source": {
    "fileKey": "xxx",
    "frameNodeId": "123:456",
    "exportedAt": "2026-06-30T00:00:00Z"
  },
  "root": {
    "id": "123:456",
    "name": "Frame 1",
    "type": "FRAME",
    "visible": true,
    "opacity": 1,
    "absoluteBoundingBox": { "x": 0, "y": 0, "width": 390, "height": 844 },
    "relativeTransform": [[1,0,0],[0,1,0]],
    "layoutMode": "NONE",
    "layoutPositioning": "AUTO",
    "constraints": {},
    "fills": [],
    "strokes": [],
    "effects": [],
    "children": []
  }
}
```

### 总结

RawFigmaScene 允许包含所有 Figma 细节，包括最终语义 IR 不允许存在的字段。

---

## 3. CanonicalScene

### 摘要

CanonicalScene 是机械清洗后的视觉场景。它不做语义推断，只把混乱但等价的表达统一。

### 输入

- `raw_figma_scene.json`

### 输出

- `canonical_scene.json`
- `canonicalization_report.json`

### 关键字段

```json
{
  "id": "node_id",
  "canonicalType": "rect | text | vector | image | group | frame | instance",
  "bounds": { "x": 24, "y": 80, "w": 342, "h": 56 },
  "style": {
    "fill": "#FFFFFF",
    "radius": 16,
    "shadow": []
  },
  "children": [],
  "flags": {
    "isInvisible": false,
    "isWrapper": false,
    "hasClip": false,
    "hasMask": false,
    "hasBlendMode": false,
    "isComplexVector": false
  }
}
```

### 总结

CanonicalScene 不改变视觉，只降低后续算法复杂度。

---

## 4. NormalizedDesignIR

### 摘要

NormalizedDesignIR 是系统自动推断出的“虚拟规范化设计稿”。它是代码生成的主输入。

### 输入

- `canonical_scene.json`
- token candidates
- layout candidates
- component candidates
- semantic labels
- asset / i18n manifest

### 输出

`normalized_design_ir.json`

### Schema 示例

```json
{
  "version": "2.0",
  "source": {
    "frameNodeId": "123:456",
    "viewport": { "width": 390, "height": 844 }
  },
  "tokens": {
    "colors": [],
    "spacing": [],
    "typography": [],
    "radii": [],
    "shadows": []
  },
  "components": [],
  "tree": {
    "type": "page",
    "name": "LoginPage",
    "layout": { "type": "column" },
    "children": []
  },
  "fallbacks": [],
  "confidence": {
    "overall": 0.86,
    "tokens": 0.91,
    "layout": 0.83,
    "components": 0.74
  }
}
```

### 总结

NormalizedDesignIR 允许包含 confidence、evidence、fallback，因为它是推断层，不是最终 renderer-only IR。

---

## 5. VisualIR

### 摘要

VisualIR 面向高保真渲染。它不追求代码优雅，只保证能画得像。

### 输入

- `normalized_design_ir.json`
- `canonical_scene.json`
- asset manifest

### 输出

`visual_ir.json`

### 节点类型

```text
scene
rect
text
image
svg
path
stack
positioned
clip
opacity
shadow
asset_slice
custom_painter
```

### 示例

```json
{
  "type": "scene",
  "size": { "w": 390, "h": 844 },
  "children": [
    {
      "type": "positioned",
      "x": 24,
      "y": 80,
      "child": {
        "type": "rect",
        "w": 342,
        "h": 56,
        "fill": "color_surface",
        "radius": "radius_16"
      }
    }
  ]
}
```

### 总结

VisualIR 是视觉兜底层，解决不规范设计稿无法直接语义化的问题。

---

## 6. SemanticIR

### 摘要

SemanticIR 面向优雅代码生成。它表达页面区域、组件、slot、props 和布局语义。

### 输入

- `normalized_design_ir.json`
- semantic labels
- component registry
- uplift decisions

### 输出

`semantic_ir.json`

### 示例

```json
{
  "type": "page",
  "name": "LoginPage",
  "regions": [
    {
      "id": "login_form",
      "name": "LoginForm",
      "role": "form",
      "layout": {
        "type": "column",
        "gap": "space_16"
      },
      "children": [
        {
          "type": "componentInstance",
          "component": "PrimaryButton",
          "props": {
            "labelKey": "login_continue"
          }
        }
      ]
    }
  ]
}
```

### 总结

SemanticIR 可以降级为旧 Design IR v1，但不能丢失 manifest 中的 sourceNodeId、strategy 和 fallback 信息。

---

## 7. 关键原则

```text
Raw 层不丢信息。
Canonical 层不改视觉。
Normalized 层允许推断，但必须带证据。
Visual 层保证像。
Semantic 层保证可维护。
Renderer 层不猜测。
AI 层不越权。
```
