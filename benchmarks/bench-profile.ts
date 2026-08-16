import { SessionStore } from "../src/storage/session-store.js";
import type { AgentMessage } from "../src/consumer/broker-client.js";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const N = 10000;
const store = new SessionStore(":memory:");
store.upsertSession({
  sessionId: "p", agentType: "c", projectPath: "/", status: "active",
  firstMessageAt: null, lastMessageAt: null, messageCount: 0,
});
const rng = mulberry32(42);
for (let i = 0; i < N; i++) {
  const r = rng();
  const m: AgentMessage = {
    role: i % 2 === 0 ? "user" : "assistant",
    text: `m-${i}`,
    timestamp: new Date(1_700_000_000_000 + i * 1000).toISOString(),
  };
  if (r < 0.2) {
    m.toolUses = [{ name: "Read", input: { file_path: `/f${i}.ts` } }];
    m.toolResults = [{ tool_use_id: `tu${i}`, content: "ok" }];
  } else if (r < 0.3) {
    m.thinking = [`thinking ${i}`];
  }
  store.addMessage("p", m);
}

const tSel0 = performance.now();
const rows = (store as unknown as { db: { prepare: (s: string) => { all: (id: string) => unknown[] } } }).db.prepare("SELECT * FROM messages WHERE session_id = ? ORDER BY message_index").all("p");
const tSel = performance.now() - tSel0;
console.log(`SELECT only: ${tSel.toFixed(1)}ms rows=${rows.length}`);

let parseCount = 0;
const tParse0 = performance.now();
for (const r of rows as Array<{ tool_uses: string | null; tool_results: string | null; thinking: string | null }>) {
  if (r.tool_uses) { JSON.parse(r.tool_uses); parseCount++; }
  if (r.tool_results) { JSON.parse(r.tool_results); parseCount++; }
  if (r.thinking) { JSON.parse(r.thinking); parseCount++; }
}
const tParse = performance.now() - tParse0;
console.log(`JSON.parse: ${tParse.toFixed(1)}ms parses=${parseCount}`);

const tMap0 = performance.now();
const msgs = store.getMessages("p");
const tMap = performance.now() - tMap0;
console.log(`getMessages total: ${tMap.toFixed(1)}ms msgs=${msgs.length}`);

store.close();
