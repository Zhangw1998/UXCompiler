# 09. Step 6 — Semantic Naming + AI Labeling

## 摘要

本步骤使用 AI 对区域、节点、组件、资源和文案进行语义命名与角色标注。AI 的职责是“解释和命名”，不是直接改变布局和生成最终代码。所有 AI 输出必须是结构化 JSON，并由 Normalizer 校验和采纳。

---

## 输入

- `regions.json`
- `layout_decisions.json`
- `inferred_components.json`
- `canonical_scene.json` 的摘要版本
- 区域截图 / 节点截图
- Text 内容列表
- Token candidates
- 用户命名规范

---

## 输出

```text
semantic_labels.json
ai_decision_report.json
naming_map.json
i18n_key_suggestions.json
```

---

## 详细实施

### 1. 构造 AI 输入

不要把全量 Raw JSON 直接丢给 AI。应构造精简上下文：

```json
{
  "task": "semantic_labeling",
  "page": {
    "nameCandidate": "LoginPage",
    "viewport": { "width": 390, "height": 844 }
  },
  "region": {
    "regionId": "region_01",
    "bounds": { "x": 0, "y": 88, "w": 390, "h": 220 },
    "layoutCandidates": [
      { "type": "column", "score": 0.92 }
    ],
    "texts": ["Welcome back", "Continue"],
    "visualSummary": "top section with title and CTA"
  },
  "constraints": {
    "outputLanguage": "json_only",
    "doNotGenerateDart": true,
    "doNotInventBusinessLogic": true
  }
}
```

### 2. AI 输出 Schema

```json
{
  "regions": [
    {
      "regionId": "region_01",
      "suggestedName": "LoginHeader",
      "role": "header",
      "confidence": 0.94,
      "reason": "Contains welcome title and intro copy."
    }
  ],
  "nodes": [
    {
      "nodeId": "123:456",
      "suggestedName": "continueButton",
      "role": "primary_button",
      "confidence": 0.91
    }
  ],
  "assets": [
    {
      "nodeId": "222:333",
      "suggestedName": "ic_arrow_right",
      "assetKind": "icon",
      "confidence": 0.88
    }
  ],
  "i18n": [
    {
      "nodeId": "333:444",
      "text": "Continue",
      "suggestedKey": "login_continue_button",
      "confidence": 0.93
    }
  ]
}
```

### 3. 采纳规则

```text
AI confidence >= 0.90 → 自动采纳
0.70 <= confidence < 0.90 → 采纳但标记 review_recommended
confidence < 0.70 → 不采纳，使用 deterministic fallback name
```

### 4. 命名 fallback

当 AI 不可用或低置信度时：

```text
region_top_01
section_content_02
text_title_03
button_candidate_04
asset_node_<shortHash>
```

### 5. AI 禁区

AI 不允许：

```text
- 直接输出 Dart
- 修改坐标
- 删除节点
- 推翻高置信度 layout decision
- 发明不存在的组件 API
- 发明业务事件或状态
```

---

## 质量门禁

- AI 输出必须通过 JSON Schema 校验。
- 每个命名必须绑定 source node id 或 region id。
- 不允许无 source 的组件、资源、i18n key。
- AI reason 可以保存到 report，但不进入最终 renderer IR。

---

## 失败与 fallback

| 场景 | fallback |
|---|---|
| AI 返回非 JSON | 重试一次，失败后使用规则命名 |
| AI 发明节点 | 丢弃该项 |
| AI 修改布局 | 丢弃布局相关字段 |
| AI 置信度低 | deterministic name |
| 多语言文本难以识别 | 使用 node role + hash 生成 key |

---

## 总结

AI 在规范化中的最大价值是语义化和命名，不是布局数学。只要坚持结构化输出和 Normalizer 最终裁决，就能降低随机性，同时获得可读代码所需的语义信息。
