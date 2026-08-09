/**
 * Session stream hook - React adapter over the per-session SessionRuntime engine.
 *
 * -----------------------------------------------------------------------------
 * High-level architecture (read this before editing)
 * -----------------------------------------------------------------------------
 *
 * The live/replay wire normalization moved into `src/lib/session-stream/runtime.ts`
 * (createSessionRuntime). This module is a thin React adapter with two modes:
 *
 * - Single-stream (G5 flag off): one local SessionRuntime per mounted hook,
 *   restarted on session switches — behavior identical to the pre-G5 hook.
 * - Multi-stream (G5 flag on + Tauri): the hook selects the visible session's
 *   snapshot from the SessionStreamOrchestrator and forwards actions to the
 *   per-session runtime owned by the orchestrator. Session lifecycle
 *   (create/start/keep-alive/evict) is owned by the orchestrator; this hook
 *   only marks the session visible on switches.
 *
 * Both modes share one fixed hook skeleton (no conditional hook calls): the
 * store subscription is either the local runtime or the orchestrator, and the
 * layout effect either restarts the local runtime or calls orchestrator.attach.
 *
 * The hard constraint (no cross-session leak) lives in the runtime: session
 * switches must be atomic — stop old stream, clear per-session accumulators,
 * then (optionally) connect to the new session. Wire callbacks are async and
 * can fire after a switch, so every callback guards on connection identity
 * (`wsRef.current !== ws`) — see runtime.ts for details.
 */

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SessionStatus } from "@/lib/api/models";
import { isMultiActiveSessionsEnabled } from "@/lib/features";
import {
  EMPTY_SESSION_VIEW,
  type SessionRuntimeActions,
} from "@/lib/session-stream/orchestrator";
import { useSessionStreamOrchestrator } from "@/lib/session-stream/provider";
import {
  createSessionRuntime,
  type SessionRuntime,
  type SessionRuntimeOptions,
} from "@/lib/session-stream/runtime";
import type { ConnectionPhase, SessionViewState } from "@/lib/session-stream/types";
import type { SlashCommandDef } from "@/lib/slash-command-catalog";
import type { LiveMessage } from "./types";

export type {
  GoalStartConfirmationResult,
  LocalInfoPanelResult,
  SendMessageOptions,
  SendMessageResult,
} from "@/lib/session-stream/runtime";
export { mergeSlashCommandsByName } from "@/lib/session-stream/runtime";
export type { SlashCommandDef } from "@/lib/slash-command-catalog";

type UseSessionStreamOptions = {
  /** Session ID to connect to */
  sessionId: string | null;
  /** Base URL for WebSocket connection (defaults to current host) */
  baseUrl?: string;
  /** Callback when messages change */
  onMessagesChange?: (messages: LiveMessage[]) => void;
  /** Callback when connection status changes */
  onConnectionChange?: (connected: boolean) => void;
  /** Callback when an error occurs */
  onError?: (error: Error) => void;
  /** Callback when session status changes */
  onSessionStatus?: (status: SessionStatus) => void;
  /** Callback when first turn is complete (for auto-renaming) */
  onFirstTurnComplete?: () => void;
  /** Start the live worker as soon as the session is selected. */
  autoConnect?: boolean;
};

/**
 * Snapshot fields mirror `SessionViewState` 1:1; the connection metadata fields
 * (`connectionPhase` / `connectionId` / `updatedAt`) stay optional here as in
 * the former inline type. Action fields mirror `SessionRuntimeActions`.
 */
export type UseSessionStreamReturn = Omit<
  SessionViewState,
  "connectionPhase" | "connectionId" | "updatedAt"
> & {
  /** Lifecycle phase of the underlying connection */
  connectionPhase?: ConnectionPhase;
  /** Stable id of the current wire connection attempt (Tauri), if any */
  connectionId?: string | null;
  /** Timestamp (ms) of the last snapshot update */
  updatedAt?: number;
} & SessionRuntimeActions;

function buildStreamReturn(
  snapshot: SessionViewState,
  actions: SessionRuntimeActions,
): UseSessionStreamReturn {
  return { ...snapshot, ...actions };
}

const NOOP_SUBSCRIBE = (): (() => void) => () => undefined;
const NOOP_GET_SNAPSHOT = (): SessionViewState => EMPTY_SESSION_VIEW;

