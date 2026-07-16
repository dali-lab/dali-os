const baseEl = document.getElementById("base");
const periodEl = document.getElementById("period");
const demoEl = document.getElementById("demo");
const statusEl = document.getElementById("status");

chrome.storage.sync.get(["daliBase", "daliPeriodId", "demoMode"]).then(({ daliBase, daliPeriodId, demoMode }) => {
  if (daliBase) baseEl.value = daliBase;
  if (daliPeriodId) periodEl.value = daliPeriodId;
  demoEl.checked = !!demoMode;
});

document.getElementById("save").addEventListener("click", async () => {
  const daliBase = baseEl.value.trim().replace(/\/$/, "");
  const daliPeriodId = periodEl.value.trim();
  const demoMode = demoEl.checked;
  await chrome.storage.sync.set({ daliBase, daliPeriodId, demoMode });
  statusEl.textContent = "Saved ✓";
  setTimeout(() => { statusEl.textContent = ""; }, 2000);
});
