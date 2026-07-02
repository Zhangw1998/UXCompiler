# 23. Step 14：Review Task System

## 摘要

Review Task System 把自动规范化中的不确定点转成可操作任务。用户不需要浏览完整 Figma 节点树，也不需要理解所有算法，只处理会影响还原度、代码质量或生成安全性的关键决策。

---

## 输入

```text
- normalization_report.json。
- layout_candidates.json。
- inferred_components.json。
- inferred_tokens.json。
- asset_manifest.json。
- semantic_labels.json。
- visual_diff_report.json。
- stale_override_report.json。
```

---

## 输出

```text
- review_tasks.json。
- task action 生成的 overrides。
- task_status_report.json。
```

---

## 详细实施

### 1. 任务优先级

```text
P0：阻塞最终写入
- 无法决定 render strategy。
- 资源导出失败且被代码引用。
- P0 视觉 diff 超阈值。
- Flutter analyze error。
- stale override 影响当前节点结构。

P1：影响代码优雅和长期维护
- 组件候选未确认。
- 组件 props 不明确。
- 重要区域命名不明确。
- layout strategy 中置信度。

P2：影响整洁度但不阻塞
- token 命名。
- i18n key 命名。
- asset 命名。
- 低频 raw value。
```

### 2. 任务类型

```text
low_confidence_layout
low_confidence_component
ambiguous_name
token_conflict
asset_strategy_uncertain
i18n_key_uncertain
visual_diff_failed
stale_override
flutter_analyze_failed
resource_export_failed
component_mapping_required
```

### 3. Task Schema

```json
{
  "id": "task_001",
  "type": "low_confidence_layout",
  "priority": "P1",
  "target": {
    "normalizedNodeId": "region_header",
    "sourceNodeIds": ["1:2", "1:3"]
  },
  "title": "Header 区域布局置信度较低",
  "description": "系统在 Row 和 Stack 之间不确定。",
  "confidence": 0.64,
  "evidence": {
    "rowScore": 0.66,
    "stackScore": 0.61,
    "overlapRatio": 0.08
  },
  "suggestedActions": [
    {
      "label": "使用 Row",
      "override": {
        "type": "layout_strategy_override",
        "payload": { "strategy": "row" }
      }
    },
    {
      "label": "使用 Stack",
      "override": {
        "type": "layout_strategy_override",
        "payload": { "strategy": "stack" }
      }
    }
  ],
  "status": "open"
}
```

### 4. 任务生成规则

```text
layout confidence < 0.70：创建 P1 task，默认 absolute fallback。
component similarity 0.70-0.90：创建 P1 task，请用户确认是否抽组件。
token alias 范围过宽：创建 P2 task，请用户 merge/split。
asset strategy 涉及切图且包含 Text：创建 P0 task。
visual diff 超过阈值：创建 P0/P1 task，按区域严重程度决定。
stale override：创建 P0/P1 task，取决于 target 是否影响当前输出。
```

### 5. 任务 UI

每张任务卡必须包含：

```text
- 问题标题。
- 局部截图或节点高亮。
- source node 列表。
- 系统建议。
- 置信度和证据。
- 一键操作。
- 进入高级编辑入口。
```

### 6. 一键操作到 Override

用户点击“一键使用 Stack”，系统不直接改 IR，而是创建 Override：

```text
Task Action → Override → Rebuild NormalizedIR → Refresh Preview → Close Task
```

### 7. 批处理

允许批量接受低风险建议：

```text
- Accept all P2 naming suggestions。
- Accept all high-confidence token merges。
- Accept all asset rename suggestions。
```

不允许批量跳过：

```text
- P0 tasks。
- 会切图的策略变更。
- 会覆盖已有 Flutter 文件的变更。
```

---

## 质量门禁

```text
- P0 task 未处理时禁止 Codegen Write。
- 每个 Task 必须能追溯到 sourceNodeId 或 normalizedNodeId。
- 每个 suggestedAction 必须生成合法 Override。
- Task 关闭必须记录关闭原因。
- 任务列表刷新不能丢失用户已创建 Override。
```

---

## 失败与 fallback

```text
任务无法定位源节点：
- 降级为 region-level task。

用户忽略 P1 task：
- 使用系统 fallback 并在 generation manifest 标记。

用户忽略 P2 task：
- 使用自动命名 / raw token。

建议动作冲突：
- 禁用一键操作，引导到高级编辑器。
```

---

## 总结

Review Task System 是 Workbench 的“低摩擦人工干预层”。它把不确定推断变成明确、可审查、可重复应用的 Override，减少用户手工整理全部节点树的成本。
