# Codex Subscription 登录接入桌面实施方案

> 日期：2026-08-09
>
> 状态：待实施
>
> 产品标识：`Codex Subscription（实验性）`
> 适用基线：`codex/runtime-cutover` 完成后的 Source Runtime-only 架构

## 1. 结论

可以在 Kimi Code Desktop 中实现类似 OpenCode Desktop 的 Codex/ChatGPT 订阅登录，但实现方式必须是：

- Kimi Source Runtime 继续是唯一代理 Runtime 和唯一 agent loop；
- Codex 登录只作为一个新的 Provider 鉴权方式；
- Codex Responses 只作为该 Provider 的模型传输；
- 不启动、不依赖 Codex CLI、Codex app-server 或外部 `opencode`；
- 不读取或覆盖用户的 `~/.codex/auth.json`；
- 不把 ChatGPT 订阅登录与 OpenAI API Key 混成一个配置状态；
- 不在失败时静默降级到 API Key、Kimi Provider 或其他模型。

目标链路如下：

```text
Settings / Provider Connect UI
  -> Tauri auth commands
     -> RuntimeHost / runtime-v1
        -> desktop-runtime AuthDriverRegistry
           -> KimiAuthDriver                  # 保留现有 Kimi 登录
           -> CodexSubscriptionAuthDriver     # 浏览器 PKCE / Device Code / refresh
        -> desktop-owned credential store

Composer / Session
  -> Kimi agent-core                          # 唯一 agent loop
     -> openai-codex provider definition
        -> Codex subscription transport
           -> ChatGPT Codex Responses endpoint
```

这不是“把 Codex Desktop 嵌进 Kimi Desktop”，也不是“双 Runtime”。它是在现有 Source Runtime 的 Provider 抽象中增加一个认证和请求适配器。

## 2. 为什么采用这个方案

OpenCode 当前实现已经证明这条用户路径可行：桌面选择 OpenAI Provider，选择 ChatGPT/Codex 登录方式，浏览器完成 OAuth，应用保存 refresh token，再把模型请求转发到 Codex Responses 端点。

本项目不能直接照搬 OpenCode 的整体架构，因为当前产品有更严格的运行时约束：

- `runtime/kimi-code` 中的 Kimi 源码是唯一 AI Runtime；
- `runtime-v1` 是 Rust 与 Node Runtime 之间唯一协议；
- 生产路径不得恢复外部 CLI、ACP、双 backend 或 silent fallback；
- Provider、模型和鉴权的核心状态归 Runtime 所有；
- `runtime/kimi-code/apps/desktop-runtime` 是仓内允许承载桌面专属适配的边界。

因此只参考 OpenCode 的 OAuth 状态机、token 刷新和请求适配思路，不复制它的 Runtime 组织方式。

## 3. 目标

### 3.1 用户能力

用户可以在桌面设置中：

1. 选择 `OpenAI Codex` Provider；
2. 选择“使用 ChatGPT 订阅登录”；
3. 在默认浏览器完成授权，或在无回调环境中使用 Device Code；
4. 回到桌面看到已登录账号和登录方式；
5. 选择该 Provider 支持的模型发起真实会话；
6. token 过期时自动刷新；
7. 主动退出并清除本应用保存的凭据；
8. 在授权失效、账号不支持、限流或服务异常时看到明确错误。

### 3.2 工程目标

- 把现有 Kimi 专用 auth IPC 收敛为多 Provider 的统一契约；
- OAuth token 只在 Node Runtime 的鉴权/传输边界中使用；
- Provider 请求仍由 Kimi agent-core 调度，不改变会话、工具、上下文和 replay 主链；
- 利用现有 Provider 注册、OAuth toolkit、`clientFactory`/HTTP 注入扩展点，预期不修改上游 Kimi core；
- 浏览器登录、Device Code、refresh、logout 和请求传输都能离线单测；
- 最终通过真实 Tauri + Source Runtime 的登录与对话验收。

## 4. 非目标与硬边界

本阶段不做以下事情：

