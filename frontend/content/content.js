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

  const TICK_MS = (typeof FOCUS_CONFIG !== "undefined" && FOCUS_CONFIG.TIMER_TICK_MS) || 1000;

  /** Start the per-tab timer — increments every TICK_MS. */
  function startTimer() {
    resetTimer();
    timerInterval = setInterval(() => {
      secondsOnTab += 1;
      timerEl.textContent = `⏱ ${fmt(secondsOnTab)}`;
    }, TICK_MS);
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

  /* Divider (between goal and status) */
  const div1 = document.createElement("span");
  Object.assign(div1.style, {
    width:      "1px",
    height:     "18px",
    background: "rgba(255,255,255,0.3)",
    margin:     "0 14px",
    flexShrink: "0",
  });

  /* Timer — hidden for now, kept in DOM for possible future use */
  const timerEl = document.createElement("span");
  timerEl.id = "fa-timer";
  timerEl.textContent = "⏱ 00:00";
  Object.assign(timerEl.style, {
    display:            "none",
    fontVariantNumeric: "tabular-nums",
    flexShrink:         "0",
  });

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
    document.body.style.paddingTop = "";
    document.documentElement.style.scrollPaddingTop = "";
    if (typeof revertPushed === "function") revertPushed();
    bar.remove();
  });

  bar.append(goalEl, div1, timerEl, statusEl, dismissBtn);
  document.body.prepend(bar);

  const BAR_HEIGHT = 45;
  const BAR_HEIGHT_PX = BAR_HEIGHT + "px";

  // Push normal flow content down
  document.body.style.paddingTop = BAR_HEIGHT_PX;
  document.documentElement.style.scrollPaddingTop = BAR_HEIGHT_PX;

  // Push fixed/sticky headers down (body padding doesn't affect them)
  const pushed = [];
  function pushFixedElements() {
    document.querySelectorAll("header, nav, [role='banner'], [data-fixed-header]").forEach((el) => {
      if (el.id === "focus-assistant-bar" || el.closest("#focus-assistant-bar")) return;
      const cs = getComputedStyle(el);
      if (cs.position !== "fixed" && cs.position !== "sticky") return;
      const top = parseFloat(cs.top);
      if (!Number.isFinite(top) || top > 20) return;
      if (el.dataset.faPushed === "true") return;
      const prevTop = el.style.getPropertyValue("top") || el.getAttribute("data-fa-original-top");
      el.setAttribute("data-fa-original-top", prevTop || "0");
      el.style.setProperty("top", BAR_HEIGHT_PX, "important");
      el.dataset.faPushed = "true";
      pushed.push(el);
    });
    // Also catch any fixed element at top that's full-width (common header pattern)
    document.querySelectorAll("*").forEach((el) => {
      if (el.id === "focus-assistant-bar" || el.closest("#focus-assistant-bar")) return;
      if (pushed.includes(el)) return;
      const cs = getComputedStyle(el);
      if (cs.position !== "fixed") return;
      const top = parseFloat(cs.top);
      if (!Number.isFinite(top) || top > 20) return;
      if (el.offsetWidth < window.innerWidth * 0.4) return; // skip sidebars
      if (el.dataset.faPushed === "true") return;
      const prevTop = el.style.getPropertyValue("top") || el.getAttribute("data-fa-original-top");
      el.setAttribute("data-fa-original-top", prevTop || "0");
      el.style.setProperty("top", BAR_HEIGHT_PX, "important");
      el.dataset.faPushed = "true";
      pushed.push(el);
    });
  }
  pushFixedElements();
  setTimeout(pushFixedElements, 500);
  let pushDebounce = null;
  const observer = new MutationObserver(() => {
    if (pushDebounce) clearTimeout(pushDebounce);
    pushDebounce = setTimeout(pushFixedElements, 300);
  });
  observer.observe(document.body, { childList: true, subtree: true });

  function revertPushed() {
    observer.disconnect();
    pushed.forEach((el) => {
      if (el.dataset.faPushed !== "true") return;
      const orig = el.getAttribute("data-fa-original-top");
      if (orig !== null) el.style.setProperty("top", orig || "0", "important");
      else el.style.removeProperty("top");
      delete el.dataset.faPushed;
      el.removeAttribute("data-fa-original-top");
    });
  }

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
  chrome.storage.local.get(["goal", "sessionActive", "lastNudge", "lastNudgeAt"], (data) => {
    applyState(data);
    const NUDGE_STALE_MS = 15000;
    if (data.lastNudge && data.lastNudgeAt && (Date.now() - data.lastNudgeAt < NUDGE_STALE_MS)) {
      chrome.runtime.sendMessage({ type: "AM_I_ACTIVE_TAB" }, (isActive) => {
        if (isActive) showNudge(data.lastNudge.reason, { focus_score: data.lastNudge.focus_score, raw: data.lastNudge.confidence }, data.lastNudge.goal);
      });
    }
  });

  // ── 2. React to session start / end and to pending nudge ───
  const NUDGE_STALE_MS = 15000;

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    chrome.storage.local.get(["goal", "sessionActive"], applyState);

    // Fallback: show nudge if it was stored while this tab wasn't ready for the message
    const lastNudgeAt = changes.lastNudgeAt?.newValue;
    const lastNudge = changes.lastNudge?.newValue;
    if (lastNudgeAt && lastNudge && (Date.now() - lastNudgeAt < NUDGE_STALE_MS)) {
      chrome.runtime.sendMessage({ type: "AM_I_ACTIVE_TAB" }, (isActive) => {
        if (isActive) showNudge(lastNudge.reason, { focus_score: lastNudge.focus_score, raw: lastNudge.confidence }, lastNudge.goal);
      });
    }
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

  // ── Appreciation banner ───────────────────────────────────────────

  /** Show a positive feedback banner when user is on track with high focus score. */
  function showAppreciation(reason, focus_score, goal) {
    // Replace any existing appreciation or nudge
    document.getElementById("fa-appreciation")?.remove();
    document.getElementById("fa-nudge")?.remove();

    // Inject slide-in animation once (reuse existing style if present)
    if (!document.getElementById("fa-style")) {
      const style = document.createElement("style");
      style.id = "fa-style";
      style.textContent = `
        @keyframes fa-slide-in {
          from { opacity: 0; transform: translateY(-8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `;
      document.head.appendChild(style);
    }

    const appreciation = document.createElement("div");
    appreciation.id = "fa-appreciation";
    Object.assign(appreciation.style, {
      position:    "fixed",
      top:         "45px",
      left:        "0",
      width:       "100%",
      zIndex:      "2147483646",
      display:     "flex",
      alignItems:  "flex-start",
      gap:         "12px",
      padding:     "12px 16px",
      background:  "linear-gradient(90deg, #065f46, #047857)",
      color:       "#d1fae5",
      fontFamily:  "'Segoe UI', system-ui, sans-serif",
      boxShadow:   "0 3px 10px rgba(0,0,0,0.35)",
      boxSizing:   "border-box",
      animation:   "fa-slide-in 0.25s ease",
    });

    // Icon
    const icon = document.createElement("span");
    icon.textContent = "✨";
    Object.assign(icon.style, { fontSize: "18px", flexShrink: "0", marginTop: "1px" });

    // Message block
    const msgBlock = document.createElement("div");
    Object.assign(msgBlock.style, { flex: "1", display: "flex", flexDirection: "column", gap: "4px" });

    const goalLine = document.createElement("div");
    Object.assign(goalLine.style, { fontSize: "13px", fontWeight: "700", lineHeight: "1.4" });
    goalLine.textContent = `Great job staying focused on: "${goal || "—"}"`;

    const scoreLine = document.createElement("div");
    Object.assign(scoreLine.style, { fontSize: "13px", fontWeight: "400", lineHeight: "1.4" });
    scoreLine.textContent = `Focus Score: ${focus_score}/100`;

    const reasonLine = document.createElement("div");
    Object.assign(reasonLine.style, {
      fontSize:   "11px",
      fontWeight: "400",
      opacity:    "0.85",
      marginTop:  "4px",
      lineHeight: "1.4",
    });
    reasonLine.textContent = reason;

    msgBlock.append(goalLine, scoreLine, reasonLine);

    function dismissAppreciation() {
      appreciation.remove();
      bar.style.background = "linear-gradient(90deg, #4f46e5, #6366f1)";
    }

    // Close button (X)
    const closeBtn = document.createElement("button");
    closeBtn.textContent = "✕";
    closeBtn.title = "Dismiss";
    Object.assign(closeBtn.style, {
      background:  "transparent",
      border:      "none",
      color:       "rgba(209,250,229,0.8)",
      fontSize:    "18px",
      cursor:      "pointer",
      lineHeight:  "1",
      padding:     "0",
      marginLeft:  "auto",
      flexShrink:  "0",
      width:       "24px",
      height:      "24px",
      display:     "flex",
      alignItems:  "center",
      justifyContent: "center",
      borderRadius: "4px",
      transition:  "background 0.2s, color 0.2s",
    });
    closeBtn.addEventListener("mouseenter", () => {
      closeBtn.style.background = "rgba(209,250,229,0.2)";
      closeBtn.style.color = "#d1fae5";
    });
    closeBtn.addEventListener("mouseleave", () => {
      closeBtn.style.background = "transparent";
      closeBtn.style.color = "rgba(209,250,229,0.8)";
    });
    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      dismissAppreciation();
    });

    appreciation.append(icon, msgBlock, closeBtn);
    document.body.appendChild(appreciation);

    // Tint the main bar green while appreciation is visible
    bar.style.background = "linear-gradient(90deg, #065f46, #047857)";
  }

  // ── Nudge banner ───────────────────────────────────────────

  /** Show a persistent distraction warning — stays until the user dismisses it. */
  function showNudge(reason, confidence, goal) {
    // Replace any existing nudge
    document.getElementById("fa-nudge")?.remove();

    // Inject slide-in animation once
    if (!document.getElementById("fa-style")) {
      const style = document.createElement("style");
      style.id = "fa-style";
      style.textContent = `
        @keyframes fa-slide-in {
          from { opacity: 0; transform: translateY(-8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `;
      document.head.appendChild(style);
    }

    const nudge = document.createElement("div");
    nudge.id = "fa-nudge";
    Object.assign(nudge.style, {
      position:    "fixed",
      top:         "45px",
      left:        "0",
      width:       "100%",
      zIndex:      "2147483646",
      display:     "flex",
      alignItems:  "flex-start",
      gap:         "12px",
      padding:     "12px 16px",
      background:  "linear-gradient(90deg, #92400e, #b45309)",
      color:       "#fff7ed",
      fontFamily:  "'Segoe UI', system-ui, sans-serif",
      boxShadow:   "0 3px 10px rgba(0,0,0,0.35)",
      boxSizing:   "border-box",
      animation:   "fa-slide-in 0.25s ease",
    });

    // Icon
    const icon = document.createElement("span");
    icon.textContent = "🔔";
    Object.assign(icon.style, { fontSize: "18px", flexShrink: "0", marginTop: "1px" });

    // Message block
    const msgBlock = document.createElement("div");
    Object.assign(msgBlock.style, { flex: "1", display: "flex", flexDirection: "column", gap: "4px" });

    const goalLine = document.createElement("div");
    Object.assign(goalLine.style, { fontSize: "13px", fontWeight: "700", lineHeight: "1.4" });
    goalLine.textContent = `You said your goal was: "${goal || "—"}"`;

    const questionLine = document.createElement("div");
    Object.assign(questionLine.style, { fontSize: "13px", fontWeight: "400", lineHeight: "1.4" });
    questionLine.textContent = "Does this page support that goal?";

    const reasonLine = document.createElement("div");
    Object.assign(reasonLine.style, {
      fontSize:   "11px",
      fontWeight: "400",
      opacity:    "0.75",
      marginTop:  "4px",
      lineHeight: "1.4",
    });
    const scoreLabel = (confidence?.focus_score !== undefined)
      ? `Focus score: ${confidence.focus_score}/100`
      : `${Math.round((confidence?.raw ?? 0) * 100)}% confidence`;
    reasonLine.textContent = `${scoreLabel} · ${reason}`;

    msgBlock.append(goalLine, questionLine, reasonLine);

    // Dismiss button
    const close = document.createElement("button");
    close.textContent = "✕";
    close.title = "Dismiss";
    Object.assign(close.style, {
      background:  "transparent",
      border:      "none",
      color:       "rgba(255,247,237,0.8)",
      fontSize:    "15px",
      cursor:      "pointer",
      padding:     "0",
      lineHeight:  "1",
      flexShrink:  "0",
      marginTop:   "2px",
    });
    close.addEventListener("click", () => {
      nudge.remove();
      bar.style.background = "linear-gradient(90deg, #4f46e5, #6366f1)";
    });

    nudge.append(icon, msgBlock, close);
    document.body.appendChild(nudge);

    // Tint the main bar orange while nudge is visible
    bar.style.background = "linear-gradient(90deg, #92400e, #b45309)";
  }

  // ── 3. React to messages from the background ───────────────
  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {

    // TAB_CHANGED — update the bar goal text and reset the timer
    if (message.type === "TAB_CHANGED") {
      applyState({ goal: message.goal, sessionActive: true });
      document.getElementById("fa-nudge")?.remove();
      document.getElementById("fa-appreciation")?.remove();
      bar.style.background = "linear-gradient(90deg, #4f46e5, #6366f1)";
    }

    // SESSION_ENDED — reset the bar on all tabs immediately
    if (message.type === "SESSION_ENDED") {
      applyState({ goal: "", sessionActive: false });
      document.getElementById("fa-nudge")?.remove();
      document.getElementById("fa-appreciation")?.remove();
      bar.style.background = "linear-gradient(90deg, #4f46e5, #6366f1)";
    }

    // APPRECIATION — AI says user is doing great (high focus score, on track)
    if (message.type === "APPRECIATION") {
      showAppreciation(
        message.reason,
        message.focus_score,
        message.goal
      );
    }

    // NUDGE — AI says this page doesn't align with the goal
    if (message.type === "NUDGE") {
      showNudge(
        message.reason,
        { focus_score: message.focus_score, raw: message.confidence ?? 0 },
        message.goal
      );
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
