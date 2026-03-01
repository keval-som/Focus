// ─────────────────────────────────────────────────────────────
// Focus Assistant – Background Service Worker (Manifest V3)
//
// Stage 3 + 5 + 6 (Batch): Tab Tracking, Page Extraction & AI Batch Analysis
//
// Flow:
//   Tab switch → /session/log   (fast, no LLM, stores raw visit)
//   Every N min → /session/analyze_batch  (LLM analyzes window of activity)
//   Batch result → NUDGE sent to active tab if is_on_track === false
// ─────────────────────────────────────────────────────────────

importScripts("../config.js");

const API_BASE      = "http://localhost:8000/api/v1";
const EXTENSION_KEY = "hackathon-focus-123";
const BATCH_ALARM   = "focus-batch-analyze";

const apiHeaders = {
  "Content-Type":    "application/json",
  "X-Extension-Key": EXTENSION_KEY,
};

// ── In-memory session state ────────────────────────────────────
// Service workers can be suspended by Chrome between events.
// Critical fields are also mirrored to chrome.storage.local for re-hydration.
let session = {
  sessionActive:       false,
  goal:                "",
  currentTabId:        null,
  currentTabStartTime: 0,
  totalTime:           0,
  driftCount:          0,
  currentPage:         null,  // { url, title, snippet } of the tab being timed
};

// ─────────────────────────────────────────────────────────────
// Anti-bot page detection
// ─────────────────────────────────────────────────────────────

const ANTI_BOT_TITLE_PATTERNS = [
  "just a moment", "checking your browser", "please wait",
  "attention required", "access denied", "security check",
  "ddos protection", "verify you are human", "enable javascript",
  "bot check", "one more step", "request blocked",
];

const ANTI_BOT_URL_PATTERNS = [
  "/cdn-cgi/", "challenge.cloudflare.com", "/akamai-challenge",
];

