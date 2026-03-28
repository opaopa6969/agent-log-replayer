/**
 * Timeline Renderer
 *
 * Generates timeline event data for the TimelineView component.
 * Extracts tool calls, message boundaries, and timing information
 * to produce a structured timeline suitable for visual rendering.
 */

import type { AgentMessage } from "../consumer/broker-client.js";

export type TimelineEventKind =
  | "user_message"
  | "assistant_message"
  | "tool_use"
  | "tool_result"
  | "thinking"
  | "session_start"
  | "session_idle"
  | "session_end";

export interface TimelineEvent {
  /** Sequential index in the timeline */
  index: number;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Event kind for visual categorization */
  kind: TimelineEventKind;
  /** Short label for display */
  label: string;
  /** Optional detail text */
  detail?: string;
  /** Duration in ms from previous event (null for first event) */
  durationFromPrev: number | null;
  /** Original message index in the session */
  messageIndex: number;
}

/**
 * Build a timeline from a sequence of AgentMessages.
 */
export function buildTimeline(messages: AgentMessage[]): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  let eventIndex = 0;
  let prevTimestamp: string | null = null;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    // Main message event
    const kind: TimelineEventKind =
      msg.role === "user" ? "user_message" : "assistant_message";

    const duration = computeDuration(prevTimestamp, msg.timestamp);

    events.push({
      index: eventIndex++,
      timestamp: msg.timestamp,
      kind,
      label: msg.role === "user" ? "User" : "Assistant",
      detail: truncate(msg.text ?? "", 120),
      durationFromPrev: duration,
      messageIndex: i,
    });

    prevTimestamp = msg.timestamp;

    // Thinking blocks
    if (msg.thinking?.length) {
      events.push({
        index: eventIndex++,
        timestamp: msg.timestamp,
        kind: "thinking",
        label: `Thinking (${msg.thinking.length} blocks)`,
        detail: truncate(msg.thinking[0], 80),
        durationFromPrev: 0,
        messageIndex: i,
      });
    }

    // Tool uses
    if (msg.toolUses?.length) {
      for (const tool of msg.toolUses) {
        const t = tool as { name?: string; input?: Record<string, unknown> };
        events.push({
          index: eventIndex++,
          timestamp: msg.timestamp,
          kind: "tool_use",
          label: t.name ?? "Tool",
          detail: formatToolDetail(t),
          durationFromPrev: 0,
          messageIndex: i,
        });
      }
    }
  }

  return events;
}

/**
 * Compute total session duration in ms from first to last message.
 */
export function computeSessionDuration(messages: AgentMessage[]): number | null {
  if (messages.length < 2) return null;
  const first = messages[0].timestamp;
  const last = messages[messages.length - 1].timestamp;
  return computeDuration(first, last);
}

// ── Helpers ──

function computeDuration(
  from: string | null,
  to: string
): number | null {
  if (!from || !to) return null;
  try {
    const diff = new Date(to).getTime() - new Date(from).getTime();
    return diff >= 0 ? diff : null;
  } catch {
    return null;
  }
}

function formatToolDetail(tool: {
  name?: string;
  input?: Record<string, unknown>;
}): string {
  const input = tool.input ?? {};
  switch (tool.name) {
    case "Read":
    case "Write":
    case "Edit":
      return String(input.file_path ?? "");
    case "Bash":
      return truncate(String(input.command ?? ""), 100);
    case "Grep":
      return `${input.pattern ?? ""} in ${input.path ?? "."}`;
    case "Glob":
      return String(input.pattern ?? "");
    default:
      return "";
  }
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}
