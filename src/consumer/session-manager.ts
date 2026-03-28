/**
 * Session Manager
 *
 * Manages active session state in memory and persists to SQLite.
 * Receives BrokerEvents and maintains per-session message arrays.
 * Notifies listeners (WebSocket) of new events.
 */

import type { BrokerEvent, AgentMessage } from "./broker-client.js";
import type { SessionStore, StoredSession } from "../storage/session-store.js";

export type SessionStatus = "active" | "idle" | "lost" | "archived";

export interface ActiveSession {
  sessionId: string;
  agentType: string;
  projectPath: string;
  status: SessionStatus;
  messages: AgentMessage[];
  securityFlags: unknown[];
  bannedWordHits: unknown[];
  firstMessageAt: string | null;
  lastMessageAt: string | null;
  messageCount: number;
}

export type SessionEventListener = (
  event: BrokerEvent,
  session: ActiveSession
) => void;

export class SessionManager {
  private sessions = new Map<string, ActiveSession>();
  private listeners: SessionEventListener[] = [];
  private store: SessionStore;

  constructor(store: SessionStore) {
    this.store = store;
  }

  /**
   * Process an incoming BrokerEvent.
   * Updates session state and notifies listeners.
   */
  handleEvent(event: BrokerEvent): void {
    const sessionId = event._session.sessionId;

    switch (event.type) {
      case "session.discovered":
        this.ensureSession(event);
        break;

      case "message":
        this.handleMessage(event);
        break;

      case "session.idle":
        this.updateStatus(sessionId, "idle");
        break;

      case "session.lost":
        this.updateStatus(sessionId, "lost");
        break;
    }

    const session = this.sessions.get(sessionId);
    if (session) {
      this.notifyListeners(event, session);
    }
  }

  /**
   * Add a listener for session events (used by WebSocket handler).
   */
  addListener(listener: SessionEventListener): void {
    this.listeners.push(listener);
  }

  /**
   * Remove a listener.
   */
  removeListener(listener: SessionEventListener): void {
    const idx = this.listeners.indexOf(listener);
    if (idx >= 0) this.listeners.splice(idx, 1);
  }

  /**
   * Get all known sessions (active + archived from store).
   */
  getAllSessions(): ActiveSession[] {
    return [...this.sessions.values()];
  }

  /**
   * Get a specific session by ID.
   */
  getSession(sessionId: string): ActiveSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Load archived sessions from storage on startup.
   */
  async loadFromStore(): Promise<void> {
    const stored = this.store.listSessions();
    for (const s of stored) {
      if (!this.sessions.has(s.sessionId)) {
        this.sessions.set(s.sessionId, {
          sessionId: s.sessionId,
          agentType: s.agentType,
          projectPath: s.projectPath,
          status: "archived",
          messages: this.store.getMessages(s.sessionId),
          securityFlags: [],
          bannedWordHits: [],
          firstMessageAt: s.firstMessageAt,
          lastMessageAt: s.lastMessageAt,
          messageCount: s.messageCount,
        });
      }
    }
  }

  // ── Private ──

  private ensureSession(event: BrokerEvent): ActiveSession {
    const sessionId = event._session.sessionId;
    let session = this.sessions.get(sessionId);

    if (!session) {
      session = {
        sessionId,
        agentType: event._session.agentType,
        projectPath: event._session.projectPath,
        status: "active",
        messages: [],
        securityFlags: [],
        bannedWordHits: [],
        firstMessageAt: null,
        lastMessageAt: null,
        messageCount: 0,
      };
      this.sessions.set(sessionId, session);
      this.store.upsertSession(session);
    }

    return session;
  }

  private handleMessage(event: BrokerEvent): void {
    const session = this.ensureSession(event);

    if (event.message) {
      session.messages.push(event.message);
      session.messageCount++;
      session.lastMessageAt = event.message.timestamp;
      if (!session.firstMessageAt) {
        session.firstMessageAt = event.message.timestamp;
      }
      session.status = "active";

      // Persist message
      this.store.addMessage(session.sessionId, event.message);
      this.store.upsertSession(session);
    }

    // Accumulate security data
    if (event.securityFlags) {
      session.securityFlags.push(...event.securityFlags);
    }
    if (event.bannedWordHits) {
      session.bannedWordHits.push(...event.bannedWordHits);
    }
  }

  private updateStatus(sessionId: string, status: SessionStatus): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.status = status;
      this.store.upsertSession(session);
    }
  }

  private notifyListeners(event: BrokerEvent, session: ActiveSession): void {
    for (const listener of this.listeners) {
      try {
        listener(event, session);
      } catch (err) {
        console.error("Session event listener error:", err);
      }
    }
  }
}
