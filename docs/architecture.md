[日本語版](architecture-ja.md)

# Architecture

## 1. Design Philosophy

agent-log-replayer is a browser-based session replayer that acts as a consumer of agent-log-broker. It is built as a three-layer architecture:

1. **Consumer layer** — subscribes to the broker, receives `BrokerEvent` via HTTP callback
2. **Storage layer** — persists sessions, messages, and security events to SQLite
3. **UI layer** — serves a React SPA with REST API + WebSocket real-time streaming

No parsing logic lives in the replayer. All parsing and redaction is handled upstream by the broker.

---

## 2. Three-Layer Architecture

```
┌─────────────────────────────────────────────────────────┐
│ Layer 1: Consumer                                        │
│   broker-client.ts   — HTTP callback subscription mgmt  │
│   session-manager.ts — in-memory session state          │
└──────────────────────────┬──────────────────────────────┘
                           │ BrokerEvent
                           ▼
┌─────────────────────────────────────────────────────────┐
│ Layer 2: Storage (SQLite)                                │
│   session-store.ts   — sessions + messages + security   │
└──────────────────────────┬──────────────────────────────┘
                           │ query + realtime notify
                           ▼
┌─────────────────────────────────────────────────────────┐
│ Layer 3: UI                                              │
│   routes.ts          — Express REST API                  │
│   websocket.ts       — WebSocket real-time streaming    │
│   React SPA          — SessionList/Player/views         │
└─────────────────────────────────────────────────────────┘
```

---

## 3. SQLite Schema

### `sessions`

```sql
CREATE TABLE sessions (
  session_id      TEXT PRIMARY KEY,
  agent_type      TEXT NOT NULL,
  project_path    TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'active',
  first_message_at TEXT,
  last_message_at  TEXT,
  message_count   INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
```

`status` values: `active` | `idle` | `lost` | `archived`

### `messages`

```sql
CREATE TABLE messages (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id     TEXT NOT NULL,
  message_index  INTEGER NOT NULL,
  role           TEXT NOT NULL,
  text           TEXT,
  tool_uses      TEXT,   -- JSON array
  tool_results   TEXT,   -- JSON array
  thinking       TEXT,   -- JSON array
  timestamp      TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

CREATE INDEX idx_messages_session ON messages(session_id, message_index);
```

`tool_uses`, `tool_results`, `thinking` are stored as JSON strings (not normalized). `message_index` is a monotonic counter per session.

### `security_events`

```sql
CREATE TABLE security_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id    TEXT NOT NULL,
  message_index INTEGER,
  flag_type     TEXT NOT NULL,
  detail        TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id)
);

CREATE INDEX idx_security_session ON security_events(session_id);
```

Note: security event rows are defined in schema but the current `addMessage` implementation stores `securityFlags` and `bannedWordHits` in the in-memory `ActiveSession` only. Persistent storage of security events to this table is not yet implemented.

---

## 4. WebSocket Protocol

### Server → Client

```typescript
// New event from broker
{ type: "event", sessionId: string, event: BrokerEvent }

// Full session list (sent on connect)
{ type: "session.list", sessions: SessionSummary[] }

// Error notification
{ type: "error", message: string }
```

### Client → Server

```typescript
// Subscribe to a specific session (or all sessions if sessionId omitted)
{ type: "subscribe", sessionId?: string }

// Unsubscribe — revert to "all sessions" mode
{ type: "unsubscribe" }
```

All connected clients start in "subscribe to all sessions" mode (`subscribedSessionId: null`).

---

## 5. REST API

| Method | Path | Description | Response |
|--------|------|-------------|----------|
| `GET` | `/api/sessions` | List all sessions | `SessionSummary[]` |
| `GET` | `/api/sessions/:id` | Session detail + messages | `ActiveSession` |
| `GET` | `/api/sessions/:id/timeline` | Timeline events | `TimelineEvent[]` |
| `GET` | `/api/status` | Health + broker connection | `StatusResponse` |
| `POST` | `/api/broker/callback` | Receive BrokerEvent | `{ ok: true }` |

**Error codes for `/api/broker/callback`:**
- `400` — invalid `BrokerEvent` format (broker will not retry)
- `500` — internal error (broker will retry)

---

## 6. Renderer

