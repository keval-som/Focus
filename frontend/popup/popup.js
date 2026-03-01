// Focus Assistant – Popup Logic (no build step required)

const goalInput = document.getElementById("goal-input");
const btnStart  = document.getElementById("btn-start");
const btnEnd    = document.getElementById("btn-end");

// Enable Start button only when the input has text
goalInput.addEventListener("input", () => {
  btnStart.disabled = goalInput.value.trim() === "";
});

btnStart.addEventListener("click", () => {
  const goal = goalInput.value.trim();
  if (!goal) return;

  // TODO: Persist goal and notify content script
  // chrome.storage.local.set({ goal, sessionActive: true });
  // chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  //   chrome.tabs.sendMessage(tab.id, { type: "GOAL_UPDATE", goal });
  // });

  console.log("[Focus] Session started:", goal);
  btnStart.textContent = "✅ Session Active";
  btnStart.disabled = true;
});

btnEnd.addEventListener("click", () => {
  // TODO: Clear session state
  // chrome.storage.local.remove(["goal", "sessionActive"]);

  console.log("[Focus] Session ended.");
  goalInput.value = "";
  btnStart.textContent = "Start Session";
  btnStart.disabled = true;
});
