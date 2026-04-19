[日本語版](getting-started-ja.md)

# Getting Started

This guide walks through running agent-log-replayer and observing a live agent session.

## Prerequisites

- Node.js ≥ 20
- agent-log-broker running and accessible (default: `http://localhost:3100`)
- An AI agent (e.g., Claude Code) that writes to a log file the broker watches

## 1. Install dependencies

```bash
cd agent-log-replayer
npm install
```

## 2. Configure environment (optional)

The defaults work for local development. Override with environment variables if needed:

```bash
export PORT=3200
export BROKER_URL=http://localhost:3100
export CALLBACK_URL=http://localhost:3200/api/broker/callback
export DB_PATH=./data/sessions.db
```

## 3. Build and start

```bash
npm run build
npm start
```

You should see:

```
[replayer] Listening on http://localhost:3200
[replayer] Subscribed to broker as agent-log-replayer-1713500000000
```

## 4. Open the UI

Navigate to `http://localhost:3200` in your browser.

The **Session List** panel on the left will be empty until the broker delivers the first event.

## 5. Trigger an agent session

Start an agent that the broker is configured to watch. For example, with Claude Code:

```bash
cd /your/project
claude
```

Within a few seconds, the session should appear in the Session List.

## 6. Replay a session

1. Click a session in the **Session List**.
2. The **Session Player** opens with playback controls.
3. Press **Play** or use the seek bar to move through the session.
4. The **TerminalView**, **TimelineView**, and **SecurityPanel** areas are currently placeholder stubs — they will render content once implemented.

## 7. Browse past sessions

Past sessions are loaded from SQLite on startup. They appear in the Session List with `archived` status.

Click any archived session to inspect its messages via the REST API:

```bash
# List all sessions
curl http://localhost:3200/api/sessions

# Get a specific session with messages
curl http://localhost:3200/api/sessions/<sessionId>

# Get timeline events
curl http://localhost:3200/api/sessions/<sessionId>/timeline

# Check broker connection
curl http://localhost:3200/api/status
```

## 8. Development workflow

Run backend and frontend in watch mode simultaneously:

```bash
# Terminal 1
npm run dev

# Terminal 2
npm run dev:frontend
```

Frontend changes hot-reload via Vite. Backend changes require restart.

## Known limitations

- **TerminalView**, **TimelineView**, and **SecurityPanel** are placeholder stubs — they render static shells only.
- **consumerId** changes on every restart. This accumulates stale consumer records in the broker. See [decisions/consumer-id-instability.md](decisions/consumer-id-instability.md).
- **Tests: 0.** There are no automated tests. Manual verification only.
