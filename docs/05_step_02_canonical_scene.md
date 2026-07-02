# 05. Step 2 — Canonical Scene

## 摘要

Canonical Scene 是对 RawFigmaScene 的机械清洗层。它不修改 Figma 原稿，也不做语义判断，只把后续算法难以处理的原始结构转换为统一、稳定、可计算的视觉场景。

---

## 输入

- `raw_figma_scene.json`
- `extraction_report.json`
- 可选：用户清洗配置

---

## 输出

```text
canonical_scene.json
canonicalization_report.json
node_mapping.json
```

`node_mapping.json` 用于记录：

```text
raw node id → canonical node id
canonical node id → raw source node ids
```

---

## 详细实施

### 1. 坐标标准化

将每个节点坐标转换为相对 root frame 的坐标。

```ts
canonicalBounds = absoluteBoundingBox - root.absoluteBoundingBox
```

输出：

```json
{
  "bounds": { "x": 24, "y": 80, "w": 342, "h": 56 }
}
```

### 2. 节点类型归一

将 Figma 类型映射为 canonical 类型：

| Figma 类型 | Canonical 类型 |
|---|---|
| FRAME | frame |
| GROUP | group |
| TEXT | text |
| RECTANGLE | rect |
| VECTOR / BOOLEAN_OPERATION / STAR / LINE | vector |
| INSTANCE | instance |
| COMPONENT / COMPONENT_SET | component |

### 3. 无效节点标记

不要直接删除节点，除非它完全无视觉和无布局意义。推荐先标记：

```json
{
  "flags": {
    "isInvisible": true,
    "isZeroSize": false,
    "isEmptyWrapper": false
  }
}
```

### 4. Wrapper 压平

可压平条件：

```text
- 节点没有 fill / stroke / effect / opacity / clip / mask / transform
- 节点不是 Auto Layout 容器
- 节点只有一个 child 或仅用于无意义分组
```

不可压平条件：

```text
- clipsContent = true
- opacity != 1
- has effect
- has transform
- has mask / blendMode
- layoutMode != NONE
- 作为 component instance 边界
```

### 5. 复杂效果标记

对每个节点打 flags：

```json
{
  "flags": {
    "hasBlur": true,
    "hasMask": true,
    "hasBlendMode": false,
    "isComplexVector": true,
    "recommendAssetSlice": true
  }
}
```

### 6. 视觉顺序排序

按 Figma children 顺序保留 z-index。输出：

```json
{
  "zIndex": 12
}
```

---

## 质量门禁

- canonical root 尺寸必须与 reference screenshot 一致。
- 每个 canonical node 必须能追溯到 raw node id。
- 不得在本步骤改变 bounds、color、opacity、effect 的视觉含义。
- 被移除 / 压平的节点必须记录原因。

---

## 输出示例

```json
{
  "version": "2.0",
  "root": {
    "id": "c_123_456",
    "sourceNodeId": "123:456",
    "canonicalType": "frame",
    "bounds": { "x": 0, "y": 0, "w": 390, "h": 844 },
    "children": [
      {
        "id": "c_1",
        "sourceNodeId": "12:34",
        "canonicalType": "text",
        "bounds": { "x": 24, "y": 80, "w": 200, "h": 32 },
        "text": { "content": "Welcome" }
      }
    ]
  }
}
```

---

## 总结

Canonical Scene 是 Normalizer 的地基。它应该把“混乱的 Figma 节点树”变成“可计算的视觉树”，但不能试图把它变成规范 UI。真正的规范化发生在后续 Token、Layout、Component 和 Semantic 层。