- 不把 Codex CLI 或 app-server 作为会话 backend；
- 不提供“在 Kimi Runtime 和 Codex Runtime 之间切换”；
- 不导入 Codex CLI 已有登录态；
- 不接管或修改 `~/.codex`；
- 不承诺 ChatGPT 订阅可使用全部 OpenAI API 模型；
- 不把 API Key 登录伪装成 ChatGPT 订阅登录；
- 不在 OAuth 失败时自动切换成 API Key；
- 不把浏览器 mock、单测通过描述为真实桌面验收；
- 不复制 OpenCode 源码。如果后续确实复用可识别代码，必须保留 MIT 许可信息并更新 `THIRD_PARTY_NOTICES.md`。

## 5. 已确认的现状与缺口

### 5.1 已有基础

当前代码已经具备以下基础：

- runtime-v1 已有 `auth.startLogin`、`auth.getFlow`、`auth.cancelLogin`、`auth.logout`、`auth.status`；
- auth 参数 schema 已预留可选 `provider`；
- Runtime bootstrap 支持 extra seeds，可替换或组合 OAuth toolkit；
- Provider 类型为开放字符串，Provider definition 可从 desktop adapter 注册；
- OpenAI Responses Provider 支持 `baseUrl`、headers、`clientFactory` 和 HTTP client 注入；
- 前端已使用 Tauri opener 打开外部授权 URL；
- 当前 RuntimeHost 已承担单进程监管和 runtime-v1 请求转发。

这些扩展点足以在 desktop-runtime 层完成 Codex Provider，正常情况下不需要修改上游 agent-core。

### 5.2 当前缺口

- Rust `auth.rs` 仍按 Kimi DTO 转换，并把 Provider 固定为默认值；
- Rust 侧只有一个全局 `CURRENT_LOGIN_ID`，无法正确表达多 Provider、多 flow；
- 设置页只有 Kimi 专用登录组件；
- `auth-router` 当前全部委托给 Kimi klient auth；
- 没有桌面自有的 Codex OAuth driver、credential store 和请求传输；
- 没有明确区分“凭据已保存”“账号已认证”“真实模型请求已验证”；
- 真实 Tauri auth 验收仍属于 M5，现有代码和测试不能替代真机结论。

## 6. 架构决策

### 6.1 Auth Driver Registry

在 `runtime/kimi-code/apps/desktop-runtime` 新增桌面自有的 auth driver 抽象：

```ts
interface DesktopAuthDriver {
  readonly provider: string
  listMethods(): Promise<AuthMethod[]>
  startLogin(input: StartLoginInput): Promise<AuthFlow>
  getFlow(flowId: string): Promise<AuthFlow>
  cancelLogin(flowId: string): Promise<void>
  getStatus(): Promise<AuthStatus>
  logout(): Promise<void>
}
```

首批 driver：

- `KimiAuthDriver`：委托现有 `klient.global.auth`，保持 Kimi 行为；
- `CodexSubscriptionAuthDriver`：负责 PKCE、Device Code、token exchange/refresh、账号信息和登出；
- `AuthDriverRegistry`：按 provider 路由，未知 provider 返回结构化错误。

Flow 状态必须归 Node Runtime 所有，并以 `(provider, flow_id)` 为键。Rust 不再维护单一全局 login id。

### 6.2 Composite OAuth Toolkit

通过现有 Runtime bootstrap extra seeds 注入组合 toolkit：

- Kimi token 查询继续委托现有 Kimi OAuth service；
- `openai-codex` token 查询委托 Codex credential/token service；
- Provider 请求只拿到短期 access token，不直接操作 refresh token；
- refresh 使用 per-provider single-flight，防止并发请求重复刷新并覆盖 rotated token。

如果实施时发现现有 DI 扩展点不足，应停止进入上游源码，先记录缺失接口和替代设计。只有确认无法从 desktop-runtime 外层解决，才允许创建上游补丁，并同步登记 `runtime/PATCHES.md`。

### 6.3 Provider 定义

注册独立 Provider ID：

```text
provider id: openai-codex
provider type: openai_codex
protocol: openai_responses
auth mode: oauth
credential key: oauth/openai-codex
```

