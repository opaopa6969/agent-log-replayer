import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { SessionStore } from "../src/storage/session-store.js";
import type { AgentMessage } from "../src/consumer/broker-client.js";

function makeStore(): SessionStore {
  return new SessionStore(":memory:");
}

describe("SessionStore", () => {
  let store: SessionStore;

  beforeEach(() => {
    store = makeStore();
  });

  afterEach(() => {
    store.close();
  });

  describe("upsertSession (insert)", () => {
    it("creates session with all fields correct", () => {
      store.upsertSession({
        sessionId: "sess-001",
        agentType: "claude-code",
        projectPath: "/home/user/project",
        status: "active",
        firstMessageAt: "2026-04-23T10:00:00.000Z",
        lastMessageAt: "2026-04-23T10:00:05.000Z",
        messageCount: 1,
      });

      const sessions = store.listSessions();
      expect(sessions).toHaveLength(1);

      const session = sessions[0];
      expect(session.sessionId).toBe("sess-001");
      expect(session.agentType).toBe("claude-code");
      expect(session.projectPath).toBe("/home/user/project");
      expect(session.status).toBe("active");
      expect(session.firstMessageAt).toBe("2026-04-23T10:00:00.000Z");
      expect(session.lastMessageAt).toBe("2026-04-23T10:00:05.000Z");
      expect(session.messageCount).toBe(1);
    });
  });

  describe("upsertSession (update)", () => {
    it("updates status, message_count, last_message_at but NOT first_message_at", () => {
      // Initial insert
      store.upsertSession({
        sessionId: "sess-001",
        agentType: "claude-code",
        projectPath: "/home/user/project",
        status: "active",
        firstMessageAt: "2026-04-23T10:00:00.000Z",
        lastMessageAt: "2026-04-23T10:00:05.000Z",
        messageCount: 1,
      });

      // Update with new status, count, lastMessageAt
      // Pass firstMessageAt: null so COALESCE preserves the existing value
      store.upsertSession({
        sessionId: "sess-001",
        agentType: "claude-code",
        projectPath: "/home/user/project",
        status: "idle",
        firstMessageAt: null, // null → COALESCE keeps existing first_message_at
        lastMessageAt: "2026-04-23T10:05:00.000Z",
        messageCount: 5,
      });

      const sessions = store.listSessions();
      expect(sessions).toHaveLength(1);

      const session = sessions[0];
      expect(session.status).toBe("idle");
      expect(session.messageCount).toBe(5);
      expect(session.lastMessageAt).toBe("2026-04-23T10:05:00.000Z");
      // first_message_at should be preserved from the original insert (COALESCE keeps non-null)
      expect(session.firstMessageAt).toBe("2026-04-23T10:00:00.000Z");
    });
  });

  describe("addMessage", () => {
    it("adds messages with correct sequential message_index (0, 1, 2...)", () => {
      store.upsertSession({
        sessionId: "sess-001",
        agentType: "claude-code",
        projectPath: "/project",
        status: "active",
        firstMessageAt: null,
        lastMessageAt: null,
        messageCount: 0,
      });

      const msg0: AgentMessage = {
        role: "user",
        text: "First message",
        timestamp: "2026-04-23T10:00:00.000Z",
      };
      const msg1: AgentMessage = {
        role: "assistant",
        text: "Second message",
        timestamp: "2026-04-23T10:00:01.000Z",
      };
      const msg2: AgentMessage = {
        role: "user",
        text: "Third message",
        timestamp: "2026-04-23T10:00:02.000Z",
      };

      store.addMessage("sess-001", msg0);
      store.addMessage("sess-001", msg1);
      store.addMessage("sess-001", msg2);

      const messages = store.getMessages("sess-001");
      expect(messages).toHaveLength(3);
      expect(messages[0].text).toBe("First message");
      expect(messages[1].text).toBe("Second message");
      expect(messages[2].text).toBe("Third message");
    });
  });

  describe("getMessages", () => {
    it("returns messages in order and deserializes JSON fields", () => {
      store.upsertSession({
        sessionId: "sess-002",
        agentType: "claude-code",
        projectPath: "/project",
        status: "active",
        firstMessageAt: null,
        lastMessageAt: null,
        messageCount: 0,
      });

      const toolUses = [{ name: "Read", input: { file_path: "/foo.ts" } }];
      const toolResults = [{ tool_use_id: "tu-1", content: "file content" }];
      const thinking = ["I am thinking..."];

      const msg: AgentMessage = {
        role: "assistant",
        text: "Response with tools",
        toolUses,
        toolResults,
        thinking,
        timestamp: "2026-04-23T10:00:00.000Z",
      };

      store.addMessage("sess-002", msg);

      const messages = store.getMessages("sess-002");
      expect(messages).toHaveLength(1);

      const retrieved = messages[0];
      expect(retrieved.role).toBe("assistant");
      expect(retrieved.text).toBe("Response with tools");
      expect(retrieved.timestamp).toBe("2026-04-23T10:00:00.000Z");

      // JSON fields should be deserialized
      expect(retrieved.toolUses).toEqual(toolUses);
      expect(retrieved.toolResults).toEqual(toolResults);
      expect(retrieved.thinking).toEqual(thinking);
    });

    it("returns messages in message_index order", () => {
      store.upsertSession({
        sessionId: "sess-003",
        agentType: "claude-code",
        projectPath: "/project",
        status: "active",
        firstMessageAt: null,
        lastMessageAt: null,
        messageCount: 0,
      });

      const timestamps = [
        "2026-04-23T10:00:00.000Z",
        "2026-04-23T10:00:01.000Z",
        "2026-04-23T10:00:02.000Z",
      ];

      for (let i = 0; i < 3; i++) {
        store.addMessage("sess-003", {
          role: i % 2 === 0 ? "user" : "assistant",
          text: `Message ${i}`,
          timestamp: timestamps[i],
        });
      }

      const messages = store.getMessages("sess-003");
      expect(messages[0].text).toBe("Message 0");
      expect(messages[1].text).toBe("Message 1");
      expect(messages[2].text).toBe("Message 2");
    });
  });

  describe("security events", () => {
    it("persists, restores, and deduplicates broker retries", () => {
      store.upsertSession({
        sessionId: "sess-security",
        agentType: "claude-code",
        projectPath: "/project",
        status: "active",
        firstMessageAt: null,
        lastMessageAt: null,
        messageCount: 0,
      });
      const flag = {
        type: "suspicious-command",
        severity: "warning",
        description: "shell command",
        messageIndex: 4,
      };
      const hit = {
        word: "secret",
        context: "a secret value",
        messageIndex: 4,
        field: "text",
      };

      expect(
        store.addSecurityEvent(
          "sess-security",
          "message-1",
          4,
          "security_flag",
          0,
          flag
        )
      ).toBe(true);
      expect(
        store.addSecurityEvent(
          "sess-security",
          "message-1",
          4,
          "security_flag",
          0,
          flag
        )
      ).toBe(false);
      expect(
        store.addSecurityEvent(
          "sess-security",
          "message-1",
          4,
          "banned_word_hit",
          0,
          hit
        )
      ).toBe(true);

      expect(store.getSecurityEvents("sess-security")).toEqual({
        securityFlags: [flag],
        bannedWordHits: [hit],
      });
    });
  });

  describe("listSessions", () => {
    it("returns sessions ordered by updated_at DESC", () => {
      // Insert two sessions; second upsert will have a later updated_at
      store.upsertSession({
        sessionId: "sess-alpha",
        agentType: "claude-code",
        projectPath: "/alpha",
        status: "active",
        firstMessageAt: null,
        lastMessageAt: null,
        messageCount: 0,
      });

      store.upsertSession({
        sessionId: "sess-beta",
        agentType: "claude-code",
        projectPath: "/beta",
        status: "active",
        firstMessageAt: null,
        lastMessageAt: null,
        messageCount: 0,
      });

      // Touch sess-alpha again so it has a newer updated_at
      store.upsertSession({
        sessionId: "sess-alpha",
        agentType: "claude-code",
        projectPath: "/alpha",
        status: "active",
        firstMessageAt: null,
        lastMessageAt: null,
        messageCount: 1,
      });

      const sessions = store.listSessions();
      expect(sessions).toHaveLength(2);
      // sess-alpha was updated last, so should be first
      expect(sessions[0].sessionId).toBe("sess-alpha");
      expect(sessions[1].sessionId).toBe("sess-beta");
    });

    it("returns empty array when no sessions exist", () => {
      const sessions = store.listSessions();
      expect(sessions).toHaveLength(0);
    });
  });

  describe("addMessage foreign-key guard", () => {
    it("rejects a message for a session that was never upserted", () => {
      // messages.session_id has a FOREIGN KEY referencing sessions.
      // A message for an unknown session must not silently succeed;
      // otherwise orphan rows would accumulate and getMessages would
      // return data for sessions that never existed.
      const msg: AgentMessage = {
        role: "user",
        text: "orphan",
        timestamp: "2026-04-23T10:00:00.000Z",
      };
      expect(() => store.addMessage("never-upserted", msg)).toThrow(
        /FOREIGN KEY/i
      );
      // Nothing should have been written.
      expect(store.getMessages("never-upserted")).toHaveLength(0);
    });
  });
});
