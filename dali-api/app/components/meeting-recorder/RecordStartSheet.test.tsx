// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { act, createElement } from "react";
import { RecordStartSheet } from "./RecordStartSheet";
import { makeRec, mountDom } from "./test-support";

const CONSENT = {
  title: "Record this interview",
  ask: "Ask the applicant if you can record.",
  confirm: "The applicant said yes",
};

let unmount: (() => void) | null = null;
afterEach(() => {
  unmount?.();
  unmount = null;
});

function show(consent?: typeof CONSENT, rec = makeRec()) {
  const mounted = mountDom(createElement(RecordStartSheet, { rec, consent }));
  unmount = mounted.unmount;
  const start = () =>
    [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Start recording"))!;
  return { start };
}

describe("RecordStartSheet", () => {
  it("starts right away when nobody's permission is needed", () => {
    const { start } = show();
    expect(document.body.textContent).toContain("Record this meeting");
    expect(start().disabled).toBe(false);
  });

  it("asks for permission and holds Start until it's confirmed", () => {
    const { start } = show(CONSENT);
    expect(document.body.textContent).toContain("Record this interview");
    expect(document.body.textContent).toContain("Ask the applicant if you can record.");
    expect(start().disabled).toBe(true);

    const box = document.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    act(() => box.click());
    expect(start().disabled).toBe(false);
  });

  it("offers no source choice with the native recorder and starts it", () => {
    const rec = makeRec({ desktopVer: "0.1.21", useDesktopApp: true });
    const { start } = show(undefined, rec);
    expect(document.querySelector('input[type="radio"]')).toBeNull();
    expect(document.body.textContent).not.toContain("browser instead");
    expect(document.body.textContent).not.toContain("Microphone");
    act(() => start().click());
    expect(rec.startDesktop).toHaveBeenCalled();
    expect(rec.startBrowser).not.toHaveBeenCalled();
  });

  it("records through the webview, with no call audio toggle, in a shell without the native recorder", () => {
    const rec = makeRec({ desktopVer: "0.1.21", useDesktopApp: false });
    const { start } = show(undefined, rec);
    expect(document.querySelector('input[type="radio"]')).toBeNull();
    expect(document.body.textContent).toContain("Microphone");
    expect(document.body.textContent).not.toContain("Include call audio");
    act(() => start().click());
    expect(rec.startBrowser).toHaveBeenCalled();
  });

  it("keeps the mic picker and call audio toggle in a regular browser", () => {
    show(undefined, makeRec({ desktopVer: null, useDesktopApp: false }));
    expect(document.body.textContent).toContain("Microphone");
    expect(document.body.textContent).toContain("Include call audio");
  });
});
