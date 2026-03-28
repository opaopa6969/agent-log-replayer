/**
 * App — React entry point
 *
 * Root component that sets up the main layout:
 * - Left panel: SessionList (live + archived sessions)
 * - Center panel: SessionPlayer (replay with controls) or TerminalView
 * - Right panel: TimelineView + SecurityPanel
 */

import React, { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { SessionList } from "./components/SessionList.js";
import { SessionPlayer } from "./components/SessionPlayer.js";
import { useSessionStore } from "./store/sessionStore.js";

function App(): React.ReactElement {
  const { selectedSessionId, connect } = useSessionStore();

  useEffect(() => {
    connect();
  }, [connect]);

  return (
    <div style={{ display: "flex", height: "100vh", fontFamily: "system-ui, sans-serif" }}>
      {/* Left panel — Session list */}
      <div style={{ width: "300px", borderRight: "1px solid #333", overflow: "auto" }}>
        <SessionList />
      </div>

      {/* Main panel — Player */}
      <div style={{ flex: 1, overflow: "auto" }}>
        {selectedSessionId ? (
          <SessionPlayer sessionId={selectedSessionId} />
        ) : (
          <div style={{ padding: "2rem", color: "#888", textAlign: "center" }}>
            <h2>agent-log-replayer</h2>
            <p>左のリストからセッションを選択してください</p>
          </div>
        )}
      </div>
    </div>
  );
}

// Mount
const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(<App />);
}

export default App;
