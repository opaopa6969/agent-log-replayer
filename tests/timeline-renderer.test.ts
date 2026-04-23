import { describe, it, expect } from "vitest";
import {
  buildTimeline,
} from "../src/renderer/timeline-renderer.js";
import type { AgentMessage } from "../src/consumer/broker-client.js";

describe("buildTimeline", () => {
  it("event count matches messages (one event per message with no extras)", () => {
    const messages: AgentMessage[] = [
      { role: "user", text: "Hello", timestamp: "2026-04-23T10:00:00.000Z" },
      { role: "assistant", text: "Hi there", timestamp: "2026-04-23T10:00:05.000Z" },
    ];
    const events = buildTimeline(messages);
    // Each message produces one main event, no thinking/toolUses
    expect(events).toHaveLength(2);
  });

  it("event count includes extra events for thinking and tool uses", () => {
    const messages: AgentMessage[] = [
      {
        role: "assistant",
        text: "Response",
        thinking: ["block1", "block2"],
        toolUses: [{ name: "Read", input: { file_path: "/foo" } }],
        timestamp: "2026-04-23T10:00:00.000Z",
      },
    ];
    const events = buildTimeline(messages);
    // 1 assistant_message + 1 thinking group + 1 tool_use = 3
    expect(events).toHaveLength(3);
  });

  it("event kinds are correct (user_message, assistant_message)", () => {
    const messages: AgentMessage[] = [
      { role: "user", text: "Hello", timestamp: "2026-04-23T10:00:00.000Z" },
      { role: "assistant", text: "Hi", timestamp: "2026-04-23T10:00:05.000Z" },
    ];
    const events = buildTimeline(messages);
    expect(events[0].kind).toBe("user_message");
    expect(events[1].kind).toBe("assistant_message");
  });

  it("tool_use events have kind 'tool_use'", () => {
    const messages: AgentMessage[] = [
      {
        role: "assistant",
        toolUses: [
          { name: "Bash", input: { command: "ls" } },
          { name: "Read", input: { file_path: "/foo" } },
        ],
        timestamp: "2026-04-23T10:00:00.000Z",
      },
    ];
    const events = buildTimeline(messages);
    const toolEvents = events.filter((e) => e.kind === "tool_use");
    expect(toolEvents).toHaveLength(2);
  });

  it("first event has durationFromPrev = null", () => {
    const messages: AgentMessage[] = [
      { role: "user", text: "Hello", timestamp: "2026-04-23T10:00:00.000Z" },
      { role: "assistant", text: "Hi", timestamp: "2026-04-23T10:00:05.000Z" },
    ];
    const events = buildTimeline(messages);
    expect(events[0].durationFromPrev).toBeNull();
  });

  it("subsequent events compute durationFromPrev from timestamps", () => {
    const messages: AgentMessage[] = [
      { role: "user", text: "Hello", timestamp: "2026-04-23T10:00:00.000Z" },
      { role: "assistant", text: "Hi", timestamp: "2026-04-23T10:00:05.000Z" },
    ];
    const events = buildTimeline(messages);
    // Second event should be 5000ms after the first
    expect(events[1].durationFromPrev).toBe(5000);
  });

  it("events have sequential index values", () => {
    const messages: AgentMessage[] = [
      { role: "user", text: "A", timestamp: "2026-04-23T10:00:00.000Z" },
      { role: "assistant", text: "B", timestamp: "2026-04-23T10:00:01.000Z" },
      { role: "user", text: "C", timestamp: "2026-04-23T10:00:02.000Z" },
    ];
    const events = buildTimeline(messages);
    events.forEach((event, i) => {
      expect(event.index).toBe(i);
    });
  });

  it("empty messages returns empty timeline", () => {
    const events = buildTimeline([]);
    expect(events).toHaveLength(0);
  });

  it("messageIndex references correct source message", () => {
    const messages: AgentMessage[] = [
      { role: "user", text: "A", timestamp: "2026-04-23T10:00:00.000Z" },
      { role: "assistant", text: "B", timestamp: "2026-04-23T10:00:01.000Z" },
    ];
    const events = buildTimeline(messages);
    expect(events[0].messageIndex).toBe(0);
    expect(events[1].messageIndex).toBe(1);
  });
});