function isAntiBotPage({ url = "", title = "", snippet = "" }) {
  const lt = title.toLowerCase();
  const lu = url.toLowerCase();
  const ls = snippet.toLowerCase();
  if (ANTI_BOT_TITLE_PATTERNS.some(p => lt.includes(p))) return true;
  if (ANTI_BOT_URL_PATTERNS.some(p => lu.includes(p)))   return true;
  if (ls.length < 120 && (lt.includes("check") || lt.includes("verif"))) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────
// Tab timing helpers
// ─────────────────────────────────────────────────────────────

/**
 * Close timing on the previous tab.
 * Logs the visit to the backend with the actual time spent,
 * then returns the elapsed ms so callers can update totalTime.
 */
function closePreviousTab() {
  if (session.currentTabId === null || session.currentTabStartTime === 0) return;

  const elapsed         = Date.now() - session.currentTabStartTime;
  const durationSeconds = Math.round(elapsed / 1000);
  session.totalTime    += elapsed;

  console.log(
    `[Focus] Tab closed — tabId: ${session.currentTabId} | elapsed: ${durationSeconds}s | totalTime: ${(session.totalTime / 1000).toFixed(1)}s`
  );

  // Log the visit with the real duration if we captured the page data
  if (session.currentPage && durationSeconds > 0) {
    const page = session.currentPage;
    chrome.storage.local.get(["sessionId", "sessionActive"], ({ sessionId, sessionActive }) => {
      if (!sessionId || !sessionActive) return;
      logVisit({ sessionId, ...page, durationSeconds });
    });
  }
}

/** Start timing a new tab, notify its content script, and extract page data. */
function openNewTab(tabId) {
  session.currentTabId        = tabId;
  session.currentTabStartTime = Date.now();
  session.currentPage         = null; // cleared until extraction completes
  session.driftCount         += 1;

  console.log(`[Focus] Tab opened — tabId: ${tabId} | goal: "${session.goal}"`);

  // Update the floating bar on the new tab
  chrome.tabs.sendMessage(tabId, {
    type: "TAB_CHANGED",
    goal: session.goal,
  }).catch(() => {});

  // Extract page data and store it for logging when this tab is left
  extractAndStore(tabId);
}

/**
 * Send EXTRACT_PAGE_DATA to a tab and store the result in session.currentPage.
 * Used both on tab switch (via openNewTab) and on session start.
 */
function extractAndStore(tabId) {
  chrome.tabs.sendMessage(tabId, { type: "EXTRACT_PAGE_DATA" }, (response) => {
    void chrome.runtime.lastError;

    if (!response?.data) return;
    const { url, title, snippet } = response.data;
    if (!url) return;

    if (isAntiBotPage({ url, title, snippet })) {
      console.log(`[Focus] Anti-bot page — skipping. title: "${title}"`);
      return;
    }

    // Store so closePreviousTab can log it with the real duration later
    session.currentPage = { url, title, snippet };
    console.log(`[Focus] Page data captured: "${title}"`);
  });
}

// ─────────────────────────────────────────────────────────────
// Backend API calls
// ─────────────────────────────────────────────────────────────

/** POST /session/log — fast, no LLM, records one tab visit. */
async function logVisit({ sessionId, url, title, snippet, durationSeconds }) {
  try {
    const res = await fetch(`${API_BASE}/session/log`, {
      method:  "POST",
      headers: apiHeaders,
      body:    JSON.stringify({
        session_id:       sessionId,
        url,
        title,
        snippet,
        duration_seconds: durationSeconds,
      }),
    });
    if (res.ok) {
      console.log(`[Focus] Logged: "${title}" | ${durationSeconds}s`);
    } else {
      console.warn(`[Focus] Log API error: ${res.status}`);
    }
  } catch (err) {
    console.warn("[Focus] logVisit failed:", err.message);
  }
}

/** POST /session/analyze_batch — LLM analyzes last 4 min of activity. */
async function runBatchAnalysis() {
  chrome.storage.local.get(["sessionId", "sessionActive", "goal"], async (stored) => {
    const { sessionId, sessionActive, goal } = stored || {};
    if (!sessionActive || !sessionId) return;

    try {
      console.log("[Focus] Running batch analysis…");

      const res = await fetch(`${API_BASE}/session/analyze_batch`, {
        method:  "POST",
        headers: apiHeaders,
        body:    JSON.stringify({ session_id: sessionId }),
      });

      if (!res.ok) {
        console.warn(`[Focus] Batch API error: ${res.status}`);
        return;
      }

      const { focus_score, is_on_track, coaching_nudge, url_breakdown } = await res.json();

      console.log(
        `[Focus] Batch result — score: ${focus_score} | on_track: ${is_on_track}\n  Nudge: ${coaching_nudge}`
      );

      // Persist latest score so popup can display it
      chrome.storage.local.set({ focusScore: focus_score, isOnTrack: is_on_track });

      // Nudge the user if they're off track
      if (!is_on_track) {
        const nudgeData = {
          reason:      coaching_nudge,
          confidence:  parseFloat(((100 - focus_score) / 100).toFixed(2)),
          focus_score,
          goal:        goal ?? "",
        };
        // Fallback: store so content script can show nudge if message arrived before script was ready
        chrome.storage.local.set({
          lastNudge:   nudgeData,
          lastNudgeAt: Date.now(),
        });

        chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
          if (!tab?.id) {
            console.warn("[Focus] No active tab for nudge.");
            return;
          }
          chrome.tabs.sendMessage(tab.id, {
            type: "NUDGE",
            ...nudgeData,
          }).catch((err) => {
            console.warn("[Focus] Nudge delivery failed (tab may not have content script):", err?.message || String(err));
          });
        });
      }

    } catch (err) {
      console.warn("[Focus] runBatchAnalysis failed:", err.message);
    }
  });
}

// ─────────────────────────────────────────────────────────────
// Broadcast to all tabs
// ─────────────────────────────────────────────────────────────

