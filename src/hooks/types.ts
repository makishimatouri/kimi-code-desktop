import type { FileUIPart, ToolUIPart } from "ai";
import type { QuestionItem, ToolApprovalState } from "./wireTypes";

export type NoPreviewAttachment = {
  kind: "nopreview";
  filename: string;
};

export type VideoNoPreviewAttachment = {
  kind: "video-nopreview";
  mediaType: string;
  filename: string;
};

export type MessageAttachmentPart = FileUIPart | NoPreviewAttachment | VideoNoPreviewAttachment;

/**
 * A single step recorded from a subagent's activity.
 * Accumulated as SubagentEvents arrive and rendered inside the parent Agent tool call.
 */
export type SubagentStep =
  | { kind: "thinking"; text: string }
  | { kind: "text"; text: string }
  | {
      kind: "tool-call";
      toolCallId: string;
      toolName: string;
      /** Raw accumulated arguments string (for streaming ToolCallPart) */
      rawArgs?: string;
      input?: unknown;
      status: "running" | "success" | "error";
      output?: string;
      errorText?: string;
    }
  | {
      /** A subagent spawned by a subagent (nested SubagentEvent). */
      kind: "subagent";
      agentId: string;
      agentType?: string;
      status: "running" | "success" | "error" | "cancelled";
      steps: SubagentStep[];
    };

/**
 * Live message in the chat - this is a UI-specific type
 * that extends beyond what the API provides
 */
export type LiveMessage = {
  /** Unique identifier for this UI message (React key) */
  id: string;
  /** Backend message ID from StatusUpdate event (identifies the turn) */
  messageId?: string;
  /** 0-based turn index, set on user messages at TurnBegin */
  turnIndex?: number;
  role: "user" | "assistant";
  content?: string;
  attachments?: MessageAttachmentPart[];
  isStreaming?: boolean;
  variant?:
    | "text"
    | "chain-of-thought"
    | "tool"
    | "code"
    | "thinking"
    | "steer"
    | "message-id"
    | "status";
  /** Thinking/reasoning content from the model */
  thinking?: string;
  /** Duration of thinking in seconds */
  thinkingDuration?: number;
  chainOfThought?: {
    title: string;
    steps: {
      label: string;
      description: string;
    }[];
    revealedSteps: number;
    relatedSources?: string[];
  };
  toolCall?: {
    title: string;
    type: ToolUIPart["type"];
    state:
      | ToolUIPart["state"]
      | "approval-requested"
      | "approval-responded"
      | "question-requested"
      | "question-responded"
      | "output-denied";
    input?: ToolUIPart["input"];
    /** Tool call ID for tracking */
    toolCallId?: string;
    /**
     * Tool result fields (aligned with backend ToolReturnValue)
     * @see kosong.tooling.ToolReturnValue
     */
    /** The output content returned by the tool (for model) */
    output?: string;
    /** An explanatory message to be given to the model */
    message?: string;
    /** Content blocks to be displayed to the user */
    display?: Array<{ type: string; data: unknown }>;
    /** Extra debugging/testing data */
    extras?: Record<string, unknown>;
    /** Whether the tool call resulted in an error */
    isError?: boolean;
    /** Error text for display (derived from message when isError) */
    errorText?: string;
    /** Media parts extracted from tool output (images/videos from ReadMediaFile etc.) */
    mediaParts?: Array<{ type: "image_url" | "video_url"; url: string }>;
    approval?: ToolApprovalState;
    question?: {
      id: string;
      toolCallId: string;
      questions: QuestionItem[];
      rpcMessageId?: string | number;
      submitted?: boolean;
      resolved?: boolean;
      answers?: Record<string, string>;
    };
    /** Steps from a subagent (Agent tool) — populated by SubagentEvent processing */
    subagentSteps?: SubagentStep[];
    /** Whether the subagent is still actively running */
    subagentRunning?: boolean;
    /** Built-in subagent type (coder / explore / plan) */
    subagentType?: string;
    /** Subagent instance ID */
    subagentAgentId?: string;
    /** True when this tool message was created from a sub-agent's ApprovalRequest
     *  (the tool_call_id belongs to the sub-agent, not the main agent) */
    isSubagentOrigin?: boolean;
  };
  codeSnippet?: {
    title: string;
    code: string;
    language: string;
    description?: string;
  };
};
