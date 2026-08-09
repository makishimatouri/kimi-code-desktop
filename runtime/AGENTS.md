# runtime/ 代理指南 / Agent Guide

本目录承载仓内唯一 AI Runtime 内核及其上游契约。改动这里的规则比仓库其他位置严格得多，动手前先读完本文件。

## 目录构成 / Layout

```text
runtime/
├── UPSTREAM.md          # 冻结契约：pin 的上游版本、验证与更新流程
├── PATCHES.md           # 上游补丁登记表：改了上游什么、为什么、何时移除
└── kimi-code/           # pin 住的上游 Kimi Code subtree（git subtree，full history）
    └── apps/desktop-runtime/   # 例外：桌面自有的 runtime 适配层（本仓代码）
```

## 两个契约文件 / The Two Contracts

- **`UPSTREAM.md`** — 冻结契约。记录 subtree pin 在哪个上游 repo/tag/commit（当前：`@moonshot-ai/kimi-code@0.33.0` / `53c832dfdf9566afd59a8b3d54ebd36d3cb03d72`）、导入验证命令、本地所有权边界（`apps/desktop-runtime`）、SEA sidecar 构建说明，以及上游更新流程（`git subtree pull` 不带 `--squash`、不从未评审分支头更新等）。升级上游版本时必须同步更新此文件。
- **`PATCHES.md`** — 补丁登记表。对 `kimi-code/` 内**上游源码文件**的任何修改必须直接提交并在表中登记（原因、上游 issue/PR、移除条件）；活跃补丁超过 5 个先暂停新增。受控集成文件（`flake.nix`、根 `vitest.config.ts`、`pnpm-lock.yaml`、根 `package.json` 的 `packageManager` 等 workspace 接线）允许直接提交，不占用补丁名额。

## 硬性规则 / Hard Rules

- `kimi-code/` 上游文件保持 pristine、最后才动：能在 React/Rust/脚本外层解决的就不要进 subtree。
- 唯一允许在 subtree 内新增/修改的位置是 `apps/desktop-runtime/`（桌面自有代码）；React/Tauri 侧只依赖版本化的 `runtime-v1` 协议，不依赖 Kimi 内部类型。
- 不得用 npm 合并或重新生成 `kimi-code/pnpm-lock.yaml`：外层 npm、内层 pnpm 双工具链是有意设计。
- 验证 pristine 状态（应只出现 `apps/desktop-runtime` 新增 + 受控集成文件修改）：

  ```sh
  git diff --name-status 53c832dfdf9566afd59a8b3d54ebd36d3cb03d72 HEAD:runtime/kimi-code
  ```

- `kimi-code/AGENTS.md` 是**上游自己的**代理指南，仅在确需修改上游源码时参考；桌面约定以根 `AGENTS.md` 与本文件为准。

## 当前有意的本地偏差 / Intentional Local Deviations

- `kimi-code/package.json` 的 `packageManager` 从上游的 `pnpm@10.33.0` 提升到 `pnpm@10.34.5`：与 CI（`.github/workflows/ci.yml` 的 `pnpm/action-setup@v4` `version: 10.34.5`）和外层 `package.json` devDependency 对齐，避免 engine-strict 检查失败。`UPSTREAM.md` 冻结表记录的是上游原始的 10.33.0。属受控集成类改动，下次上游同步时按上游新值重新对齐。

English summary: `runtime/kimi-code` is a pinned upstream subtree — keep it pristine and touch it last; the only in-tree location you may add or edit is `apps/desktop-runtime/` (desktop-owned). `UPSTREAM.md` is the freeze/update contract (currently `@moonshot-ai/kimi-code@0.33.0` / `53c832df`); `PATCHES.md` registers any unavoidable upstream-source edits (pause beyond 5 active patches). Controlled integration files (flake.nix, root vitest.config.ts, pnpm-lock.yaml, root packageManager) may be committed directly. Never regenerate the inner pnpm lockfile with npm.