不能复用普通 `openai` Provider ID，否则 API Key 与 ChatGPT 订阅凭据会互相覆盖，也无法清楚表达请求端点和模型能力差异。

### 6.4 后续供应商扩展

这次不能把“通用”只做成 UI 外观。完成后，新增其他 OAuth 供应商应只需要：

1. 在 desktop-runtime 注册新的 auth driver；
2. 声明该供应商支持的登录 method 和安全显示字段；
3. 注册 Provider definition、token adapter 和模型能力；
4. 添加该供应商的脱敏 fixture、单测与真实验收；
5. 由现有通用 Settings UI 按 `auth.methods` 渲染。

Rust/Tauri 不应再新增供应商专用 command，前端也不应再复制一套登录状态机。浏览器 OAuth、Device Code、API Key、静态 token 等方式可以共享 method kind，但每个 driver 必须自己处理 issuer、scope、token exchange、refresh 和 logout 语义。没有 refresh token 的供应商不能被通用层假定为可刷新。

## 7. runtime-v1 鉴权契约

现有方法名可以保留，但响应改为 Provider 无关的判别联合。新增 `auth.methods` 用于 UI 动态展示支持方式。

### 7.1 `auth.methods`

请求：

```json
{
  "provider": "openai-codex"
}
```

响应：

```json
{
  "provider": "openai-codex",
  "methods": [
    {
      "id": "browser",
      "kind": "browser",
      "label": "使用 ChatGPT 登录"
    },
    {
      "id": "device_code",
      "kind": "device_code",
      "label": "使用设备代码登录"
    }
  ]
}
```

API Key 属于普通 OpenAI Provider 的独立配置方式，不进入 `openai-codex` OAuth 方法列表。

### 7.2 `auth.startLogin`

请求：

```json
{
  "provider": "openai-codex",
  "method": "browser"
}
```

浏览器 flow 响应：

```json
{
  "provider": "openai-codex",
  "flow_id": "opaque-id",
  "method": "browser",
  "status": "pending",
  "authorization_url": "https://auth.openai.com/...",
  "expires_at": 1786212345000
}
```

Device Code flow 响应：

```json
{
  "provider": "openai-codex",
  "flow_id": "opaque-id",
  "method": "device_code",
  "status": "pending",
  "verification_uri": "https://service-returned-verification-url.example",
  "verification_uri_complete": "https://service-returned-verification-url.example?...",
  "user_code": "ABCD-EFGH",
  "expires_at": 1786212345000,
  "interval_ms": 5000
}
```

### 7.3 `auth.getFlow`

请求必须同时带 provider 与 flow id：

```json
{
  "provider": "openai-codex",
  "flow_id": "opaque-id"
}
```

状态只能是：

```text
pending | authenticated | denied | expired | cancelled | failed
```

错误响应使用稳定 code，例如：

```text
auth.callback_port_unavailable
auth.state_mismatch
auth.pkce_exchange_failed
auth.device_code_denied
auth.flow_expired
auth.refresh_revoked
auth.provider_unavailable
```

错误对象不能包含 authorization code、access token、refresh token、完整响应 body 或敏感 headers。

### 7.4 `auth.status`

```json
{
  "provider": "openai-codex",
  "authenticated": true,
  "method": "chatgpt_subscription",
  "account": {
    "email": "masked-or-safe-display-value",
    "plan": "known-display-value"
  }
}
```

`account_id` 只在 Runtime 内构造请求头，不默认传给前端。JWT payload 解析只允许用于提取显示元数据或 account id，不能当作签名验证或授权判断。

### 7.5 `auth.cancelLogin`、`auth.logout`

- cancel 必须中止轮询、关闭 callback server、清除 PKCE verifier 和内存 flow；
- logout 必须原子删除本应用的 Codex credential；
- logout 不能退出用户的 ChatGPT 浏览器会话，也不能删除 `~/.codex`；
- Runtime shutdown 必须取消全部未完成 flow。

## 8. 浏览器 PKCE 登录

### 8.1 流程

