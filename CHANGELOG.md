# Changelog

All notable changes to agent-log-replayer are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

- `getOrCreateConsumerId()` in `BrokerClient` — persists `consumerId` to `./data/consumer-id.txt` so it is reused across restarts; `CONSUMER_ID` env var override supported (issue #10, BUG-001).
- `loadFromStore()` is now called in `src/index.ts` `main()` before broker subscribe, restoring archived sessions on startup (issue #8, TECH-005).
- SPA fallback `app.get("*", ...)` after `express.static("frontend/dist")` so direct URLs like `/sessions/xxx` resolve to `index.html` (issue #12, BUG-003).
- `// SYNC WITH broker/src/types/broker-event.ts` comments on all duplicated types in `broker-client.ts` (Option C, issue #15, TECH-001).

### Changed

- `src/index.ts` `loadConfig()` now reads `CONSUMER_ID` env var and passes `consumerId` to `BrokerClient`.

### Documentation

- `docs/decisions/consumer-id-instability.md` Status: BACKLOG → Implemented.
- `docs/decisions/broker-event-type-duplication.md` Status: Open → Option C Implemented.
- `spec/SPEC.md` §10.1/§11.1 updated: tests 0 → 45 cases / 5 files.
- `spec/SPEC.md` §10.2/§10.4/§5.3/付録D/付録E D.3 updated to reflect resolutions.

## [0.1.0] - 2026-04-19

### Added

- Initial scaffold: Express + WebSocket server, React SPA frontend
- `BrokerClient` — registers as `full_stream` consumer with agent-log-broker
- `SessionManager` — in-memory session state with SQLite persistence
- `SessionStore` — SQLite-backed storage via `better-sqlite3` (WAL mode)
  - Tables: `sessions`, `messages`, `security_events`
- REST API: `GET /api/sessions`, `GET /api/sessions/:id`, `GET /api/sessions/:id/timeline`, `GET /api/status`, `POST /api/broker/callback`
- WebSocket handler at `/ws` — real-time event streaming to browser clients
- `terminal-renderer.ts` — ANSI escape sequence generation for xterm.js replay
- `timeline-renderer.ts` — structured timeline event construction from messages
- `diff-renderer.ts` — file diff visualization for Edit/Write tool events
- `audit.ts` — security flag aggregation and `requiresReview()` helper
- Frontend components: `SessionList`, `SessionPlayer` (functional)
- Frontend placeholders: `TerminalView`, `TimelineView`, `SecurityPanel` (TODO stubs)
- Zustand store (`sessionStore.ts`) for client-side state
- Vite + TypeScript build pipeline for frontend
- `vitest` configured as test runner (0 tests written)
