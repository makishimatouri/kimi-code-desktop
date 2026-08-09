import { type FormEvent, useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "@/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/ui/dialog";
import { Switch } from "@/ui/switch";
import {
  formValueFromEntry,
  type McpServerEntry,
  type McpServerFormValue,
  type McpTransport,
  serverEntryFromForm,
  validateServerForm,
} from "./mcp-config";

function inputClassName(extra = ""): string {
  return cn(
    "h-8 w-full rounded-r1 border border-line bg-background px-2 font-mono text-[11.5px] text-foreground outline-none placeholder:text-faint focus:border-line-strong disabled:cursor-not-allowed disabled:opacity-60",
    extra,
  );
}

function textareaClassName(extra = ""): string {
  return cn(
    "min-h-16 w-full resize-y rounded-r1 border border-line bg-background px-2 py-1.5 font-mono text-[11.5px] leading-relaxed text-foreground outline-none placeholder:text-faint focus:border-line-strong disabled:cursor-not-allowed disabled:opacity-60",
    extra,
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.09em] text-faint">
        {label}
      </span>
      {children}
      {hint ? <span className="mt-1 block text-[10.5px] text-faint">{hint}</span> : null}
    </div>
  );
}

const TRANSPORTS: Array<{ id: McpTransport; label: string; hint: string }> = [
  { id: "stdio", label: "stdio", hint: "本地命令，由 Kimi Code 以子进程启动" },
  { id: "http", label: "HTTP", hint: "连接已在运行的 HTTP 端点" },
  { id: "sse", label: "SSE", hint: "旧式 HTTP+SSE 端点；新 server 优先用 HTTP" },
];

function parseKeyValueLines(text: string): {
  values: Record<string, string>;
  error: string | null;
} {
  const values: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) {
      return { values: {}, error: `「${trimmed}」格式不正确，应为 KEY=VALUE` };
    }
    values[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return { values, error: null };
}