1. Runtime 生成高熵 `state`、PKCE verifier 和 S256 challenge；
2. Runtime 仅在 loopback 地址启动一次性 callback server；
3. Runtime 返回 authorization URL，前端通过 Tauri opener 打开系统浏览器；
4. callback 校验 path、state、code 和 flow 生命周期；
5. Runtime 直接完成 token exchange；
6. Runtime 原子写入 credential store；
7. callback 页面只显示“可以返回桌面”，不展示 token 或账号 payload；
8. flow 转为 `authenticated`，关闭 listener 并销毁 verifier。

### 8.2 端口策略

OpenCode 当前实现使用 loopback 端口 `1455`。第一版为保持授权 redirect URI 兼容，可以采用同一固定回调端口，但必须：

- 只绑定 `127.0.0.1`/`::1`，不能监听公网接口；
- 端口占用时返回 `auth.callback_port_unavailable`；
- 不杀死占用端口的其他进程；
- UI 明确提供 Device Code 重试；
- 不从浏览器 flow 静默切换到 Device Code；
- 五分钟超时后自动关闭 listener。

OAuth client id、redirect URI 和 scope 必须在实现前对照 OpenAI 当前公开客户端实现重新核验。不能仅因为 OpenCode 使用某个 public client id，就把它视为本产品长期稳定契约。

## 9. Device Code 登录

Device Code 用于 callback 端口不可用、远程桌面或浏览器无法自动回跳的场景。

实现要求：

- Runtime 请求 user code 和 device auth id；
- UI 显示 user code、复制按钮、verification URL 和剩余时间；
- Runtime 按服务端 interval 加安全余量轮询；
- `authorization_pending` 继续等待；
- `slow_down` 增加间隔；
- denied、expired、cancelled 必须终止；
- 使用 `AbortController`，取消和 Runtime shutdown 能立即停止网络请求；
- 不把 device auth token 或 token exchange 响应发送到前端。

## 10. 凭据存储与刷新

### 10.1 第一版存储

第一版使用 Runtime 自有受限文件存储，与 `$KIMI_CODE_HOME` 生命周期一致：

```text
$KIMI_CODE_HOME/credentials/oauth/openai-codex.json
```

最低要求：

- credentials 目录权限 `0700`；
- credential 文件权限 `0600`；
- 临时文件同目录写入、fsync 后原子 rename；
- Windows 使用等价 ACL 收紧，仅当前用户可读；
- 读取时拒绝目录、符号链接或权限异常目标；
- JSON 只保存 access token、refresh token、expires at 和 Runtime 必需的 account id；
- 不保存 authorization code、PKCE verifier、完整 JWT claims 或原始 HTTP 响应；
- 日志、错误、wire、会话记录和崩溃报告统一 redact。

不使用“自行加密后把密钥放在同目录”这种伪加密。系统 Keychain/Credential Manager 可作为后续增强，但不能为了第一版引入不稳定的 SEA 原生依赖。

### 10.2 Refresh 规则

- access token 在过期前保留安全窗口主动刷新；
- 同一 Provider 同时只允许一个 refresh promise；
- refresh token rotation 后必须原子替换旧值；
- 请求收到 401 时最多强制刷新并重放一次；
- 第二次 401 转为 `auth.refresh_revoked`，不得无限重试；
- 403 作为账号、workspace 或 entitlement 问题显示；
- 429 作为额度/限流显示，不触发重新登录；
- 网络错误保留原登录态，除非服务端明确宣告 token 无效。

## 11. Codex Subscription 模型传输

### 11.1 独立 transport

在 desktop-runtime 注册 `openai-codex` Provider definition，利用现有 OpenAI Responses provider 的 client/HTTP 注入点添加 transport：

- 将 Responses 请求送到 ChatGPT Codex backend；
- 使用 `Authorization: Bearer <access_token>`；
- 在可用时添加 `ChatGPT-Account-Id`；
- 使用本产品真实的 `originator` 和 User-Agent，例如 `kimi-code-desktop`；
- 不能伪装成 `opencode`；
- 删除普通 OpenAI API Key Provider 遗留的 authorization/default key；
- 在发送前移除 Codex backend 不支持的字段，例如经验证不支持的 `max_output_tokens`；
- 保留流式响应、abort、错误映射和 Kimi agent-core 的工具循环。

