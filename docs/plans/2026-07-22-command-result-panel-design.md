# Command Result Panel Design

> **文档状态（2026-08-09）：历史设计记录。** `/usage` 与 `/status` 的当前实现由桌面本地 Source Runtime/平台额度路径承载；本文用于解释 UI 决策，不作为 Runtime 接线说明。

**Goal:** Show `/usage` and `/status` in a temporary panel above the composer instead of appending chat messages.

## Decisions

- Placement: between message list and Composer (footer stack), same `max-w-[44rem]` width — “second dialog layer”
- Chat history: no user message, no assistant reply for these two commands
- Close: Esc, close button, or replace when running the other info command
- `/help` and blocked slash remain message-based for this change
- Reuse `formatUsageReport` / `formatStatusReport` plain text; no rich quota bars in v1

## Architecture

1. `useSessionStream.sendMessage` (and/or a dedicated helper) resolves usage/status content without mutating `messages`
2. `ConversationView` owns panel state `{ command, content, loading } | null`
3. New `CommandResultPanel` renders title, body (`whitespace-pre-wrap`), close control
4. Local intercept in `ConversationView.send` so busy sessions do not queue these commands

## Error handling

- Loading: show panel with “查询中…”
- Failure: keep panel open with error text
- Outside click: optional; Esc + close button are required

## Testing

- Unit: sendMessage/local helper does not append messages for `/usage` and `/status`
- Component: panel renders, dismisses on close/Esc
