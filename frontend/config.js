// ─────────────────────────────────────────────────────────────
// Focus Assistant — Timing Configuration
//
// Edit this file to change all extension timings.
// Backend: update backend/main.py get_recent_logs(minutes=N) to match
// BATCH_ANALYSIS_MINUTES.
// ─────────────────────────────────────────────────────────────

var FOCUS_CONFIG = {
  /** How often (minutes) to run batch AI analysis of recent tab activity */
  BATCH_ANALYSIS_MINUTES: 1,

  /** How often (ms) the per-tab timer display updates in the floating bar */
  TIMER_TICK_MS: 1000,
};
