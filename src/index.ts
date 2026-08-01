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
import { BrokerClient, getOrCreateConsumerId } from "./consumer/broker-client.js";
import { SessionManager } from "./consumer/session-manager.js";
import { SessionStore } from "./storage/session-store.js";
import { createRoutes } from "./api/routes.js";
import { setupWebSocket } from "./api/websocket.js";

export interface ServerConfig {
  port: number;
  brokerUrl: string;
  callbackUrl: string;
  dbPath: string;
  consumerId?: string;
}

function loadConfig(): ServerConfig {
  return {
    port: parseInt(process.env.PORT ?? "3200", 10),
    brokerUrl: process.env.BROKER_URL ?? "http://localhost:3100",
    callbackUrl:
      process.env.CALLBACK_URL ??
      "http://localhost:3200/api/broker/callback",
    dbPath: process.env.DB_PATH ?? "./data/sessions.db",
    consumerId: process.env.CONSUMER_ID,
  };
}

async function main(): Promise<void> {
  const config = loadConfig();

  // Storage
  const store = new SessionStore(config.dbPath);

  // Session manager (in-memory state + persistence)
  const sessionManager = new SessionManager(store);

  // Restore archived sessions from storage before subscribing to broker
  await sessionManager.loadFromStore();

  // Express app
  const app = express();
  app.use(express.json({ limit: "10mb" }));

  // HTTP server (shared between Express and WebSocket)
  const server = createServer(app);

  // WebSocket server for browser clients
  const wss = new WebSocketServer({ server, path: "/ws" });
  const wsHandler = setupWebSocket(wss, sessionManager);

  // Broker client (subscribes to agent-log-broker)
  const brokerClient = new BrokerClient({
    brokerUrl: config.brokerUrl,
    callbackUrl: config.callbackUrl,
    consumerId: config.consumerId ?? getOrCreateConsumerId("data/consumer-id.txt"),
  });

  // REST API routes
  const routes = createRoutes(sessionManager, brokerClient, wsHandler);
  app.use("/api", routes);

  // Serve frontend static files in production
  app.use(express.static("frontend/dist"));

  // SPA fallback: return index.html for non-API routes (#12)
  app.get("*", (_req, res) => res.sendFile("frontend/dist/index.html"));

  // Subscribe to broker on startup
  try {
    await brokerClient.subscribe();
    console.log(`Subscribed to broker at ${config.brokerUrl}`);
  } catch (err) {
    console.warn("Failed to subscribe to broker (will retry):", err);
  }

  server.listen(config.port, () => {
    console.log(`agent-log-replayer listening on port ${config.port}`);
    console.log(`WebSocket endpoint: ws://localhost:${config.port}/ws`);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