/** Send a message to every tab that has a content script. Errors are silently ignored. */
function broadcastToAllTabs(msg) {
  chrome.tabs.query({}, (tabs) => {
    for (const tab of tabs) {
      if (tab.id) chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
    }
  });
}

// ─────────────────────────────────────────────────────────────
// Persist / re-hydrate state
// ─────────────────────────────────────────────────────────────

function flushToStorage() {
  chrome.storage.local.set({
    totalTime:    session.totalTime,
    driftCount:   session.driftCount,
    currentTabId: session.currentTabId,
  });
}

// ─────────────────────────────────────────────────────────────
// chrome.alarms — survives SW suspension (unlike setInterval)
// ─────────────────────────────────────────────────────────────

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === BATCH_ALARM) runBatchAnalysis();
});

// ─────────────────────────────────────────────────────────────
// Message handler — popup commands
// ─────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === "AM_I_ACTIVE_TAB") {
    const tabId = sender.tab?.id;
    if (tabId == null) {
      sendResponse(false);
      return;
    }
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      sendResponse(tab?.id === tabId);
    });
    return true;
  }

  if (message.type === "START_SESSION") {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      session = {
        sessionActive:       true,
        goal:                message.goal ?? "",
        currentTabId:        tab?.id ?? null,
        currentTabStartTime: Date.now(),
        totalTime:           0,
        driftCount:          0,
        currentPage:         null,
      };

      console.log(`[Focus] Session started — goal: "${session.goal}" | tabId: ${session.currentTabId}`);
      flushToStorage();
      sendResponse({ ok: true });

      // Broadcast goal to ALL open tabs immediately — don't rely on storage.onChanged
      broadcastToAllTabs({ type: "TAB_CHANGED", goal: session.goal });

      // Extract current tab data immediately (logged when user switches away)
      if (tab?.id) extractAndStore(tab.id);

      const batchMins = (typeof FOCUS_CONFIG !== "undefined" && FOCUS_CONFIG.BATCH_ANALYSIS_MINUTES) || 4;
      chrome.alarms.create(BATCH_ALARM, { periodInMinutes: batchMins });
      console.log(`[Focus] Batch alarm scheduled every ${batchMins} minutes.`);
    });

    return true; // keep channel open for async sendResponse
  }

  if (message.type === "END_SESSION") {
    // Log the final tab before resetting
    if (session.sessionActive) {
      closePreviousTab();
      flushToStorage();
    }

    // Cancel the batch alarm
    chrome.alarms.clear(BATCH_ALARM);

    // Reset all open tabs immediately
    broadcastToAllTabs({ type: "SESSION_ENDED" });

    session = {
      sessionActive:       false,
      goal:                "",
      currentTabId:        null,
      currentTabStartTime: 0,
      totalTime:           0,
      driftCount:          0,
      currentPage:         null,
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
  chrome.storage.local.get(["sessionActive", "goal", "sessionId"], (data) => {
    if (!data.sessionActive) return;

    // Re-hydrate if SW was suspended
    if (!session.sessionActive) {
      session.sessionActive = true;
      session.goal          = data.goal || "";
    }

    closePreviousTab();
    openNewTab(tabId);
    flushToStorage();
  });
});

/* Navigation within the same tab (e.g. YouTube video change, SPA route). */
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status !== "complete") return;

  chrome.storage.local.get(["sessionActive", "goal", "currentTabId"], (data) => {
    if (!data.sessionActive) return;

    // Re-hydrate if SW was suspended
    if (!session.sessionActive) {
      session.sessionActive = true;
      session.goal          = data.goal        || "";
      session.currentTabId  = data.currentTabId || null;
    }

    // Only react to the tab the user is actually on
    if (tabId !== session.currentTabId) return;

    closePreviousTab();
    openNewTab(tabId);
    flushToStorage();
  });
});
