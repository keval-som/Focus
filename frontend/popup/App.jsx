import React, { useState, useEffect } from "react";

export default function App() {
  const [goal, setGoal]               = useState("");
  const [sessionActive, setSessionActive] = useState(false);
  const [savedGoal, setSavedGoal]     = useState("");

  // On popup open, read existing session state from storage
  useEffect(() => {
    chrome.storage.local.get(["goal", "sessionActive"], (data) => {
      if (data.sessionActive) {
        setSessionActive(true);
        setSavedGoal(data.goal || "");
        setGoal(data.goal || "");
      }
    });
  }, []);

  const handleStartSession = () => {
    const trimmed = goal.trim();
    if (!trimmed) return;

    // 1. Write session state to storage (content script reads this on page load)
    chrome.storage.local.set({
      goal:          trimmed,
      sessionActive: true,
      startTime:     Date.now(),
      alignedTime:   0,
      driftCount:    0,
    }, () => {
      // 2. Tell the background service worker to start tab tracking
      chrome.runtime.sendMessage({ type: "START_SESSION", goal: trimmed }, () => {
        void chrome.runtime.lastError; // suppress if SW is waking up
      });

      console.log("[Focus] Session started with goal:", trimmed);
      setSessionActive(true);
      setSavedGoal(trimmed);
    });
  };

  const handleEndSession = () => {
    // 1. Update storage so all content scripts drop back to "Goal: None"
    chrome.storage.local.set({ sessionActive: false }, () => {
      // 2. Tell the background service worker to stop tracking
      chrome.runtime.sendMessage({ type: "END_SESSION" }, () => {
        void chrome.runtime.lastError;
      });

      console.log("[Focus] Session ended.");
      setSessionActive(false);
      setSavedGoal("");
      setGoal("");
    });
  };

  return (
    <div className="popup-container">

      {/* ── Header ── */}
      <header className="popup-header">
        <span className="logo">🎯</span>
        <h1>Focus Assistant</h1>
        {/* Live session indicator dot */}
        <span className={`status-dot ${sessionActive ? "active" : ""}`} />
      </header>

      {/* ── Active session banner ── */}
      {sessionActive && (
        <div className="session-banner">
          <span className="session-banner-label">Active goal</span>
          <span className="session-banner-goal">"{savedGoal}"</span>
        </div>
      )}

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
          // Allow pressing Enter to start session
          onKeyDown={(e) => e.key === "Enter" && handleStartSession()}
          disabled={sessionActive}
        />
      </section>

      {/* ── Action Buttons ── */}
      <footer className="popup-footer">
        <button
          className="btn btn-primary"
          onClick={handleStartSession}
          disabled={sessionActive || !goal.trim()}
        >
          Start Session
        </button>
        <button
          className="btn btn-secondary"
          onClick={handleEndSession}
          disabled={!sessionActive}
        >
          End Session
        </button>
      </footer>

    </div>
  );
}
