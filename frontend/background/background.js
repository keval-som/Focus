// ─────────────────────────────────────────────────────────────
// Focus Assistant – Background Service Worker (Manifest V3)
//
// Stage 3 + 5 + 6: Tab Tracking, Page Extraction & AI Analysis
//
// Responsibilities:
//   • Receive START_SESSION / END_SESSION messages from the popup
//   • Track time spent per tab during an active session
//   • Notify content scripts when the active tab changes
//   • Extract page data and send to backend for AI alignment check
//   • Send NUDGE to content script when user is off-track
// ─────────────────────────────────────────────────────────────

const API_BASE      = "http://localhost:8000/api/v1";
const EXTENSION_KEY = "hackathon-focus-123";

const apiHeaders = {
  "Content-Type":    "application/json",
  "X-Extension-Key": EXTENSION_KEY,
};

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

  // Notify content script so it resets its timer and updates goal text
  chrome.tabs.sendMessage(tabId, {
    type: "TAB_CHANGED",
    goal: session.goal,
  }).catch(() => {});

  requestAnalysis(tabId);
}

/**
 * Extract page data from a tab and send it to the backend for AI analysis.
 * Separated from openNewTab so we can trigger analysis on session start
 * without also sending a TAB_CHANGED (which resets the bar unnecessarily).
 */
function requestAnalysis(tabId) {
  chrome.tabs.sendMessage(tabId, { type: "EXTRACT_PAGE_DATA" }, (response) => {
    void chrome.runtime.lastError; // suppress "no receiver" for restricted tabs

    if (!response?.data) return;

    const { url, title, snippet } = response.data;
    if (!url) return;

    // Always read from storage — SW may have restarted since session was created
    chrome.storage.local.get(["sessionId", "sessionActive"], ({ sessionId, sessionActive }) => {
      if (!sessionId || !sessionActive) return;
      analyzeWithAI({ sessionId, url, title, snippet, tabId });
    });
  });
}

/* Persist session counters + currentTabId to storage.
   currentTabId must be persisted so onUpdated can check it after a SW restart. */
function flushToStorage() {
  chrome.storage.local.set({
    totalTime:    session.totalTime,
    alignedTime:  session.alignedTime,
    driftCount:   session.driftCount,
    currentTabId: session.currentTabId,
  });
}

/**
 * Call the backend /analyze endpoint with extracted page data.
 * If the AI says the page is NOT aligned, send a NUDGE to the content script.
 */
async function analyzeWithAI({ sessionId, url, title, snippet, tabId }) {
  try {
    console.log(`[Focus] Analyzing: "${title}" | url: ${url}`);

    const res = await fetch(`${API_BASE}/session/analyze`, {
      method:  "POST",
      headers: apiHeaders,
      body:    JSON.stringify({ session_id: sessionId, url, title, snippet }),
    });

    if (!res.ok) {
      console.warn(`[Focus] Analyze API error: ${res.status}`);
      return;
    }

    const { aligned, confidence, reason, cached } = await res.json();

    console.log(
      `[Focus] AI result — aligned: ${aligned} | confidence: ${(confidence * 100).toFixed(0)}% | cached: ${cached}\n  Reason: ${reason}`
    );

    if (!aligned) {
      // Send a nudge to the content script on this tab
      chrome.tabs.sendMessage(tabId, {
        type:       "NUDGE",
        reason,
        confidence,
        goal:       session.goal,
      }).catch(() => {}); // tab may have navigated away
    }

  } catch (err) {
    console.warn("[Focus] analyzeWithAI failed:", err.message);
  }
}

// ─────────────────────────────────────────────────────────────
// Message handler — receives commands from the popup
// ─────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {

  if (message.type === "START_SESSION") {
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

      // Analyze the tab the user is already on immediately.
      // Use requestAnalysis (not openNewTab) to avoid sending TAB_CHANGED —
      // the bar already updates via chrome.storage.onChanged in content.js.
      if (tab?.id) requestAnalysis(tab.id);
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
  // Always read sessionActive from storage — the service worker can be
  // suspended between events and in-memory `session` state is lost on wake-up.
  chrome.storage.local.get(["sessionActive", "goal", "sessionId"], (data) => {
    if (!data.sessionActive) return;

    // Re-hydrate in-memory state if the SW was just woken up
    if (!session.sessionActive) {
      session.sessionActive = true;
      session.goal          = data.goal || "";
    }

    closePreviousTab();
    openNewTab(tabId);
    flushToStorage();
  });
});

/* A tab finishes loading a new URL (navigation within same tab). */
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;

  // Read ALL persisted state — currentTabId included — so SW restarts don't break us
  chrome.storage.local.get(["sessionActive", "goal", "currentTabId"], (data) => {
    if (!data.sessionActive) return;

    // Re-hydrate full in-memory state if SW was just woken up
    if (!session.sessionActive) {
      session.sessionActive = true;
      session.goal          = data.goal        || "";
      session.currentTabId  = data.currentTabId || null;
    }

    // Only re-analyze if this is the tab the user is actually on
    if (tabId !== session.currentTabId) return;

    closePreviousTab();
    openNewTab(tabId);
    flushToStorage();
  });
});
