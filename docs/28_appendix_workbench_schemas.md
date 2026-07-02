# 28. 附录：Workbench Schema 示例

## 摘要

本文档提供 Local-first Normalization Workbench 所需的关键 Schema 示例。所有人工干预、任务、预览和同步结果都应结构化保存，避免自然语言说明直接影响 Compiler。

---

## 1. `project.json`

```json
{
  "id": "proj_001",
  "name": "Login Page",
  "figma": {
    "fileKey": "abc123",
    "pageId": "1:1",
    "frameId": "10:20",
    "frameName": "Login / Default"
  },
  "flutter": {
    "projectPath": "/Users/me/app",
    "packageName": "app",
    "targetFeature": "login"
  },
  "currentSnapshotId": "snap_001",
  "currentOverrideSetId": "ovset_001",
  "currentNormalizedIrId": "nir_001",
  "status": "reviewing"
}
```

---

## 2. `source_snapshot.json`

```json
{
  "id": "snap_001",
  "figmaFileKey": "abc123",
  "frameId": "10:20",
  "figmaVersion": "v42",
  "viewport": { "width": 390, "height": 844, "devicePixelRatio": 3 },
  "rawSceneHash": "sha256_xxx",
  "rawScenePath": "snapshots/snap_001/raw_figma_scene.json",
  "canonicalScenePath": "snapshots/snap_001/canonical_scene.json",
  "referenceScreenshotPath": "snapshots/snap_001/figma_reference.png",
  "assetDir": "snapshots/snap_001/assets",
  "createdAt": "2026-06-30T10:00:00-07:00"
}
```

---

## 3. `override_set.json`

```json
{
  "id": "ovset_001",
  "version": 12,
  "snapshotId": "snap_001",
  "hash": "sha256_override_set",
  "overrides": [
    {
      "id": "ovr_001",
      "type": "node_parent_override",
      "target": { "kind": "source_node", "sourceNodeId": "123:456" },
      "payload": {
        "targetNormalizedParentId": "region_header"
      },
      "status": "active",
      "createdBy": "user",
      "createdAt": "2026-06-30T10:00:00-07:00"
    }
  ]
}
```

---

## 4. Override 类型枚举

```text
node_parent_override
region_create_override
region_merge_override
region_split_override
layout_strategy_override
render_strategy_override
naming_override
component_candidate_override
component_prop_override
component_variant_override
token_merge_override
token_split_override
token_rename_override
asset_strategy_override
i18n_key_override
flutter_component_mapping_override
text_calibration_override
ignore_node_override
```

---

## 5. `review_task.json`

```json
{
  "id": "task_001",
  "type": "low_confidence_component",
  "priority": "P1",
  "target": {
    "candidateId": "cmp_candidate_001",
    "sourceNodeIds": ["12:1", "12:8", "12:15"]
  },
  "title": "确认 3 个卡片是否抽成 ProductCard",
  "description": "这些区域结构相似，但第二个实例缺少 price 文本。",
  "confidence": 0.78,
  "suggestedActions": [
    {
      "label": "确认为 ProductCard",
      "override": {
        "type": "component_candidate_override",
        "payload": { "action": "approve", "componentName": "ProductCard" }
      }
    },
    {
      "label": "保持独立生成",
      "override": {
        "type": "component_candidate_override",
        "payload": { "action": "reject" }
      }
    }
  ],
  "status": "open"
}
```

---

## 6. `preview_artifact.json`

```json
{
  "id": "preview_001",
  "projectId": "proj_001",
  "normalizedIrId": "nir_001",
  "overrideSetHash": "sha256_override_set",
  "figmaReference": "snapshots/snap_001/figma_reference.png",
  "webPreview": "previews/preview_001/web_preview.png",
  "flutterPreview": "previews/preview_001/flutter_preview.png",
  "diffHeatmap": "previews/preview_001/diff_heatmap.png",
  "score": {
    "visualScore": 0.992,
    "ssim": 0.991,
    "pixelDiffRatio": 0.006,
    "textBaselineMaxDelta": 1.2
  },
  "environment": {
    "flutterVersion": "3.x",
    "deviceSize": "390x844",
    "devicePixelRatio": 3,
    "fontProfile": "ios_inter"
  },
  "issues": [
    {
      "type": "text_baseline_offset",
      "sourceNodeId": "123:456",
      "deltaY": 1.2
    }
  ]
}
```

---

## 7. `node_remap_report.json`

```json
{
  "oldSnapshotId": "snap_001",
  "newSnapshotId": "snap_002",
  "matches": [
    {
      "oldSourceNodeId": "123:456",
      "newSourceNodeId": "789:101",
      "matchScore": 0.93,
      "method": "visualHash_textHash_siblingContext",
      "overrideReapplied": true
    }
  ],
  "staleOverrides": [
    {
      "overrideId": "ovr_008",
      "reason": "target_node_removed"
    }
  ]
}
```

---

## 8. `codegen_review.json`

```json
{
  "buildId": "build_001",
  "projectId": "proj_001",
  "normalizedIrId": "nir_001",
  "visualScore": 0.992,
  "analyze": { "errors": 0, "warnings": 3 },
  "filesToCreate": [
    "lib/features/login/presentation/pages/login_page.dart"
  ],
  "filesToModify": [
    {
      "path": "pubspec.yaml",
      "patch": "codegen/build_001/pubspec.yaml.patch"
    }
  ],
  "assetsToAdd": [
    "assets/images/login_hero.png"
  ],
  "arbKeysToAdd": [
    "loginContinueButton"
  ],
  "blockingTasks": []
}
```

---

## 9. `workbench_settings.json`

```json
{
  "mode": "local_first",
  "ports": {
    "api": 17371,
    "web": 17372
  },
  "flutter": {
    "sdkPath": "/Users/me/flutter",
    "previewDevice": {
      "width": 390,
      "height": 844,
      "devicePixelRatio": 3
    }
  },
  "ai": {
    "enabled": true,
    "provider": "openai_compatible",
    "sendScreenshots": true,
    "sendRawJson": false
  },
  "codegen": {
    "writeMode": "patch_review",
    "allowOverwriteGeneratedRegions": true,
    "allowOverwriteManualCode": false
  }
}
```

---

## 总结

Workbench Schema 的核心原则是：所有人工决策都必须结构化、可校验、可追溯、可重放。这样系统才能在不修改 Figma 的前提下，把人工规范化成果长期保存，并在每次重新同步和生成代码时确定性复用。
