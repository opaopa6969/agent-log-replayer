/**
 * TimelineView — Event timeline
 *
 * Displays a vertical timeline of session events:
 * user messages, assistant messages, tool calls, thinking blocks.
 * Clicking an event seeks the player to that position.
 */

import React from "react";

const KIND_COLORS: Record<string, string> = {
  user_message: "#4caf50",
  assistant_message: "#2196f3",
  tool_use: "#ff9800",
  thinking: "#9c27b0",
  session_start: "#666",
  session_idle: "#666",
  session_end: "#666",
};

interface TimelineViewProps {
  sessionId: string;
  currentIndex: number;
  onSeek: (messageIndex: number) => void;
}

export function TimelineView({
  sessionId: _sessionId,
  currentIndex: _currentIndex,
  onSeek: _onSeek,
}: TimelineViewProps): React.ReactElement {
  // TODO: Fetch timeline data from /api/sessions/:id/timeline

  return (
    <div style={{ padding: "0.5rem", borderBottom: "1px solid #333" }}>
      <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "12px", color: "#888" }}>
        Timeline
      </h4>
      <div style={{ fontSize: "11px", color: "#666" }}>
        {/* Placeholder — will render timeline events */}
        Timeline events will appear here.
      </div>

      {/* Legend */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          flexWrap: "wrap",
          marginTop: "0.5rem",
          fontSize: "10px",
        }}
      >
        {Object.entries(KIND_COLORS).map(([kind, color]) => (
          <span key={kind} style={{ color }}>
            {"\u25CF"} {kind.replace("_", " ")}
          </span>
        ))}
      </div>
    </div>
  );
}
