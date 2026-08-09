# 计划与验收文档状态

更新时间：2026-08-09

Source Runtime 已在当前 `master` 基线完成一次性切换。下表为计划文档的阅读入口；“历史”表示保留原始正文用于追溯，不代表其中的 ACP、旧 CLI、旧路径或旧命令仍可执行。

## 现行契约与进行中工作

| 文档 | 状态 | 用途 |
| --- | --- | --- |
| [`2026-08-08-runtime-cutover-m4.md`](2026-08-08-runtime-cutover-m4.md) | 已完成 | Source Runtime 切换完成态与发布门禁 |
| [`2026-08-07-source-backend-maintenance.md`](2026-08-07-source-backend-maintenance.md) | 生效中 | subtree、上游同步与补丁维护 |
| [`2026-08-07-ui-compatibility-checklist.md`](2026-08-07-ui-compatibility-checklist.md) | 生效中 | live/replay、语义 UI 与 fallback 验收 |
| [`2026-07-18-webview2-acceptance.md`](2026-07-18-webview2-acceptance.md) | 待完成 | macOS WKWebView 与 Windows WebView2 的真实桌面验收 |
| [`2026-08-09-codex-subscription-auth.md`](2026-08-09-codex-subscription-auth.md) | 待实施 | 实验性 Codex Subscription 登录方案 |

## 已完成或被替代的架构记录

| 文档 | 状态 | 当前阅读方式 |
| --- | --- | --- |
| [`2026-08-07-source-backend-architecture.md`](2026-08-07-source-backend-architecture.md) | 已实施 | 架构决策；完成态以 M4 为准 |
| [`2026-08-07-source-backend-replacement-map.md`](2026-08-07-source-backend-replacement-map.md) | 已实施 | ACP 到 Source Runtime 的迁移对照表 |
| [`2026-07-31-kimi-code-0.31.0-alignment.md`](2026-07-31-kimi-code-0.31.0-alignment.md) | 已替代 | 旧 0.31.0/ACP 对齐记录；当前 pin 为 0.33.0 |
| [`2026-07-31-g5-multi-active-sessions-design.md`](2026-07-31-g5-multi-active-sessions-design.md) | 历史 | ACP 时代多活会话设计；当前 AppShell 仅持有一个 active stream |

## 历史功能与设计记录

以下文档保留当时的目标、路径和验证命令，不作为当前实施清单：

- [`2026-07-10-agent-swarm-ui.md`](2026-07-10-agent-swarm-ui.md)
- [`2026-07-14-event-ui-coverage.md`](2026-07-14-event-ui-coverage.md)
- [`2026-07-18-v2-ui-integration.md`](2026-07-18-v2-ui-integration.md)
- [`2026-07-19-generic-send-feedback.md`](2026-07-19-generic-send-feedback.md)
- [`2026-07-22-command-result-panel-design.md`](2026-07-22-command-result-panel-design.md)
- [`2026-07-22-model-management-ux.md`](2026-07-22-model-management-ux.md)
- [`2026-07-22-single-instance.md`](2026-07-22-single-instance.md)
- [`2026-07-23-thinking-effort-controls.md`](2026-07-23-thinking-effort-controls.md)
- [`2026-07-24-issue-triage-roadmap.md`](2026-07-24-issue-triage-roadmap.md)
- [`2026-07-26-optional-auth-readiness.md`](2026-07-26-optional-auth-readiness.md)

执行新改动时，从根 [`AGENTS.md`](../../AGENTS.md) 和 [`.github/DEVELOPMENT.md`](../../.github/DEVELOPMENT.md) 开始，不要直接照抄历史计划中的命令或文件路径。
