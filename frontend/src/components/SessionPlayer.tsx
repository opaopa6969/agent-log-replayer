/**
 * SessionPlayer — Replay player with playback controls
 *
 * Provides play/pause, step forward/backward, seek, and speed controls.
 * Inherits playback concepts from claude-session-replay's Player format:
 * - Uniform, real-time, and compressed playback modes
 * - Speed slider (0.25x to 16x)
 * - Keyboard shortcuts (Space, arrows, Home/End)
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { TerminalView } from "./TerminalView.js";
import { TimelineView } from "./TimelineView.js";
import { SecurityPanel } from "./SecurityPanel.js";
import { useSessionStore } from "../store/sessionStore.js";

export type PlaybackMode = "uniform" | "realtime" | "compressed";

interface PlaybackState {
  playing: boolean;
  currentIndex: number;
  speed: number;
  mode: PlaybackMode;
}

export function SessionPlayer({
  sessionId,
}: {
  sessionId: string;
}): React.ReactElement {
  const { sessions } = useSessionStore();
  const session = sessions.find((s) => s.sessionId === sessionId);

  const [playback, setPlayback] = useState<PlaybackState>({
    playing: false,
    currentIndex: 0,
    speed: 1,
    mode: "uniform",
  });

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const totalMessages = session?.messageCount ?? 0;

  // Playback logic
  const advance = useCallback(() => {
    setPlayback((prev) => {
      if (prev.currentIndex >= totalMessages - 1) {
        return { ...prev, playing: false };
      }
      return { ...prev, currentIndex: prev.currentIndex + 1 };
    });
  }, [totalMessages]);

  useEffect(() => {
    if (!playback.playing) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    const interval =
      playback.mode === "uniform" ? 800 / playback.speed : 800 / playback.speed;

    timerRef.current = setTimeout(advance, interval);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [playback.playing, playback.currentIndex, playback.speed, playback.mode, advance]);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      switch (e.key) {
        case " ":
          e.preventDefault();
          setPlayback((p) => ({ ...p, playing: !p.playing }));
          break;
        case "ArrowRight":
          setPlayback((p) => ({
            ...p,
            playing: false,
            currentIndex: Math.min(p.currentIndex + 1, totalMessages - 1),
          }));
          break;
        case "ArrowLeft":
          setPlayback((p) => ({
            ...p,
            playing: false,
            currentIndex: Math.max(p.currentIndex - 1, 0),
          }));
          break;
        case "Home":
          setPlayback((p) => ({ ...p, playing: false, currentIndex: 0 }));
          break;
        case "End":
          setPlayback((p) => ({
            ...p,
            playing: false,
            currentIndex: totalMessages - 1,
          }));
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [totalMessages]);

  if (!session) {
    return <div style={{ padding: "1rem", color: "#888" }}>Session not found</div>;
  }

  const progress =
    totalMessages > 0
      ? ((playback.currentIndex + 1) / totalMessages) * 100
      : 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Controls bar */}
      <div
        style={{
          padding: "0.5rem 1rem",
          borderBottom: "1px solid #333",
          display: "flex",
          alignItems: "center",
          gap: "1rem",
          fontSize: "13px",
        }}
      >
        <button
          onClick={() => setPlayback((p) => ({ ...p, playing: !p.playing }))}
          style={{ padding: "4px 12px", cursor: "pointer" }}
        >
          {playback.playing ? "Pause" : "Play"}
        </button>

        <button
          onClick={() =>
            setPlayback((p) => ({
              ...p,
              playing: false,
              currentIndex: Math.max(p.currentIndex - 1, 0),
            }))
          }
          style={{ cursor: "pointer" }}
        >
          Prev
        </button>

        <button
          onClick={() =>
            setPlayback((p) => ({
              ...p,
              playing: false,
              currentIndex: Math.min(p.currentIndex + 1, totalMessages - 1),
            }))
          }
          style={{ cursor: "pointer" }}
        >
          Next
        </button>

        <span style={{ color: "#aaa" }}>
          {playback.currentIndex + 1} / {totalMessages}
        </span>

        {/* Progress bar */}
        <div
          style={{
            flex: 1,
            height: "6px",
            backgroundColor: "#333",
            borderRadius: "3px",
            cursor: "pointer",
          }}
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const ratio = (e.clientX - rect.left) / rect.width;
            setPlayback((p) => ({
              ...p,
              playing: false,
              currentIndex: Math.round(ratio * (totalMessages - 1)),
            }));
          }}
        >
          <div
            style={{
              width: `${progress}%`,
              height: "100%",
              backgroundColor: "#4caf50",
              borderRadius: "3px",
              transition: "width 0.1s",
            }}
          />
        </div>

        {/* Speed */}
        <label style={{ color: "#aaa" }}>
          {playback.speed}x
          <input
            type="range"
            min="0.25"
            max="16"
            step="0.25"
            value={playback.speed}
            onChange={(e) =>
              setPlayback((p) => ({ ...p, speed: parseFloat(e.target.value) }))
            }
            style={{ width: "80px", marginLeft: "4px" }}
          />
        </label>

        {/* Playback mode */}
        <select
          value={playback.mode}
          onChange={(e) =>
            setPlayback((p) => ({ ...p, mode: e.target.value as PlaybackMode }))
          }
          style={{ fontSize: "12px" }}
        >
          <option value="uniform">Uniform</option>
          <option value="realtime">Real-time</option>
          <option value="compressed">Compressed</option>
        </select>
      </div>

      {/* Main content area */}
      <div style={{ flex: 1, display: "flex", overflow: "hidden" }}>
        {/* Terminal / message view */}
        <div style={{ flex: 1, overflow: "auto" }}>
          <TerminalView
            sessionId={sessionId}
            visibleUpTo={playback.currentIndex}
          />
        </div>

        {/* Side panel: timeline + security */}
        <div
          style={{
            width: "280px",
            borderLeft: "1px solid #333",
            overflow: "auto",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <TimelineView
            sessionId={sessionId}
            currentIndex={playback.currentIndex}
            onSeek={(index) =>
              setPlayback((p) => ({ ...p, playing: false, currentIndex: index }))
            }
          />
          <SecurityPanel sessionId={sessionId} />
        </div>
      </div>
    </div>
  );
}
