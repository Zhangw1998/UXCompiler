# 11. Step 8 — VisualIR + Fidelity Renderer

## 摘要

本步骤先生成高保真视觉版本。对于不规范设计稿，必须先保证能“画得像”，再考虑代码优雅。VisualIR 是视觉兜底层，Flutter Fidelity Renderer 会将它转换成 Stack、Positioned、CustomPainter、Image、Text 等稳定可渲染代码。

---

## 输入

- `normalized_design_ir.json`
- `canonical_scene.json`
- `asset_manifest.json`
- `i18n_manifest.json`
- `inferred_tokens.json`
- viewport / DPR / font config

---

## 输出

```text
visual_ir.json
lib/generated/fidelity/*
fidelity_generation_manifest.json
node_pixel_map.json
```

---

## 详细实施

### 1. VisualIR 节点类型

支持：

```text
scene
stack
positioned
rect
text
image
svg
path
clip
opacity
shadow
custom_painter
asset_slice
```

### 2. Render Strategy

每个 region 选择一个策略：

```text
semantic_widget      // 已识别组件，直接用组件
absolute_widget      // Stack + Positioned
custom_painter       // 复杂 path / shape
asset_slice          // 装饰性复杂区域切图
hybrid_region        // 主体 semantic + overlay absolute
```

策略必须写入 manifest：

```json
{
  "regionId": "hero_visual",
  "strategy": "asset_slice",
  "reason": "complex mask and blur",
  "editable": false,
  "sourceNodeIds": ["56:78"]
}
```

### 3. Flutter Fidelity 代码生成

#### absolute_widget 示例

```dart
class LoginHeroFidelityRegion extends StatelessWidget {
  const LoginHeroFidelityRegion({super.key});

  @override
  Widget build(BuildContext context) {
    return const SizedBox(
      width: 390,
      height: 220,
      child: Stack(
        children: [
          Positioned(
            left: 24,
            top: 16,
            width: 342,
            height: 120,
            child: DecoratedBox(
              decoration: BoxDecoration(
                color: AppColors.surface,
                borderRadius: BorderRadius.all(Radius.circular(AppRadii.r16)),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
```

#### asset_slice 示例

```dart
class HeroBackgroundSlice extends StatelessWidget {
  const HeroBackgroundSlice({super.key});

  @override
  Widget build(BuildContext context) {
    return Image.asset(
      Assets.imgHeroBackground,
      width: 390,
      height: 220,
      fit: BoxFit.cover,
    );
  }
}
```

### 4. Text Fidelity

Text 渲染必须处理：

```text
fontFamily
fontWeight
fontSize
lineHeight
letterSpacing
textAlign
maxLines
baselineShift
strutStyle
```

输出集中校准配置：

```json
{
  "fontFamily": "Inter",
  "fontSize": 16,
  "figmaLineHeight": 24,
  "flutterHeight": 1.5,
  "baselineShift": -1
}
```

### 5. node_pixel_map

为了 diff 归因，每个生成 widget 必须记录 source node bounds：

```json
{
  "sourceNodeId": "12:34",
  "widgetPath": "LoginPage/LoginHeroFidelityRegion/Text_1",
  "bounds": { "x": 24, "y": 80, "w": 120, "h": 24 }
}
```

---

## 质量门禁

- Fidelity version 必须能渲染完整页面。
- 生成代码必须 `dart format`。
- 页面尺寸必须与 Figma reference screenshot 一致。
- 所有 assets 必须存在。
- 每个 visible canonical node 必须有 render decision 或 ignore reason。

---

## 失败与 fallback

| 场景 | fallback |
|---|---|
| 复杂 shape 无法 CustomPainter | asset_slice |
| 文本 baseline 不一致 | font calibration patch |
| 组件视觉差异大 | 回退 absolute_widget |
| 资源缺失 | placeholder + warning |
| Stack 过大 | region 分块 |

---

## 总结

VisualIR 和 Fidelity Renderer 不是最终优雅代码，但它们是 99%+ 视觉还原的底座。后续 Semantic Uplift 必须在不破坏这个视觉基线的前提下进行。
