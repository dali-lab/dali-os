const baseEl = document.getElementById("base");
const periodEl = document.getElementById("period");
const statusEl = document.getElementById("status");

chrome.storage.sync.get(["daliBase", "daliPeriodId"]).then(({ daliBase, daliPeriodId }) => {
  if (daliBase) baseEl.value = daliBase;
  if (daliPeriodId) periodEl.value = daliPeriodId;
});

document.getElementById("save").addEventListener("click", async () => {
  const daliBase = baseEl.value.trim().replace(/\/$/, "");
  const daliPeriodId = periodEl.value.trim();
  await chrome.storage.sync.set({ daliBase, daliPeriodId });
  statusEl.textContent = "Saved ✓";
  setTimeout(() => { statusEl.textContent = ""; }, 2000);
});
