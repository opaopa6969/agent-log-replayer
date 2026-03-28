/**
 * REST API Routes
 *
 * Endpoints:
 *   POST /api/broker/callback    — Receives BrokerEvents from agent-log-broker
 *   GET  /api/sessions           — List all sessions
 *   GET  /api/sessions/:id       — Get session detail with messages
 *   GET  /api/sessions/:id/timeline — Get timeline events for a session
 *   GET  /api/status             — Health check / connection status
 */

import { Router } from "express";
import type { Request, Response } from "express";
import type { SessionManager } from "../consumer/session-manager.js";
import type { BrokerClient, BrokerEvent } from "../consumer/broker-client.js";
import type { WebSocketHandler } from "./websocket.js";
import { buildTimeline } from "../renderer/timeline-renderer.js";

export function createRoutes(
  sessionManager: SessionManager,
  brokerClient: BrokerClient,
  _wsHandler: WebSocketHandler
): Router {
  const router = Router();

  /**
   * POST /api/broker/callback
   * Receives BrokerEvents from agent-log-broker.
   * Must return 2xx for successful delivery.
   */
  router.post("/broker/callback", (req: Request, res: Response) => {
    try {
      const event = req.body as BrokerEvent;

      if (!event._broker || !event._session || !event.type) {
        res.status(400).json({ error: "Invalid BrokerEvent format" });
        return;
      }

      sessionManager.handleEvent(event);
      res.status(200).json({ ok: true });
    } catch (err) {
      console.error("Error processing broker callback:", err);
      res.status(500).json({ error: "Internal error" });
    }
  });

  /**
   * GET /api/sessions
   * List all known sessions (active + archived).
   */
  router.get("/sessions", (_req: Request, res: Response) => {
    const sessions = sessionManager.getAllSessions().map((s) => ({
      sessionId: s.sessionId,
      agentType: s.agentType,
      projectPath: s.projectPath,
      status: s.status,
      messageCount: s.messageCount,
      firstMessageAt: s.firstMessageAt,
      lastMessageAt: s.lastMessageAt,
      hasSecurityFlags: s.securityFlags.length > 0,
      hasBannedWords: s.bannedWordHits.length > 0,
    }));
    res.json(sessions);
  });

  /**
   * GET /api/sessions/:id
   * Get full session data including messages.
   */
  router.get("/sessions/:id", (req: Request, res: Response) => {
    const session = sessionManager.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json(session);
  });

  /**
   * GET /api/sessions/:id/timeline
   * Get structured timeline events for a session.
   */
  router.get("/sessions/:id/timeline", (req: Request, res: Response) => {
    const session = sessionManager.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    const timeline = buildTimeline(session.messages);
    res.json(timeline);
  });

  /**
   * GET /api/status
   * Health check and broker connection status.
   */
  router.get("/status", async (_req: Request, res: Response) => {
    const brokerStatus = await brokerClient.checkStatus();
    res.json({
      replayer: "ok",
      broker: brokerStatus,
      subscribed: brokerClient.isSubscribed(),
      consumerId: brokerClient.getConsumerId(),
      sessionCount: sessionManager.getAllSessions().length,
    });
  });

  return router;
}
