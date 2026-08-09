# Kimi Code Desktop 文档导航

本目录同时保存现行契约与历史实施记录。阅读前先按文档角色判断其权威性；旧计划中的 ACP、旧路径、旧版本和旧命令只描述当时状态，不是当前实现指南。

## 当前入口

| 目的 | 文档 |
| --- | --- |
| 项目介绍、开发与构建 | [`../README.md`](../README.md) |
| 结构、依赖边界与验证门槛 | [`.github/DEVELOPMENT.md`](../.github/DEVELOPMENT.md) |
| 功能装配步骤 | [`.github/FEATURE_IMPLEMENTATION.md`](../.github/FEATURE_IMPLEMENTATION.md) |
| 代理工作约束 | [`../AGENTS.md`](../AGENTS.md) |
| Source Runtime 完成态 | [`plans/2026-08-08-runtime-cutover-m4.md`](plans/2026-08-08-runtime-cutover-m4.md) |
| Runtime 长期维护 | [`plans/2026-08-07-source-backend-maintenance.md`](plans/2026-08-07-source-backend-maintenance.md) |
| UI 兼容契约 | [`plans/2026-08-07-ui-compatibility-checklist.md`](plans/2026-08-07-ui-compatibility-checklist.md) |
| 真实桌面验收 | [`plans/2026-07-18-webview2-acceptance.md`](plans/2026-07-18-webview2-acceptance.md) |
| 上游冻结与补丁 | [`../runtime/UPSTREAM.md`](../runtime/UPSTREAM.md)、[`../runtime/PATCHES.md`](../runtime/PATCHES.md) |

## 文档角色

- `plans/` 既包含当前契约，也包含已经执行、被替代或仅供追溯的历史计划；以 [`plans/README.md`](plans/README.md) 的状态表为准。
- [`releases/`](releases/README.md) 是版本发布时的历史快照。旧版说明中的 ACP 或 CLI 描述不应被改写成当前架构。
- `superpowers/` 保存 Monochrome V2 的历史设计与执行记录，不是当前目录或 Runtime 契约。
- Kimi Code 用户功能文档由上游 subtree 维护：[`../runtime/kimi-code/docs/zh/`](../runtime/kimi-code/docs/zh/) 与 [`../runtime/kimi-code/docs/en/`](../runtime/kimi-code/docs/en/)。外壳文档不复制上游配置、命令或 MCP 参考。

## 当前事实优先级

发生冲突时依次以正在运行的源码和测试、`package.json` 脚本、`.github/DEVELOPMENT.md`、根 `AGENTS.md`、已确认的 Source Runtime 契约和根 `README.md` 为准。历史计划与发布记录只用于解释决策过程。
