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
          // Update session in list when we receive an event
          const { sessions } = get();
          const idx = sessions.findIndex(
            (s) => s.sessionId === data.sessionId
          );
          if (idx >= 0) {
            // Session exists, update message count
            const updated = [...sessions];
            updated[idx] = {
              ...updated[idx],
              messageCount: updated[idx].messageCount + 1,
              status: "active",
            };
            set({ sessions: updated });
          }
          // New session events are handled by session.list updates
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
