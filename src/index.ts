/**
 * agent-log-replayer — Entry point
 *
 * Express server + WebSocket server.
 * Subscribes to agent-log-broker as a consumer,
 * persists sessions to SQLite, and streams events
 * to browser clients via WebSocket.
 */

import express from "express";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { BrokerClient } from "./consumer/broker-client.js";
import { SessionManager } from "./consumer/session-manager.js";
import { SessionStore } from "./storage/session-store.js";
import { createRoutes } from "./api/routes.js";
import { setupWebSocket } from "./api/websocket.js";
import { createMcpHandler } from "./mcp/server.js";

export interface ServerConfig {
  port: number;
  brokerUrl: string;
  callbackUrl: string;
  dbPath: string;
}

function loadConfig(): ServerConfig {
  return {
    port: parseInt(process.env.PORT ?? "3200", 10),
    brokerUrl: process.env.BROKER_URL ?? "http://localhost:3100",
    callbackUrl:
      process.env.CALLBACK_URL ??
      "http://localhost:3200/api/broker/callback",
    dbPath: process.env.DB_PATH ?? "./data/sessions.db",
  };
}

async function main(): Promise<void> {
  const config = loadConfig();

  // Storage
  const store = new SessionStore(config.dbPath);

  // Session manager (in-memory state + persistence)
  const sessionManager = new SessionManager(store);

  // Broker client (subscribes to agent-log-broker)
  const brokerClient = new BrokerClient({
    brokerUrl: config.brokerUrl,
    callbackUrl: config.callbackUrl,
  });

  // Express app
  const app = express();

  // MCP handler must run BEFORE express.json() to avoid consuming the raw body
  const mcpHandler = createMcpHandler({ sessionManager, brokerClient });
  app.use(async (req, res, next) => {
    if (req.url === "/mcp") {
      return mcpHandler(req, res);
    }
    next();
  });

  app.use(express.json({ limit: "10mb" }));

  // HTTP server (shared between Express and WebSocket)
  const server = createServer(app);

  // WebSocket server for browser clients
  const wss = new WebSocketServer({ server, path: "/ws" });
  const wsHandler = setupWebSocket(wss, sessionManager);

  // REST API routes
  const routes = createRoutes(sessionManager, brokerClient, wsHandler);
  app.use("/api", routes);

  // Health check (volta convention)
  app.get("/healthz", (_req, res) => {
    res.json({ ok: true, name: "agent-log-replayer", version: "0.1.0" });
  });

  // Serve frontend static files in production
  app.use(express.static("frontend/dist"));

  // Load archived sessions from storage (BUG-003 fix)
  await sessionManager.loadFromStore();

  // Subscribe to broker on startup
  try {
    await brokerClient.subscribe();
    console.log(`Subscribed to broker at ${config.brokerUrl}`);
  } catch (err) {
    console.warn("Failed to subscribe to broker (will retry):", err);
  }

  server.listen(config.port, "0.0.0.0", () => {
    console.log(`agent-log-replayer listening on port ${config.port}`);
    console.log(`WebSocket endpoint: ws://localhost:${config.port}/ws`);
    console.log(`MCP endpoint: http://localhost:${config.port}/mcp`);
    console.log(`Health: http://localhost:${config.port}/healthz`);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
