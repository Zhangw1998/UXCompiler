# 10. Step 7 — Asset + i18n Normalization

## 摘要

本步骤决定哪些视觉节点应该转成 Flutter 代码，哪些导出为资源，哪些作为复杂装饰切图；同时把 Text 节点抽取为 i18n key。核心原则是：可交互和可变内容尽量保留为真实 Flutter Widget，复杂装饰允许局部切图。

---

## 输入

- `canonical_scene.json`
- `semantic_labels.json`
- `inferred_components.json`
- `inferred_tokens.json`
- raw asset candidates
- 用户资源目录配置
- 用户 i18n 配置

---

## 输出

```text
asset_manifest.json
i18n_manifest.json
assets/icons/*.svg
assets/images/*.png | *.webp
assets/slices/*.png | *.webp
lib/generated/assets.gen.dart
lib/l10n/intl_en.arb
```

---

## 详细实施

### 1. 资源策略分类

每个节点或区域选择一个策略：

```text
text_real
icon_svg
image_asset
decorative_slice
semantic_component
custom_painter
ignore
```

选择规则：

| 节点/区域 | 推荐策略 |
|---|---|
| 真实文案 Text | text_real |
| 简单 vector icon | icon_svg |
| 照片 / bitmap image | image_asset |
| 复杂 mask / blur / blend / 多层装饰 | decorative_slice |
| Button / Input / ListItem | semantic_component |
| 复杂 path 但不适合切图 | custom_painter |
| invisible / zero-size | ignore |

### 2. 切图限制

不能切图的内容：

```text
- Button 文案
- 表单输入区域
- 需要国际化的文本
- 用户头像 / 动态图片位
- 可点击主要组件
- 需要状态变化的组件
```

允许切图：

```text
- 背景装饰
- 插画
- 复杂渐变叠层
- blur / mask / blend 视觉块
- 不需要交互的营销 banner
```

### 3. 资源命名

命名优先级：

```text
1. AI semantic asset name
2. Figma meaningful name
3. role + position：ic_arrow_right / img_login_hero
4. source node hash 防冲突
```

输出示例：

```json
{
  "assetId": "asset_ic_arrow_right",
  "sourceNodeId": "22:33",
  "fileName": "ic_arrow_right.svg",
  "path": "assets/icons/ic_arrow_right.svg",
  "kind": "icon_svg",
  "hash": "a1b2c3",
  "usedBy": ["login_page"]
}
```

### 4. 资源去重

用 hash 去重：

```text
same binary hash → same asset
same vector path hash → same SVG asset
same rendered bitmap hash → same image asset
```

不同语义但同资源可建立 alias：

```json
{
  "canonicalAsset": "ic_arrow_right.svg",
  "aliases": ["ic_next.svg", "ic_chevron_right.svg"]
}
```

### 5. i18n 抽取

Text Node 转换为：

```json
{
  "key": "login_continue_button",
  "value": "Continue",
  "sourceNodeId": "33:44",
  "role": "button_label",
  "confidence": 0.93
}
```

规则：

- 相同文案但不同上下文可使用不同 key。
- Button / Placeholder / Title / Error message 应带 role。
- 不把图片中文字当作 i18n，除非 OCR 或人工标注明确可信。

### 6. Flutter 输出

生成：

```dart
class Assets {
  static const icArrowRight = 'assets/icons/ic_arrow_right.svg';
  static const imgLoginHero = 'assets/images/img_login_hero.webp';
}
```

生成 ARB：

```json
{
  "login_continue_button": "Continue",
  "@login_continue_button": {
    "description": "Button label from LoginPage continue CTA"
  }
}
```

---

## 质量门禁

- 所有 Image.asset / SvgPicture.asset 引用必须存在于 manifest。
- 所有页面可见 Text 默认必须进入 i18n manifest。
- asset 文件名必须稳定、可重复生成。
- decorative slice 必须记录 source node 和 reason。
- 可交互组件不能被整块切图。

---

## 失败与 fallback

| 场景 | fallback |
|---|---|
| SVG 导出失败 | PNG/WebP asset |
| 复杂 vector 无法转 SVG | decorative_slice |
| i18n key 冲突 | 添加 role / region 前缀 |
| 资源命名低置信度 | hash name + review flag |
| 图片缺失 | 占位 asset + warning |

---

## 总结

资源和 i18n 规范化决定了代码是否能真正被开发维护。系统要避免“为了像而切掉一切”，也要避免“为了代码优雅而硬画复杂视觉”。正确策略是分层：文本保真、组件保真、装饰切图、资源可追溯。
