/**
 * SessionStore baseline benchmark
 *
 * Targets the performance hotspots documented in SPEC.md §10.5:
 *   - addMessage: COUNT(*) WHERE session_id = ? on every insert (TECH-003)
 *   - getMessages: JSON.parse on every row
 *   - listSessions: full scan ordered by updated_at DESC
 *
 * The benchmark is intentionally framework-free (no vitest) so it can be
 * re-run with plain `tsx` after each optimization. Results are printed as
 * TSV for easy diffing:
 *
 *   metric_name   iterations   total_ms   ops_per_sec   p50_us   p99_us
 *
 * Reproduction:
 *   npx tsx benchmarks/bench-store.ts            # default sizes
 *   BENCH_SEED=42 BENCH_MSG=2000 npx tsx benchmarks/bench-store.ts
 */

import { SessionStore } from "../src/storage/session-store.js";
import type { AgentMessage } from "../src/consumer/broker-client.js";

interface BenchConfig {
  /** Number of messages per session for the addMessage/getMessages benches. */
  messagesPerSession: number;
  /** Number of sessions for the listSessions bench. */
  sessionCount: number;
  /** Repetitions for timed loops. */
  repetitions: number;
  /** Warmup iterations (not measured). */
  warmup: number;
  /** Deterministic seed for message contents. */
  seed: number;
}

function loadConfig(): BenchConfig {
  const env = process.env;
  return {
    messagesPerSession: intEnv("BENCH_MSG", 1000),
    sessionCount: intEnv("BENCH_SESSIONS", 500),
    repetitions: intEnv("BENCH_REPS", 5),
    warmup: intEnv("BENCH_WARMUP", 1),
    seed: intEnv("BENCH_SEED", 42),
  };
}

function intEnv(name: string, def: number): number {
  const v = process.env[name];
  if (!v) return def;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : def;
}

