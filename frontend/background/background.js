// ─────────────────────────────────────────────────────────────
// Focus Assistant – Background Service Worker (Manifest V3)
//
// KEY FIX: MV3 service workers are suspended by Chrome after ~30s
// of inactivity. All in-memory state is lost on each wakeup.
// We persist the full session object to chrome.storage.session
// (which survives SW restarts within the same browser session)
// and restore it lazily on the first event of each SW activation.
// ─────────────────────────────────────────────────────────────

// ─── Backend configuration ────────────────────────────────────
const BACKEND_URL = "http://localhost:8000";
const EXTENSION_KEY = "hackathon-focus-123"; // must match EXTENSION_SECRET_KEY in .env

/**
 * Fire-and-forget authenticated POST to the backend.
 * Returns parsed JSON, or null on any error (extension keeps working offline).
 */
async function callBackend(path, body) {
  try {
    const res = await fetch(`${BACKEND_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Extension-Key": EXTENSION_KEY,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(`[Focus] Backend ${path} → HTTP ${res.status}`);
      return null;
    }
    return await res.json();
  } catch (err) {
    console.warn(`[Focus] Backend ${path} failed:`, err.message);
    return null;
  }
}

// ─── Session state ─────────────────────────────────────────────
// In-memory copy; authoritative source is chrome.storage.session.
const DEFAULT_SESSION = {
  sessionActive: false,
  goal: "",
  sessionId: null,
  currentTabId: null,
  currentTabStartTime: 0,
  chromeFocused: true,
  alignedTime: 0,
  totalTime: 0,
  driftCount: 0,
  tabTimes: {},   // { [tabId]: accumulatedMs }
};

let session = { ...DEFAULT_SESSION };

// ─── Service-worker persistence ────────────────────────────────
// Chrome.storage.session persists across SW restarts but is cleared
// when the browser exits. Perfect for tracking an active session.

/**
 * Restore session from chrome.storage.session.
 * Called once per SW activation before any event is processed.
 * If the SW was sleeping, we reset currentTabStartTime to now so
 * we don't count the time Chrome had the SW suspended.
 */
let _sessionRestored = false;
const _sessionRestorePromise = chrome.storage.session
  .get("focusSession")
  .then((data) => {
    if (data.focusSession) {
      session = data.focusSession;

      // SW was sleeping — we don't know how long, so restart the
      // timer from now rather than counting suspended time.
      if (session.sessionActive && session.currentTabId !== null) {
        session.currentTabStartTime = Date.now();
        console.log("[Focus] SW woke up — resuming session, timer restarted.");
      }
    }
    _sessionRestored = true;
    console.log("[Focus] Session restored from storage:", session.sessionActive);
  });

/** Persist current session to chrome.storage.session. */
function saveSession() {
  chrome.storage.session.set({ focusSession: session });
}

/** Wait for session restoration, then run fn(). */
async function withSession(fn) {
  await _sessionRestorePromise;
  return fn();
}

// ─── Helpers ───────────────────────────────────────────────────

/**
 * Commit time elapsed since currentTabStartTime into tabTimes/totalTime,
 * notify the outgoing content script to pause its timer,
 * then null out currentTabStartTime so double-calls are safe.
 */
function closePreviousTab() {
  if (session.currentTabId === null || session.currentTabStartTime === 0) return;

  const elapsed = Date.now() - session.currentTabStartTime;
  session.totalTime += elapsed;
  session.tabTimes[session.currentTabId] =
    (session.tabTimes[session.currentTabId] || 0) + elapsed;

  console.log(
    `[Focus] Tab closed — tabId: ${session.currentTabId}` +
    ` | elapsed: ${(elapsed / 1000).toFixed(1)}s` +
    ` | accumulated: ${((session.tabTimes[session.currentTabId]) / 1000).toFixed(1)}s` +
    ` | totalTime: ${(session.totalTime / 1000).toFixed(1)}s`
  );

  chrome.tabs.sendMessage(session.currentTabId, { type: "TAB_DEACTIVATED" })
    .catch(() => { });

  session.currentTabStartTime = 0; // make double-call safe
}

/**
 * Begin timing a new tab.
 * Sends TAB_CHANGED with accumulated seconds so the content script
 * can resume the visual timer from the right value.
 *
 * @param {number}  tabId
 * @param {boolean} [delayMessage=false] – true after onUpdated (page nav)
 *   so the freshly-injected content script has time to register its listener.
 */
function openNewTab(tabId, delayMessage = false) {
  session.currentTabId = tabId;
  session.currentTabStartTime = Date.now();
  session.driftCount += 1;

  console.log(`[Focus] Tab opened — tabId: ${tabId} | goal: "${session.goal}"`);

  const accumulatedMs = session.tabTimes[tabId] || 0;
  const accumulatedSecs = Math.floor(accumulatedMs / 1000);

  const sendTabChanged = () => {
    chrome.tabs.sendMessage(tabId, {
      type: "TAB_CHANGED",
      goal: session.goal,
      accumulatedSeconds: accumulatedSecs,
    }).catch(() => { });
  };

  // After a page navigation the content script is freshly injected.
  // Wait 200ms to give it time to register its message listener.
  if (delayMessage) {
    setTimeout(sendTabChanged, 200);
  } else {
    sendTabChanged();
  }

  // Request page data for AI alignment analysis
  chrome.tabs.sendMessage(tabId, { type: "EXTRACT_PAGE_DATA" }, async (response) => {
    void chrome.runtime.lastError;
    if (!response) return;

    const { url, title, snippet, bypassLLM, reason } = response.data ?? {};

    console.log("[Focus] AI payload:", { goal: session.goal, url, title, bypassLLM, reason });

    // Handle bypass edge cases (auth pages, local pages, etc.)
    if (bypassLLM) {
      console.log(`[Focus] Bypassing LLM for edge case: ${reason}`);
      chrome.storage.local.set({
        lastAnalysis: {
          aligned: true, // Treat necessary bypass pages as implicitly aligned
          confidence: 1.0,
          reason: reason || "System / Private Page",
          cached: true,
          url,
        },
      });
      return;
    }

    // POST to backend for AI alignment scoring
    if (session.sessionId && url) {
      const result = await callBackend("/api/v1/session/analyze", {
        session_id: session.sessionId,
        url: url ?? "",
        title: title ?? "",
        snippet: snippet ?? "",
      });

      if (result) {
        console.log("[Focus] Alignment result:", result);
        chrome.storage.local.set({
          lastAnalysis: {
            aligned: result.aligned,
            confidence: result.confidence,
            reason: result.reason,
            cached: result.cached,
            url,
          },
        });
      }
    }
  });
}

/** Flush counters + persist full session so SW can restore after sleep. */
function flushToStorage() {
  chrome.storage.local.set({
    totalTime: session.totalTime,
    alignedTime: session.alignedTime,
    driftCount: session.driftCount,
  });
  saveSession(); // persist full session for SW restart recovery
}

// ─────────────────────────────────────────────────────────────
// Message handler — receives commands from the popup
// ─────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {

  // ── START SESSION ─────────────────────────────────────────
  if (message.type === "START_SESSION") {
    chrome.tabs.query({ active: true, currentWindow: true }, async ([tab]) => {
      await _sessionRestorePromise;

      session = {
        ...DEFAULT_SESSION,
        sessionActive: true,
        goal: message.goal ?? "",
        currentTabId: tab?.id ?? null,
        currentTabStartTime: Date.now(),
      };

      // Create backend session
      const data = await callBackend("/api/v1/session/start", { goal: session.goal });
      if (data?.session_id) {
        session.sessionId = data.session_id;
        console.log(`[Focus] Backend session: ${session.sessionId}`);
      } else {
        console.warn("[Focus] Backend offline — session tracking only locally.");
      }

      chrome.storage.local.set({
        sessionId: session.sessionId,
        backendOnline: !!data?.session_id,
      });

      console.log(`[Focus] Session started — goal: "${session.goal}" | tabId: ${session.currentTabId}`);
      flushToStorage();
      sendResponse({ ok: true });
    });

    return true; // keep channel open for async sendResponse
  }

  // ── END SESSION ───────────────────────────────────────────
  if (message.type === "END_SESSION") {
    (async () => {
      await _sessionRestorePromise;

      if (session.sessionActive) {
        closePreviousTab();
        flushToStorage();
        if (session.sessionId) {
          callBackend("/api/v1/session/end", { session_id: session.sessionId });
        }
      }

      session = { ...DEFAULT_SESSION };
      saveSession();
      chrome.storage.local.remove(["sessionId", "lastAnalysis", "backendOnline"]);
      console.log("[Focus] Session ended.");
      sendResponse({ ok: true });
    })();

    return true;
  }

});

// ─────────────────────────────────────────────────────────────
// Tab lifecycle listeners
// ─────────────────────────────────────────────────────────────

/** User switches to a different tab inside Chrome. */
chrome.tabs.onActivated.addListener(({ tabId }) => {
  withSession(() => {
    if (!session.sessionActive) return;
    closePreviousTab();
    openNewTab(tabId, false);
    flushToStorage();
  });
});

/**
 * A tab finishes loading a new URL (navigation or revisit).
 * We delay TAB_CHANGED by 200ms so the freshly-injected content
 * script has time to register its listener.
 */
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  withSession(() => {
    if (!session.sessionActive) return;
    if (changeInfo.status !== "complete") return;
    if (tabId !== session.currentTabId) return;

    closePreviousTab();
    openNewTab(tabId, true /* delayMessage */);
    flushToStorage();
  });
});

// ─────────────────────────────────────────────────────────────
// Window focus tracking — pause timer when user leaves Chrome
// ─────────────────────────────────────────────────────────────
chrome.windows.onFocusChanged.addListener((windowId) => {
  withSession(() => {
    if (!session.sessionActive) return;

    const chromeLostFocus = (windowId === chrome.windows.WINDOW_ID_NONE);

    if (chromeLostFocus && session.chromeFocused) {
      session.chromeFocused = false;
      closePreviousTab();
      if (session.currentTabId !== null) {
        chrome.tabs.sendMessage(session.currentTabId, { type: "TAB_DEACTIVATED" })
          .catch(() => { });
      }
      session.currentTabId = null;
      flushToStorage();
      console.log("[Focus] Chrome lost focus — timer paused.");

    } else if (!chromeLostFocus && !session.chromeFocused) {
      session.chromeFocused = true;
      chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
        if (!tab) return;
        openNewTab(tab.id, false);
        flushToStorage();
        console.log("[Focus] Chrome regained focus — timer resumed on tabId:", tab.id);
      });
    }
  });
});
