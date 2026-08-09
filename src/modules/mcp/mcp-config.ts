/**
 * Structured view over `~/.kimi-code/mcp.json`.
 *
 * Schema (runtime/kimi-code/docs/zh/customization/mcp.md):
 * `{ "mcpServers": { "<name>": { command|url, transport?, args?, env?, cwd?,
 *   headers?, bearerTokenEnvVar?, enabled?, startupTimeoutMs?, toolTimeoutMs?,
 *   enabledTools?, disabledTools? } } }`
 *
 * Entries with `command` are stdio servers; entries with `url` and no
 * `transport` are HTTP servers; SSE requires `transport: "sse"`.
 * Unknown per-server keys are preserved verbatim through edits via `raw`.
 */

export type McpTransport = "stdio" | "http" | "sse";

export type McpServerEntry = {
  name: string;
  transport: McpTransport;
  enabled: boolean;
  /** Display summary: `command + args` for stdio, `url` for HTTP/SSE. */
  summary: string;
  /** Raw JSON object for this server; unknown keys survive edits. */
  raw: Record<string, unknown>;
};

export type McpConfigParseResult =
  | { ok: true; servers: McpServerEntry[] }
  | { ok: false; error: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function inferTransport(raw: Record<string, unknown>): McpTransport {
  if (asString(raw.command).trim()) {
    return "stdio";
  }
  if (raw.transport === "sse") {
    return "sse";
  }
  return "http";
}

function summarize(raw: Record<string, unknown>, transport: McpTransport): string {
  if (transport === "stdio") {
    return [asString(raw.command), ...asStringArray(raw.args)].join(" ").trim();
  }
  return asString(raw.url);
}

export function parseMcpConfig(content: string): McpConfigParseResult {
  let value: unknown;
  try {
    value = JSON.parse(content);
  } catch (err) {
    return {
      ok: false,
      error: `JSON 格式错误：${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!isPlainObject(value) || !isPlainObject(value.mcpServers)) {
    return { ok: false, error: "mcp.json 必须包含 mcpServers 对象" };
  }
  const servers: McpServerEntry[] = [];
  for (const [name, raw] of Object.entries(value.mcpServers)) {
    if (!isPlainObject(raw)) {
      return { ok: false, error: `MCP server "${name}" 的配置必须是对象` };
    }
    const transport = inferTransport(raw);
    servers.push({
      name,
      transport,
      enabled: raw.enabled !== false,
      summary: summarize(raw, transport),
      raw,
    });
  }
  return { ok: true, servers };
}

export function serializeMcpConfig(servers: McpServerEntry[]): string {
  const mcpServers: Record<string, unknown> = {};
  for (const server of servers) {
    mcpServers[server.name] = server.raw;
  }
  return `${JSON.stringify({ mcpServers }, null, 2)}\n`;
}

export function upsertServer(servers: McpServerEntry[], entry: McpServerEntry): McpServerEntry[] {
  const index = servers.findIndex((server) => server.name === entry.name);
  if (index === -1) {
    return [...servers, entry];
  }
  return servers.map((server, i) => (i === index ? entry : server));
}

export function removeServer(servers: McpServerEntry[], name: string): McpServerEntry[] {
  return servers.filter((server) => server.name !== name);
}

export function setServerEnabled(
  servers: McpServerEntry[],
  name: string,
  enabled: boolean,
): McpServerEntry[] {
  return servers.map((server) => {
    if (server.name !== name) {
      return server;
    }
    const raw = { ...server.raw };
    if (enabled) {
      // Absent `enabled` means enabled upstream; drop the key to keep diffs minimal.
      delete raw.enabled;
    } else {
      raw.enabled = false;
    }
    return { ...server, enabled, raw };
  });
}

export type McpServerFormValue = {
  name: string;
  transport: McpTransport;
  command: string;
  args: string[];
  env: Record<string, string>;
  cwd: string;
  url: string;
  headers: Record<string, string>;
  bearerTokenEnvVar: string;
  enabled: boolean;
};

/** Form fields of the other transports; removed when switching transport. */
const TRANSPORT_SPECIFIC_KEYS = [
  "command",
  "args",
  "env",
  "cwd",
  "url",
  "headers",
  "bearerTokenEnvVar",
  "transport",
] as const;

function setOrDelete(target: Record<string, unknown>, key: string, value: unknown, keep: boolean) {
  if (keep) {
    target[key] = value;
  } else {
    delete target[key];
  }
}

/**
 * Build the raw JSON object for one server from form values. When `existingRaw`
 * is given (edit), unknown keys like `startupTimeoutMs` / `enabledTools` are
 * preserved; keys specific to other transports are dropped.
 */
export function buildServerRaw(
  form: McpServerFormValue,
  existingRaw?: Record<string, unknown>,
): Record<string, unknown> {
  const raw: Record<string, unknown> = { ...(existingRaw ?? {}) };
  for (const key of TRANSPORT_SPECIFIC_KEYS) {
    delete raw[key];
  }

  if (form.transport === "stdio") {
    setOrDelete(raw, "command", form.command.trim(), form.command.trim().length > 0);
    const args = form.args.map((arg) => arg.trim()).filter(Boolean);
    setOrDelete(raw, "args", args, args.length > 0);
    setOrDelete(raw, "env", form.env, Object.keys(form.env).length > 0);
    setOrDelete(raw, "cwd", form.cwd.trim(), form.cwd.trim().length > 0);
  } else {
    setOrDelete(raw, "url", form.url.trim(), form.url.trim().length > 0);
    if (form.transport === "sse") {
      raw.transport = "sse";
    }
    setOrDelete(raw, "headers", form.headers, Object.keys(form.headers).length > 0);
    setOrDelete(
      raw,
      "bearerTokenEnvVar",
      form.bearerTokenEnvVar.trim(),
      form.bearerTokenEnvVar.trim().length > 0,
    );
  }

  if (form.enabled) {
    // Absent `enabled` means enabled upstream; drop stale explicit flags.
    delete raw.enabled;
  } else {
    raw.enabled = false;
  }
  return raw;
}

export function serverEntryFromForm(
  form: McpServerFormValue,
  existingRaw?: Record<string, unknown>,
): McpServerEntry {
  const raw = buildServerRaw(form, existingRaw);
  return {
    name: form.name.trim(),
    transport: form.transport,
    enabled: form.enabled,
    summary: summarize(raw, form.transport),
    raw,
  };
}

export function formValueFromEntry(entry: McpServerEntry): McpServerFormValue {
  const raw = entry.raw;
  return {
    name: entry.name,
    transport: entry.transport,
    command: asString(raw.command),
    args: asStringArray(raw.args),
    env: isPlainObject(raw.env)
      ? Object.fromEntries(
          Object.entries(raw.env).filter(([, v]) => typeof v === "string") as [string, string][],
        )
      : {},
    cwd: asString(raw.cwd),
    url: asString(raw.url),
    headers: isPlainObject(raw.headers)
      ? Object.fromEntries(
          Object.entries(raw.headers).filter(([, v]) => typeof v === "string") as [
            string,
            string,
          ][],
        )
      : {},
    bearerTokenEnvVar: asString(raw.bearerTokenEnvVar),
    enabled: entry.enabled,
  };
}

/** Returns an error message, or null when the form is valid. */
export function validateServerForm(
  form: McpServerFormValue,
  existingNames: string[],
  editingName?: string,
): string | null {
  const name = form.name.trim();
  if (!name) {
    return "名称不能为空";
  }
  if (name !== editingName && existingNames.includes(name)) {
    return `已存在同名 server "${name}"`;
  }
  if (form.transport === "stdio") {
    if (!form.command.trim()) {
      return "stdio server 需要填写启动命令（command）";
    }
    return null;
  }
  const url = form.url.trim();
  if (!url) {
    return "HTTP/SSE server 需要填写 URL";
  }
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "URL 必须使用 http 或 https";
    }
  } catch {
    return "URL 格式不正确";
  }
  return null;
}
