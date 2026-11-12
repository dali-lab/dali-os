// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { ToastProvider } from "~/components/ui/toast";
import { DialogProvider } from "~/components/ui/dialog";
import { SessionsTab } from "../SessionsTab";
import { WEEKDAYS } from "../manage-ui";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const data = {
  offering: { id: "off1", type: "Course", sessions: [] },
  materials: [],
  offeringFiles: [],
  assignments: [],
  attendanceMatrix: { students: [], sessions: [] },
} as never;

let container: HTMLDivElement;
let root: Root;

async function mount() {
  const Stub = createRoutesStub([
    { path: "/", Component: () => <SessionsTab data={data} />, loader: () => null },
  ]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () =>
    root.render(
      createElement(
        ToastProvider,
        null,
        createElement(DialogProvider, null, createElement(Stub, { initialEntries: ["/"] })),
      ),
    ),
  );
  await act(async () => {});
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

describe("SessionsTab generate series", () => {
  it("posts weekday chips as getDay() indices, Sunday first", async () => {
    await mount();
    const open = Array.from(document.body.querySelectorAll("button")).find((b) =>
      /Generate weekly series/.test(b.textContent ?? ""),
    );
    expect(open).toBeTruthy();
    await act(async () => open!.click());
    const boxes = Array.from(
      document.body.querySelectorAll<HTMLInputElement>('input[name="weekdays"]'),
    );
    expect(boxes.map((b) => b.value)).toEqual(["0", "1", "2", "3", "4", "5", "6"]);
    expect(WEEKDAYS[0]).toBe("Su");
  });
});
