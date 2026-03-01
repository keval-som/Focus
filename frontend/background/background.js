// ─────────────────────────────────────────────────────────────
// Focus Assistant – Background Service Worker (Manifest V3)
//
// Stage 3 + 5: Tab Tracking & Page Data Extraction
//
// Responsibilities:
//   • Receive START_SESSION / END_SESSION messages from the popup
//   • Track time spent per tab during an active session
//   • Notify content scripts when the active tab changes
//   • Request page data from content script on tab change
//   • Build and log an AI-ready payload from extracted page data
//
// Future expansions:
//   • Send payload to AI API for goal-alignment scoring
//   • Send nudge to content script when user is off-track
// ─────────────────────────────────────────────────────────────

/* ── In-memory session state ──────────────────────────────────
   Service workers can be suspended by Chrome between events.
   For MVP, in-memory state is sufficient; for production,
   persist to chrome.storage.session (survives SW restarts). */
let session = {
  sessionActive:      false,
  goal:               "",
  currentTabId:       null,
  currentTabStartTime: 0,   // timestamp (ms) when current tab became active
  alignedTime:        0,    // ms spent on "aligned" tabs (future: AI classified)
  totalTime:          0,    // ms of total tracked tab time this session
  driftCount:         0,    // number of tab switches during session
};

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

/* Calculate time elapsed on the previous tab and add it to totalTime. */
function closePreviousTab() {
  if (session.currentTabId === null || session.currentTabStartTime === 0) return;

  const elapsed = Date.now() - session.currentTabStartTime;
  session.totalTime += elapsed;

  console.log(
    `[Focus] Tab closed — tabId: ${session.currentTabId} | elapsed: ${(elapsed / 1000).toFixed(1)}s | totalTime: ${(session.totalTime / 1000).toFixed(1)}s`
  );
}

/* Begin timing a new tab, notify its content script, and request page data. */
function openNewTab(tabId) {
  session.currentTabId        = tabId;
  session.currentTabStartTime = Date.now();
  session.driftCount         += 1;

  console.log(`[Focus] Tab opened — tabId: ${tabId} | goal: "${session.goal}"`);

  // Send TAB_CHANGED directly — no chrome.tabs.get wrapper needed.
  // chrome:// and other restricted pages simply have no content script,
  // so the message fails silently via .catch().
  chrome.tabs.sendMessage(tabId, {
    type: "TAB_CHANGED",
    goal: session.goal,
  }).catch(() => {});

  // Request page data extraction; callback handles both success and failure.
  chrome.tabs.sendMessage(tabId, { type: "EXTRACT_PAGE_DATA" }, (response) => {
    // Suppress the "no receiver" error for tabs without a content script
    void chrome.runtime.lastError;

    if (!response) return;

    const { url, title, snippet } = response.data ?? {};

    const aiPayload = {
      goal:      session.goal,
      url,
      title,
      snippet,
      timeSpent: Math.round(session.totalTime / 1000), // ms → seconds
    };

    console.log("[Focus] AI payload ready:", aiPayload);

    // TODO (Stage 6): POST aiPayload to AI alignment API
  });
}

/* Persist key counters back to chrome.storage so the popup can read them. */
function flushToStorage() {
  chrome.storage.local.set({
    totalTime:   session.totalTime,
    alignedTime: session.alignedTime,
    driftCount:  session.driftCount,
  });
}

// ─────────────────────────────────────────────────────────────
// Message handler — receives commands from the popup
// ─────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {

  if (message.type === "START_SESSION") {
    // Query the currently active tab so we can start timing it immediately
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      session = {
        sessionActive:       true,
        goal:                message.goal ?? "",
        currentTabId:        tab?.id ?? null,
        currentTabStartTime: Date.now(),
        alignedTime:         0,
        totalTime:           0,
        driftCount:          0,
      };

      console.log(`[Focus] Session started — goal: "${session.goal}" | tabId: ${session.currentTabId}`);
      flushToStorage();
      sendResponse({ ok: true });
    });

    return true; // keep message channel open for async sendResponse
  }

  if (message.type === "END_SESSION") {
    if (session.sessionActive) {
      closePreviousTab();         // account for time on the last tab
      flushToStorage();
    }

    session = {
      sessionActive:       false,
      goal:                "",
      currentTabId:        null,
      currentTabStartTime: 0,
      alignedTime:         0,
      totalTime:           0,
      driftCount:          0,
    };

    console.log("[Focus] Session ended.");
    sendResponse({ ok: true });
  }

});

// ─────────────────────────────────────────────────────────────
// Tab lifecycle listeners
// ─────────────────────────────────────────────────────────────

/* User switches to a different tab. */
chrome.tabs.onActivated.addListener(({ tabId }) => {
  if (!session.sessionActive) return;

  closePreviousTab();
  openNewTab(tabId);
  flushToStorage();
});

/* A tab finishes loading a new URL (navigation within same tab). */
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (!session.sessionActive)          return;
  if (changeInfo.status !== "complete") return;
  if (tabId !== session.currentTabId)   return; // only care about the active tab

  // Treat an in-tab navigation as a "new" tab event — reset the timer
  // so we measure time on this specific URL, not the tab's total lifetime.
  closePreviousTab();
  openNewTab(tabId);
  flushToStorage();
});
