import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { notifyTextConfigSaved } from "@/lib/config-update-toast";
import { getMcpConfigFile, updateMcpConfigFile } from "@/lib/settings-api";
import { cn } from "@/lib/utils";
import { TextConfigEditor } from "@/modules/settings/text-config-editor";
import { Button } from "@/ui/button";
import { useConfirm } from "@/ui/confirm-dialog";
import { Switch } from "@/ui/switch";
import {
  type McpServerEntry,
  type McpTransport,
  parseMcpConfig,
  removeServer,
  serializeMcpConfig,
  setServerEnabled,
  upsertServer,
} from "./mcp-config";
import { McpServerDialog } from "./mcp-server-dialog";

const TRANSPORT_BADGE: Record<McpTransport, string> = {
  stdio: "stdio",
  http: "HTTP",
  sse: "SSE",
};

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function ServerCard({
  server,
  saving,
  onToggle,
  onEdit,
  onDelete,
}: {
  server: McpServerEntry;
  saving: boolean;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <section className="rounded-r2 border border-line/70 bg-surface/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate font-mono text-[12.5px] text-foreground">{server.name}</h3>
            <span className="inline-flex shrink-0 rounded-r1 bg-surface px-1.5 py-0.5 font-mono text-[10px] text-muted">
              {TRANSPORT_BADGE[server.transport]}
            </span>
          </div>
          <p className="mt-0.5 truncate font-mono text-[10.5px] text-faint">
            {server.summary || "（未设置命令或 URL）"}
          </p>
        </div>
        <Switch
          checked={server.enabled}
          onCheckedChange={onToggle}
          disabled={saving}
          aria-label={`启用 ${server.name}`}
        />
      </div>
      <div className="mt-2 flex items-center gap-2">
        <span
          className={cn("font-mono text-[10px]", server.enabled ? "text-success" : "text-faint")}
        >
          {server.enabled ? "已启用" : "已禁用"}
        </span>
        <div className="ml-auto flex gap-1.5">
          <Button variant="ghost" disabled={saving} onClick={onEdit}>
            编辑
          </Button>
          <Button variant="ghost" disabled={saving} onClick={onDelete}>
            删除
          </Button>
        </div>
      </div>
    </section>
  );
}

