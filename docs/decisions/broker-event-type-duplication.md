# Decision: BrokerEvent Type Duplication

**Status:** Option C Implemented (2026-08-01) — `// SYNC WITH broker/src/types/broker-event.ts` comments added to all duplicated types in `src/consumer/broker-client.ts`. Option A (shared package) remains a future improvement tracked separately.
**Filed:** 2026-04-19
**Resolved:** 2026-08-01 (GitHub issue #15)
**Affects:** `src/consumer/broker-client.ts`

---

## Problem

`BrokerEvent`, `AgentMessage`, `BrokerEnvelope`, `SessionMeta`, and `IndexMeta` are defined locally in `src/consumer/broker-client.ts`:

```typescript
// src/consumer/broker-client.ts — local redefinition
export interface BrokerEvent {
  _broker: BrokerEnvelope;
  _session: SessionMeta;
  _index?: IndexMeta;
  type: BrokerEventType;
  message?: AgentMessage;
  securityFlags?: unknown[];
  bannedWordHits?: unknown[];
}
```

agent-log-broker defines the same types as its canonical source. There is no shared package between broker and replayer. The two definitions must be kept in sync manually.

## Risk

If the broker adds a field to `BrokerEvent` (e.g., `correlationId`, or changes `securityFlags` from `unknown[]` to a typed array), the replayer will silently receive that field but TypeScript will not know about it. Bugs may be invisible until runtime.

If the broker renames a field (e.g., `_session` → `_sessionMeta`), the replayer will fail to read session data and all sessions will appear empty or crash at `event._session.sessionId`.

## Why it exists

The broker and replayer are separate packages with no shared dependency mechanism at the time of writing. The path of least resistance was to copy-paste the type definitions.

## Resolution options

### Option A — Shared types package (recommended)

Extract `BrokerEvent` and related types into a new package `@unlaxer/agent-log-types` (or similar). Both broker and replayer import from it.

Pros: single source of truth, TypeScript catches drift at compile time.  
Cons: requires a new package and publish step; adds a release coupling.

### Option B — Generated types from broker's OpenAPI or JSON Schema

If the broker exposes its event schema as JSON Schema or OpenAPI, generate TypeScript types automatically using `json-schema-to-typescript` or similar.

Pros: always in sync with broker's declared contract.  
Cons: requires broker to maintain a schema artifact; adds a generation step.

### Option C — Maintain manually with a sync check comment

Keep local definitions but add a prominent `// SYNC WITH broker/src/types/broker-event.ts` comment and a changelog entry whenever broker types change.

Pros: no tooling changes.  
Cons: relies on human discipline; drift will happen eventually.

## Current state

Option C is in effect (implicitly). No comment or process exists yet. **This is a BACKLOG item.**

## Resolution (2026-08-01)

Option C is now explicitly implemented. Each duplicated type in `src/consumer/broker-client.ts` carries a `// SYNC WITH broker/src/types/broker-event.ts` comment. When broker types change, update both sides and add a changelog entry.

Option A (shared `@unlaxer/agent-log-types` package) remains a future improvement and will be tracked in a separate issue, as it requires changes to both the broker and replayer repositories.

## Affected files

- `src/consumer/broker-client.ts` — all type definitions here
- `src/storage/session-store.ts` — imports `AgentMessage` from broker-client
- `src/renderer/terminal-renderer.ts` — imports `AgentMessage`
- `src/renderer/timeline-renderer.ts` — imports `AgentMessage`
- `src/api/routes.ts` — imports `BrokerEvent`
- `src/api/websocket.ts` — imports `BrokerEvent`
