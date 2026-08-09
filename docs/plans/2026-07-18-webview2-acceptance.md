# 真实 Tauri / WebView UI 验收计划

| 项目 | 当前值 |
| --- | --- |
| 状态 | 待完成剩余 M5 场景 |
| 更新 | 2026-08-09 |
| 平台 | macOS WKWebView、Windows WebView2 |
| 运行时 | 仓内 Source Runtime（`runtime-v1`），不使用 ACP、外部 CLI 或浏览器 mock |

## 1. 目标与证据边界

在真实 Tauri 应用、真实 IPC 和 source-built Runtime 路径上验证用户可见行为。代码存在、自动化测试通过和真实桌面验收是三个独立状态；只有操作了可见界面并记录 Runtime/IPC、DOM 或截图证据的项目才能标记为桌面已验收。

历史上的 WebView2/CDP 做法只适用于 Windows。macOS 使用 WKWebView，可用当前可用的 Web Inspector、Computer Use 或截图/日志证据；不得为了调试加入生产 HTTP bridge，也不得用 Vite 浏览器页面代替 Tauri。

## 2. 前置确认

1. 运行 `git status --short --branch`，记录精确 commit、未提交改动和目标平台。
2. 确认没有旧构建占用同一 bundle id、调试端口或 Runtime 进程；记录实际启动的应用路径与 PID。
3. 使用 Node 24.15.0，运行：

   ```powershell
   npm run runtime:install
   npm run smoke:runtime
   npm run check:quick
   ```

4. `smoke:runtime` 必须通过 `runtime.getInfo` 返回 `@moonshot-ai/kimi-code@0.33.0` 与 commit `53c832dfdf9566afd59a8b3d54ebd36d3cb03d72`。它验证协议链路，但不算 UI 验收。
5. 使用 `npm run desktop` 启动当前源码；release 包验收另用 `npm run desktop:release`、`npm run release:msi` 或 `npm run release:macos` 产出的当前 artifact。

## 3. 平台检查方式

### Windows WebView2

- 仅对本次启动进程设置 `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=<unused-port>`。
- 通过 localhost CDP target 检查实际 WebView DOM 与 console；端口只在验收进程存活期间开放。
- 截图、console 记录和应用 PID 必须对应同一个当前构建。

### macOS WKWebView

- 先确认 `.app` 路径、bundle 内可执行文件和 PID，避免附着到历史 build。
- 使用可用的 Web Inspector、Computer Use 或可见截图检查界面；同时保留 Tauri/Runtime 终端日志。
- 若 Inspector 或自动化无法附着，标记为工具阻塞；成功启动、端口监听或进程存在本身不算可见验收。

## 4. 会话与 Prompt

1. 选择仓库工作目录创建会话，发送一个只读请求，要求读取 `package.json` 并返回包名。
2. 要求可见：用户消息、即时“消息发送中”、至少一个工具卡片或状态、流式回答和正确终态。
3. 忙碌时再发送一条消息，验证队列反馈；切换会话再切回，确认 stream 回连与缺失事件补齐，没有重复消息或卡片。
4. 重新打开历史会话，检查附件、工具结果、状态、用量、子代理步骤与终态的 replay 语义与 live 一致。
5. 对 runtime 崩溃、握手失败或空终态至少执行一个可控失败场景，确认 fail-closed 且显示可操作错误，不静默降级。

## 5. 语义事件与 fallback

- 工具调用参数延迟补齐时只更新同一 tool-call id，不出现永久 pending 或重复卡片。
- 审批与追问可交互并正确进入 resolved 状态；通知不会泄露凭据或完整私密配置。
- Swarm/子代理卡片展示 live 进度、嵌套 parent 关系和终态；Agents/Tasks 与对话卡片口径一致。
- 未知工具、未知 display payload 和未知可展示事件仍有 generic fallback，不导致消息流中断。
- 桌面完成通知只在真实 turn 完成时触发；回放历史不能重复触发系统通知。

## 6. Workspace、Sessions 与 Settings

1. 依次打开 Changes、Files、Agents、Tasks；验证 loading、empty、error 与真实数据状态，Git/文件视图必须针对当前会话 worktree。
2. 验证 active/archived 分页、重命名、归档/恢复和批量操作；删除只在专门测试数据上执行。
3. 打开 Settings 的 General、Usage、Config、MCP 与 About：

   - 手动 dark/light 有效；不得声称支持尚未接入的 system theme。
   - `config.toml` 与 `mcp.json` 读取、校验、保存失败和刷新反馈可见；不得记录 token 或完整私密内容。
   - About 显示桌面版本与 handshake 的 Kimi source tag/commit，不探测外部 CLI。

4. auth 真机验收使用专门测试账号或已授权环境，记录成功/失败状态但不记录凭据。
5. Share 与 fork-at-turn 不得出现伪能力；`fork_session` 继续显示引擎能力边界。

## 7. Release artifact 验收

### macOS Apple Silicon

- 验证当前 DMG 中的 `.app` 能启动包内 SEA sidecar，manifest 的 target、source commit 与 artifact digest 一致。
- 分别记录 ad-hoc、Developer ID 签名和 notarization 状态；未完成正式签名/公证时不得描述为已交付。

### Windows

- 验证当前 MSI/本地 release executable 携带匹配架构的 Runtime artifact，不依赖 PATH 上的 `kimi`。
- Windows SEA 变体未交付前明确标记阻塞，不用旧 exe/MSI 替代当前源码结果。

## 8. 自动化回归与交接

桌面操作完成后运行与改动范围相称的门禁；完整回归为：

```powershell
npm test
npm run build
npm run smoke:runtime
cargo test --manifest-path src-tauri/Cargo.toml
cargo check --manifest-path src-tauri/Cargo.toml
```

交接报告固定分为：

- 代码：实现或检查到的路径。
- 自动化：实际命令、通过/失败及环境阻塞。
- 真实桌面：平台、构建路径、PID、已操作场景和证据。
- 未验收：未执行或被工具/凭据/平台阻塞的场景。

关闭测试应用和调试端口，确认没有遗留的当前测试 Runtime 进程。不要删除用户真实会话、配置或凭据。
