import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createServer, type Server } from "node:http";
import express from "express";
import { WebSocketServer } from "ws";
import { BrokerClient } from "../src/consumer/broker-client.js";
import { SessionManager } from "../src/consumer/session-manager.js";
import { SessionStore } from "../src/storage/session-store.js";
import { createRoutes } from "../src/api/routes.js";
import { setupWebSocket } from "../src/api/websocket.js";
import { createMcpHandler } from "../src/mcp/server.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let server: Server;
let port: number;
let baseUrl: string;

beforeAll(async () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "replay-mcp-"));
  const dbPath = join(tmpDir, "test.db");

  const store = new SessionStore(dbPath);
  const sessionManager = new SessionManager(store);

  const app = express();

  const brokerClient = new BrokerClient({
    brokerUrl: "http://localhost:3100",
    callbackUrl: "http://localhost:0/api/broker/callback",
  });

  const mcpHandler = createMcpHandler({ sessionManager, brokerClient });
  app.use(async (req, res, next) => {
    if (req.url === "/mcp") {
      return mcpHandler(req, res);
    }
    next();
  });

  app.use(express.json({ limit: "10mb" }));
  server = createServer(app);

  const wss = new WebSocketServer({ server, path: "/ws" });
  const wsHandler = setupWebSocket(wss, sessionManager);

  const routes = createRoutes(sessionManager, brokerClient, wsHandler);
  app.use("/api", routes);

  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, name: "agent-log-replayer", version: "0.1.0" });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        port = addr.port;
        baseUrl = `http://127.0.0.1:${port}`;
      }
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe("MCP e2e", () => {
  it("GET /healthz returns 200", async () => {
    const res = await fetch(`${baseUrl}/healthz`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.name).toBe("agent-log-replayer");
  });

  it("tools/list returns 5 tools with annotations", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`${baseUrl}/mcp`)
    );
    const client = new Client({
      name: "test-client",
      version: "0.1.0",
    });
    await client.connect(transport);

    const tools = await client.listTools();
    expect(tools.tools.length).toBe(5);

    const names = tools.tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "audit_summary",
      "get_session",
      "get_timeline",
      "list_sessions",
      "status",
    ]);

    for (const tool of tools.tools) {
      expect(tool.annotations).toBeDefined();
      expect(tool.annotations?.readOnlyHint).toBe(true);
    }

    await client.close();
  });

  it("list_sessions returns array", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`${baseUrl}/mcp`)
    );
    const client = new Client({ name: "test-client", version: "0.1.0" });
    await client.connect(transport);

    const result = await client.callTool({ name: "list_sessions" });
    expect(result.content).toBeDefined();
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      .text;
    const sessions = JSON.parse(text);
    expect(Array.isArray(sessions)).toBe(true);

    await client.close();
  });

  it("status returns replayer ok", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`${baseUrl}/mcp`)
    );
    const client = new Client({ name: "test-client", version: "0.1.0" });
    await client.connect(transport);

    const result = await client.callTool({ name: "status" });
    const text = (result.content as Array<{ type: string; text: string }>)[0]
      .text;
    const status = JSON.parse(text);
    expect(status.replayer).toBe("ok");
    expect(status.broker).toBeDefined();
    expect(typeof status.broker.connected).toBe("boolean");
    expect(typeof status.sessionCount).toBe("number");

    await client.close();
  }, 30000);

  it("get_session with invalid id returns error", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`${baseUrl}/mcp`)
    );
    const client = new Client({ name: "test-client", version: "0.1.0" });
    await client.connect(transport);

    const result = await client.callTool({
      name: "get_session",
      arguments: { sessionId: "nonexistent" },
    });
    expect(result.isError).toBe(true);

    await client.close();
  });

  it("replay://spec resource returns valid JSON", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`${baseUrl}/mcp`)
    );
    const client = new Client({ name: "test-client", version: "0.1.0" });
    await client.connect(transport);

    const resources = await client.listResources();
    const specUri = resources.resources.find((r) => r.uri === "replay://spec");
    expect(specUri).toBeDefined();
    expect(specUri?.mimeType).toBe("application/json");

    const result = await client.readResource({ uri: "replay://spec" });
    const text = result.contents[0].text;
    const spec = JSON.parse(text);
    expect(spec.namespace).toBe("replay");
    expect(spec.name).toBe("agent-log-replayer");
    expect(Array.isArray(spec.capabilities)).toBe(true);
    expect(spec.capabilities.length).toBeGreaterThanOrEqual(8);
    expect(Array.isArray(spec.compositions)).toBe(true);
    expect(spec.health).toBe("/healthz");

    await client.close();
  });

  it("replay://guide resource returns markdown", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`${baseUrl}/mcp`)
    );
    const client = new Client({ name: "test-client", version: "0.1.0" });
    await client.connect(transport);

    const result = await client.readResource({ uri: "replay://guide" });
    const text = result.contents[0].text;
    expect(text).toContain("# replay");
    expect(text).toContain("list_sessions");
    expect(text).toContain("get_session");

    await client.close();
  });

  it("skill://replay-ingest resource returns SKILL.md", async () => {
    const transport = new StreamableHTTPClientTransport(
      new URL(`${baseUrl}/mcp`)
    );
    const client = new Client({ name: "test-client", version: "0.1.0" });
    await client.connect(transport);

    const result = await client.readResource({
      uri: "skill://replay-ingest",
    });
    const text = result.contents[0].text;
    expect(text).toContain("---");
    expect(text).toContain("name: replay-ingest");
    expect(text).toContain("volta:");
    expect(text).toContain("namespace: replay");

    await client.close();
  });
});
