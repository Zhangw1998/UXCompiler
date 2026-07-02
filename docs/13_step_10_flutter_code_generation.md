# 13. Step 10 — Flutter Code Generation

## 摘要

本步骤把 VisualIR / SemanticIR / Token / Asset / i18n 转换为 Flutter 项目文件。生成方式必须结构化、可格式化、可增量更新，不能让 AI 拼接最终 Dart。目标是生成程序员愿意继续编辑的代码。

---

## 输入

- `semantic_ir.json`
- `visual_ir.json`
- `inferred_tokens.json`
- `asset_manifest.json`
- `i18n_manifest.json`
- `uplift_decisions.json`
- 用户项目配置
- 可选：已有 Flutter 项目路径

---

## 输出

```text
lib/features/<feature>/presentation/pages/<page>.dart
lib/features/<feature>/presentation/widgets/*.dart
lib/theme/app_colors.dart
lib/theme/app_text_styles.dart
lib/theme/app_spacing.dart
lib/theme/app_radii.dart
lib/theme/app_shadows.dart
lib/generated/assets.gen.dart
lib/l10n/intl_*.arb
pubspec.yaml.patch
flutter_generation_manifest.json
```

---

## 详细实施

### 1. 文件结构

推荐 Clean Architecture presentation-only 输出：

```text
lib/
  features/
    login/
      presentation/
        pages/
          login_page.dart
        widgets/
          login_header.dart
          login_form.dart
          login_hero_fidelity_region.dart
  theme/
    app_colors.dart
    app_text_styles.dart
    app_spacing.dart
    app_radii.dart
    app_shadows.dart
  generated/
    assets.gen.dart
```

### 2. Page Facade

页面文件保持简单：

```dart
class LoginPage extends StatelessWidget {
  const LoginPage({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      body: SafeArea(
        child: LoginContent(),
      ),
    );
  }
}
```

### 3. Region Widgets

每个 region 单独成 widget：

```dart
class LoginContent extends StatelessWidget {
  const LoginContent({super.key});

  @override
  Widget build(BuildContext context) {
    return const Column(
      children: [
        LoginHeader(),
        LoginForm(),
      ],
    );
  }
}
```

### 4. Fidelity Region 局部封装

```dart
class LoginHeroFidelityRegion extends StatelessWidget {
  const LoginHeroFidelityRegion({super.key});

  @override
  Widget build(BuildContext context) {
    return const SizedBox(
      width: 390,
      height: 220,
      child: Stack(children: []),
    );
  }
}
```

### 5. Generated Region 标记

为了支持后续增量更新：

```dart
// @uxc-generated:start nodeId=12:34 strategy=semantic_widget hash=abc123
class LoginForm extends StatelessWidget {
  const LoginForm({super.key});
  ...
}
// @uxc-generated:end
```

规则：

```text
- 只自动覆盖 generated region。
- 手改 generated region 后，下次生成必须走三方 merge。
- 用户可以 promote generated widget 为手写组件。
```

### 6. Token 代码生成

```dart
class AppSpacing {
  const AppSpacing._();
  static const xs = 4.0;
  static const sm = 8.0;
  static const md = 16.0;
}
```

### 7. 避免的代码风格

不要生成：

```text
- 巨大单文件
- 巨大匿名 widget tree
- 过度 Container
- 全页面 Stack + Positioned，除非 Pixel Exact 模式
- 硬编码字符串
- 硬编码颜色、字体、资源 path
- AI 发明业务 onTap
```

### 8. Project Writer

写入策略：

```text
new file → create
existing generated region unchanged → update
existing generated region modified → three-way merge
manual file → output patch and ask confirmation
```

---

## 质量门禁

- `dart format` 必须通过。
- `flutter analyze` 不应有 error。
- 所有 imports 必须可解析。
- 所有 assets 必须存在并在 pubspec 中声明。
- 所有 Text 字符串应来自 i18n 或明确标记 non_i18n。
- 每个 generated widget 必须能追溯到 source region / node。

---

## 失败与 fallback

| 场景 | fallback |
|---|---|
| import 冲突 | alias import 或集中 barrel file |
| pubspec patch 冲突 | 输出 patch，不直接覆盖 |
| i18n 未配置 | 生成 local fallback + warning |
| generated region 被手改 | 三方 merge / conflict patch |
| Flutter analyze error | 阻塞输出 final，保留 draft |

---

## 总结

Flutter 代码生成要像编译器，不像聊天机器人。所有输出必须可追踪、可格式化、可验证、可增量更新。视觉兜底代码可以存在，但必须局部封装，主代码保持可读。