endpoint、header 名和 body rewrite 规则集中在一个 transport 模块，不散落到 UI、Rust 或通用 OpenAI Provider 中。

### 11.2 模型能力

ChatGPT 订阅端点不等于 OpenAI Platform API，不能简单暴露全部 `openai_responses` 模型。

第一版应维护桌面自有、可测试的兼容模型清单：

- 只展示已通过真实订阅请求验证的模型；
- 模型能力记录 reasoning、tools、image input、context 等明确字段；
- 未知模型默认隐藏，不猜测能力；
- 服务端拒绝模型时返回可操作错误，不回退到别的模型；
- OpenCode 的过滤规则只能作为参考，不能成为本产品事实来源。

兼容清单应与 Provider adapter 放在同一所有权边界，便于协议变化时单点更新。

### 11.3 稳定性声明

ChatGPT Codex backend 不是通用、版本化的公开 OpenAI Platform API。即使 OpenCode 当前能使用，也可能发生 endpoint、scope、client policy、header 或模型约束变化。

因此第一版必须：

- 在 UI 标记“实验性”；
- 把协议差异隔离在 adapter；
- 为关键 response fixture 添加契约测试；
- 协议不兼容时 fail closed；
- 不影响 Kimi 和普通 API Provider；
- 发布前确认当前 OpenAI 使用条款、OAuth client 识别和产品命名要求。

## 12. Provider 配置与持久化

成功登录后，Runtime 负责确保存在独立 Provider 配置，概念形态如下：

```toml
[providers.openai-codex]
type = "openai_codex"

[providers.openai-codex.oauth]
storage = "file"
key = "oauth/openai-codex"
```

要求：

- config 只保存 credential reference，不保存 token；
- 登录成功与 Provider 配置写入必须具备可恢复顺序；
- 凭据成功、配置失败时回滚新凭据或返回明确的待修复状态；
- logout 默认删除 credential，但保留非敏感 Provider/模型配置，状态显示“需要登录”；
- 删除 Provider 时询问是否同时删除本应用 credential；
- API Key Provider 使用不同 ID 和不同 credential key。

## 13. Rust / Tauri 层改造

Rust 继续作为薄 IPC 层，不拥有 OAuth token 或刷新逻辑。

需要改造：

- auth command DTO 改为 Provider 无关的 runtime-v1 DTO；
- 所有 auth 命令显式接收 provider；
- 删除静态 `CURRENT_LOGIN_ID`；
- `getFlow`、`cancelLogin` 使用 UI 提供的 opaque flow id；
- 只做 schema 校验、RuntimeHost 调用和安全错误转换；
- 禁止打印完整 params/result；
- 授权 URL 可传前端，token 和 token exchange body 不可传；
- Runtime 不可用时返回 Source Runtime readiness 错误，不启动其他 backend。

迁移期间可以保留一层 TypeScript 函数名兼容，供现有 Kimi UI 同批迁移；最终提交不得保留两套生产 auth 命令路径。

## 14. 桌面 UI

### 14.1 信息架构

把 Kimi 专用登录面板收敛为通用 Provider 连接面板：

```text
Settings
  -> Providers
     -> Kimi
     -> OpenAI Codex (Experimental)
     -> OpenAI API Key
     -> Other providers...
```

`OpenAI Codex` 卡片展示：

- 未登录；
- 等待浏览器授权；
- 等待 Device Code；
- 已登录；
- 登录已失效；
- Provider 已配置但尚未完成真实请求验证。

### 14.2 交互

浏览器登录：

1. 点击“使用 ChatGPT 登录”；
2. UI 请求 `auth.startLogin`；
3. 收到 URL 后调用 Tauri opener；
4. UI 轮询 `auth.getFlow`，或以后改为 Runtime auth event；
5. 成功后刷新 provider/model/status；
6. 失败时显示稳定错误和重试入口。

Device Code：

- 显示 code、复制、打开验证页、倒计时和取消；
- 组件卸载、关闭 dialog 或切换 provider 时显式 cancel；
- 轮询状态由 Runtime 决定，前端不直接请求 OpenAI。

