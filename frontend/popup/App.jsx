// Main React component rendered inside the Chrome extension popup.
// Future: wire up chrome.storage to persist goal, and call AI nudge APIs.

import React, { useState } from "react";

export default function App() {
  // Local state for the user's current focus goal
  const [goal, setGoal] = useState("");

  // Placeholder handlers — real logic (storage, messaging) added in next sprint
  const handleStartSession = () => {
    // TODO: Save goal to chrome.storage.local and notify content script
    console.log("[Focus] Session started with goal:", goal);
  };

  const handleEndSession = () => {
    // TODO: Clear session state and show summary
    console.log("[Focus] Session ended.");
  };

  return (
    <div className="popup-container">
      {/* ── Header ── */}
      <header className="popup-header">
        <span className="logo">🎯</span>
        <h1>Focus Assistant</h1>
      </header>

      {/* ── Goal Input ── */}
      <section className="popup-body">
        <label htmlFor="goal-input" className="label">
          What are you working on?
        </label>
        <input
          id="goal-input"
          className="goal-input"
          type="text"
          placeholder="Enter your goal…"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
        />
      </section>

      {/* ── Actions ── */}
      <footer className="popup-footer">
        <button
          className="btn btn-primary"
          onClick={handleStartSession}
          disabled={!goal.trim()}
        >
          Start Session
        </button>
        <button
          className="btn btn-secondary"
          onClick={handleEndSession}
        >
          End Session
        </button>
      </footer>
    </div>
  );
}
