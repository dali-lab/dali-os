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

function show(consent?: typeof CONSENT) {
  const mounted = mountDom(createElement(RecordStartSheet, { rec: makeRec(), consent }));
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
});
