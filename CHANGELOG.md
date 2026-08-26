# Changelog

All notable changes to agent-log-replayer are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

### Added

- Persistent broker consumer IDs with a `CONSUMER_ID` override (issue #10).
- Startup restoration of archived sessions from SQLite (issue #8).
- SPA fallback routing for direct browser URLs (issue #12).
- Explicit broker type synchronization markers (issue #15).

### Documentation

- Updated the test inventory to 55 tests across 7 files (issue #5).
- Recorded the implemented status of issues #8, #10, #12, and #15.

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
