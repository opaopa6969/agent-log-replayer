import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import type { BrokerEvent } from "../src/consumer/broker-client.js";
import { SessionManager } from "../src/consumer/session-manager.js";
import { SessionStore } from "../src/storage/session-store.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("SessionManager security persistence", () => {
  it("migrates the legacy security_events schema without recreating the database", () => {
    const directory = mkdtempSync(join(tmpdir(), "replayer-security-legacy-"));
    temporaryDirectories.push(directory);
    const dbPath = join(directory, "sessions.db");
    const legacyDatabase = new Database(dbPath);
    legacyDatabase.exec(`
      CREATE TABLE security_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        message_index INTEGER,
        flag_type TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    legacyDatabase.close();

    const store = new SessionStore(dbPath);
    store.upsertSession({
      sessionId: "legacy-session",
      agentType: "claude-code",
      projectPath: "/project",
      status: "active",
      firstMessageAt: null,
      lastMessageAt: null,
      messageCount: 0,
    });
    expect(
      store.addSecurityEvent(
        "legacy-session",
        "message-1",
        0,
        "security_flag",
        0,
        { type: "legacy-migrated" }
      )
    ).toBe(true);
    expect(store.getSecurityEvents("legacy-session").securityFlags).toEqual([
      { type: "legacy-migrated" },
    ]);
    store.close();
  });

  it("restores security data after restart without duplicating retries", async () => {
    const directory = mkdtempSync(join(tmpdir(), "replayer-security-"));
    temporaryDirectories.push(directory);
    const dbPath = join(directory, "sessions.db");
    const event: BrokerEvent = {
      _broker: {
        version: "1",
        messageId: "broker-message-1",
        deliveredAt: "2026-08-27T00:00:00.000Z",
        deliveryAttempt: 1,
      },
      _session: {
        sessionId: "sess-1",
        sessionPath: "/sessions/1",
        projectPath: "/project",
        agentType: "claude-code",
      },
      _index: { messageIndex: 3, byteOffset: 100 },
      type: "message",
      securityFlags: [
        {
          type: "external-url",
          severity: "info",
          description: "URL accessed",
        },
      ],
      bannedWordHits: [
        {
          word: "secret",
          context: "secret value",
          messageIndex: 3,
          field: "text",
        },
      ],
    };

    const firstStore = new SessionStore(dbPath);
    const firstManager = new SessionManager(firstStore);
    firstManager.handleEvent(event);
    firstManager.handleEvent({
      ...event,
      _broker: { ...event._broker, deliveryAttempt: 2 },
    });
    expect(firstManager.getSession("sess-1")?.securityFlags).toHaveLength(1);
    expect(firstManager.getSession("sess-1")?.bannedWordHits).toHaveLength(1);
    firstStore.close();

    const secondStore = new SessionStore(dbPath);
    const secondManager = new SessionManager(secondStore);
    await secondManager.loadFromStore();
    expect(secondManager.getSession("sess-1")?.securityFlags).toEqual(
      event.securityFlags
    );
    expect(secondManager.getSession("sess-1")?.bannedWordHits).toEqual(
      event.bannedWordHits
    );
    secondStore.close();
  });

  it("deduplicates message body across broker retries (issue #25)", () => {
    const directory = mkdtempSync(join(tmpdir(), "replayer-message-idempotent-"));
    temporaryDirectories.push(directory);
    const dbPath = join(directory, "sessions.db");

    const baseEvent: BrokerEvent = {
      _broker: {
        version: "1",
        messageId: "broker-message-25",
        deliveredAt: "2026-08-27T00:00:00.000Z",
        deliveryAttempt: 1,
      },
      _session: {
        sessionId: "sess-25",
        sessionPath: "/sessions/25",
        projectPath: "/project",
        agentType: "claude-code",
      },
      _index: { messageIndex: 0, byteOffset: 0 },
      type: "message",
      message: {
        role: "user",
        text: "hello",
        timestamp: "2026-08-27T00:00:00.000Z",
      },
    };

    const store = new SessionStore(dbPath);
    const manager = new SessionManager(store);

    manager.handleEvent(baseEvent);
    // Simulate a broker retry: same messageId, bumped deliveryAttempt.
    manager.handleEvent({
      ...baseEvent,
      _broker: { ...baseEvent._broker, deliveryAttempt: 2 },
    });

    const session = manager.getSession("sess-25")!;
    expect(session.messages).toHaveLength(1);
    expect(session.messageCount).toBe(1);
    expect(session.messages[0].text).toBe("hello");

    const directStore = new SessionStore(dbPath);
    expect(directStore.getMessages("sess-25")).toHaveLength(1);
    directStore.close();

    store.close();
  });

  it("keeps legacy messages without message_id untouched (issue #25 migration)", () => {
    const directory = mkdtempSync(
      join(tmpdir(), "replayer-message-legacy-")
    );
    temporaryDirectories.push(directory);
    const dbPath = join(directory, "sessions.db");

    const legacyDatabase = new Database(dbPath);
    legacyDatabase.exec(`
      CREATE TABLE sessions (
        session_id TEXT PRIMARY KEY,
        agent_type TEXT NOT NULL,
        project_path TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'active',
        first_message_at TEXT,
        last_message_at TEXT,
        message_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        message_index INTEGER NOT NULL,
        role TEXT NOT NULL,
        text TEXT,
        tool_uses TEXT,
        tool_results TEXT,
        thinking TEXT,
        timestamp TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    legacyDatabase.exec(
      "INSERT INTO sessions (session_id, agent_type, project_path) VALUES ('legacy', 'claude-code', '/p')"
    );
    legacyDatabase.exec(
      "INSERT INTO messages (session_id, message_index, role, text, timestamp) VALUES ('legacy', 0, 'user', 'old', '2026-01-01T00:00:00.000Z')"
    );
    legacyDatabase.close();

    const store = new SessionStore(dbPath);
    expect(store.getMessages("legacy")).toHaveLength(1);
    expect(store.getMessages("legacy")[0].text).toBe("old");

    store.addMessage("legacy", {
      role: "assistant",
      text: "appended",
      timestamp: "2026-08-29T00:00:00.000Z",
    });
    expect(store.getMessages("legacy")).toHaveLength(2);
    expect(store.getMessages("legacy")[1].text).toBe("appended");
    store.close();
  });
});
