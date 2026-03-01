import React, { useState, useEffect } from "react";

const BACKEND_URL = "http://localhost:8000";
const API_BASE = `${BACKEND_URL}/api/v1`;
const EXTENSION_KEY = "hackathon-focus-123";

const apiHeaders = {
  "Content-Type": "application/json",
  "X-Extension-Key": EXTENSION_KEY,
};

export default function App() {
  const [goal, setGoal] = useState("");
  const [sessionActive, setSessionActive] = useState(false);
  const [savedGoal, setSavedGoal] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [backendOnline, setBackendOnline] = useState(null); // null=checking, true, false

  // ── On popup open: restore session state + check backend health ──
  useEffect(() => {
    chrome.storage.local.get(["goal", "sessionActive", "backendOnline"], (data) => {
      if (data.sessionActive) {
        setSessionActive(true);
        setSavedGoal(data.goal || "");
        setGoal(data.goal || "");
      }
      if (data.backendOnline !== undefined) setBackendOnline(data.backendOnline);
    });

    // Ping the backend health endpoint
    fetch(`${BACKEND_URL}/health`)
      .then((r) => setBackendOnline(r.ok))
      .catch(() => setBackendOnline(false));
  }, []);

  const handleStartSession = async () => {
    const trimmed = goal.trim();
    if (!trimmed) return;

    setLoading(true);
    setError("");

    chrome.storage.local.set({
      goal: trimmed,
      sessionActive: true,
      startTime: Date.now(),
      alignedTime: 0,
      driftCount: 0,
    }, () => {
      chrome.runtime.sendMessage({ type: "START_SESSION", goal: trimmed }, (resp) => {
        void chrome.runtime.lastError;
        // After start, re-check backend status from storage
        chrome.storage.local.get("backendOnline", (d) => {
          if (d.backendOnline !== undefined) setBackendOnline(d.backendOnline);
        });
        console.log("[Focus] Session started — goal:", trimmed);
        setSessionActive(true);
        setSavedGoal(trimmed);
        setLoading(false);
      });
    });
  };

  const handleEndSession = async () => {
    setLoading(true);
    setError("");

    // Read session_id before clearing storage
    chrome.storage.local.get(["sessionId"], async ({ sessionId }) => {
      try {
        // 1. Notify backend to close the session (non-blocking)
        if (sessionId) {
          await fetch(`${API_BASE}/session/end`, {
            method: "POST",
            headers: apiHeaders,
            body: JSON.stringify({ session_id: sessionId }),
          }).catch(() => { }); // don't block UI on network error
        }
      } finally {
        // 2. Always clear local state, even if the API call failed
        chrome.storage.local.set({ sessionActive: false, sessionId: null }, () => {
          chrome.runtime.sendMessage({ type: "END_SESSION" }, () => {
            void chrome.runtime.lastError;
          });
          console.log("[Focus] Session ended.");
          setSessionActive(false);
          setSavedGoal("");
          setGoal("");
          setLoading(false);
        });
      }
    });
  };

  // Backend status label
  const backendLabel =
    backendOnline === null ? "Checking…" :
      backendOnline ? "Backend ✅" :
        "Backend ✖ Offline";
  const backendColor =
    backendOnline === null ? "#aaa" :
      backendOnline ? "#86efac" :
        "#fca5a5";

  return (
    <div className="popup-container">

      {/* ── Header ── */}
      <header className="popup-header">
        <span className="logo">🎯</span>
        <h1>Focus Assistant</h1>
        <span className={`status-dot ${sessionActive ? "active" : ""}`} />
      </header>

      {/* ── Backend status pill ── */}
      <div style={{
        textAlign: "center",
        fontSize: "11px",
        fontWeight: 600,
        color: backendColor,
        margin: "0 0 6px",
        letterSpacing: "0.4px",
      }}>
        {backendLabel}
      </div>

      {/* ── Active session banner ── */}
      {sessionActive && (
        <div className="session-banner">
          <span className="session-banner-label">Active goal</span>
          <span className="session-banner-goal">"{savedGoal}"</span>
        </div>
      )}

      {/* ── Error message ── */}
      {error && <div className="error-msg">{error}</div>}

      {/* ── Goal Input ── */}
      <section className="popup-body">
        <label htmlFor="goal-input" className="label">
          What are you working on?
        </label>
        <input
          id="goal-input"
          className="goal-input"
          type="text"
          placeholder="Enter your goal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleStartSession()}
          disabled={sessionActive || loading}
        />
      </section>

      {/* ── Action Buttons ── */}
      <footer className="popup-footer">
        <button
          className="btn btn-primary"
          onClick={handleStartSession}
          disabled={sessionActive || !goal.trim() || loading}
        >
          {loading && !sessionActive ? "Starting…" : "Start Session"}
        </button>
        <button
          className="btn btn-secondary"
          onClick={handleEndSession}
          disabled={!sessionActive || loading}
        >
          {loading && sessionActive ? "Ending…" : "End Session"}
        </button>
      </footer>

    </div>
  );
}
