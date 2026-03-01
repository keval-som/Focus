// ─────────────────────────────────────────────────────────────
// Focus Assistant – Background Service Worker (Manifest V3)
//
// Responsibilities (MVP):
//   • Log tab activation and update events for debugging
//
// Future expansions:
//   • Read active session goal from chrome.storage
//   • Classify URLs against goal (via AI API call)
//   • Send nudge messages to content script on distraction
// ─────────────────────────────────────────────────────────────

// Fired whenever the user switches to a different tab
chrome.tabs.onActivated.addListener((activeInfo) => {
  chrome.tabs.get(activeInfo.tabId, (tab) => {
    console.log(
      `[Focus] Tab activated → tabId: ${activeInfo.tabId} | URL: ${tab?.url ?? "unknown"}`
    );

    // TODO: Check if tab URL is aligned with the current goal
    //       and send a nudge to content.js if off-track
  });
});

// Fired whenever a tab's URL or status changes (e.g., navigation)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // Only act when the page has finished loading to avoid duplicate events
  if (changeInfo.status !== "complete") return;

  console.log(
    `[Focus] Tab updated → tabId: ${tabId} | URL: ${tab?.url ?? "unknown"}`
  );

  // TODO: Re-evaluate goal alignment on each new page load
});
