# 21. Step 12：Figma Bridge Plugin

## 摘要

Figma Bridge Plugin 是 Workbench 的数据入口。它只负责从 Figma 读取当前设计稿、导出截图和资源、同步选区，并把结果发送到本地 Workbench。它不负责复杂规范化、不保存主 Override、不运行 Flutter。

---

## 输入

```text
- 用户当前选中的 Frame / Page / Component。
- Figma Node Tree。
- 节点几何、样式、文本、资源引用。
- 用户导出配置：scale、format、includeHidden、asset mode。
- Local Workbench 连接信息：localhost port / token。
```

---

## 输出

```text
- raw_figma_scene.json。
- figma_reference.png。
- raw_assets/。
- extraction_report.json。
- selection_changed events。
- sourceNodeId locate/highlight result。
```

---

## 详细实施

### 1. 插件结构

```text
apps/figma-plugin/
  src/
    main.ts
    ui.tsx
    extractor/
      read-selection.ts
      build-raw-scene.ts
      export-screenshot.ts
      export-assets.ts
    bridge/
      local-client.ts
      message-protocol.ts
    ui/
      App.tsx
      ConnectPanel.tsx
      SyncPanel.tsx
```

### 2. 主流程

```text
1. 用户在 Figma 里打开插件。
2. 插件 UI 尝试连接 http://127.0.0.1:<port>。
3. 用户选择 Frame，点击 Sync Selected Frame。
4. 插件读取节点树并构建 RawFigmaScene。
5. 插件导出目标 Frame reference screenshot。
6. 插件按候选策略导出 icon/image/slice 资源。
7. 插件把 snapshot 上传到 Local Workbench API。
8. Workbench 创建 SourceSnapshot 和 Project。
9. 插件持续监听 selectionchange，并发送 sourceNodeId。
```

### 3. RawFigmaScene 构建要求

必须保留：

```text
- sourceNodeId
- sourceNodeName
- node type
- visible
- opacity
- absoluteBoundingBox
- absoluteRenderBounds
- relativeTransform
- constraints
- layoutMode
- layoutPositioning
- fills
- strokes
- effects
- blendMode
- cornerRadius
- text properties
- componentKey / instance info
- bound variables / styles
- children order / z-index
```

不得在插件层做：

```text
- 不删除看似无用的 Group。
- 不合并相近颜色。
- 不把节点直接改成 Button/Card。
- 不把布局直接改成 Row/Column。
```

插件层只做读取和序列化。

### 4. Reference Screenshot 导出

输出：

```text
snapshots/snap_001/figma_reference.png
```

要求：

```text
- 尺寸与 Frame viewport 一致。
- 记录 scale / DPR / format。
- 记录导出时间和 Figma version。
- 如果导出失败，写入 extraction_report.json。
```

### 5. 资源候选导出

资源可以先分为候选，不在插件层最终裁决：

```text
icon_candidate
image_candidate
decorative_slice_candidate
complex_vector_candidate
```

输出：

```json
{
  "sourceNodeId": "123:456",
  "candidateType": "icon_candidate",
  "exportedFiles": [
    { "format": "svg", "path": "raw_assets/123_456.svg" }
  ],
  "status": "success"
}
```

### 6. Selection Sync

Workbench 需要支持“点击规范化树节点 → Figma 定位源节点”。实现方式：

```text
- 插件运行期间维持 WebSocket / HTTP polling。
- Workbench 发送 locate_source_node 请求。
- 插件在 Figma 中选中该 node，并滚动到可见位置。
- 如果插件未运行，Workbench 提示用户打开插件。
```

### 7. 离线导出 fallback

如果 localhost 不可用：

```text
1. 插件生成 uxcompiler_snapshot.zip。
2. 用户在 Workbench 中手动导入。
3. Workbench 仍可继续 Normalization。
```

zip 内容：

```text
raw_figma_scene.json
figma_reference.png
raw_assets/
extraction_report.json
```

---

## 质量门禁

```text
- 每个 Raw node 必须有 sourceNodeId。
- Raw node 顺序必须保留 Figma children order。
- 导出的 screenshot 必须存在或有明确失败原因。
- assets 导出失败不能中断整个 snapshot。
- 插件不得写入用户 Figma 文件，不使用 setPluginData 保存主数据。
```

---

## 失败与 fallback

```text
用户未选择 Frame：
- 提示选择 Frame，允许选择 Page 但要求确认范围。

Frame 过大：
- 只同步用户选中子树。
- 对 assets 分批导出。

某些节点不可导出：
- 记录 asset_export_failed。
- 后续 Asset Studio 处理。

连接本地 Workbench 失败：
- 提供导出 zip。
```

---

## 总结

Figma Bridge Plugin 是只读数据桥。它确保系统拥有完整、可追溯的 Raw 证据，而复杂规范化、人工干预、预览和代码生成都交给本地 Workbench 与 Runner。
