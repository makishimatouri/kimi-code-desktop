import { useCallback, useEffect, useRef, useState } from "react";
import { notifyTextConfigSaved } from "@/lib/config-update-toast";
import type { UpdateTextConfigResponse } from "@/lib/tauri-api";
import { Button } from "@/ui/button";

export function TextConfigEditor({
  enabled,
  label,
  description,
  language,
  load,
  save,
  onDirtyChange,
}: {
  enabled: boolean;
  label: string;
  description: string;
  language: "toml" | "json";
  load: () => Promise<{ content: string; path: string }>;
  save: (content: string) => Promise<UpdateTextConfigResponse>;
  onDirtyChange: (dirty: boolean) => void;
}) {
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [path, setPath] = useState("");
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const loadRequestIdRef = useRef(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isReady = loadState === "ready";

  useEffect(() => {
    onDirtyChange(isReady && content !== savedContent);
  }, [content, isReady, onDirtyChange, savedContent]);

  const loadFile = useCallback(async () => {
    const requestId = loadRequestIdRef.current + 1;
    loadRequestIdRef.current = requestId;
    setLoadState("loading");
    setError(null);
    try {
      const file = await load();
      if (requestId !== loadRequestIdRef.current) return;
      setContent(file.content);
      setSavedContent(file.content);
      setPath(file.path);
      setLoadState("ready");
    } catch (loadError) {
      if (requestId !== loadRequestIdRef.current) return;
      setContent("");
      setSavedContent("");
      setPath("");
      setError(
        `读取 ${label} 失败：${loadError instanceof Error ? loadError.message : String(loadError)}`,
      );
      setLoadState("error");
    }
  }, [label, load]);

  useEffect(() => {
    if (!enabled) {
      loadRequestIdRef.current += 1;
      setLoadState("idle");
      return;
    }
    void loadFile();
    return () => {
      loadRequestIdRef.current += 1;
    };
  }, [enabled, loadFile]);

  const retryLoad = () => {
    if (enabled && loadState !== "loading") {
      void loadFile();
    }
  };

  const handleSave = async () => {
    if (!isReady || saving) return;
    setError(null);
    if (language === "json") {
      try {
        JSON.parse(content);
      } catch (err) {
        setError(`JSON 格式错误：${err instanceof Error ? err.message : String(err)}`);
        return;
      }
    }
    setSaving(true);
    try {
      const resp = await save(content);
      if (!resp.success) {
        throw new Error(resp.error || `保存 ${label} 失败`);
      }
      setSavedContent(content);
      notifyTextConfigSaved(resp, `${label} 已保存`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col">
      <div className="mb-3 shrink-0">
        <p className="text-[12.5px] text-foreground">{description}</p>
        <p className="mt-1 truncate font-mono text-[10px] text-faint">
          {path || (loadState === "error" ? "读取失败" : "读取中…")}
        </p>
      </div>
      {loadState === "idle" || loadState === "loading" ? (
        <p className="py-12 text-center font-mono text-[11px] text-faint">加载中…</p>
      ) : loadState === "error" ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3">
          <p className="text-center font-mono text-[11px] text-faint">
            读取失败，当前内容不会被保存。
          </p>
          <Button variant="ghost" onClick={retryLoad}>
            重试读取
          </Button>
        </div>
      ) : (
        <textarea
          value={content}
          onChange={(event) => setContent(event.target.value)}
          spellCheck={false}
          disabled={!isReady || saving}
          className="min-h-0 w-full flex-1 resize-none rounded-r2 border border-line bg-background p-3 font-mono text-[11px] leading-relaxed text-foreground outline-none focus:border-line-strong disabled:opacity-60"
        />
      )}
      {error && (
        <p className="mt-2 shrink-0 whitespace-pre-wrap font-mono text-[10.5px] text-danger">
          {error}
        </p>
      )}
      <div className="mt-3 flex shrink-0 items-center">
        <span className="font-mono text-[10px] text-faint">
          {content === savedContent ? "没有未保存的更改" : "有未保存的更改"}
        </span>
        <Button
          className="ml-auto"
          disabled={!isReady || saving || content === savedContent}
          onClick={() => void handleSave()}
        >
          {saving ? "保存中…" : `保存 ${label}`}
        </Button>
      </div>
    </div>
  );
}
