// ─────────────────────────────────────────────────────────────
// Focus Assistant – Content Script
//
// Injected into every page (<all_urls>, document_end).
//
// MVP behaviour:
//   • Injects a floating goal bar at the top of every webpage
//
// Future expansions:
//   • Receive goal text from background via chrome.runtime.onMessage
//   • Show distraction nudge overlays
//   • Highlight off-topic content
// ─────────────────────────────────────────────────────────────

(function () {
  "use strict";

  // Avoid double-injection if the script somehow runs twice
  if (document.getElementById("focus-assistant-bar")) return;

  /* ── Create the floating bar element ── */
  const bar = document.createElement("div");
  bar.id = "focus-assistant-bar";

  // Inline styles keep the bar fully self-contained (no external CSS needed)
  Object.assign(bar.style, {
    position:        "fixed",
    top:             "0",
    left:            "0",
    width:           "100%",
    zIndex:          "2147483647",   // Maximum z-index to stay on top
    display:         "flex",
    alignItems:      "center",
    justifyContent:  "center",
    gap:             "8px",
    padding:         "6px 16px",
    background:      "linear-gradient(90deg, #6366f1, #4f51d9)",
    color:           "#ffffff",
    fontFamily:      "Segoe UI, system-ui, sans-serif",
    fontSize:        "13px",
    fontWeight:      "500",
    letterSpacing:   "0.3px",
    boxShadow:       "0 2px 8px rgba(0,0,0,0.35)",
    boxSizing:       "border-box",
  });

  // Goal label — updated dynamically once storage/messaging is wired up
  const goalLabel = document.createElement("span");
  goalLabel.id = "focus-goal-label";
  goalLabel.textContent = "🎯 Goal: None";

  // Dismiss button so users can hide the bar for the current page
  const dismissBtn = document.createElement("button");
  dismissBtn.textContent = "✕";
  Object.assign(dismissBtn.style, {
    marginLeft:      "auto",
    background:      "transparent",
    border:          "none",
    color:           "#ffffff",
    fontSize:        "14px",
    cursor:          "pointer",
    lineHeight:      "1",
    padding:         "0 4px",
  });
  dismissBtn.title = "Dismiss bar for this page";
  dismissBtn.addEventListener("click", () => bar.remove());

  bar.appendChild(goalLabel);
  bar.appendChild(dismissBtn);
  document.body.prepend(bar);

  /* ── Listen for goal updates from the background / popup ── */
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === "GOAL_UPDATE") {
      // TODO: Receive and display the current session goal
      goalLabel.textContent = `🎯 Goal: ${message.goal ?? "None"}`;
    }

    if (message.type === "SESSION_ENDED") {
      goalLabel.textContent = "🎯 Goal: None";
    }
  });
})();
