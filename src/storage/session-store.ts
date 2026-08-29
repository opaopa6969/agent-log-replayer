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

export type SecurityEventKind = "security_flag" | "banned_word_hit";

export interface StoredSecurityEvents {
  securityFlags: unknown[];
  bannedWordHits: unknown[];
}

export class SessionStore {
  private db: Database.Database;
  // Cached prepared statements. better-sqlite3's prepare() is cheap but not
  // free; reusing the same Statement avoids repeated SQL parsing and GC
  // pressure on the Statement objects. Each is created lazily on first use
  // so the constructor stays side-effect-free for schema setup.
  private stmtUpsertSession?: Database.Statement;
  private stmtInsertMessage?: Database.Statement;
  private stmtInsertBrokerMessage?: Database.Statement;
  private stmtNextMessageIndex?: Database.Statement;
  private stmtGetMessages?: Database.Statement;
  private stmtListSessions?: Database.Statement;
  private stmtInsertSecurityEvent?: Database.Statement;
  private stmtGetSecurityEvents?: Database.Statement;

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
        message_id TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES sessions(session_id)
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session
        ON messages(session_id, message_index);

      CREATE TABLE IF NOT EXISTS security_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        message_id TEXT,
        message_index INTEGER,
        event_kind TEXT,
        event_index INTEGER,
        flag_type TEXT NOT NULL,
        detail TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY (session_id) REFERENCES sessions(session_id)
      );

      CREATE INDEX IF NOT EXISTS idx_security_session
        ON security_events(session_id);
    `);

    // security_events existed before persistence was implemented. Additive
    // ALTERs preserve any existing database instead of requiring recreation.
    const columns = new Set(
      (this.db.prepare("PRAGMA table_info(security_events)").all() as Array<{
        name: string;
      }>).map((column) => column.name)
    );
    if (!columns.has("message_id")) {
      this.db.exec("ALTER TABLE security_events ADD COLUMN message_id TEXT");
    }
    if (!columns.has("event_kind")) {
      this.db.exec("ALTER TABLE security_events ADD COLUMN event_kind TEXT");
    }
    if (!columns.has("event_index")) {
      this.db.exec("ALTER TABLE security_events ADD COLUMN event_index INTEGER");
    }

    // Legacy rows have no message_id and remain untouched. Broker-delivered
    // rows are idempotent per message, kind, and position in the payload.
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_security_message_event
        ON security_events(session_id, message_id, event_kind, event_index)
        WHERE message_id IS NOT NULL
    `);

    // messages existed before broker-retry idempotency was added. Add the
    // message_id column additively so existing databases keep working.
    const messageColumns = new Set(
      (this.db.prepare("PRAGMA table_info(messages)").all() as Array<{
        name: string;
      }>).map((column) => column.name)
    );
    if (!messageColumns.has("message_id")) {
      this.db.exec("ALTER TABLE messages ADD COLUMN message_id TEXT");
    }

    // Broker retries must not duplicate message rows. A partial unique index
    // mirrors the security_events pattern: legacy rows without a message_id
    // stay untouched, while broker-delivered rows are deduplicated per
    // (session_id, message_id).
    this.db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_broker_message
        ON messages(session_id, message_id)
        WHERE message_id IS NOT NULL
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
    const stmt =
      (this.stmtUpsertSession ??= this.db.prepare(`
        INSERT INTO sessions (session_id, agent_type, project_path, status,
          first_message_at, last_message_at, message_count, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(session_id) DO UPDATE SET
          status = excluded.status,
          first_message_at = COALESCE(excluded.first_message_at, sessions.first_message_at),
          last_message_at = excluded.last_message_at,
          message_count = excluded.message_count,
          updated_at = datetime('now')
      `));

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

  /** Add a message to a session. Returns false when a broker retry is ignored. */
  addMessage(sessionId: string, message: AgentMessage, messageId?: string): boolean {
    // Broker-delivered messages carry a message_id and are deduplicated via
    // idx_messages_broker_message. Messages without a message_id (legacy or
    // locally injected) bypass the guard and are always inserted.
    if (messageId) {
      const stmt =
        (this.stmtInsertBrokerMessage ??= this.db.prepare(`
          INSERT OR IGNORE INTO messages (session_id, message_index, role, text,
            tool_uses, tool_results, thinking, timestamp, message_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `));
      const result = stmt.run(
        sessionId,
        this.nextMessageIndex(sessionId),
        message.role,
        message.text ?? null,
        message.toolUses ? JSON.stringify(message.toolUses) : null,
        message.toolResults ? JSON.stringify(message.toolResults) : null,
        message.thinking ? JSON.stringify(message.thinking) : null,
        message.timestamp,
        messageId
      );
      return result.changes > 0;
    }

    // Use MAX(message_index) instead of COUNT(*) to determine the next index.
    // MAX() resolves to the last entry of idx_messages_session, making it
    // O(log N) rather than the O(N) index-only scan that COUNT(*) requires.
    // See SPEC.md §10.5 (TECH-003) for the original hotspot.
    const stmt =
      (this.stmtInsertMessage ??= this.db.prepare(`
        INSERT INTO messages (session_id, message_index, role, text,
          tool_uses, tool_results, thinking, timestamp)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `));
    stmt.run(
      sessionId,
      this.nextMessageIndex(sessionId),
      message.role,
      message.text ?? null,
      message.toolUses ? JSON.stringify(message.toolUses) : null,
      message.toolResults ? JSON.stringify(message.toolResults) : null,
      message.thinking ? JSON.stringify(message.thinking) : null,
      message.timestamp
    );
    return true;
  }

  private nextMessageIndex(sessionId: string): number {
    const idxStmt =
      (this.stmtNextMessageIndex ??= this.db.prepare(
        "SELECT COALESCE(MAX(message_index), -1) AS last_idx " +
          "FROM messages WHERE session_id = ?"
      ));
    const row = idxStmt.get(sessionId) as { last_idx: number } | undefined;
    return (row?.last_idx ?? -1) + 1;
  }

  /** Get all messages for a session. */
  getMessages(sessionId: string): AgentMessage[] {
    // Select only the columns consumed by the mapper. SELECT * forces
    // better-sqlite3 to materialize `id`, `created_at`, etc. into JS objects
    // for every row; narrowing the column list cuts both transfer cost and
    // V8 object allocation. The prepared statement is cached on first use.
    const stmt =
      (this.stmtGetMessages ??= this.db.prepare(
        "SELECT role, text, tool_uses, tool_results, thinking, timestamp " +
          "FROM messages WHERE session_id = ? ORDER BY message_index"
      ));
    const rows = stmt.all(sessionId) as Array<{
      role: string;
      text: string | null;
      tool_uses: string | null;
      tool_results: string | null;
      thinking: string | null;
      timestamp: string;
    }>;

    // Pre-allocate and use a plain for-loop to avoid the per-row closure
    // allocation that Array.prototype.map performs.
    const out: AgentMessage[] = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      out[i] = {
        role: r.role as "user" | "assistant" | "system",
        text: r.text ?? undefined,
        toolUses: r.tool_uses ? JSON.parse(r.tool_uses) : undefined,
        toolResults: r.tool_results ? JSON.parse(r.tool_results) : undefined,
        thinking: r.thinking ? JSON.parse(r.thinking) : undefined,
        timestamp: r.timestamp,
      };
    }
    return out;
  }

  /** Persist one broker-provided security item. Returns false for a retry. */
  addSecurityEvent(
    sessionId: string,
    messageId: string,
    messageIndex: number | null,
    eventKind: SecurityEventKind,
    eventIndex: number,
    event: unknown
  ): boolean {
    const flagType =
      eventKind === "security_flag" &&
      typeof event === "object" &&
      event !== null &&
      "type" in event
        ? String((event as { type: unknown }).type)
        : "banned_word";
    const stmt =
      (this.stmtInsertSecurityEvent ??= this.db.prepare(`
        INSERT OR IGNORE INTO security_events
          (session_id, message_id, message_index, event_kind, event_index,
            flag_type, detail)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `));
    const result = stmt.run(
      sessionId,
      messageId,
      messageIndex,
      eventKind,
      eventIndex,
      flagType,
      JSON.stringify(event) ?? "null"
    );
    return result.changes > 0;
  }

  /** Restore the raw security payloads for a session. */
  getSecurityEvents(sessionId: string): StoredSecurityEvents {
    const stmt =
      (this.stmtGetSecurityEvents ??= this.db.prepare(`
        SELECT event_kind, detail
        FROM security_events
        WHERE session_id = ? AND event_kind IS NOT NULL
        ORDER BY message_index, event_index, id
      `));
    const rows = stmt.all(sessionId) as Array<{
      event_kind: SecurityEventKind;
      detail: string | null;
    }>;
    const result: StoredSecurityEvents = {
      securityFlags: [],
      bannedWordHits: [],
    };
    for (const row of rows) {
      const event: unknown = row.detail ? JSON.parse(row.detail) : null;
      if (row.event_kind === "security_flag") {
        result.securityFlags.push(event);
      } else if (row.event_kind === "banned_word_hit") {
        result.bannedWordHits.push(event);
      }
    }
    return result;
  }

  /** List all sessions. */
  listSessions(): StoredSession[] {
    // Enumerate columns explicitly; SELECT * would also fetch no extra
    // columns here, but being explicit avoids silently picking up future
    // schema additions and keeps the row shape aligned with the mapper.
    const stmt =
      (this.stmtListSessions ??= this.db.prepare(
        "SELECT session_id, agent_type, project_path, status, " +
          "first_message_at, last_message_at, message_count, " +
          "created_at, updated_at FROM sessions ORDER BY updated_at DESC"
      ));
    const rows = stmt.all() as Array<{
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

    const out: StoredSession[] = new Array(rows.length);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      out[i] = {
        sessionId: row.session_id,
        agentType: row.agent_type,
        projectPath: row.project_path,
        status: row.status,
        firstMessageAt: row.first_message_at,
        lastMessageAt: row.last_message_at,
        messageCount: row.message_count,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      };
    }
    return out;
  }

  /** Close the database. */
  close(): void {
    this.db.close();
  }
}