/**
 * Hook for connecting to a session's WebSocket stream.
 *
 * The multi-active-session mode (G5 flag on + Tauri) is captured once per
 * mounted hook — the flag only changes on a full reload, so the selected mode
 * (and therefore the hook call shape) stays stable across renders.
 */
export function useSessionStream(options: UseSessionStreamOptions): UseSessionStreamReturn {
  const orchestrator = useSessionStreamOrchestrator();
  const [useMulti] = useState(
    () => orchestrator !== null && isMultiActiveSessionsEnabled(),
  );
  const multiOrchestrator = useMulti ? orchestrator : null;

  const {
    sessionId,
    baseUrl,
    onMessagesChange,
    onConnectionChange,
    onError,
    onSessionStatus,
    onFirstTurnComplete,
    autoConnect = false,
  } = options;
  const runtimeOptions: SessionRuntimeOptions = {
    sessionId,
    baseUrl,
    onMessagesChange,
    onConnectionChange,
    onError,
    onSessionStatus,
    onFirstTurnComplete,
    autoConnect,
  };

  // Single-stream mode owns one local runtime per mounted hook; multi-stream
  // mode never creates one here (the orchestrator owns the runtimes).
  const runtimeRef = useRef<SessionRuntime | null>(null);
  if (multiOrchestrator === null && runtimeRef.current === null) {
    runtimeRef.current = createSessionRuntime(runtimeOptions);
  }
  const runtime = multiOrchestrator === null ? runtimeRef.current : null;
  if (runtime) {
    // Forward the latest options every render so callbacks never go stale
    // (mirrors the former per-render useCallback closures).
    runtime.updateOptions(runtimeOptions);
  }

  // The layout effect reads the latest options through a ref so it can depend
  // on [sessionId, onError] only, exactly like the single-stream adapter's
  // former useLayoutEffect([sessionId, onError, ...]) dependency set.
  const runtimeOptionsRef = useRef(runtimeOptions);
  runtimeOptionsRef.current = runtimeOptions;

  // Store subscription: the orchestrator (multi) or the local runtime (single).
  const subscribe = multiOrchestrator
    ? multiOrchestrator.subscribe
    : runtime?.subscribe ?? NOOP_SUBSCRIBE;
  const getSnapshot = multiOrchestrator
    ? multiOrchestrator.getSnapshot
    : runtime?.getSnapshot ?? NOOP_GET_SNAPSHOT;
  const snapshot: SessionViewState = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getSnapshot,
  );
  const { messages, isConnected } = snapshot;

  // Actions: orchestrator-bound (multi) or the local runtime's methods (single).
  const actions: SessionRuntimeActions = multiOrchestrator
    ? multiOrchestrator.actionsFor(sessionId, runtimeOptions)
    : (runtime as SessionRuntime);

  // Notify parent of changes
  useEffect(() => {
    onMessagesChange?.(messages);
  }, [messages, onMessagesChange]);

  // Notify parent of connection changes
  useEffect(() => {
    onConnectionChange?.(isConnected);
  }, [isConnected, onConnectionChange]);

  // sessionId/onError are intentional restart triggers, mirroring the former
  // useLayoutEffect([sessionId, onError, ...]) dependency set.
  // biome-ignore lint/correctness/useExhaustiveDependencies: restart triggers, mirror the former effect's dependency set.
  useLayoutEffect(() => {
    if (multiOrchestrator) {
      // Multi-stream: mark the session visible; background runtimes must
      // survive visibility switches, so there is no teardown here.
      multiOrchestrator.attach(sessionId, runtimeOptionsRef.current);
      return;
    }
    // Single-stream: session switches are atomic — stop the old stream, clear
    // per-session accumulators, then start the new session. We use
    // `useLayoutEffect` so teardown happens before paint, minimizing the chance
    // that the next screen renders while the previous connection still pushes
    // messages.
    const localRuntime = runtimeRef.current;
    if (!localRuntime) {
      return;
    }
    localRuntime.stop();
    localRuntime.start();
    return () => {
      // Unmount teardown mirrors the former dedicated unmount effect: close the
      // wire and timers only, without clearing global tool-events stores. The
      // full per-session cleanup (stores, notifications, messages) is owned by
      // `stop()` in the effect body on session switches, not by this cleanup.
      localRuntime.disconnect();
    };
    // sessionId/onError are intentional restart triggers, mirroring the former
    // useLayoutEffect([sessionId, onError, ...]) dependency set.
  }, [multiOrchestrator, sessionId, onError]);

  return buildStreamReturn(snapshot, actions);
}