/** Tiny deterministic PRNG (mulberry32) so runs are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeMessage(rng: () => number, index: number): AgentMessage {
  // Vary payload size: ~20% with toolUses, ~10% with thinking, rest plain.
  const r = rng();
  const base: AgentMessage = {
    role: index % 2 === 0 ? "user" : "assistant",
    text: `message-${index}-` + Math.floor(rng() * 1e9).toString(36),
    timestamp: new Date(1_700_000_000_000 + index * 1000).toISOString(),
  };
  if (r < 0.2) {
    base.toolUses = [
      { name: "Read", input: { file_path: `/path/file-${index}.ts` } },
      { name: "Bash", input: { command: `ls -la /tmp/${index}` } },
    ];
    base.toolResults = [
      { tool_use_id: `tu-${index}`, content: "ok".repeat(50) },
    ];
  } else if (r < 0.3) {
    base.thinking = [`Considering step ${index}...`.repeat(5)];
  }
  return base;
}

interface Sample {
  name: string;
  iterations: number;
  totalMs: number;
  perOpUs: number[];
}

function bench(
  name: string,
  iterations: number,
  warmup: number,
  fn: (i: number) => void
): Sample {
  for (let i = 0; i < warmup; i++) fn(i);
  const perOpUs: number[] = [];
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const s = performance.now();
    fn(i);
    perOpUs.push((performance.now() - s) * 1000);
  }
  const totalMs = performance.now() - start;
  return { name, iterations, totalMs, perOpUs };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function fmt(n: number, digits = 2): string {
  if (Number.isInteger(n)) return n.toString();
  return n.toFixed(digits);
}

function printSample(s: Sample): void {
  const opsPerSec = (s.iterations / s.totalMs) * 1000;
  const sorted = [...s.perOpUs].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p99 = percentile(sorted, 99);
  process.stdout.write(
    [
      s.name,
      s.iterations,
      fmt(s.totalMs, 1),
      fmt(opsPerSec, 0),
      fmt(p50, 1),
      fmt(p99, 1),
    ].join("\t") + "\n"
  );
}

function main(): void {
  const cfg = loadConfig();
  process.stdout.write(
    [
      `# agent-log-replayer SessionStore bench`,
      `# config: messagesPerSession=${cfg.messagesPerSession} sessionCount=${cfg.sessionCount} reps=${cfg.repetitions} seed=${cfg.seed}`,
      `# node: ${process.version} platform: ${process.platform}`,
      `# ${new Date().toISOString()}`,
      "",
      "metric\titerations\ttotal_ms\tops_per_sec\tp50_us\tp99_us",
    ].join("\n") + "\n"
  );

  const rng = mulberry32(cfg.seed);

  // ── A. addMessage throughput (COUNT(*) on every insert) ──
  {
    const store = new SessionStore(":memory:");
    store.upsertSession({
      sessionId: "bench-sess-A",
      agentType: "claude-code",
      projectPath: "/bench",
      status: "active",
      firstMessageAt: null,
      lastMessageAt: null,
      messageCount: 0,
    });
    const msgs: AgentMessage[] = [];
    for (let i = 0; i < cfg.messagesPerSession; i++) {
      msgs.push(makeMessage(rng, i));
    }
    let idx = 0;
    const s = bench("addMessage", cfg.messagesPerSession, 0, () => {
      store.addMessage("bench-sess-A", msgs[idx++ % msgs.length]);
    });
    printSample(s);
    store.close();
  }

  // ── B. getMessages: full scan + JSON.parse ──
  {
    const store = new SessionStore(":memory:");
    store.upsertSession({
      sessionId: "bench-sess-B",
      agentType: "claude-code",
      projectPath: "/bench",
      status: "active",
      firstMessageAt: null,
      lastMessageAt: null,
      messageCount: 0,
    });
    for (let i = 0; i < cfg.messagesPerSession; i++) {
      store.addMessage("bench-sess-B", makeMessage(rng, i));
    }
    // Measure repeated full reads.
    const s = bench(
      "getMessages_full_read",
      cfg.repetitions,
      cfg.warmup,
      () => {
        const msgs = store.getMessages("bench-sess-B");
        // Touch a field to prevent DCE.
        if (msgs.length > 0 && msgs[0].text === undefined) {
          throw new Error("unexpected");
        }
      }
    );
    printSample(s);
    store.close();
  }

  // ── C. listSessions: scan with ORDER BY updated_at DESC ──
  {
    const store = new SessionStore(":memory:");
    for (let i = 0; i < cfg.sessionCount; i++) {
      store.upsertSession({
        sessionId: `bench-sess-C-${i}`,
        agentType: "claude-code",
        projectPath: `/bench/${i}`,
        status: i % 3 === 0 ? "active" : "idle",
        firstMessageAt: null,
        lastMessageAt: null,
        messageCount: i,
      });
    }
    const s = bench("listSessions", cfg.repetitions, cfg.warmup, () => {
      const list = store.listSessions();
      if (list.length !== cfg.sessionCount) throw new Error("unexpected");
    });
    printSample(s);
    store.close();
  }

  // ── D. addMessage + upsertSession (handleMessage pattern) ──
  // Real workload: each incoming broker event triggers both addMessage
  // and upsertSession. This isolates the combined hot path.
  {
    const store = new SessionStore(":memory:");
    store.upsertSession({
      sessionId: "bench-sess-D",
      agentType: "claude-code",
      projectPath: "/bench",
      status: "active",
      firstMessageAt: null,
      lastMessageAt: null,
      messageCount: 0,
    });
    const msgs: AgentMessage[] = [];
    for (let i = 0; i < cfg.messagesPerSession; i++) {
      msgs.push(makeMessage(rng, i));
    }
    let idx = 0;
    let count = 0;
    const s = bench(
      "addMessage+upsertSession",
      cfg.messagesPerSession,
      0,
      () => {
        const m = msgs[idx++ % msgs.length];
        store.addMessage("bench-sess-D", m);
        count++;
        store.upsertSession({
          sessionId: "bench-sess-D",
          agentType: "claude-code",
          projectPath: "/bench",
          status: "active",
          firstMessageAt: null,
          lastMessageAt: m.timestamp,
          messageCount: count,
        });
      }
    );
    printSample(s);
    store.close();
  }
}

main();
