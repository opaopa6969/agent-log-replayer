/**
 * Terminal Renderer
 *
 * Produces xterm.js-compatible output sequences for terminal replay.
 * Converts AgentMessage into terminal escape sequences that reproduce
 * the Claude Code terminal experience in the browser.
 *
 * Rendering concepts inherited from claude-session-replay's Terminal format:
 * - User input: ">" prompt with blue background bar
 * - Assistant text: orange left border, dark background
 * - Tool blocks: indented with tool-specific icons
 * - Spinner animation: orange dot during processing, green check on completion
 */

import type { AgentMessage } from "../consumer/broker-client.js";

/** ANSI escape codes for terminal styling */
const ANSI = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  blue: "\x1b[34m",
  green: "\x1b[32m",
  orange: "\x1b[33m",
  bgBlue: "\x1b[44m",
  bgDark: "\x1b[48;5;235m",
} as const;

/** Tool display icons (matching claude-session-replay conventions) */
const TOOL_ICONS: Record<string, string> = {
  Read: "\u{1F4C4}",
  Write: "\u{1F4DD}",
  Edit: "\u{270F}\uFE0F",
  Bash: "$",
  Grep: "\u{1F50D}",
  Glob: "\u{1F4C1}",
  Task: "\u{1F4CB}",
  Agent: "\u{1F916}",
};

export interface TerminalRenderOptions {
  showThinking: boolean;
  showToolDetails: boolean;
  ansiMode: "strip" | "color";
}

const DEFAULT_OPTIONS: TerminalRenderOptions = {
  showThinking: false,
  showToolDetails: true,
  ansiMode: "strip",
};

export interface RenderedLine {
  text: string;
  timestamp: string;
  role: "user" | "assistant" | "tool" | "thinking";
}

/**
 * Render an AgentMessage into terminal-style lines.
 */
export function renderMessage(
  message: AgentMessage,
  options: Partial<TerminalRenderOptions> = {}
): RenderedLine[] {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const lines: RenderedLine[] = [];

  if (message.role === "user") {
    lines.push({
      text: `${ANSI.bgBlue}${ANSI.bold} > ${message.text ?? ""}${ANSI.reset}`,
      timestamp: message.timestamp,
      role: "user",
    });
  } else if (message.role === "assistant") {
    // Thinking blocks
    if (opts.showThinking && message.thinking?.length) {
      for (const block of message.thinking) {
        lines.push({
          text: `${ANSI.dim}  [thinking] ${truncate(block, 200)}${ANSI.reset}`,
          timestamp: message.timestamp,
          role: "thinking",
        });
      }
    }

    // Main text
    if (message.text) {
      lines.push({
        text: `${ANSI.orange}  ${message.text}${ANSI.reset}`,
        timestamp: message.timestamp,
        role: "assistant",
      });
    }

    // Tool uses
    if (opts.showToolDetails && message.toolUses?.length) {
      for (const tool of message.toolUses) {
        const t = tool as { name?: string; input?: Record<string, unknown> };
        const icon = TOOL_ICONS[t.name ?? ""] ?? "\u{2699}\uFE0F";
        const summary = formatToolSummary(t);
        lines.push({
          text: `${ANSI.green}  ${icon} ${t.name ?? "Unknown"}: ${summary}${ANSI.reset}`,
          timestamp: message.timestamp,
          role: "tool",
        });
      }
    }
  }

  return lines;
}

/**
 * Render a sequence of messages into a complete terminal session.
 */
export function renderSession(
  messages: AgentMessage[],
  options: Partial<TerminalRenderOptions> = {}
): RenderedLine[] {
  const allLines: RenderedLine[] = [];
  for (const msg of messages) {
    allLines.push(...renderMessage(msg, options));
  }
  return allLines;
}

// ── Helpers ──

function formatToolSummary(tool: {
  name?: string;
  input?: Record<string, unknown>;
}): string {
  const input = tool.input ?? {};
  switch (tool.name) {
    case "Read":
      return String(input.file_path ?? "");
    case "Write":
      return String(input.file_path ?? "");
    case "Edit":
      return String(input.file_path ?? "");
    case "Bash":
      return truncate(String(input.command ?? ""), 100);
    case "Grep":
      return `${input.pattern ?? ""} in ${input.path ?? "."}`;
    case "Glob":
      return String(input.pattern ?? "");
    default:
      return JSON.stringify(input).slice(0, 80);
  }
}

function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen) + "...";
}