退出：

- 明确提示“只清除 Kimi Code Desktop 保存的 Codex 登录，不会退出浏览器中的 ChatGPT”；
- 成功后立即刷新模型可用性；
- 正在使用该 Provider 的新请求必须被阻止并提示重新登录。

### 14.3 UI 文案边界

应使用：

- `使用 ChatGPT 订阅登录`
- `Codex Subscription（实验性）`
- `OpenAI API Key`（独立入口）

不应使用：

- `免费使用 OpenAI API`
- `支持全部 ChatGPT 模型`
- `官方 OpenAI 集成`，除非后续获得明确授权或合作身份
- 把“凭据已保存”表述为“模型已验证可用”

## 15. 实施工作包

每个工作包开始前重新检查 `git status --short --branch`，声明文件 ownership；共享热点文件同一时间只允许一个 owner。

### W0：冻结契约与测试夹具

范围：只读核验 + protocol types/tests。

- 核验 OpenAI 官方当前登录流程、scope、redirect URI、client identity 和 Device Code contract；
- 固定 OpenCode 参考 commit，不跟随 `dev` 浮动；
- 为 auth methods、browser flow、device flow、status、error 建立 fixture；
- 为 Codex Responses request/stream/error 建立脱敏 fixture；
- 明确实验性开关、模型兼容清单和发布门槛。

退出条件：协议与安全评审通过，未写业务实现。

### W1：Runtime auth driver 与 credential store

主要范围：

```text
runtime/kimi-code/apps/desktop-runtime/src/**/auth-router.ts
runtime/kimi-code/apps/desktop-runtime/src/auth/**
runtime/kimi-code/apps/desktop-runtime/src/protocol-parity.ts
runtime/kimi-code/apps/desktop-runtime/test/**
```

- 引入 AuthDriverRegistry；
- 用 KimiAuthDriver 包装现有 klient auth；
- 实现 Codex browser/device flow；
- 实现受限文件 credential store；
- 实现 single-flight refresh、cancel 和 shutdown cleanup；
- 确认无 token 出现在日志和 runtime-v1 响应。

退出条件：Runtime 单测覆盖成功、失败、超时、取消、刷新旋转和并发刷新。

### W2：Provider transport 与模型策略

主要范围：

```text
runtime/kimi-code/apps/desktop-runtime/src/providers/**
runtime/kimi-code/apps/desktop-runtime/src/engine.ts
runtime/kimi-code/apps/desktop-runtime/test/**
```

- 注册 `openai-codex` Provider；
- 注入 composite OAuth toolkit；
- 实现 endpoint/header/body adapter；
- 添加模型兼容清单；
- 覆盖 streaming、abort、401 refresh、403、429 和未知 payload；
- 证明工具调用仍由 Kimi agent-core 完成。

退出条件：离线 fixture 测试通过；用测试 server 验证完整请求链，无真实 token。

### W3：Rust / Tauri 通用 auth IPC

主要范围：

```text
src-tauri/src/commands/auth.rs
src-tauri/src/runtime/protocol.rs
src-tauri/src/runtime/client.rs
src-tauri/src/runtime_check.rs
src-tauri/src/**/auth*test*
```

- 去除 Kimi 专用 DTO 和单全局 flow；
- 显式传 provider、method、flow id；
- 保持 Rust 无 token；
- 增加多 Provider flow、错误转换和 Runtime 重启测试。

退出条件：Rust focused tests 与 `cargo test --all-targets` 通过。

### W4：Provider 连接 UI

主要范围：

```text
src/lib/tauri-api.ts
src/modules/settings/**
src/modules/providers/**
src/**/__tests__/**
```

- 抽象通用 ProviderAuthPanel/ConnectDialog；
- 迁移 Kimi 登录，不产生第二套路径；
- 增加 Codex browser/device/logout/status UI；
- 增加实验性说明和 API Key 独立入口；
- 登录成功后刷新 Provider、模型和全局配置状态；
- 覆盖卸载取消、重试、端口冲突、过期和退出。