export function McpPanel({
  enabled,
  onDirtyChange,
}: {
  enabled: boolean;
  /** Reports only the embedded raw editor's unsaved state; structured edits save immediately. */
  onDirtyChange: (dirty: boolean) => void;
}) {
  const confirm = useConfirm();
  const [servers, setServers] = useState<McpServerEntry[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [path, setPath] = useState("");
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadRequestIdRef = useRef(0);
  const [saving, setSaving] = useState(false);
  const [dialog, setDialog] = useState<{ editing: McpServerEntry | null } | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [rawDirty, setRawDirty] = useState(false);
  // Bumped after structured saves to remount the raw editor from on-disk truth.
  const [rawEpoch, setRawEpoch] = useState(0);

  const load = useCallback(async () => {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    setLoadState("loading");
    setLoadError(null);
    try {
      const file = await getMcpConfigFile();
      if (requestId !== loadRequestIdRef.current) return;
      const parsed = parseMcpConfig(file.content);
      setPath(file.path);
      setServers(parsed.ok ? parsed.servers : []);
      setParseError(parsed.ok ? null : parsed.error);
      setLoadState("ready");
    } catch (err) {
      if (requestId !== loadRequestIdRef.current) return;
      setPath("");
      setLoadError(`读取 mcp.json 失败：${errorMessage(err)}`);
      setLoadState("error");
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      loadRequestIdRef.current += 1;
      setLoadState("idle");
      setAdvancedOpen(false);
      setRawDirty(false);
      setDialog(null);
      onDirtyChange(false);
      return;
    }
    void load();
    return () => {
      loadRequestIdRef.current += 1;
    };
  }, [enabled, load, onDirtyChange]);

  /** Persist a new server list; throws on failure so callers can keep UI state. */
  const persist = useCallback(async (next: McpServerEntry[]) => {
    const text = serializeMcpConfig(next);
    setSaving(true);
    try {
      const resp = await updateMcpConfigFile(text);
      setServers(next);
      setParseError(null);
      setRawEpoch((epoch) => epoch + 1);
      notifyTextConfigSaved(resp, "mcp.json 已保存");
    } finally {
      setSaving(false);
    }
  }, []);

  const handleToggle = async (server: McpServerEntry, enabledValue: boolean) => {
    const previous = servers;
    const next = setServerEnabled(servers, server.name, enabledValue);
    setServers(next);
    try {
      await persist(next);
    } catch (err) {
      setServers(previous);
      toast.error(`保存失败：${errorMessage(err)}`);
    }
  };

  const handleDelete = async (server: McpServerEntry) => {
    if (
      !(await confirm({
        message: `确定删除 MCP Server「${server.name}」吗？此操作会立即写入 mcp.json。`,
        confirmLabel: "删除",
        danger: true,
      }))
    ) {
      return;
    }
    try {
      await persist(removeServer(servers, server.name));
    } catch (err) {
      toast.error(`删除失败：${errorMessage(err)}`);
    }
  };

  const handleDialogSubmit = async (entry: McpServerEntry) => {
    await persist(upsertServer(servers, entry));
  };

  const handleRawDirtyChange = useCallback(
    (dirty: boolean) => {
      setRawDirty(dirty);
      onDirtyChange(dirty);
    },
    [onDirtyChange],
  );

  const toggleAdvanced = async () => {
    if (advancedOpen && rawDirty) {
      if (!(await confirm("高级 mcp.json 编辑器有未保存的更改，确定放弃并收起吗？"))) {
        return;
      }
      setRawDirty(false);
      onDirtyChange(false);
    }
    setAdvancedOpen((open) => !open);
  };

  const retryLoad = () => {
    if (enabled && loadState !== "loading") {
      void load();
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="mb-3 shrink-0 space-y-2">
        <p className="text-[12.5px] text-foreground">
          管理 MCP Server：表单维护常用字段，保存后写入用户级 mcp.json，空闲会话重启后生效。
        </p>
        <p className="truncate font-mono text-[10px] text-faint">
          {path || (loadState === "error" ? "读取失败" : "读取中…")}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="primary"
            disabled={loadState !== "ready" || parseError !== null || saving}
            onClick={() => setDialog({ editing: null })}
          >
            添加 Server
          </Button>
          <Button variant="ghost" disabled={loadState === "loading"} onClick={retryLoad}>
            {loadState === "loading" ? "刷新中…" : "刷新"}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {loadState === "idle" || loadState === "loading" ? (
          <p className="py-8 text-center font-mono text-[11px] text-faint">加载中…</p>
        ) : loadState === "error" ? (
          <div className="flex flex-col items-center justify-center gap-3 py-8">
            <p className="text-center font-mono text-[11px] text-danger">{loadError}</p>
            <Button variant="ghost" onClick={retryLoad}>
              重试读取
            </Button>
          </div>
        ) : parseError !== null ? (
          <div className="rounded-r1 border border-warn/40 bg-warn/10 px-2.5 py-2">
            <p className="font-mono text-[10px] uppercase tracking-[0.09em] text-warn">
              mcp.json 解析失败
            </p>
            <p className="mt-1 whitespace-pre-wrap font-mono text-[10.5px] text-warn">
              {parseError}
            </p>
            <p className="mt-1 text-[10.5px] text-muted">
              请展开下方高级编辑器手动修复；修复前无法使用结构化编辑。
            </p>
          </div>
        ) : servers.length === 0 ? (
          <p className="py-8 text-center font-mono text-[11px] text-faint">
            尚未配置 MCP Server。点击「添加 Server」接入第一个工具服务。
          </p>
        ) : (
          <div className="space-y-3 pb-3">
            {servers.map((server) => (
              <ServerCard
                key={server.name}
                server={server}
                saving={saving}
                onToggle={(enabledValue) => void handleToggle(server, enabledValue)}
                onEdit={() => setDialog({ editing: server })}
                onDelete={() => void handleDelete(server)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="mt-3 shrink-0 border-t border-line pt-3">
        <button
          type="button"
          className="font-mono text-[10.5px] text-muted underline-offset-2 hover:text-foreground hover:underline"
          onClick={() => void toggleAdvanced()}
        >
          {advancedOpen ? "收起高级 mcp.json 编辑器" : "展开高级 mcp.json 编辑器（排障）"}
        </button>
        {advancedOpen ? (
          <div className="mt-3 flex min-h-[240px] flex-1 flex-col">
            <TextConfigEditor
              key={rawEpoch}
              enabled={enabled && advancedOpen}
              label="mcp.json"
              language="json"
              description="高级：直接编辑完整 mcp.json。保存前会在本地检查 JSON 格式。"
              load={getMcpConfigFile}
              save={async (content) => {
                const resp = await updateMcpConfigFile(content);
                // Raw save is the new on-disk truth; reload the structured view.
                await load();
                return resp;
              }}
              onDirtyChange={handleRawDirtyChange}
            />
          </div>
        ) : null}
      </div>

      {dialog ? (
        <McpServerDialog
          open
          onOpenChange={(open) => {
            if (!open) setDialog(null);
          }}
          existingNames={servers.map((server) => server.name)}
          editing={dialog.editing}
          onSubmit={handleDialogSubmit}
        />
      ) : null}
    </div>
  );
}
