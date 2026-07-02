# 25. Step 16：Component / Token / Asset / i18n Studios

## 摘要

本步骤提供四个专用编辑视图，用于把不规范设计稿提升为“虚拟设计系统”：组件确认、Token 合并、资源策略确认、i18n 文案确认。它们都不直接修改 Figma，只生成 Override 和 Registry。

---

## 输入

```text
- inferred_components.json。
- component_instance_map.json。
- inferred_tokens.json。
- token_usage_map.json。
- asset_manifest.json。
- i18n_manifest.json。
- semantic_labels.json。
- current override_set.json。
- existing Flutter project config。
```

---

## 输出

```text
- component_candidate_overrides.json。
- component_registry.json。
- token_overrides.json。
- token_registry.json。
- asset_strategy_overrides.json。
- final_asset_manifest.json。
- i18n_key_overrides.json。
- final_i18n_manifest.json。
```

---

## 1. Component Studio

### 摘要

Component Studio 用于确认系统挖掘出的虚拟组件，并编辑 props / slots / variants / Flutter 映射。

### 输入

```text
- component candidates。
- source instance screenshots。
- source node signatures。
- semantic labels。
- existing Flutter component registry。
```

### 输出

```text
- approved inferred components。
- component props / slots / variants。
- flutter component mappings。
- component-specific review tasks。
```

### 详细实施

UI 布局：

```text
左侧：候选组件列表。
中间：实例缩略图网格。
右侧：Component Inspector。
底部：Props Diff / Code Preview / Visual Score。
```

支持操作：

```text
- Approve Candidate。
- Reject Candidate。
- Merge Candidates。
- Split Candidate。
- Add Instance。
- Remove Instance。
- Define Prop。
- Define Optional Prop。
- Define Slot。
- Define Variant。
- Map to Existing Flutter Widget。
- Generate Local Component。
```

组件定义示例：

```json
{
  "id": "cmp_product_card",
  "name": "ProductCard",
  "source": "inferred_and_user_approved",
  "instances": ["12:1", "12:8", "12:15"],
  "props": [
    { "name": "image", "type": "asset", "sourceSelector": "first_image" },
    { "name": "title", "type": "text", "sourceSelector": "first_text" },
    { "name": "price", "type": "text", "sourceSelector": "price_text" }
  ],
  "slots": [
    { "name": "trailing", "optional": true }
  ],
  "variants": [
    { "name": "state", "values": ["default", "selected"] }
  ]
}
```

Flutter 映射示例：

```json
{
  "componentId": "cmp_primary_button",
  "flutter": {
    "import": "package:app/ui/components/app_button.dart",
    "constructor": "AppButton.primary",
    "props": {
      "label": { "from": "prop.label", "i18n": true },
      "leadingIcon": { "from": "slot.leading", "optional": true }
    }
  }
}
```

### 质量门禁

```text
- approved component 至少 2 个实例，除非用户显式允许 single-use component。
- 每个 prop 必须有 sourceSelector。
- Flutter mapping 必须有 import 和 constructor。
- 组件替换后必须跑 preview/diff 或标记未验证。
```

### 失败与 fallback

```text
候选被拒绝：实例独立生成。
props 不稳定：生成 local widget，但不抽公共组件。
Flutter mapping 不完整：降级生成 generated component。
```

### 总结

Component Studio 决定代码能否从“视觉还原”升级为“工程可维护”。

---

## 2. Token Studio

### 摘要

Token Studio 用于审查从不规范设计稿中推断出的 Shadow Design Tokens，处理 merge、split、rename、映射项目现有 token。

### 输入

```text
- token candidates。
- usage map。
- source values。
- project token registry。
```

### 输出

```text
- token_merge_override。
- token_split_override。
- token_rename_override。
- project_token_mapping_override。
- final token registry。
```

### 详细实施

Token 类型：

```text
color
typography
spacing
radius
shadow
opacity
border
```

UI 必须展示：

```text
- canonical value。
- aliases。
- usage count。
- usage preview。
- confidence。
- generated Dart name。
- mapping status。
```

操作：

