# 22. Step 13：Local Project Store 与 Override Store

## 摘要

因为系统不能修改 Figma 原稿，所有人工干预都必须保存在本地 Project Store 中。Project Store 是 Workbench 的长期记忆：它保存 SourceSnapshot、NormalizedIR、OverrideSet、ReviewTask、PreviewArtifact、CodegenBuild，并支持重新同步设计稿时复用旧决策。

---

## 输入

```text
- Figma Bridge Plugin 上传的 snapshot。
- 自动规范化 artifacts。
- 用户在 Workbench 中产生的操作。
- Preview Runner 输出。
- Codegen 输出。
- 现有 Flutter 项目路径和配置。
```

---

## 输出

```text
- project.json。
- source_snapshot.json。
- override_set.json。
- review_tasks.json。
- preview_artifacts.json。
- build_artifacts.json。
- stale_override_report.json。
```

---

## 详细实施

### 1. MVP 存储方案

优先本地：

```text
- SQLite：保存索引、状态、关系、任务。
- File Storage：保存大文件、IR JSON、图片、assets、patch。
```

推荐目录：

```text
.uxcompiler/
  workspace.json
  db.sqlite
  projects/
    <project_id>/
      project.json
      settings.json
      snapshots/
      normalized/
      overrides/
      review_tasks/
      previews/
      codegen/
```

### 2. 核心表

```text
projects
source_snapshots
normalized_ir_versions
override_sets
overrides
review_tasks
preview_artifacts
codegen_builds
settings
```

### 3. Project 模型

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
    "packageName": "app"
  },
  "currentSnapshotId": "snap_001",
  "currentOverrideSetId": "ovset_001",
  "currentNormalizedIrId": "nir_001",
  "status": "reviewing"
}
```

### 4. SourceSnapshot 模型

```json
{
  "id": "snap_001",
  "figmaFileKey": "abc123",
  "frameId": "10:20",
  "figmaVersion": "v42",
  "rawSceneHash": "sha256_xxx",
  "rawScenePath": "snapshots/snap_001/raw_figma_scene.json",
  "canonicalScenePath": "snapshots/snap_001/canonical_scene.json",
  "referenceScreenshotPath": "snapshots/snap_001/figma_reference.png",
  "assetDir": "snapshots/snap_001/assets",
  "createdAt": "2026-06-30T10:00:00-07:00"
}
```

### 5. Stable Node Key

Figma nodeId 是优先标识，但设计稿复制或重建时可能失效，因此每个 source node 还要生成稳定匹配信息：

```json
{
  "sourceNodeId": "123:456",
  "stableKey": {
    "nodeId": "123:456",
    "type": "TEXT",
    "pathHash": "hash_parent_path",
    "visualHash": "hash_bounds_style_text",
    "textHash": "hash_text_content",
    "siblingContextHash": "hash_nearby_nodes"
  }
}
```

重新同步时匹配优先级：

```text
1. nodeId exact match
2. pathHash + type match
3. visualHash + textHash match
4. bounds similarity + sibling context
5. stale_override
```

### 6. Override 模型

所有人工操作都必须结构化：

```json
{
  "id": "ovr_001",
  "scope": "project",
  "target": {
    "kind": "source_node",
    "sourceNodeId": "123:456"
  },
  "type": "layout_strategy_override",
  "payload": {
    "strategy": "stack",
    "reason": "manual_review"
  },
  "status": "active",
  "createdBy": "user",
  "createdAt": "2026-06-30T10:00:00-07:00",
  "updatedAt": "2026-06-30T10:05:00-07:00"
}
```

Override 类型：

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
token_merge_override
token_split_override
asset_strategy_override
i18n_key_override
flutter_component_mapping_override
text_calibration_override
ignore_node_override
```

### 7. Override 应用顺序

```text
1. ignore_node_override
2. region_create / merge / split
3. node_parent_override
4. token overrides
5. component overrides
6. naming overrides
7. layout / render strategy overrides
8. asset / i18n overrides
9. flutter component mappings
10. calibration overrides
```

应用顺序必须固定，保证确定性。

### 8. Override 历史

每个 override 变更写入 append-only log：

```text
overrides/override_history.ndjson
```

示例：

```json
{"event":"created","overrideId":"ovr_001","actor":"user","timestamp":"..."}
{"event":"updated","overrideId":"ovr_001","actor":"user","timestamp":"..."}
{"event":"disabled","overrideId":"ovr_001","actor":"user","timestamp":"..."}
```

### 9. 导入 / 导出

本地优先也要支持迁移：

```text
uxc project export proj_001 --out login_page.uxcproj.zip
uxc project import login_page.uxcproj.zip
```

导出包包含：

```text
project.json
settings.json
snapshots metadata
normalized artifacts
overrides
review tasks
preview reports
不默认包含完整 Flutter 项目代码
```

---

## 质量门禁

```text
- 所有 Override 必须可 JSON Schema 校验。
- 每个 Override 必须可追溯 actor 和时间。
- 不允许自然语言备注直接影响 Compiler。
- OverrideSet 必须有版本号和 hash。
- 同一 Snapshot + OverrideSet 生成结果必须一致。
```

---

## 失败与 fallback

```text
Override target 不存在：
- 标记 stale_override。
- 生成 Review Task。

SQLite 损坏：
- 从 file artifacts 和 override_history 重建索引。

本地目录移动：
- projectPath 进入 invalid 状态。
- 用户重新绑定 Flutter 项目路径。

多处 Override 冲突：
- 后应用规则覆盖前规则。
- 生成 override_conflict_report。
```

---

## 总结

Project Store 是本地优先方案的核心。它让“人工规范化”成为可版本化资产，而不是一次性 UI 操作。后续设计稿更新、AI 重新推断、代码重新生成，都必须通过 Override Store 保持稳定和可追溯。