function keyValueLines(values: Record<string, string>): string {
  return Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

type FormState = {
  name: string;
  transport: McpTransport;
  command: string;
  argsText: string;
  envText: string;
  cwd: string;
  url: string;
  headersText: string;
  bearerTokenEnvVar: string;
  enabled: boolean;
};

const EMPTY_FORM: FormState = {
  name: "",
  transport: "stdio",
  command: "",
  argsText: "",
  envText: "",
  cwd: "",
  url: "",
  headersText: "",
  bearerTokenEnvVar: "",
  enabled: true,
};

function formStateFromEntry(entry: McpServerEntry): FormState {
  const value: McpServerFormValue = formValueFromEntry(entry);
  return {
    name: value.name,
    transport: value.transport,
    command: value.command,
    argsText: value.args.join("\n"),
    envText: keyValueLines(value.env),
    cwd: value.cwd,
    url: value.url,
    headersText: keyValueLines(value.headers),
    bearerTokenEnvVar: value.bearerTokenEnvVar,
    enabled: value.enabled,
  };
}

export function McpServerDialog({
  open,
  onOpenChange,
  existingNames,
  editing,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Names already in use; used for duplicate validation when adding. */
  existingNames: string[];
  /** When set, the dialog edits this server; otherwise it adds a new one. */
  editing: McpServerEntry | null;
  /** Receives the built entry; throw to keep the dialog open and show the error. */
  onSubmit: (entry: McpServerEntry) => Promise<void>;
}) {
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(editing ? formStateFromEntry(editing) : EMPTY_FORM);
      setError(null);
      setSubmitting(false);
    }
  }, [open, editing]);

  const patch = (changes: Partial<FormState>) => {
    setForm((current) => ({ ...current, ...changes }));
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting) return;

    const env = parseKeyValueLines(form.envText);
    if (env.error) {
      setError(`环境变量：${env.error}`);
      return;
    }
    const headers = parseKeyValueLines(form.headersText);
    if (headers.error) {
      setError(`请求头：${headers.error}`);
      return;
    }

    const value: McpServerFormValue = {
      name: form.name,
      transport: form.transport,
      command: form.command,
      args: form.argsText.split("\n"),
      env: env.values,
      cwd: form.cwd,
      url: form.url,
      headers: headers.values,
      bearerTokenEnvVar: form.bearerTokenEnvVar,
      enabled: form.enabled,
    };
    const validationError = validateServerForm(value, existingNames, editing?.name);
    if (validationError) {
      setError(validationError);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(serverEntryFromForm(value, editing?.raw));
      onOpenChange(false);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : String(submitError));
      setSubmitting(false);
    }
  };

  const transportHint = TRANSPORTS.find((item) => item.id === form.transport)?.hint;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogTitle>
          {editing ? `编辑 MCP Server「${editing.name}」` : "添加 MCP Server"}
        </DialogTitle>
        <DialogDescription>
          保存后写入 ~/.kimi-code/mcp.json，空闲会话重启后生效。
        </DialogDescription>
        <form onSubmit={(event) => void handleSubmit(event)} className="mt-4">
          <div className="flex max-h-[55vh] flex-col gap-3 overflow-y-auto pr-1">
            <Field label="名称" hint="工具将显示为 mcp__<名称>__<工具名>">
              <input
                className={inputClassName()}
                value={form.name}
                onChange={(event) => patch({ name: event.target.value })}
                placeholder="例如 filesystem"
                disabled={editing !== null || submitting}
                spellCheck={false}
              />
            </Field>

            <div>
              <span className="mb-1 block font-mono text-[10px] uppercase tracking-[0.09em] text-faint">
                传输方式
              </span>
              <div className="flex gap-1.5">
                {TRANSPORTS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    disabled={submitting}
                    onClick={() => patch({ transport: item.id })}
                    className={cn(
                      "h-7 rounded-r1 border px-3 font-mono text-[11px] transition-colors",
                      form.transport === item.id
                        ? "border-bright bg-bright/10 text-bright"
                        : "border-line text-muted hover:border-line-strong hover:text-foreground",
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {transportHint ? (
                <p className="mt-1 text-[10.5px] text-faint">{transportHint}</p>
              ) : null}
            </div>

            {form.transport === "stdio" ? (
              <>
                <Field label="启动命令" hint="例如 npx、uvx 或可执行文件的绝对路径">
                  <input
                    className={inputClassName()}
                    value={form.command}
                    onChange={(event) => patch({ command: event.target.value })}
                    placeholder="npx"
                    disabled={submitting}
                    spellCheck={false}
                  />
                </Field>
                <Field label="参数（每行一个）">
                  <textarea
                    className={textareaClassName("min-h-14")}
                    value={form.argsText}
                    onChange={(event) => patch({ argsText: event.target.value })}
                    placeholder={"-y\n@modelcontextprotocol/server-filesystem\n/tmp"}
                    disabled={submitting}
                    spellCheck={false}
                  />
                </Field>
                <Field label="环境变量（每行 KEY=VALUE，可选）">
                  <textarea
                    className={textareaClassName("min-h-14")}
                    value={form.envText}
                    onChange={(event) => patch({ envText: event.target.value })}
                    placeholder="API_KEY=..."
                    disabled={submitting}
                    spellCheck={false}
                  />
                </Field>
                <Field label="工作目录（可选）">
                  <input
                    className={inputClassName()}
                    value={form.cwd}
                    onChange={(event) => patch({ cwd: event.target.value })}
                    placeholder="/path/to/dir"
                    disabled={submitting}
                    spellCheck={false}
                  />
                </Field>
              </>
            ) : (
              <>
                <Field label="URL">
                  <input
                    className={inputClassName()}
                    value={form.url}
                    onChange={(event) => patch({ url: event.target.value })}
                    placeholder="https://mcp.example.com/mcp"
                    disabled={submitting}
                    spellCheck={false}
                  />
                </Field>
                <Field label="请求头（每行 KEY=VALUE，可选）">
                  <textarea
                    className={textareaClassName("min-h-14")}
                    value={form.headersText}
                    onChange={(event) => patch({ headersText: event.target.value })}
                    placeholder="Authorization=Bearer ..."
                    disabled={submitting}
                    spellCheck={false}
                  />
                </Field>
                <Field
                  label="Bearer Token 环境变量名（可选）"
                  hint="从该环境变量读取 token，避免把密钥写进配置文件"
                >
                  <input
                    className={inputClassName()}
                    value={form.bearerTokenEnvVar}
                    onChange={(event) => patch({ bearerTokenEnvVar: event.target.value })}
                    placeholder="MCP_TOKEN"
                    disabled={submitting}
                    spellCheck={false}
                  />
                </Field>
              </>
            )}

            <div className="flex items-center gap-2 text-[12px] text-foreground">
              <Switch
                checked={form.enabled}
                onCheckedChange={(checked) => patch({ enabled: checked })}
                disabled={submitting}
                aria-label="启用此 server"
              />
              启用此 server
            </div>
          </div>

          {error ? (
            <p className="mt-3 whitespace-pre-wrap font-mono text-[10.5px] text-danger">{error}</p>
          ) : null}

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" disabled={submitting} onClick={() => onOpenChange(false)}>
              取消
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting ? "保存中…" : "保存"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
