/**
 * Session Store — Zustand store
 *
 * Client-side state management for sessions and WebSocket connection.
 * Receives real-time updates from the server via WebSocket.
 */

import { create } from "zustand";

export interface SessionSummary {
  sessionId: string;
  agentType: string;
  projectPath: string;
  status: string;
  messageCount: number;
  firstMessageAt: string | null;
  lastMessageAt: string | null;
}

interface SessionStoreState {
  /** All known sessions */
  sessions: SessionSummary[];
  /** Currently selected session ID */
  selectedSessionId: string | null;
  /** WebSocket connection status */
  connected: boolean;
  /** WebSocket instance */
  ws: WebSocket | null;

  /** Connect to the server WebSocket */
  connect: () => void;
  /** Select a session for viewing */
  selectSession: (sessionId: string) => void;
  /** Update sessions from server data */
  setSessions: (sessions: SessionSummary[]) => void;
}

export const useSessionStore = create<SessionStoreState>((set, get) => ({
  sessions: [],
  selectedSessionId: null,
  connected: false,
  ws: null,

  connect: () => {
    if (get().ws) return; // Already connected

    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    const ws = new WebSocket(wsUrl);

    ws.onopen = () => {
      set({ connected: true, ws });
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        if (data.type === "session.list") {
          set({ sessions: data.sessions });
        } else if (data.type === "event") {
          const brokerEvent = data.event as {
            type: string;
            _session?: {
              sessionId: string;
              agentType: string;
              projectPath: string;
            };
            message?: { timestamp: string };
          };
          const { sessions } = get();
          const idx = sessions.findIndex(
            (s) => s.sessionId === data.sessionId
          );

          if (idx >= 0) {
            const updated = [...sessions];
            const current = updated[idx];
            if (brokerEvent.type === "message") {
              updated[idx] = {
                ...current,
                messageCount: current.messageCount + 1,
                status: "active",
              };
            } else if (brokerEvent.type === "session.idle") {
              updated[idx] = { ...current, status: "idle" };
            } else if (brokerEvent.type === "session.lost") {
              updated[idx] = { ...current, status: "lost" };
            }
            // session.discovered on an existing session is a no-op; it is
            // already in the list and carries no new state for the summary.
            set({ sessions: updated });
          } else if (brokerEvent.type === "session.discovered") {
            // New session observed after the initial session.list. The
            // server only sends session.list on connect, so we add the
            // session here to keep the UI in sync without a reload (#26).
            const meta = brokerEvent._session;
            if (meta) {
              set({
                sessions: [
                  ...sessions,
                  {
                    sessionId: meta.sessionId,
                    agentType: meta.agentType,
                    projectPath: meta.projectPath,
                    status: "active",
                    messageCount: 0,
                    firstMessageAt: null,
                    lastMessageAt: null,
                  },
                ],
              });
            }
          }
        }
      } catch {
        // Ignore invalid messages
      }
    };

    ws.onclose = () => {
      set({ connected: false, ws: null });
      // Reconnect after delay
      setTimeout(() => get().connect(), 3000);
    };

    ws.onerror = () => {
      ws.close();
    };
  },

  selectSession: (sessionId: string) => {
    set({ selectedSessionId: sessionId });

    // Subscribe to this session's events via WebSocket
    const { ws } = get();
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: "subscribe", sessionId }));
    }
  },

  setSessions: (sessions: SessionSummary[]) => {
    set({ sessions });
  },
}));
