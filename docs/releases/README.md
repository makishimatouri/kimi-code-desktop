# 发布记录索引

本目录保存发布时的历史快照。版本说明中的 Runtime、ACP、CLI、文件路径和功能状态应按对应版本理解，不随当前 `master` 的 Source Runtime 架构回写。

| 版本 | 发布说明 |
| --- | --- |
| v1.1.3 | [`v1.1.3-notes.md`](v1.1.3-notes.md) |
| v1.1.2 | [`v1.1.2-notes.md`](v1.1.2-notes.md) |
| v1.1.1 | [`v1.1.1-notes.md`](v1.1.1-notes.md) |
| v1.0.0 | [`v1.0.0-notes.md`](v1.0.0-notes.md) |
| v0.1.12 | [`v0.1.12-notes.md`](v0.1.12-notes.md) |
| v0.1.11 | [`v0.1.11-notes.md`](v0.1.11-notes.md) |
| v0.1.10 | [`v0.1.10-notes.md`](v0.1.10-notes.md) |

[`CHANGELOG-draft.md`](CHANGELOG-draft.md) 是 v0.1.11 → v0.1.12 的历史整理草稿，不是当前未发布变更日志。

当前工作区的产品版本读取 `package.json`、`package-lock.json`、`src-tauri/Cargo.toml` 与 `src-tauri/tauri.conf.json`，并由 `npm run version:sync` 检查。当前代码能力以源码、测试和 [`../plans/2026-08-08-runtime-cutover-m4.md`](../plans/2026-08-08-runtime-cutover-m4.md) 为准，不能仅从最近一份历史 release note 推断。
