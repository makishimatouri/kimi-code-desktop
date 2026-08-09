import { describe, expect, it } from "vitest";
import {
  buildServerRaw,
  formValueFromEntry,
  inferTransport,
  type McpServerFormValue,
  parseMcpConfig,
  removeServer,
  serializeMcpConfig,
  serverEntryFromForm,
  setServerEnabled,
  upsertServer,
  validateServerForm,
} from "./mcp-config";

const SAMPLE = `{
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"]
    },
    "linear": {
      "url": "https://mcp.linear.app/mcp"
    },
    "legacy-events": {
      "transport": "sse",
      "url": "https://mcp.example.com/sse",
      "enabled": false
    }
  }
}
`;

function emptyForm(overrides: Partial<McpServerFormValue> = {}): McpServerFormValue {
  return {
    name: "server",
    transport: "stdio",
    command: "",
    args: [],
    env: {},
    cwd: "",
    url: "",
    headers: {},
    bearerTokenEnvVar: "",
    enabled: true,
    ...overrides,
  };
}

describe("parseMcpConfig", () => {
  it("parses servers and infers transport from command/url/sse", () => {
    const result = parseMcpConfig(SAMPLE);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.servers.map((s) => [s.name, s.transport, s.enabled])).toEqual([
      ["filesystem", "stdio", true],
      ["linear", "http", true],
      ["legacy-events", "sse", false],
    ]);
    expect(result.servers[0].summary).toBe("npx -y @modelcontextprotocol/server-filesystem /tmp");
    expect(result.servers[1].summary).toBe("https://mcp.linear.app/mcp");
  });

  it("rejects invalid JSON", () => {
    const result = parseMcpConfig("{ not json");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain("JSON 格式错误");
  });

  it("rejects a document without an mcpServers object", () => {
    expect(parseMcpConfig("{}").ok).toBe(false);
    expect(parseMcpConfig('{"mcpServers": []}').ok).toBe(false);
    expect(parseMcpConfig("[]").ok).toBe(false);
  });

  it("rejects a non-object server entry instead of silently dropping it", () => {
    const result = parseMcpConfig('{"mcpServers": {"bad": "npx"}}');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('"bad"');
  });
});

describe("serializeMcpConfig", () => {
  it("round-trips parsed content preserving unknown keys", () => {
    const parsed = parseMcpConfig(SAMPLE);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const text = serializeMcpConfig(parsed.servers);
    expect(JSON.parse(text)).toEqual(JSON.parse(SAMPLE));
    expect(text.endsWith("\n")).toBe(true);
  });
});

describe("list operations", () => {
  const parsed = parseMcpConfig(SAMPLE);
  if (!parsed.ok) throw new Error("sample must parse");
  const servers = parsed.servers;

  it("upsert appends a new server and replaces an existing one", () => {
    const added = upsertServer(servers, {
      name: "new",
      transport: "http",
      enabled: true,
      summary: "https://example.com/mcp",
      raw: { url: "https://example.com/mcp" },
    });
    expect(added.map((s) => s.name)).toEqual(["filesystem", "linear", "legacy-events", "new"]);

    const replaced = upsertServer(servers, {
      name: "linear",
      transport: "http",
      enabled: false,
      summary: "https://other.example.com/mcp",
      raw: { url: "https://other.example.com/mcp", enabled: false },
    });
    expect(replaced.map((s) => s.name)).toEqual(["filesystem", "linear", "legacy-events"]);
    expect(replaced[1].raw.url).toBe("https://other.example.com/mcp");
  });

  it("removeServer drops only the named server", () => {
    expect(removeServer(servers, "linear").map((s) => s.name)).toEqual([
      "filesystem",
      "legacy-events",
    ]);
  });

  it("setServerEnabled only touches the enabled key", () => {
    const disabled = setServerEnabled(servers, "filesystem", false);
    expect(disabled[0].raw).toEqual({ ...servers[0].raw, enabled: false });

    const enabled = setServerEnabled(servers, "legacy-events", true);
    expect(enabled[2].raw).toEqual({
      transport: "sse",
      url: "https://mcp.example.com/sse",
    });
  });
});

