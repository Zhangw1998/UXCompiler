# 06. Step 3 — Token Mining

## 摘要

Token Mining 的目标是从不规范设计稿中自动推断 Shadow Design System。即使设计稿没有使用 Figma Variables / Styles，也要从实际视觉值中聚类出颜色、字体、间距、圆角、阴影等 Token，并记录原始值到规范值的映射。

---

## 输入

- `canonical_scene.json`
- 可选：Figma Variables
- 可选：Figma Styles
- 可选：用户 token 命名规则

---

## 输出

```text
inferred_tokens.json
token_usage_map.json
token_confidence_report.json
```

---

## 详细实施

### 1. 收集原始样式值

从所有可见视觉节点收集：

```text
colors: fill / stroke / textColor / shadowColor
text styles: fontFamily / fontSize / fontWeight / lineHeight / letterSpacing
spacing: sibling gap / parent padding / section gap / screen margin
radii: cornerRadius / rectangleCornerRadii
shadows: offsetX / offsetY / blur / spread / color / opacity
opacity: node opacity / fill opacity
```

### 2. 用途分类

同一个颜色在不同用途下可能是不同 Token。先按 usage 分桶：

```text
color.background
color.surface
color.text
color.border
color.icon
color.shadow
```

示例：

```json
{
  "rawValue": "#111111",
  "usage": "text",
  "nodeIds": ["12:34", "12:35"]
}
```

### 3. 聚类与吸附

#### 颜色聚类

建议使用 LAB 或 RGB 距离，按用途单独聚类。

```text
#FFFFFF, #FEFEFE, #FDFDFD → color_surface_default = #FFFFFF
#111111, #121212, #101010 → color_text_primary = #111111
```

#### 间距聚类

优先吸附到常见值，但不要强行 8pt grid：

```text
7, 8, 8.5, 9 → space_8
15, 16, 17 → space_16
23, 24, 25 → space_24
```

#### 字体聚类

按 `fontFamily + fontSize + fontWeight + lineHeight + letterSpacing` 聚类。

```text
Inter / 24 / 700 / 32 → text_title_large
Inter / 16 / 400 / 24 → text_body_medium
```

### 4. Token 命名

命名优先级：

```text
1. Figma Variable / Style 名称
2. 用途 + 语义：color_text_primary
3. 位置 + 用途：color_nav_background
4. 类型 + 值：space_16 / radius_12
```

AI 可以参与命名，但必须返回 JSON 建议，不能直接改最终 token。

### 5. 保留 alias

每个 token 必须保留原始值：

```json
{
  "name": "space_16",
  "value": 16,
  "aliases": [15, 16, 17],
  "snapTolerance": 1,
  "confidence": 0.92,
  "usageCount": 126
}
```

这样生成代码可以使用 `AppSpacing.md`，但视觉修复仍能回溯到原始值。

---

## 输出示例

```json
{
  "version": "2.0",
  "colors": [
    {
      "name": "color_text_primary",
      "value": "#111111",
      "aliases": ["#101010", "#121212"],
      "usage": "text",
      "confidence": 0.91,
      "usageCount": 34
    }
  ],
  "spacing": [
    {
      "name": "space_16",
      "value": 16,
      "aliases": [15, 16, 17],
      "confidence": 0.94,
      "usageCount": 88
    }
  ],
  "typography": [
    {
      "name": "text_body_medium",
      "fontFamily": "Inter",
      "fontSize": 16,
      "fontWeight": 400,
      "lineHeight": 24,
      "letterSpacing": 0,
      "confidence": 0.89
    }
  ]
}
```

---

## 质量门禁

- 每个 token 必须有 source values 和 source node ids。
- 高频裸值必须能被 token 覆盖。
- 不允许把不同 usage 的颜色强制合并。
- 不允许把所有 spacing 强行归 8pt grid。
- 低置信度 token 必须标记，不得隐藏。

---

## 失败与 fallback

| 场景 | 处理 |
|---|---|
| 值分布过于离散 | 生成 raw token，并标记 low_confidence |
| 同一颜色跨多个用途 | 生成 alias token 或 semantic token 两层 |
| 字体缺失 | 生成 token，但标记 missing_font |
| 阴影复杂 | 保留 raw shadow，不强行合并 |

---

## 总结

Token Mining 是“规范化设计稿”的第一核心能力。它不需要修改 Figma 原稿，而是从视觉事实中反编译出一套 Shadow Design System，让后续代码不再满屏魔法数字。
