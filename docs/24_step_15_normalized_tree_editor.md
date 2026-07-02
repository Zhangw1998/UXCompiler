# 24. Step 15：Normalized Tree Editor

## 摘要

Normalized Tree Editor 用于编辑“虚拟规范化 UI 树”，而不是编辑 Figma 原始节点树。用户可以把节点固定到某个层级、创建/合并/拆分区域、改名、锁定布局策略、标记装饰或浮层，并实时查看预览影响。

---

## 输入

```text
- normalized_design_ir.json。
- source_node_mapping.json。
- current override_set.json。
- region screenshots / preview artifacts。
- review_tasks.json。
```

---

## 输出

```text
- node_parent_override。
- region_create_override。
- region_merge_override。
- region_split_override。
- naming_override。
- layout_strategy_override。
- render_strategy_override。
- updated normalized_design_ir.json。
```

---

## 详细实施

### 1. 页面布局

```text
左侧：Normalized Tree
中间：Preview Canvas / Screenshot Overlay
右侧：Inspector
底部：Change Preview / Task / Diff Issues
```

Tree 示例：

```text
LoginPage
  SafeAreaRegion
    HeaderRegion
      BackButton
      TitleText
    HeroRegion
      HeroBackgroundSlice
      HeroTitle
    LoginFormRegion
      EmailInput
      PasswordInput
      ContinueButton
    BottomLegalRegion
```

### 2. Tree 节点展示字段

```text
- normalized name。
- role。
- layout strategy。
- render strategy。
- source node count。
- confidence。
- override badge。
- visual score。
- fallback badge。
```

### 3. 支持操作

#### 3.1 固定层级

```text
- Pin to Region。
- Move to Region。
- Drag into parent。
- Mark as Overlay。
- Mark as Decoration。
```

输出：

```json
{
  "type": "node_parent_override",
  "sourceNodeIds": ["123:456"],
  "targetNormalizedParentId": "region_header"
}
```

#### 3.2 创建区域

```text
- Select nodes → Create Region。
- 给 Region 命名。
- 指定 role：header / content / list / footer / overlay / decoration。
```

输出：

```json
{
  "type": "region_create_override",
  "payload": {
    "regionId": "region_login_header",
    "name": "LoginHeader",
    "role": "header",
    "sourceNodeIds": ["1:2", "1:3"]
  }
}
```

#### 3.3 合并 / 拆分区域

```text
- Merge Regions。
- Split Region by selected children。
- Extract Overlay。
- Extract Decoration。
```

#### 3.4 修改布局策略

```text
- Auto。
- Force Row。
- Force Column。
- Force Grid。
- Force Stack。
- Force Absolute。
```

#### 3.5 修改渲染策略

```text
semantic_widget
semantic_layout
absolute_widget
custom_painter
asset_slice
hybrid_region
ignore
```

#### 3.6 命名

```text
- Rename Page。
- Rename Region。
- Rename Component Instance。
- Rename Asset Source。
- Rename Widget Class。
```

命名必须校验：

```text
- Dart class PascalCase。
- file name snake_case。
- asset name snake_case。
- i18n key lowerCamelCase 或项目规则。
```

### 4. Inspector 字段

```text
Identity
- name
- role
- sourceNodeIds
- stableKey

Layout
- inferred candidates
- selected strategy
- padding / gap / alignment
- confidence / evidence

Rendering
- render strategy
- fallback strategy
- asset strategy
- text calibration

Codegen
- widget class
- file path
- component mapping
- generated region id

Traceability
- source Figma node
- current overrides
- related tasks
- diff issues
```

### 5. 与 Figma 互通

```text
点击 sourceNodeId → Workbench 请求 Figma Plugin 选中节点。
Figma selectionchange → Workbench 高亮对应 normalized node。
```

### 6. 与 Preview 互通

```text
拖拽或修改策略后：
1. 创建临时 Override。
2. Rebuild NormalizedIR draft。
3. 更新 Web Preview。
4. 用户点击 Apply 后保存 Override。
5. 用户点击 Run Flutter Preview 后做真实渲染和 Diff。
```

### 7. 合法性校验

必须阻止：

```text
- 树结构循环。
- 子节点跨 page root。
- 交互文本被放入 decorative_slice。
- ignored node 被其他 visible widget 引用。
- 同一个 sourceNodeId 被两个互斥 region 独占。
```

允许：

```text
- 同一 sourceNodeId 被用于 trace 和 asset reference。
- 装饰层作为 overlay。
- hybrid region 里同时有 semantic children 和 fidelity overlay。
```

---

## 质量门禁

```text
- 每次保存操作必须生成 Override。
- Tree 中每个节点必须可追溯 sourceNodeId 或 generatedId。
- 所有强制策略必须写 reason。
- 被手动锁定的节点在自动重建时不得被覆盖。
- Preview draft 和 saved Override 要区分。
```

---

## 失败与 fallback

```text
用户移动节点导致布局不可表达：
- 阻止保存，提示改用 absolute / hybrid。

源节点找不到：
- 显示 stale source badge。

Preview 失败：
- 保留 Override 草稿，但不标记视觉验证通过。

命名冲突：
- 提供自动后缀或引导用户重命名。
```

---

## 总结

Normalized Tree Editor 是“人工把不规范设计稿规范化”的主界面。它编辑的是 Shadow UI Tree，不修改 Figma，因此既能保留原稿，又能为代码生成提供稳定、可审计、可复用的规范化结构。
