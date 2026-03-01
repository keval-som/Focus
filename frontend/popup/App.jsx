import React, { useState, useEffect } from "react";

const API_BASE        = "http://localhost:8000/api/v1";
const EXTENSION_KEY   = "hackathon-focus-123";

const apiHeaders = {
  "Content-Type":    "application/json",
  "X-Extension-Key": EXTENSION_KEY,
};

export default function App() {
  const [goal, setGoal]               = useState("");
  const [sessionActive, setSessionActive] = useState(false);
  const [savedGoal, setSavedGoal]     = useState("");
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState("");

  // On popup open, restore existing session state from storage
  useEffect(() => {
    chrome.storage.local.get(["goal", "sessionActive", "sessionId"], (data) => {
      if (data.sessionActive) {
        setSessionActive(true);
        setSavedGoal(data.goal || "");
        setGoal(data.goal || "");
      }
    });
  }, []);

  const handleStartSession = async () => {
    const trimmed = goal.trim();
    if (!trimmed) return;

    setLoading(true);
    setError("");

    try {
      // 1. Call backend to create a session and get a session_id
      const res = await fetch(`${API_BASE}/session/start`, {
        method:  "POST",
        headers: apiHeaders,
        body:    JSON.stringify({ goal: trimmed }),
      });

      if (!res.ok) throw new Error(`Server error: ${res.status}`);
      const { session_id } = await res.json();

      // 2. Persist session state + session_id so background and content scripts can use it
      chrome.storage.local.set({
        goal:          trimmed,
        sessionActive: true,
        sessionId:     session_id,
        startTime:     Date.now(),
        alignedTime:   0,
        driftCount:    0,
      }, () => {
        // 3. Tell the background worker to start tab tracking
        chrome.runtime.sendMessage({ type: "START_SESSION", goal: trimmed }, () => {
          void chrome.runtime.lastError;
        });
        console.log("[Focus] Session started — id:", session_id, "goal:", trimmed);
        setSessionActive(true);
        setSavedGoal(trimmed);
      });

    } catch (err) {
      console.error("[Focus] Failed to start session:", err);
      setError("Could not reach server. Is the backend running?");
    } finally {
      setLoading(false);
    }
  };

  const handleEndSession = async () => {
    setLoading(true);
    setError("");

    // Read session_id before clearing storage
    chrome.storage.local.get(["sessionId"], async ({ sessionId }) => {
      try {
        // 1. Notify backend to close the session
        if (sessionId) {
          await fetch(`${API_BASE}/session/end`, {
            method:  "POST",
            headers: apiHeaders,
            body:    JSON.stringify({ session_id: sessionId }),
          }).catch(() => {}); // non-blocking — don't block UI on network error
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

  return (
    <div className="popup-container">

      {/* ── Header ── */}
      <header className="popup-header">
        <span className="logo">🎯</span>
        <h1>Focus Assistant</h1>
        <span className={`status-dot ${sessionActive ? "active" : ""}`} />
      </header>

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
