import { Panel } from "./panel";
import type { WorkerPush } from "./messages";

declare global {
  interface Window {
    __daliTimesheetMounted?: boolean;
  }
}

// Guard against the content script being injected twice into the same page.
if (!window.__daliTimesheetMounted) {
  window.__daliTimesheetMounted = true;

  const panel = new Panel();

  const onTimesheet = () =>
    !!document.querySelector(".timesheetAddEntryTable, [id*='TimesheetList'], [id*='QuickDate']");

  // Auto-show on a timesheet page; elsewhere on JobX stay hidden until the
  // toolbar icon is clicked. The grid can arrive via postback, so watch for it.
  if (!onTimesheet()) {
    panel.toggle(); // hide
    const observer = new MutationObserver(() => {
      if (onTimesheet()) {
        if (panel.hidden) panel.toggle();
        observer.disconnect();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  chrome.runtime.onMessage.addListener((message: WorkerPush) => {
    if (message.kind === "toggle-panel") panel.toggle();
  });
}
