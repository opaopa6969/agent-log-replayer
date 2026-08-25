import { describe, it, expect } from "vitest";
import {
  renderMessage,
  renderSession,
} from "../src/renderer/terminal-renderer.js";
import type { AgentMessage } from "../src/consumer/broker-client.js";

const ANSI_RESET = "\x1b[0m";
const ANSI_BGBLUE = "\x1b[44m";
const ANSI_ORANGE = "\x1b[33m";
const ANSI_GREEN = "\x1b[32m";
const ANSI_DIM = "\x1b[2m";

describe("renderMessage", () => {
  const timestamp = "2026-04-23T10:00:00.000Z";

  it("user message contains ANSI codes and message text", () => {
    const msg: AgentMessage = {
      role: "user",
      text: "Hello world",
      timestamp,
    };
    const lines = renderMessage(msg);
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line.role).toBe("user");
    expect(line.timestamp).toBe(timestamp);
    expect(line.text).toContain(ANSI_BGBLUE);
    expect(line.text).toContain("Hello world");
    expect(line.text).toContain(ANSI_RESET);
  });

  it("assistant message with text renders properly", () => {
    const msg: AgentMessage = {
      role: "assistant",
      text: "Here is my response",
      timestamp,
    };
    const lines = renderMessage(msg);
    expect(lines).toHaveLength(1);
    const line = lines[0];
    expect(line.role).toBe("assistant");
    expect(line.text).toContain(ANSI_ORANGE);
    expect(line.text).toContain("Here is my response");
    expect(line.text).toContain(ANSI_RESET);
  });

  it("tool_use shows icon and tool name", () => {
    const msg: AgentMessage = {
      role: "assistant",
      toolUses: [{ name: "Read", input: { file_path: "/path/to/file.ts" } }],
      timestamp,
    };
    const lines = renderMessage(msg);
    // Should have one tool line (no text block)
    const toolLines = lines.filter((l) => l.role === "tool");
    expect(toolLines).toHaveLength(1);
    expect(toolLines[0].text).toContain("Read");
    expect(toolLines[0].text).toContain(ANSI_GREEN);
    // Read icon is 📄
    expect(toolLines[0].text).toContain("\u{1F4C4}");
  });

  it("thinking block is hidden by default (showThinking: false)", () => {
    const msg: AgentMessage = {
      role: "assistant",
      text: "Response",
      thinking: ["I am thinking about this"],
      timestamp,
    };
    const lines = renderMessage(msg, { showThinking: false });
    const thinkingLines = lines.filter((l) => l.role === "thinking");
    expect(thinkingLines).toHaveLength(0);
  });

  it("thinking block shown when showThinking: true", () => {
    const msg: AgentMessage = {
      role: "assistant",
      text: "Response",
      thinking: ["I am thinking about this"],
      timestamp,
    };
    const lines = renderMessage(msg, { showThinking: true });
    const thinkingLines = lines.filter((l) => l.role === "thinking");
    expect(thinkingLines).toHaveLength(1);
    expect(thinkingLines[0].text).toContain(ANSI_DIM);
    expect(thinkingLines[0].text).toContain("[thinking]");
    expect(thinkingLines[0].text).toContain("I am thinking about this");
  });

  it("showToolDetails: false hides tool uses", () => {
    const msg: AgentMessage = {
      role: "assistant",
      text: "Response",
      toolUses: [{ name: "Bash", input: { command: "ls -la" } }],
      timestamp,
    };
    const lines = renderMessage(msg, { showToolDetails: false });
    const toolLines = lines.filter((l) => l.role === "tool");
    expect(toolLines).toHaveLength(0);
  });
});

describe("renderSession", () => {
  const timestamp1 = "2026-04-23T10:00:00.000Z";
  const timestamp2 = "2026-04-23T10:01:00.000Z";

  it("returns concatenated lines from all messages", () => {
    const messages: AgentMessage[] = [
      { role: "user", text: "First message", timestamp: timestamp1 },
      { role: "assistant", text: "Second message", timestamp: timestamp2 },
    ];
    const lines = renderSession(messages);
    expect(lines).toHaveLength(2);
    expect(lines[0].role).toBe("user");
    expect(lines[1].role).toBe("assistant");
  });

  it("empty array returns empty result", () => {
    const lines = renderSession([]);
    expect(lines).toHaveLength(0);
    expect(lines).toEqual([]);
  });
});