```text
- Merge Tokens。
- Split Token。
- Rename Token。
- Set Canonical Value。
- Set Snap Tolerance。
- Map to Existing Project Token。
- Mark as Raw Value。
```

Token merge 示例：

```json
{
  "type": "token_merge_override",
  "tokenType": "spacing",
  "canonicalToken": { "name": "space_16", "value": 16 },
  "sourceValues": [15, 16, 17],
  "snapTolerance": 1
}
```

### 质量门禁

```text
- Token 名称必须唯一。
- 被映射到项目 Token 的值要记录偏差。
- 低频 raw value 可以保留，但必须标记 reason。
- typography token 必须包含 lineHeight。
```

### 失败与 fallback

```text
Token 冲突：保留两个 token，创建 P2 task。
用户不处理：高频自动命名，低频 raw。
```

### 总结

Token Studio 把“无设计系统”的稿子转成可生成 ThemeData / Dart 常量的 Shadow Design System。

---

## 3. Asset Studio

### 摘要

Asset Studio 用于确认每个视觉资源的策略：真实 Text、SVG Icon、PNG/WebP Image、Decorative Slice、CustomPainter。

### 输入

```text
- asset candidates。
- node complexity report。
- text overlay info。
- exported raw assets。
```

### 输出

```text
- final_asset_manifest.json。
- asset_strategy_override。
- asset rename overrides。
- pubspec asset patch candidates。
```

### 详细实施

策略：

```text
text_real
icon_svg
image_asset
decorative_slice
custom_painter
ignore
```

操作：

```text
- Mark as Real Text。
- Mark as SVG Icon。
- Mark as PNG/WebP Image。
- Mark as Decorative Slice。
- Mark as CustomPainter。
- Rename Asset。
- Choose Export Scale。
- Choose Crop Bounds。
- Exclude Text Nodes from Slice。
```

策略 override 示例：

```json
{
  "type": "asset_strategy_override",
  "sourceNodeId": "200:300",
  "strategy": "decorative_slice",
  "assetName": "login_hero_background",
  "format": "png",
  "scale": 3,
  "excludeTextNodes": true
}
```

### 质量门禁

```text
- 动态文本、按钮、输入框不可默认切图。
- decorative_slice 如果包含 Text，必须创建 P0 task。
- asset path 必须唯一且稳定。
- 同一视觉 hash 的资源应去重。
```

### 失败与 fallback

```text
SVG 复杂不可渲染：降级 PNG/WebP。
资源导出失败：创建 P0 task。
命名冲突：自动添加短 hash。
```

### 总结

Asset Studio 通过局部切图兜住高还原，同时保护动态文本和交互组件的可维护性。

---

## 4. i18n Studio

### 摘要

i18n Studio 用于确认 Text 节点是否进入国际化、key 名称、description、placeholder 和重复文案合并。

### 输入

```text
- text nodes。
- semantic labels。
- existing arb files。
- inferred i18n manifest。
```

### 输出

```text
- final_i18n_manifest.json。
- i18n_key_override。
- arb files。
- non_i18n reasons。
```

### 详细实施

操作：

```text
- Accept generated key。
- Rename key。
- Mark as Non-i18n。
- Merge duplicate text。
- Define placeholder。
- Define ARB description。
- Map to existing ARB key。
```

Override 示例：

```json
{
  "type": "i18n_key_override",
  "sourceNodeId": "300:400",
  "text": "Continue",
  "key": "loginContinueButton",
  "arbDescription": "Primary CTA on login page"
}
```

### 质量门禁

```text
- 所有可见 Text 必须有 i18n key 或 non_i18n reason。
- key 必须符合项目命名规则。
- placeholder 必须类型明确。
- 不得把图片中文字误认为真实 Text，除非 OCR/人工确认。
```

### 失败与 fallback

```text
key 冲突：提示合并或重命名。
用户不处理 P2：使用自动 key。
文本来自 asset slice：标记 non_extractable_text。
```

### 总结

i18n Studio 让从设计稿反编译出的 UI 能直接接入 Flutter Intl / ARB 工作流，避免代码里出现字符串字面量。
