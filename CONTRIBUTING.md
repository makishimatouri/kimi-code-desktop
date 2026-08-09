# 贡献与开发

先从 [`docs/README.md`](docs/README.md) 判断文档角色。本仓库正式的结构与开发规范维护在 [`.github/DEVELOPMENT.md`](.github/DEVELOPMENT.md)，功能接线步骤见 [`.github/FEATURE_IMPLEMENTATION.md`](.github/FEATURE_IMPLEMENTATION.md)。

开始改动前：

1. 运行 `git status --short --branch`，保留工作区内无关的 staged、unstaged 与 untracked 改动。
2. 先写清改动范围和验证计划，再按所属模块实现；不要整仓格式化或恢复 ACP、外部 CLI、旧 sidecar 等生产路径。
3. Runtime/wire 改动必须同时检查 live、replay、store、语义 UI 和 generic fallback。
4. 根据开发规范运行 focused tests 与相应门禁，最后运行 `git diff --check`。
5. 交付时分别报告“代码完成”“自动化通过”“真实 Tauri/WebView 验收”，不能相互替代。

只改文档时至少检查本地 Markdown 链接与 `git diff --check`。历史计划和发布说明用于追溯，不应把其中的旧架构描述当作当前实现要求。
