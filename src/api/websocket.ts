/**
 * WebSocket Handler
 *
 * Streams real-time session events to connected browser clients.
 * Clients can subscribe to specific sessions or receive all events.
 *
 * Protocol (server → client):
 *   { type: "event", sessionId, event: BrokerEvent }
 *   { type: "session.list", sessions: ActiveSession[] }
 *   { type: "error", message: string }
 *
 * Protocol (client → server):
 *   { type: "subscribe", sessionId?: string }   — subscribe to session (or all)
 *   { type: "unsubscribe" }                     — stop receiving events
 */

import type { WebSocketServer, WebSocket } from "ws";
import type { SessionManager, ActiveSession } from "../consumer/session-manager.js";
import type { BrokerEvent } from "../consumer/broker-client.js";

interface ClientState {
  ws: WebSocket;
  subscribedSessionId: string | null; // null = all sessions
}

interface ClientMessage {
  type: "subscribe" | "unsubscribe";
  sessionId?: string;
}

export interface WebSocketHandler {
  /** Number of connected clients */
  clientCount(): number;
}

export function setupWebSocket(
  wss: WebSocketServer,
  sessionManager: SessionManager
): WebSocketHandler {
  const clients = new Set<ClientState>();

  // Listen for session events and forward to WebSocket clients
  sessionManager.addListener(
    (event: BrokerEvent, session: ActiveSession) => {
      const payload = JSON.stringify({
        type: "event",
        sessionId: session.sessionId,
        event,
      });

      for (const client of clients) {
        if (
          client.subscribedSessionId === null ||
          client.subscribedSessionId === session.sessionId
        ) {
          try {
            client.ws.send(payload);
          } catch {
            // Client disconnected, will be cleaned up
          }
        }
      }
    }
  );

  wss.on("connection", (ws: WebSocket) => {
    const client: ClientState = {
      ws,
      subscribedSessionId: null, // default: all sessions
    };
    clients.add(client);

    // Send current session list on connect
    const sessions = sessionManager.getAllSessions();
    ws.send(
      JSON.stringify({
        type: "session.list",
        sessions: sessions.map((s) => ({
          sessionId: s.sessionId,
          agentType: s.agentType,
          projectPath: s.projectPath,
          status: s.status,
          messageCount: s.messageCount,
          firstMessageAt: s.firstMessageAt,
          lastMessageAt: s.lastMessageAt,
        })),
      })
    );

    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(String(data)) as ClientMessage;

        if (msg.type === "subscribe") {
          client.subscribedSessionId = msg.sessionId ?? null;
        } else if (msg.type === "unsubscribe") {
          client.subscribedSessionId = null;
        }
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
      }
    });

    ws.on("close", () => {
      clients.delete(client);
    });
  });

  return {
    clientCount: () => clients.size,
  };
}
