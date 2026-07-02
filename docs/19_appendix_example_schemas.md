# 19. 附录：示例 Schema 与 Manifest

## 摘要

本文档提供常用 JSON 示例，方便其他 AI 或工程师实现时直接参考。

---

## 1. `normalization_report.json`

```json
{
  "version": "2.0",
  "source": {
    "fileKey": "xxx",
    "frameNodeId": "123:456"
  },
  "score": {
    "overall": 0.84,
    "tokens": 0.91,
    "layout": 0.83,
    "components": 0.76,
    "assets": 0.89
  },
  "issues": [
    {
      "type": "low_confidence_component",
      "sourceNodeIds": ["12:34", "12:80"],
      "message": "These cards look similar but hierarchy differs.",
      "fallback": "generate_separate_widgets"
    }
  ]
}
```

---

## 2. `render_strategy_manifest.json`

```json
{
  "page": "LoginPage",
  "viewport": {
    "width": 390,
    "height": 844,
    "devicePixelRatio": 3
  },
  "regions": [
    {
      "regionId": "login_form",
      "sourceNodeIds": ["12:34"],
      "strategy": "semantic_widget",
      "reason": "Recognized login form pattern",
      "editable": true,
      "visualScore": 0.994
    },
    {
      "regionId": "hero_background",
      "sourceNodeIds": ["56:78"],
      "strategy": "asset_slice",
      "reason": "Complex masks and blur effects",
      "editable": false,
      "visualScore": 0.999
    }
  ]
}
```

---

## 3. `component_registry.json`

```json
{
  "components": [
    {
      "figmaComponentKey": "optional_figma_key",
      "inferredComponentId": "primary_button",
      "flutter": {
        "import": "package:app/ui/components/app_button.dart",
        "constructor": "AppButton.primary",
        "props": {
          "label": {
            "from": "text",
            "i18n": true
          },
          "enabled": {
            "from": "variantOrState",
            "default": true
          }
        }
      },
      "fidelity": {
        "expectedHeight": 48,
        "baselineOffset": -1
      }
    }
  ]
}
```

---

## 4. `repair_patch.json`

```json
{
  "version": "2.0",
  "patches": [
    {
      "target": "normalized_design_ir",
      "sourceNodeId": "12:34",
      "operation": "set",
      "path": "/textCalibration/baselineShift",
      "value": -1,
      "reason": "Flutter baseline is 1px lower than Figma reference."
    },
    {
      "target": "visual_ir",
      "sourceNodeId": "44:55",
      "operation": "set",
      "path": "/bounds/y",
      "value": 128,
      "reason": "Node rendered 2px too high."
    }
  ]
}
```

---

## 5. Strategy 枚举

```text
semantic_widget
semantic_layout
absolute_widget
custom_painter
asset_slice
hybrid_region
ignore
```

---

## 6. Confidence 规则

```text
>= 0.90       自动采纳
0.70 - 0.89   采纳但需要 review flag
< 0.70        不自动采纳，使用 fallback
```

---

## 7. 目录输出示例

```text
artifacts/
  raw_figma_scene.json
  canonical_scene.json
  inferred_tokens.json
  regions.json
  layout_decisions.json
  inferred_components.json
  semantic_labels.json
  asset_manifest.json
  i18n_manifest.json
  normalized_design_ir.json
  visual_ir.json
  semantic_ir.json
  flutter_generation_manifest.json
  visual_diff_report.json

flutter_output/
  lib/
    features/
      login/
        presentation/
          pages/
            login_page.dart
          widgets/
            login_header.dart
            login_form.dart
            login_hero_fidelity_region.dart
    theme/
      app_colors.dart
      app_text_styles.dart
      app_spacing.dart
    generated/
      assets.gen.dart
    l10n/
      intl_en.arb
  assets/
    icons/
    images/
    slices/
  pubspec.yaml.patch
```

---

## 总结

这些 Schema 不是最终强制标准，但可以作为实现 v0/v1 的起点。每个 schema 的关键要求是：可追溯、可校验、可 fallback、可 diff。


---

## 8. v2.1 Workbench Schema

Workbench 相关 Schema 已独立放入 [28_appendix_workbench_schemas.md](./28_appendix_workbench_schemas.md)，包括：

```text
project.json
source_snapshot.json
override_set.json
review_task.json
preview_artifact.json
node_remap_report.json
codegen_review.json
workbench_settings.json
```

这些 Schema 用于支持本地优先的人工规范化、预览、Diff、Codegen Review 和 Incremental Sync。