Three renderer modules in `src/renderer/`:

### terminal-renderer.ts

Converts `AgentMessage[]` → `RenderedLine[]` (ANSI escape sequences for xterm.js).

Visual conventions:
- `user` messages: `\x1b[44m\x1b[1m > {text}\x1b[0m` (blue background, bold)
- `assistant` text: `\x1b[33m  {text}\x1b[0m` (orange)
- Tool blocks: `\x1b[32m  {icon} {name}: {summary}\x1b[0m` (green)
- Thinking blocks: `\x1b[2m  [thinking] {truncated}\x1b[0m` (dim, hidden by default)

Options: `showThinking: boolean`, `showToolDetails: boolean`, `ansiMode: "strip" | "color"`

### timeline-renderer.ts

Converts `AgentMessage[]` → `TimelineEvent[]` for the frontend timeline bar.

### diff-renderer.ts

Extracts file diff information from `Edit`/`Write` tool use inputs.

---

## 7. Security Audit

`src/security/audit.ts` — presentation-only module. Broker performs detection; replayer aggregates and displays.

```typescript
interface AuditSummary {
  totalFlags: number;
  criticalCount: number;
  warningCount: number;
  infoCount: number;
  bannedWordCount: number;
  flagsByType: Record<string, number>;
  flags: SecurityFlag[];
  bannedWordHits: BannedWordHit[];
}
```

`requiresReview(summary): boolean` — `true` if `criticalCount > 0 || bannedWordCount > 0`.

---

## 8. Frontend Components

### SessionList

Displays all sessions from the Zustand store. Shows `sessionId`, `agentType`, `projectPath`, `status` badge, `messageCount`, and security indicator.

### SessionPlayer

Playback controls: play/pause, seek bar, speed multiplier. Drives `currentIndex` in the Zustand store, which all view components read.

### TerminalView — TODO placeholder

**Not yet implemented.** Props: `sessionId`, `visibleUpTo: number`. Intended to render messages through xterm.js up to `currentIndex`. Current implementation returns a static placeholder div.

### TimelineView — TODO placeholder

**Not yet implemented.** Props: `sessionId`, `currentIndex`, `onSeek`. Intended to fetch from `GET /api/sessions/:id/timeline` and render a clickable vertical timeline. Current implementation returns a static placeholder with legend only.

### SecurityPanel — TODO placeholder

**Not yet implemented.** Props: `sessionId`. Intended to display `SecurityFlag[]` and `BannedWordHit[]` from the session store. Current implementation returns a static placeholder.

---

## 9. Module Map

```
src/
├── index.ts                    # Express + WebSocket server entry
├── consumer/
│   ├── broker-client.ts        # Broker subscription management
│   └── session-manager.ts      # Session state (memory + persistence)
├── renderer/
│   ├── terminal-renderer.ts    # ANSI sequence generation
│   ├── timeline-renderer.ts    # Timeline event construction
│   └── diff-renderer.ts        # File diff extraction
├── storage/
│   └── session-store.ts        # SQLite persistence (better-sqlite3)
├── api/
│   ├── routes.ts               # REST API endpoints
│   └── websocket.ts            # WebSocket real-time handler
└── security/
    └── audit.ts                # Security flag aggregation

frontend/
├── index.html
└── src/
    ├── App.tsx
    ├── components/
    │   ├── SessionList.tsx      # Session list (functional)
    │   ├── SessionPlayer.tsx    # Playback controls (functional)
    │   ├── TerminalView.tsx     # TODO placeholder
    │   ├── TimelineView.tsx     # TODO placeholder
    │   └── SecurityPanel.tsx   # TODO placeholder
    └── store/
        └── sessionStore.ts     # Zustand client state
```

---

## 10. Known Risks

### BrokerEvent type duplication

`BrokerEvent` and `AgentMessage` are locally defined in `broker-client.ts` instead of being imported from a shared package. Any change to the broker's canonical types must be manually mirrored here. See [decisions/broker-event-type-duplication.md](decisions/broker-event-type-duplication.md).

### consumerId instability

`consumerId` is generated as `` `agent-log-replayer-${Date.now()}` `` on every process start unless overridden. This creates stale consumer records in the broker. See [decisions/consumer-id-instability.md](decisions/consumer-id-instability.md).
