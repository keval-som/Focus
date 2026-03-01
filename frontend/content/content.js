// ─────────────────────────────────────────────────────────────
// Focus Assistant – Content Script (Stage 4)
//
// Injected into every page at document_end.
// Responsibilities:
//   • Render a fixed floating bar (goal, timer, status)
//   • Read initial session state from chrome.storage on load
//   • React to storage changes (session start / end)
//   • React to TAB_CHANGED messages from the background (reset timer)
// ─────────────────────────────────────────────────────────────

(function () {
  "use strict";

  // Prevent double-injection (e.g. if the script somehow fires twice)
  if (document.getElementById("focus-assistant-bar")) return;

  // ── Timer state ────────────────────────────────────────────
  let timerInterval  = null;  // setInterval handle
  let secondsOnTab   = 0;     // seconds elapsed on this tab since TAB_CHANGED

  // ── Helpers ────────────────────────────────────────────────

  /** Format seconds as MM:SS */
  function fmt(secs) {
    const m = String(Math.floor(secs / 60)).padStart(2, "0");
    const s = String(secs % 60).padStart(2, "0");
    return `${m}:${s}`;
  }

  /** Stop any running timer and reset the counter. */
  function resetTimer() {
    clearInterval(timerInterval);
    timerInterval = null;
    secondsOnTab  = 0;
    timerEl.textContent = "⏱ 00:00";
  }

  /** Start the per-tab timer — increments every second. */
  function startTimer() {
    resetTimer();
    timerInterval = setInterval(() => {
      secondsOnTab += 1;
      timerEl.textContent = `⏱ ${fmt(secondsOnTab)}`;
    }, 1000);
  }

  // ── DOM construction ───────────────────────────────────────

  /* Outer bar */
  const bar = document.createElement("div");
  bar.id = "focus-assistant-bar";
  Object.assign(bar.style, {
    position:        "fixed",
    top:             "0",
    left:            "0",
    width:           "100%",
    height:          "45px",
    zIndex:          "2147483647",
    display:         "flex",
    alignItems:      "center",
    gap:             "0",
    padding:         "0 16px",
    background:      "linear-gradient(90deg, #4f46e5, #6366f1)",
    color:           "#ffffff",
    fontFamily:      "'Segoe UI', system-ui, sans-serif",
    fontSize:        "13px",
    fontWeight:      "500",
    boxShadow:       "0 2px 10px rgba(0,0,0,0.4)",
    boxSizing:       "border-box",
    letterSpacing:   "0.2px",
  });

  /* Goal pill — left side */
  const goalEl = document.createElement("span");
  goalEl.id = "fa-goal";
  Object.assign(goalEl.style, {
    flex:           "1",
    overflow:       "hidden",
    textOverflow:   "ellipsis",
    whiteSpace:     "nowrap",
  });
  goalEl.textContent = "🎯 Goal: —";

  /* Divider */
  const div1 = document.createElement("span");
  Object.assign(div1.style, {
    width:      "1px",
    height:     "18px",
    background: "rgba(255,255,255,0.3)",
    margin:     "0 14px",
    flexShrink: "0",
  });

  /* Timer — centre */
  const timerEl = document.createElement("span");
  timerEl.id = "fa-timer";
  timerEl.textContent = "⏱ 00:00";
  Object.assign(timerEl.style, {
    fontVariantNumeric: "tabular-nums",
    flexShrink:         "0",
  });

  /* Divider */
  const div2 = div1.cloneNode();

  /* Status badge — right side */
  const statusEl = document.createElement("span");
  statusEl.id = "fa-status";
  Object.assign(statusEl.style, {
    flexShrink:   "0",
    padding:      "2px 10px",
    borderRadius: "20px",
    fontSize:     "11px",
    fontWeight:   "700",
    letterSpacing:"0.5px",
    textTransform:"uppercase",
    background:   "rgba(255,255,255,0.15)",
    border:       "1px solid rgba(255,255,255,0.25)",
  });
  statusEl.textContent = "Inactive";

  /* Dismiss button — far right */
  const dismissBtn = document.createElement("button");
  dismissBtn.textContent = "✕";
  dismissBtn.title = "Dismiss for this page";
  Object.assign(dismissBtn.style, {
    marginLeft:  "14px",
    flexShrink:  "0",
    background:  "transparent",
    border:      "none",
    color:       "rgba(255,255,255,0.7)",
    fontSize:    "15px",
    cursor:      "pointer",
    lineHeight:  "1",
    padding:     "0",
  });
  dismissBtn.addEventListener("click", () => {
    clearInterval(timerInterval);
    bar.remove();
  });

  bar.append(goalEl, div1, timerEl, div2, statusEl, dismissBtn);
  document.body.prepend(bar);

  // ── State application ──────────────────────────────────────

  /**
   * Called whenever session state is known.
   * Updates goal text and status badge; starts or stops the timer.
   */
  function applyState({ goal, sessionActive }) {
    if (sessionActive && goal) {
      goalEl.textContent    = `🎯 Goal: ${goal}`;
      statusEl.textContent  = "Active";
      statusEl.style.background = "rgba(34,197,94,0.25)";
      statusEl.style.border     = "1px solid rgba(34,197,94,0.5)";
      statusEl.style.color      = "#86efac";
      if (!timerInterval) startTimer(); // only start if not already running
    } else {
      goalEl.textContent    = "🎯 Goal: —";
      statusEl.textContent  = "Inactive";
      statusEl.style.background = "rgba(255,255,255,0.1)";
      statusEl.style.border     = "1px solid rgba(255,255,255,0.2)";
      statusEl.style.color      = "#ffffff";
      resetTimer();
    }
  }

  // ── 1. Read state immediately on page load ─────────────────
  chrome.storage.local.get(["goal", "sessionActive"], applyState);

  // ── 2. React to session start / end from the popup ─────────
  // chrome.storage.onChanged fires on all tabs — no extra messaging needed.
  chrome.storage.onChanged.addListener((_, area) => {
    if (area !== "local") return;
    chrome.storage.local.get(["goal", "sessionActive"], applyState);
  });

  // ── Page data extraction (privacy-safe) ───────────────────

  // Domains where content is inherently private — snippet is fully redacted.
  const PRIVATE_DOMAINS = [
    "mail.google", "outlook.live", "outlook.office",
    "web.whatsapp", "messenger.com", "telegram.org",
    "paypal.com", "stripe.com",
    "chase.com", "bankofamerica.com", "wellsfargo.com",
  ];

  // Per-site extraction rules for SPAs and sites with non-standard DOM structure.
  // Each entry returns { url, title, snippet } directly.
  const SITE_EXTRACTORS = [
    {
      match: (h) => h.includes("youtube.com"),
      extract: () => {
        // Preserve ?v= so each video is uniquely identified
        const url = window.location.origin + window.location.pathname + window.location.search;

        // Title: the visible video heading (not the <title> tag which lags on SPA nav)
        const titleEl =
          document.querySelector("h1.ytd-video-primary-info-renderer yt-formatted-string") ||
          document.querySelector("#title h1 yt-formatted-string") ||
          document.querySelector("h1.style-scope.ytd-video-primary-info-renderer");
        const title = titleEl?.textContent?.trim() || document.title;

        // Description: collapsed description block (most intent-bearing text on the page)
        const descEl =
          document.querySelector("#description-inline-expander") ||
          document.querySelector("#meta-contents #description") ||
          document.querySelector("ytd-video-secondary-info-renderer #description");
        const desc = descEl?.innerText?.replace(/\s+/g, " ").trim().slice(0, 300) || "";

        // Channel name as extra context
        const channelEl = document.querySelector("#channel-name a") ||
                          document.querySelector("ytd-channel-name a");
        const channel = channelEl?.textContent?.trim() || "";

        const snippet = [channel && `Channel: ${channel}`, desc].filter(Boolean).join(" | ");

        return { url, title, snippet: snippet.slice(0, 400) };
      },
    },
    {
      match: (h) => h.includes("linkedin.com"),
      extract: () => {
        const url = window.location.origin + window.location.pathname;

        // Job postings, articles, and profile names all live in <h1>
        const h1 = document.querySelector("h1")?.textContent?.trim() || "";

        // Main content area — avoid the left/right sidebars
        const main = document.querySelector(".scaffold-layout__main, main, [role='main']");
        const clone = main ? main.cloneNode(true) : document.body.cloneNode(true);
        clone.querySelectorAll("input, textarea, nav, aside, header, [data-ad-banner]").forEach((el) => el.remove());

        const body = clone.innerText.replace(/\s+/g, " ").trim();
        const snippet = (h1 ? `${h1} — ` : "") + body.slice(0, 350);

        return { url, title: document.title, snippet: snippet.slice(0, 400) };
      },
    },
    {
      match: (h) => h.includes("twitter.com") || h.includes("x.com"),
      extract: () => {
        const url = window.location.origin + window.location.pathname;

        // On a tweet page the primary article holds the tweet text
        const tweet = document.querySelector("article [data-testid='tweetText']");
        const snippet = tweet
          ? tweet.innerText.replace(/\s+/g, " ").trim().slice(0, 400)
          : "[timeline — no specific tweet selected]";

        return { url, title: document.title, snippet };
      },
    },
  ];

  function extractPageData() {
    const hostname  = window.location.hostname;
    const isPrivate = PRIVATE_DOMAINS.some((d) => hostname.includes(d));

    if (isPrivate) {
      return {
        url:     window.location.origin + window.location.pathname,
        title:   document.title,
        snippet: "[content redacted]",
        private: true,
      };
    }

    // Try a site-specific extractor first
    const extractor = SITE_EXTRACTORS.find((e) => e.match(hostname));
    if (extractor) {
      return { ...extractor.extract(), private: false };
    }

    // ── Generic fallback for all other sites ──
    const safeUrl = window.location.origin + window.location.pathname;

    const clone = document.body.cloneNode(true);
    clone
      .querySelectorAll("input, textarea, [contenteditable], nav, footer, aside, script, style, noscript")
      .forEach((el) => el.remove());

    const nodes = clone.querySelectorAll("h1, h2, h3, main, article, [role='main'], p");
    const text  = nodes.length
      ? [...nodes].map((n) => n.innerText).join(" ")
      : clone.innerText;

    return {
      url:     safeUrl,
      title:   document.title,
      snippet: text.replace(/\s+/g, " ").trim().slice(0, 400),
      private: false,
    };
  }

  // ── Nudge toast ────────────────────────────────────────────

  let nudgeTimeout = null;

  /** Show a dismissable distraction warning below the main bar. */
  function showNudge(reason, confidence) {
    // Remove any existing nudge first
    document.getElementById("fa-nudge")?.remove();
    clearTimeout(nudgeTimeout);

    const nudge = document.createElement("div");
    nudge.id = "fa-nudge";
    Object.assign(nudge.style, {
      position:    "fixed",
      top:         "45px",          // sits just below the main bar
      left:        "0",
      width:       "100%",
      zIndex:      "2147483646",
      display:     "flex",
      alignItems:  "center",
      gap:         "10px",
      padding:     "8px 16px",
      background:  "linear-gradient(90deg, #b45309, #d97706)",
      color:       "#fff7ed",
      fontFamily:  "'Segoe UI', system-ui, sans-serif",
      fontSize:    "12px",
      fontWeight:  "500",
      boxShadow:   "0 2px 8px rgba(0,0,0,0.3)",
      boxSizing:   "border-box",
      animation:   "fa-slide-in 0.2s ease",
    });

    // Inject keyframe animation once
    if (!document.getElementById("fa-style")) {
      const style = document.createElement("style");
      style.id = "fa-style";
      style.textContent = `
        @keyframes fa-slide-in {
          from { opacity: 0; transform: translateY(-6px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `;
      document.head.appendChild(style);
    }

    const pct  = Math.round(confidence * 100);
    const icon = document.createElement("span");
    icon.textContent = "⚠️";

    const text = document.createElement("span");
    text.style.flex = "1";
    text.textContent = `Distraction detected (${pct}% confidence) — ${reason}`;

    const close = document.createElement("button");
    close.textContent = "✕";
    Object.assign(close.style, {
      background:  "transparent",
      border:      "none",
      color:       "#fff7ed",
      fontSize:    "14px",
      cursor:      "pointer",
      padding:     "0",
      lineHeight:  "1",
      flexShrink:  "0",
    });
    close.addEventListener("click", () => nudge.remove());

    nudge.append(icon, text, close);
    document.body.appendChild(nudge);

    // Also tint the main bar orange to signal distraction state
    bar.style.background = "linear-gradient(90deg, #92400e, #b45309)";

    // Auto-dismiss after 8 seconds
    nudgeTimeout = setTimeout(() => {
      nudge.remove();
      bar.style.background = "linear-gradient(90deg, #4f46e5, #6366f1)";
    }, 8000);
  }

  // ── 3. React to messages from the background ───────────────
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {

    // TAB_CHANGED — update the bar goal text and reset the timer
    if (message.type === "TAB_CHANGED") {
      goalEl.textContent = `🎯 Goal: ${message.goal ?? "—"}`;
      // Clear any nudge when switching tabs
      document.getElementById("fa-nudge")?.remove();
      bar.style.background = "linear-gradient(90deg, #4f46e5, #6366f1)";
      startTimer();
    }

    // NUDGE — AI says this page doesn't align with the goal
    if (message.type === "NUDGE") {
      showNudge(message.reason, message.confidence ?? 0);
    }

    // EXTRACT_PAGE_DATA — scrape this page and send privacy-safe data to background
    if (message.type === "EXTRACT_PAGE_DATA") {
      if (!window.location.href.startsWith("http")) return;

      sendResponse({
        type: "PAGE_DATA",
        data: extractPageData(),
      });
    }

    // Return true only for EXTRACT_PAGE_DATA to keep the channel open
    // for the synchronous sendResponse call above
    return message.type === "EXTRACT_PAGE_DATA";
  });
})();
