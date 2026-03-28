/**
 * SecurityPanel — Security audit view
 *
 * Displays security flags and banned word hits for a session.
 * Data originates from agent-log-broker's redaction pipeline.
 *
 * Concepts inherited from claude-session-replay's session-shipper:
 * - Security analysis (sensitive file access, suspicious commands, external URLs)
 * - Banned word detection and highlighting
 */

import React from "react";

const SEVERITY_COLORS: Record<string, string> = {
  critical: "#f44336",
  warning: "#ff9800",
  info: "#2196f3",
};

interface SecurityPanelProps {
  sessionId: string;
}

export function SecurityPanel({
  sessionId: _sessionId,
}: SecurityPanelProps): React.ReactElement {
  // TODO: Get security data from session store

  return (
    <div style={{ padding: "0.5rem" }}>
      <h4 style={{ margin: "0 0 0.5rem 0", fontSize: "12px", color: "#888" }}>
        Security Audit
      </h4>
      <div style={{ fontSize: "11px", color: "#666" }}>
        {/* Placeholder — will render security flags and banned word hits */}
        No security flags detected.
      </div>

      {/* Severity legend */}
      <div
        style={{
          display: "flex",
          gap: "8px",
          marginTop: "0.5rem",
          fontSize: "10px",
        }}
      >
        {Object.entries(SEVERITY_COLORS).map(([severity, color]) => (
          <span key={severity} style={{ color }}>
            {"\u25CF"} {severity}
          </span>
        ))}
      </div>
    </div>
  );
}
