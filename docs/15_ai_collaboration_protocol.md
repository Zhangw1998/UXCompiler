# 15. AI 协作协议

## 摘要

本文档定义其他 AI / Agent 如何参与 UXCompiler。AI 只能处理语义、命名、候选排序和修复建议，不能直接接管最终代码生成。所有 AI 输入输出必须使用结构化 JSON，必须可校验、可追踪、可拒绝。

---

## 1. AI 总原则

```text
AI annotates, compiler decides.
AI suggests, normalizer validates.
AI explains, renderer generates.
```

AI 不允许：

```text
- 直接输出最终 Dart 文件
- 覆盖高置信度 layout decision
- 发明不存在的节点或组件
- 发明业务逻辑、onTap、navigation、state
- 删除设计节点
- 修改 Figma 原稿
```

---

## 2. AI 任务类型

| 任务 | 输入 | 输出 |
|---|---|---|
| semantic_region_labeling | region screenshot + structure | region role/name |
| asset_naming | asset screenshot + node metadata | asset name/type |
| i18n_key_generation | text + context | i18n key |
| component_candidate_ranking | component candidates | ranked candidates |
| layout_low_confidence_help | layout candidates + evidence | selected candidate suggestion |
| diff_repair_suggestion | diff report + IR | repair suggestions |

---

## 3. 通用 AI 输入格式

```json
{
  "task": "semantic_region_labeling",
  "version": "2.0",
  "context": {
    "pageName": "LoginPage",
    "viewport": { "width": 390, "height": 844 },
    "targetPlatform": "flutter"
  },
  "data": {},
  "constraints": {
    "jsonOnly": true,
    "doNotGenerateDart": true,
    "doNotInventBusinessLogic": true,
    "mustReferenceSourceIds": true
  }
}
```

---

## 4. 通用 AI 输出格式

```json
{
  "task": "semantic_region_labeling",
  "version": "2.0",
  "items": [
    {
      "sourceId": "region_01",
      "suggestion": {
        "name": "LoginHeader",
        "role": "header"
      },
      "confidence": 0.94,
      "reason": "Contains title and intro copy."
    }
  ],
  "warnings": []
}
```

---

## 5. Prompt 模板：区域语义标注

```text
你是 UI 结构语义标注器，不是代码生成器。
你只能根据输入的 region 结构、文本和截图摘要，输出 JSON。
不要输出 Dart、不要输出解释性 Markdown、不要发明业务逻辑。
每个结果必须引用 sourceId。

任务：为每个 region 生成 role、suggestedName、confidence。
允许的 role：app_bar, hero, form, list, grid, card, button_group, bottom_bar, decorative, unknown。

输入 JSON：
{{INPUT_JSON}}

输出 JSON Schema：
{
  "items": [
    {
      "sourceId": "string",
      "suggestion": {
        "name": "string",
        "role": "string"
      },
      "confidence": 0.0,
      "reason": "string"
    }
  ],
  "warnings": []
}
```

---

## 6. Prompt 模板：组件候选排序

```text
你是 UI 组件候选排序器。
你不会生成代码。
你只根据候选组件的结构相似度、样式相似度、文本模式和截图摘要，判断哪个候选更可能是可复用组件。
每个输出必须包含 componentCandidateId、selectedName、props、confidence。

输入：
{{INPUT_JSON}}

输出必须是 JSON。
```

---

## 7. Prompt 模板：Diff 修复建议

```text
你是 UI 视觉差异修复建议器。
你不能直接修改代码。
你只能根据 diff report 给出结构化 repair suggestions。
优先建议小范围修复：baselineShift、lineHeight、padding、gap、assetFit、radius、position offset。
不要建议大范围重写页面。

输入：
{{DIFF_REPORT_JSON}}

输出 JSON：
{
  "repairs": [
    {
      "sourceNodeId": "string",
      "type": "baseline_shift | line_height | gap | padding | asset_fit | radius | position_offset | fallback_to_slice",
      "value": {},
      "confidence": 0.0,
      "reason": "string"
    }
  ]
}
```

---

## 8. AI 输出校验

每次 AI 输出后执行：

```text
1. JSON parse
2. schema validate
3. sourceId existence validate
4. confidence threshold check
5. forbidden field check
6. deterministic conflict check
7. accept / reject / review
```

禁止字段：

```text
flutterCode
Dart
onTap
navigation
state
absoluteCoordinatesOverride
removeNode
```

---

## 9. 置信度处理

```text
confidence >= 0.90 → auto accept
0.70 <= confidence < 0.90 → accept with review flag
confidence < 0.70 → reject or keep as candidate
```

---

## 10. 给其他 AI 的总指令

```text
你正在实现 UXCompiler 的一个模块。
请先阅读 README、IR 契约、对应 Step 文档。
你的输出必须符合该 Step 的输入输出要求。
不要跳过 artifact。
不要直接生成最终 Flutter 代码，除非你实现的是 Flutter Generator，并且输入是 SemanticIR/VisualIR。
每个推断都必须保留 sourceNodeId、confidence、evidence、fallback。
```

---

## 总结

AI 协议的核心是“可控”。只要 AI 只输出结构化建议，Normalizer 和 Compiler 保持最终裁决权，系统就能同时获得语义智能和工程确定性。
