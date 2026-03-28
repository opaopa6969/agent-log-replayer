/**
 * Session Store
 *
 * SQLite-backed persistence for session metadata and messages.
 * Uses better-sqlite3 for synchronous, fast access.
 */

import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentMessage } from "../consumer/broker-client.js";

export interface StoredSession {
  sessionId: string;
  agentType: string;
  projectPath: string;
  status: string;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  messageCount: number;
  createdAt: string;
  updatedAt: string;
}

export class SessionStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.migrate();
  }

  /** Initialize database schema. */
  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
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

      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        message_index INTEGER NOT NULL,
        role TEXT NOT NULL,
        text TEXT,
        tool_uses TEXT,
        tool_results TEXT,
        thinking TEXT,
        timestamp TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES sessions(session_id)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session
        ON messages(session_id, message_index);

      CREATE TABLE IF NOT EXISTS security_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        message_index INTEGER,
        flag_type TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES sessions(session_id)
      );

      CREATE INDEX IF NOT EXISTS idx_security_session
        ON security_events(session_id);
    `);
  }

  /** Upsert session metadata. */
  upsertSession(session: {
    sessionId: string;
    agentType: string;
    projectPath: string;
    status: string;
    firstMessageAt: string | null;
    lastMessageAt: string | null;
    messageCount: number;
  }): void {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (session_id, agent_type, project_path, status,
        first_message_at, last_message_at, message_count, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
      ON CONFLICT(session_id) DO UPDATE SET
        status = excluded.status,
        first_message_at = COALESCE(excluded.first_message_at, sessions.first_message_at),
        last_message_at = excluded.last_message_at,
        message_count = excluded.message_count,
        updated_at = datetime('now')
    `);

    stmt.run(
      session.sessionId,
      session.agentType,
      session.projectPath,
      session.status,
      session.firstMessageAt,
      session.lastMessageAt,
      session.messageCount
    );
  }

  /** Add a message to a session. */
  addMessage(sessionId: string, message: AgentMessage): void {
    const count = this.db
      .prepare("SELECT COUNT(*) as cnt FROM messages WHERE session_id = ?")
      .get(sessionId) as { cnt: number };

    const stmt = this.db.prepare(`
      INSERT INTO messages (session_id, message_index, role, text,
        tool_uses, tool_results, thinking, timestamp)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      sessionId,
      count.cnt,
      message.role,
      message.text ?? null,
      message.toolUses ? JSON.stringify(message.toolUses) : null,
      message.toolResults ? JSON.stringify(message.toolResults) : null,
      message.thinking ? JSON.stringify(message.thinking) : null,
      message.timestamp
    );
  }

  /** Get all messages for a session. */
  getMessages(sessionId: string): AgentMessage[] {
    const rows = this.db
      .prepare(
        "SELECT * FROM messages WHERE session_id = ? ORDER BY message_index"
      )
      .all(sessionId) as Array<{
      role: string;
      text: string | null;
      tool_uses: string | null;
      tool_results: string | null;
      thinking: string | null;
      timestamp: string;
    }>;

    return rows.map((row) => ({
      role: row.role as "user" | "assistant" | "system",
      text: row.text ?? undefined,
      toolUses: row.tool_uses ? JSON.parse(row.tool_uses) : undefined,
      toolResults: row.tool_results ? JSON.parse(row.tool_results) : undefined,
      thinking: row.thinking ? JSON.parse(row.thinking) : undefined,
      timestamp: row.timestamp,
    }));
  }

  /** List all sessions. */
  listSessions(): StoredSession[] {
    const rows = this.db
      .prepare("SELECT * FROM sessions ORDER BY updated_at DESC")
      .all() as Array<{
      session_id: string;
      agent_type: string;
      project_path: string;
      status: string;
      first_message_at: string | null;
      last_message_at: string | null;
      message_count: number;
      created_at: string;
      updated_at: string;
    }>;

    return rows.map((row) => ({
      sessionId: row.session_id,
      agentType: row.agent_type,
      projectPath: row.project_path,
      status: row.status,
      firstMessageAt: row.first_message_at,
      lastMessageAt: row.last_message_at,
      messageCount: row.message_count,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  /** Close the database. */
  close(): void {
    this.db.close();
  }
}