退出条件：前端 focused tests、build 和通用 fallback 检查通过。

### W5：真实桌面验收与发布门禁

- 在真实 Tauri + Source Runtime 上完成 browser PKCE 登录；
- 完成 Device Code 登录；
- 重启应用后确认登录态恢复；
- 发送真实 prompt，观察首 token、工具调用、终态和 usage；
- access token 过期/模拟 401 后确认只刷新一次；
- logout 后确认新请求被阻止；
- 端口占用、拒绝授权、网络断开、429 分别显示正确错误；
- 检查 WebView 控制台、Rust 日志、Runtime 日志和 session wire 无凭据；
- 验证 Kimi 登录和已有 Provider 无回归；
- 分别记录“代码存在”“自动化通过”“真实桌面验收”的证据。

退出条件：M5 验收记录完整，才允许默认展示该入口；否则保持 feature flag 或实验性入口关闭。

## 16. 测试矩阵

### 16.1 Runtime 单测

- PKCE verifier/challenge/state；
- callback state mismatch；
- callback timeout/cancel/port occupied；
- Device Code pending/slow_down/denied/expired；
- credential 权限、原子写、损坏文件、logout；
- refresh 提前量、rotation、single-flight、401 一次重放；
- redaction：token 不出现在异常、日志和响应；
- Provider request URL/header/body rewrite；
- stream parsing、abort、403、429；
- 不支持模型 fail closed；
- Runtime shutdown 清理 flow。

### 16.2 Rust 测试

- provider/method/flow id 序列化；
- 两个 Provider flow 不互相覆盖；
- RuntimeHost 重启后旧 flow 返回明确失效；
- 敏感字段不会进入 Rust DTO 或日志；
- readiness 失败不启动 fallback。

### 16.3 前端测试

- Provider method 选择；
- browser opener 成功/失败；
- Device Code 展示、复制、取消和过期；
- dialog unmount 调用 cancel；
- status 的 configured/authenticated/verified 区分；
- logout 刷新 Provider/model；
- Kimi 登录兼容；
- 错误文案不渲染原始 response body。

### 16.4 自动化门禁

至少运行：

```powershell
npm run check:quick
npm run runtime:typecheck
npm run runtime:test
npm run smoke:runtime
npm test
npm run build
cargo test --manifest-path src-tauri/Cargo.toml --all-targets
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets -- -D warnings
git diff --check
```

现有 `smoke:runtime` 必须扩展 auth driver 的离线路径，但真实 Codex OAuth 不能成为 CI 必需的在线依赖。

## 17. 真实验收清单

测试账号不得把凭据写入仓库或 fixture。验收记录至少包括：

| 场景 | 可见结果 | 内部证据 |
| --- | --- | --- |
| Browser PKCE | 浏览器授权后桌面显示已登录 | callback/state/token exchange 成功且无敏感日志 |
| Device Code | 输入 code 后桌面自动完成 | 轮询遵守 interval，flow 正确终止 |
| 应用重启 | 状态恢复且可发请求 | credential 权限正确，refresh 可用 |
| 首次真实请求 | 收到可见流式回复 | 请求走 `openai-codex`，agent loop 仍为 Kimi |
| 工具调用 | 工具卡片与终态正常 | live/replay/store/fallback 无回归 |
| Token refresh | 用户无感或只见短暂重试 | single-flight，仅重放一次 |
| Logout | 显示未登录，新请求被阻止 | 本应用 credential 已删除 |
| 端口占用 | 提示改用设备代码 | 没有杀进程，没有 silent fallback |
| 订阅不支持 | 显示 entitlement 错误 | 不切换 API Key/其他 Provider |
| 限流 | 显示额度或限流状态 | 无重登循环、无重试风暴 |

## 18. 故障、回滚与隔离

### 18.1 Fail-closed

以下情况都必须阻止该 Provider 的新请求并显示可操作错误：

- credential 不存在或损坏；
- refresh 被撤销；
- OAuth client/endpoint contract 改变；
- 模型不在兼容清单；
- account id 必需但无法安全取得；
- Runtime artifact/readiness 失败。

