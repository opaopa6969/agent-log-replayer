/**
 * SessionList — List of sessions (live + archived)
 *
 * Displays all known sessions with status indicators.
 * Active sessions show a live indicator.
 * Clicking a session selects it for playback.
 */

import React from "react";
import { useSessionStore, type SessionSummary } from "../store/sessionStore.js";

const STATUS_COLORS: Record<string, string> = {
  active: "#4caf50",
  idle: "#ff9800",
  lost: "#f44336",
  archived: "#9e9e9e",
};

export function SessionList(): React.ReactElement {
  const { sessions, selectedSessionId, selectSession } = useSessionStore();

  return (
    <div style={{ padding: "0.5rem" }}>
      <h3 style={{ margin: "0.5rem 0", fontSize: "14px", color: "#ccc" }}>
        Sessions ({sessions.length})
      </h3>
      <div>
        {sessions.map((session) => (
          <SessionItem
            key={session.sessionId}
            session={session}
            selected={session.sessionId === selectedSessionId}
            onClick={() => selectSession(session.sessionId)}
          />
        ))}
        {sessions.length === 0 && (
          <div style={{ padding: "1rem", color: "#666", fontSize: "13px" }}>
            broker からのイベントを待機中...
          </div>
        )}
      </div>
    </div>
  );
}

function SessionItem({
  session,
  selected,
  onClick,
}: {
  session: SessionSummary;
  selected: boolean;
  onClick: () => void;
}): React.ReactElement {
  const statusColor = STATUS_COLORS[session.status] ?? "#666";

  return (
    <div
      onClick={onClick}
      style={{
        padding: "0.5rem",
        marginBottom: "2px",
        cursor: "pointer",
        borderRadius: "4px",
        backgroundColor: selected ? "#1a3a5c" : "transparent",
        borderLeft: `3px solid ${statusColor}`,
      }}
    >
      <div style={{ fontSize: "12px", fontWeight: "bold", color: "#ddd" }}>
        {session.agentType} - {session.projectPath.split("/").pop() || "unknown"}
      </div>
      <div style={{ fontSize: "11px", color: "#888", marginTop: "2px" }}>
        {session.messageCount} msgs | {session.status}
        {session.status === "active" && " \u25CF"}
      </div>
      <div style={{ fontSize: "10px", color: "#666", marginTop: "2px" }}>
        {session.sessionId.slice(0, 12)}...
      </div>
    </div>
  );
}
