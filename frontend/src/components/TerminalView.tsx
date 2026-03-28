/**
 * TerminalView — Terminal output rendering
 *
 * Renders agent session messages in a terminal-style view
 * using xterm.js concepts. Displays messages up to the
 * current playback position.
 *
 * Visual style inherited from claude-session-replay's Terminal format:
 * - User input: ">" prompt with blue background
 * - Assistant text: orange left border
 * - Tool blocks with icons
 */

import React from "react";

interface TerminalViewProps {
  sessionId: string;
  visibleUpTo: number;
}

export function TerminalView({
  sessionId: _sessionId,
  visibleUpTo: _visibleUpTo,
}: TerminalViewProps): React.ReactElement {
  // TODO: Integrate with session store to get messages
  // TODO: Integrate xterm.js for full terminal emulation

  return (
    <div
      style={{
        backgroundColor: "#1a1a2e",
        color: "#e0e0e0",
        fontFamily: "'Cascadia Code', 'Fira Code', 'Consolas', monospace",
        fontSize: "13px",
        lineHeight: "1.5",
        padding: "1rem",
        minHeight: "100%",
      }}
    >
      <div style={{ color: "#666", fontStyle: "italic" }}>
        {/* Placeholder — will render messages from session store */}
        Terminal view will render here. Session messages displayed up to current playback position.
      </div>
    </div>
  );
}