describe("buildServerRaw", () => {
  it("builds a stdio server, dropping empty optional fields", () => {
    const raw = buildServerRaw(
      emptyForm({
        command: " npx ",
        args: ["-y", " pkg ", ""],
        env: { API_KEY: "x" },
      }),
    );
    expect(raw).toEqual({ command: "npx", args: ["-y", "pkg"], env: { API_KEY: "x" } });
  });

  it("builds an http server without a transport key, and an sse server with one", () => {
    const http = buildServerRaw(
      emptyForm({ transport: "http", url: "https://mcp.linear.app/mcp" }),
    );
    expect(http).toEqual({ url: "https://mcp.linear.app/mcp" });

    const sse = buildServerRaw(
      emptyForm({
        transport: "sse",
        url: "https://mcp.example.com/sse",
        headers: { Authorization: "Bearer x" },
        bearerTokenEnvVar: "TOKEN",
      }),
    );
    expect(sse).toEqual({
      transport: "sse",
      url: "https://mcp.example.com/sse",
      headers: { Authorization: "Bearer x" },
      bearerTokenEnvVar: "TOKEN",
    });
  });

  it("preserves unknown keys and drops keys of the previous transport when editing", () => {
    const existing = {
      command: "npx",
      args: ["-y", "pkg"],
      startupTimeoutMs: 60000,
      enabledTools: ["read_file"],
    };
    const raw = buildServerRaw(
      emptyForm({ transport: "http", url: "https://example.com/mcp", enabled: false }),
      existing,
    );
    expect(raw).toEqual({
      url: "https://example.com/mcp",
      startupTimeoutMs: 60000,
      enabledTools: ["read_file"],
      enabled: false,
    });
  });

  it("clears an explicit enabled flag when the form enables the server", () => {
    const raw = buildServerRaw(emptyForm({ command: "npx", enabled: true }), {
      command: "npx",
      enabled: false,
    });
    expect(raw).toEqual({ command: "npx" });
  });
});

describe("formValueFromEntry / serverEntryFromForm", () => {
  it("round-trips a server through the form", () => {
    const parsed = parseMcpConfig(SAMPLE);
    if (!parsed.ok) throw new Error("sample must parse");
    for (const entry of parsed.servers) {
      const rebuilt = serverEntryFromForm(formValueFromEntry(entry), entry.raw);
      expect(rebuilt.raw).toEqual(entry.raw);
      expect(rebuilt.name).toBe(entry.name);
      expect(rebuilt.transport).toBe(entry.transport);
    }
  });
});

describe("validateServerForm", () => {
  it("requires a unique non-empty name", () => {
    expect(validateServerForm(emptyForm({ name: " " }), [])).toBe("名称不能为空");
    expect(validateServerForm(emptyForm({ name: "a", command: "x" }), ["a"])).toContain("同名");
    expect(validateServerForm(emptyForm({ name: "a", command: "x" }), ["a"], "a")).toBeNull();
  });

  it("requires a command for stdio", () => {
    expect(validateServerForm(emptyForm({ command: " " }), [])).toContain("command");
    expect(validateServerForm(emptyForm({ command: "npx" }), [])).toBeNull();
  });

  it("requires a valid http(s) URL for http/sse", () => {
    expect(validateServerForm(emptyForm({ transport: "http" }), [])).toContain("URL");
    expect(validateServerForm(emptyForm({ transport: "http", url: "not a url" }), [])).toContain(
      "URL 格式不正确",
    );
    expect(
      validateServerForm(emptyForm({ transport: "http", url: "ftp://example.com" }), []),
    ).toContain("http 或 https");
    expect(
      validateServerForm(emptyForm({ transport: "sse", url: "https://example.com/sse" }), []),
    ).toBeNull();
  });
});

describe("inferTransport", () => {
  it("prefers command, then explicit sse, then http", () => {
    expect(inferTransport({ command: "npx", transport: "sse" })).toBe("stdio");
    expect(inferTransport({ transport: "sse", url: "https://x" })).toBe("sse");
    expect(inferTransport({ url: "https://x" })).toBe("http");
    expect(inferTransport({})).toBe("http");
  });
});