不能静默切换到 Kimi、OpenAI API Key 或其他 Provider。

### 18.2 功能隔离

第一版由桌面 feature flag 控制 Codex Subscription 入口。关闭开关时：

- 不展示连接入口；
- 不影响已存在的 Kimi/API Provider；
- 不删除用户 credential；
- 已选 `openai-codex` 的会话显示“Provider 当前不可用”，不自动改模型。

### 18.3 协议回滚

如果 ChatGPT Codex backend 发生不兼容：

1. 关闭入口或阻止新登录；
2. 保留凭据，避免无必要要求用户重新授权；
3. 更新 adapter 和契约 fixture；
4. 重新完成真实请求验收；
5. 不通过恢复 Codex CLI/app-server 绕过问题。

## 19. 预计文件改动

实施前按实际目录再次核对，预计涉及：

```text
runtime/kimi-code/apps/desktop-runtime/src/
  auth-router.ts
  engine.ts
  auth/driver.ts
  auth/registry.ts
  auth/kimi-driver.ts
  auth/codex-subscription-driver.ts
  auth/codex-oauth.ts
  auth/credential-store.ts
  providers/openai-codex.ts
  providers/openai-codex-models.ts
  protocol-parity.ts

src-tauri/src/
  commands/auth.rs
  runtime/protocol.rs
  runtime/client.rs

src/
  lib/tauri-api.ts
  modules/settings/settings-dialog.tsx
  modules/providers/provider-auth-panel.tsx
  modules/providers/codex-login-panel.tsx

docs/
  plans/2026-08-09-codex-subscription-auth.md
  plans/2026-08-07-ui-compatibility-checklist.md
```

预期不修改：

```text
runtime/kimi-code/packages/agent-core/**
runtime/kimi-code/packages/klient/**
```

如果必须修改上述上游目录，应先暂停实施、说明缺失扩展点，再按 `runtime/AGENTS.md` 和 `runtime/PATCHES.md` 处理。

## 20. 完成定义

只有同时满足以下条件，才能宣告 Codex Subscription 登录已实现：

- Kimi Source Runtime 仍是唯一 agent Runtime；
- 没有外部 Codex/OpenCode CLI 或 app-server 依赖；
- Kimi 与 Codex auth 都走统一 Provider-aware runtime-v1 契约；
- OAuth token 不进入前端、Rust、日志、wire、会话和 crash payload；
- 凭据权限、原子写、refresh rotation 和 logout 已验证；
- Codex 请求通过独立 Provider adapter 发出，无 silent fallback；
- 自动化门禁全部通过；
- 真实 Tauri browser/device 登录和真实模型请求完成；
- Kimi 登录、已有 Provider、会话 live/replay、工具 fallback 无回归；
- UI 持续标明实验性，直到协议和发布要求达到稳定门槛。

## 21. 参考资料

- OpenAI Codex 登录说明：<https://learn.chatgpt.com/docs/auth>
- OpenAI Codex app-server 鉴权接口说明：<https://github.com/openai/codex/blob/main/codex-rs/app-server/README.md>
- OpenCode Codex OAuth 参考实现（固定 commit）：<https://github.com/anomalyco/opencode/blob/38e10eb1408feb700021b8e8766fb0ab41bf84e2/packages/opencode/src/plugin/openai/codex.ts>
- OpenCode Desktop Provider 连接 UI（固定 commit）：<https://github.com/anomalyco/opencode/blob/38e10eb1408feb700021b8e8766fb0ab41bf84e2/packages/app/src/components/dialog-connect-provider.tsx>
- OpenCode MIT License（固定 commit）：<https://github.com/anomalyco/opencode/blob/38e10eb1408feb700021b8e8766fb0ab41bf84e2/LICENSE>
- 本仓 Source Runtime 切换契约：`docs/plans/2026-08-08-runtime-cutover-m4.md`
- 本仓 Source Runtime 维护策略：`docs/plans/2026-08-07-source-backend-maintenance.md`
- 本仓 UI 兼容性验收：`docs/plans/2026-08-07-ui-compatibility-checklist.md`
