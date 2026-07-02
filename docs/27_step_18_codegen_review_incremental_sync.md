# 27. Step 18：Codegen Review 与 Incremental Sync

## 摘要

Codegen Review 是写入真实 Flutter 项目前的最后一道门禁。Incremental Sync 则负责设计稿更新后复用既有 Override，避免每次重新规范化。二者共同保证本地优先平台可长期使用，而不是一次性生成器。

---

## 输入

```text
- reviewed normalized_design_ir.json。
- visual_ir.json / semantic_ir.json。
- final token / asset / i18n manifests。
- component registry。
- visual_diff_report.json。
- existing Flutter project path。
- previous generation manifest。
- current override_set.json。
```

---

## 输出

```text
- flutter_generation_manifest.json。
- files_to_create.json。
- files_to_modify.json。
- assets_to_add.json。
- arb_patch.json。
- pubspec.yaml.patch。
- generated Dart files / patches。
- merge_report.json。
- incremental_sync_report.json。
```

---

## 1. Codegen Review

### 摘要

在写入项目之前，展示即将生成和修改的所有内容，让用户确认风险。

### 详细实施

Review 页面展示：

```text
- Visual score。
- analyze result。
- files to create。
- files to modify。
- assets to add。
- arb keys to add。
- pubspec patch。
- generated widgets。
- fallback regions。
- unresolved review tasks。
- manual override summary。
```

文件策略：

```text
新文件：默认可创建。
已有文件：必须生成 patch。
generated region：可自动更新。
manual region：不得覆盖。
冲突：必须用户确认。
```

Generated region 标记：

```dart
// @uxc-generated:start nodeId=123:456 hash=abc123 strategy=semantic_layout
class _LoginHeader extends StatelessWidget {
  const _LoginHeader();
  ...
}
// @uxc-generated:end
```

Manifest 示例：

```json
{
  "buildId": "build_001",
  "normalizedIrId": "nir_001",
  "visualScore": 0.992,
  "files": [
    {
      "path": "lib/features/login/presentation/pages/login_page.dart",
      "action": "create",
      "generatedRegions": [
        {
          "id": "region_login_header",
          "sourceNodeIds": ["123:456"],
          "hash": "abc123"
        }
      ]
    }
  ],
  "assets": ["assets/images/login_hero.png"],
  "arbKeys": ["loginContinueButton"]
}
```

### 质量门禁

```text
- P0 Review Task 必须为 0。
- flutter analyze error 必须为 0。
- asset missing 必须为 0。
- i18n missing 必须为 0。
- 如果 visualScore 未达阈值，必须用户显式 override 才能写入。
- 写入前生成备份或 patch。
```

### 失败与 fallback

```text
已有文件冲突：
- 输出 patch，不直接覆盖。

analyze 失败：
- 禁止写入，显示错误和修复建议。

visual score 不达标：
- 允许导出代码到 staging，但不写入主项目。
```

### 总结

Codegen Review 确保生成代码进入真实项目之前可审计、可回滚、可确认。

---

## 2. Incremental Sync

### 摘要

当 Figma 设计稿更新后，系统重新拉取 RawFigmaScene，并尽可能复用旧 Override，减少重复人工干预。

### 输入

```text
- old source_snapshot。
- new source_snapshot。
- old override_set。
- stable_node_keys。
- previous normalized_ir。
- previous generation_manifest。
```

### 输出

```text
- node_remap_report.json。
- reapplied_overrides.json。
- stale_overrides.json。
- updated normalized_design_ir.json。
- incremental_review_tasks.json。
- patch update。
```

### 详细实施

流程：

```text
1. 用户点击 Sync from Figma。
2. Figma Plugin 生成新 SourceSnapshot。
3. 系统对比 rawSceneHash。
4. 使用 nodeId 精确匹配旧节点。
5. 对失效 nodeId 使用 stableKey 匹配。
6. 重新应用可匹配 Override。
7. 标记 stale Override。
8. 重新运行 Normalization。
9. 重新跑 Preview / Diff。
10. 只生成变化部分 Review Tasks。
11. 生成代码 patch。
```

Stable 匹配得分：

```text
matchScore =
  nodeIdExact * 0.50
+ pathSimilarity * 0.15
+ visualHashSimilarity * 0.15
+ textSimilarity * 0.10
+ siblingContextSimilarity * 0.10
```

匹配规则：

```text
score >= 0.90：自动复用 Override。
0.70 <= score < 0.90：复用但创建 review task。
score < 0.70：标记 stale_override。
```

### 设计稿变更分类

```text
visual_only_change
text_change
layout_change
node_added
node_removed
component_structure_change
token_value_change
asset_change
```

### 代码更新策略

```text
- 只更新受影响 generated regions。
- 手写区域不覆盖。
- promote 过的手写组件只更新调用点，不重写组件内部。
- component registry mapping 优先于重新生成组件。
```

### 质量门禁

```text
- stale_override 必须进入任务列表。
- 未确认的低置信度 remap 不能静默写入代码。
- 生成 patch 必须包含旧/新 hash。
- diff score 变化必须展示。
```

### 失败与 fallback

```text
节点无法匹配：
- override 失效，用户重新绑定。

组件结构大变：
- 组件候选重新打开 review。

Token 大量变化：
- 生成 token migration report。

代码冲突：
- 只输出 patch，不写入文件。
```

### 总结

Incremental Sync 是系统产品化的关键。它让人工规范化成果成为长期资产，而不是每次设计稿变化后重新做一遍。

---

## 3. Promote Generated Widget

### 摘要

当开发者手动优化某个 generated widget 后，可以把它提升为手写组件，并进入 Component Registry。

### 输入

```text
- generated widget file。
- developer promotion request。
- component sourceNodeIds。
```

### 输出

```text
- component_registry mapping。
- promote_report.json。
- future codegen skip/usage rule。
```

### 详细实施

```text
1. 用户在 Codegen Review 或 CLI 中选择 Promote。
2. 系统记录 sourceNodeIds → Flutter widget mapping。
3. 后续生成时不再重写该 widget。
4. 只更新调用方 props。
```

### 总结

Promote 机制让自动生成代码可以自然演进为团队真实组件库。
