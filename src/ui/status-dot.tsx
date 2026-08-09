import { cn } from "@/lib/utils";

export type StatusDotKind = "ok" | "error" | "running" | "suspended" | "idle";

/**
 * Map wire/runtime status strings to dot kinds. Shared by StatusDot, the
 * session sidebars, and the agent/swarm tool cards; co-located here so the
 * ui layer never depends on lib/swarm.
 */
export function statusToDotKind(status: string | undefined): StatusDotKind {
  switch (status) {
    case "ok":
    case "done":
    case "completed":
    case "success":
      return "ok";
    case "error":
    case "failed":
    case "cancelled":
    case "danger":
      return "error";
    case "running":
    case "working":
    case "in_progress":
    case "active":
      return "running";
    case "suspended":
      return "suspended";
    case "queued":
      return "idle";
    default:
      return "idle";
  }
}

const KIND_CLASS: Record<StatusDotKind, string> = {
  ok: "bg-success",
  error: "bg-danger",
  suspended: "bg-warn",
  idle: "bg-faint",
  running: "bg-success animate-dot-pulse motion-reduce:animate-none",
};

/** Compact status indicator with a soft pulse while running/working. */
export function StatusDot({
  status,
  className,
  title,
}: {
  status?: string;
  className?: string;
  title?: string;
}) {
  const kind = statusToDotKind(status);
  return (
    <span
      role="img"
      aria-label={title ?? kind}
      title={title}
      data-status={kind}
      className={cn("inline-block size-[7px] shrink-0 rounded-full", KIND_CLASS[kind], className)}
    />
  );
}
