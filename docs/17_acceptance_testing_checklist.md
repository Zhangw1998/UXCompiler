# 17. 验收与测试清单

## 摘要

本文档定义每个模块的验收条件和质量门禁。目标是让其他 AI / 工程师实现功能时，有明确的 done definition。

---

## 1. Artifact 完整性

必须输出：

```text
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
```

检查项：

- JSON 可解析。
- Schema 校验通过。
- 所有 sourceNodeId 可追溯。
- 所有 fallback 有 reason。
- 所有 confidence 在 0 到 1 之间。

---

## 2. Raw Extraction 验收

- root viewport 尺寸正确。
- visible / invisible 节点均被记录。
- absolute bounds、effects、opacity、constraints 未丢失。
- reference screenshot 存在。
- extraction report 记录导出失败项。

---

## 3. Canonical Scene 验收

- 所有节点坐标相对 root。
- 被删除 / 压平节点有记录。
- 不破坏视觉层级和 z-index。
- wrapper 保留规则正确。

---

## 4. Token Mining 验收

- 颜色按 usage 分类。
- spacing 聚类保留 aliases。
- typography token 包含 lineHeight。
- token_usage_map 记录 source node。
- 低置信度 token 有标记。

---

## 5. Layout Inference 验收

- 每个 region 有 layout candidate。
- 每个 decision 有 score、evidence、fallback。
- column / row / grid / stack / absolute 均有测试样例。
- 混合 flow + overlay 可表达。

---

## 6. Component Mining 验收

- 至少支持 Button / Card / ListItem。
- 组件实例数量不足时不生成公共组件。
- props 来自实例差异。
- 替换组件后必须跑 diff。

---

## 7. AI Protocol 验收

- AI 输入不包含过量无关 Raw JSON。
- AI 输出 JSON Schema 校验通过。
- AI 不能输出 Dart。
- AI 不能引用不存在的 sourceId。
- 低置信度结果不会自动进入最终 IR。

---

## 8. Asset + i18n 验收

- 所有 asset path 存在。
- pubspec patch 包含资源目录。
- 所有可见 Text 进入 i18n，或有明确 non_i18n reason。
- decorative_slice 不包含主要交互文本。
- 资源命名稳定。

---

## 9. Flutter Generation 验收

- `dart format` 通过。
- `flutter analyze` 无 error。
- 代码分层，不生成巨大单文件。
- 页面无业务状态和业务逻辑。
- Theme / spacing / text style 不在页面里硬编码。
- generated region 标记存在。

---

## 10. Visual Diff 验收

- Figma screenshot 与 Flutter screenshot 尺寸一致。
- 输出 page visual score。
- 输出 node / region diff report。
- 自动修复有 patch 和 rollback。
- 不达标时输出 manual review report。

---

## 11. 建议测试集

### Case A：规范 Auto Layout 页面

目标：验证 semantic layout。

### Case B：完全自由定位页面

目标：验证 absolute_widget / fidelity renderer。

### Case C：复杂装饰 hero

目标：验证 asset_slice。

### Case D：重复卡片但非 Figma Component

目标：验证 component mining。

### Case E：字体行高复杂页面

目标：验证 text fidelity。

### Case F：中英文混合页面

目标：验证 i18n key 和 text bounds。

### Case G：手改后重新生成

目标：验证 incremental merge。

---

## 12. 质量指标建议

```text
page visualScore >= 0.990
critical text visualScore >= 0.995
analyze errors = 0
asset missing = 0
i18n missing = 0
source traceability = 100%
```

---

## 总结

验收标准必须覆盖“生成了什么、能不能跑、像不像、可不可维护、能不能追溯”。这样其他 AI 或工程师即使分模块实现，也能保持整体质量一致。


---

## 13. Local Workbench 验收

- Workbench 可以在无云服务环境下启动。
- Figma Plugin 可连接 localhost 或导出 zip。
- Project Store 可保存 snapshot、override、tasks、preview artifacts。
- 所有人工操作都生成结构化 Override。
- 同一 snapshot + override_set 重建 NormalizedIR 结果一致。
- P0 task 未处理时 Codegen Review 禁止写入真实项目。

---

## 14. Review Task 验收

- 每个 task 有 priority、target、confidence、suggestedActions。
- suggestedAction 可生成合法 Override。
- 任务关闭有 closed reason。
- stale override 会生成任务。
- P1/P2 可批量处理，但 P0 不能批量忽略。

---

## 15. Tree Editor 验收

- 支持创建 / 合并 / 拆分 Region。
- 支持节点移动和 Pin to Region。
- 支持 Force Row / Column / Stack / Absolute / Asset Slice。
- 阻止循环树和非法引用。
- 保存后生成 Override，并能 rebuild IR。

---

## 16. Studios 验收

- Component Studio 可确认 / 拒绝组件候选，编辑 props。
- Token Studio 可 merge / split / rename token。
- Asset Studio 可指定 SVG / PNG / decorative_slice / real_text。
- i18n Studio 可确认 key、description、non_i18n reason。
- 所有 studio 操作可撤销或禁用对应 Override。

---

## 17. Preview & Diff Runner 验收

- Web Preview 可在无 Flutter SDK 时运行。
- Flutter Preview 记录 Flutter version、viewport、DPR、font profile。
- Diff heatmap 可生成。
- Diff issue 可定位到 region 或 sourceNodeId。
- repair patch 可回滚。

---

## 18. Codegen Review / Incremental Sync 验收

- Codegen Review 展示文件创建、修改、assets、arb、pubspec patch。
- analyze error > 0 时禁止写入主项目。
- generated region 标记存在。
- 设计稿重新同步后，Override 可自动 remap 或标记 stale。
- 不覆盖手写代码。
