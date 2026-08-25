# Decision: consumerId Instability on Restart

**Status:** BACKLOG — known bug, no fix implemented  
**Filed:** 2026-04-19  
**Affects:** `src/consumer/broker-client.ts`, broker consumer registry

---

## Problem

`BrokerClient` generates a new `consumerId` on every process start:

```typescript
// src/consumer/broker-client.ts
this.consumerId = config.consumerId ?? `agent-log-replayer-${Date.now()}`;
```

Because `Date.now()` changes on every startup, each restart of agent-log-replayer registers as a **brand new consumer** with the broker. The previous consumer registration is never explicitly unsubscribed.

## Impact

1. **Stale consumer accumulation**: The broker's consumer registry grows with one dead entry per restart. After 10 restarts, there are 10 stale registrations.

2. **Delivery to dead callbacks**: If the broker retries delivery to stale consumers, it will attempt HTTP callbacks to `http://localhost:3200/api/broker/callback` from the old registrations. Whether this causes errors depends on broker retry logic.

3. **Subscription state loss**: If the replayer restarts mid-session, the new `consumerId` means it starts receiving events from the broker's delivery queue as a fresh subscriber. Any backlog configuration (e.g., "deliver from beginning") may not apply.

## Reproduction

```bash
npm start   # registers as agent-log-replayer-1713500000000
# Ctrl+C
npm start   # registers as agent-log-replayer-1713500001234 (new)
# broker now has two consumer records
```

## Root cause

The `consumerId` was chosen as `Date.now()` for simplicity during initial development. No persistence mechanism was implemented.

## Proposed fix

Persist `consumerId` to a file on first start and reuse it on subsequent starts:

```typescript
// src/consumer/broker-client.ts — proposed
import { readFileSync, writeFileSync, existsSync } from "node:fs";

function getOrCreateConsumerId(idFilePath: string): string {
  if (existsSync(idFilePath)) {
    return readFileSync(idFilePath, "utf-8").trim();
  }
  const id = `agent-log-replayer-${crypto.randomUUID()}`;
  writeFileSync(idFilePath, id, "utf-8");
  return id;
}
```

Default path: `./data/consumer-id.txt` (same directory as SQLite DB).

Alternatively, allow override via `CONSUMER_ID` environment variable.

## Workaround (current)

Set `consumerId` explicitly in the `BrokerClientConfig`:

```typescript
const client = new BrokerClient({
  brokerUrl: process.env.BROKER_URL ?? "http://localhost:3100",
  callbackUrl: process.env.CALLBACK_URL ?? "...",
  consumerId: "agent-log-replayer-stable",  // hardcoded stable ID
});
```

This is not implemented in the current codebase. The `src/index.ts` entry point uses the default (unstable) ID.

## BACKLOG

This is tracked as a known bug. Priority: medium. No regression impact as long as the broker handles stale consumers gracefully (returns 404 on unknown consumer unsubscribe, ignores delivery failures).
