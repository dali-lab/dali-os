// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { PersonalNotesRail } from "~/members/components/PersonalNotesRail";
import { NoteShareModal } from "~/members/components/NoteShareModal";
import { DialogProvider } from "~/components/ui/dialog";
import type { NoteSummary } from "~/members/lib/personal-notes.server";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const note = (extra: Partial<NoteSummary> = {}): NoteSummary => ({
  id: "n1",
  title: "Weekly prep",
  iconEmoji: null,
  kind: "Document",
  parentPageId: null,
  visibility: "public",
  labListing: "Listed",
  updatedAt: "2026-10-01T00:00:00Z",
  tags: [],
  shareCount: 0,
  owner: null,
  ...extra,
});

let container: HTMLDivElement;
let root: Root;

async function mount(node: () => ReturnType<typeof createElement>) {
  vi.stubGlobal("fetch", vi.fn(async () => ({ json: async () => ({}) })));
  const Stub = createRoutesStub([{ path: "/", Component: node }]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Stub, { initialEntries: ["/"] }));
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 0));
  });
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

describe("lab-wide mark in the members components", () => {
  it("marks a note listed lab-wide with the people icon and a Lab pill", async () => {
    await mount(() =>
      createElement(PersonalNotesRail, {
        ownerId: "u1",
        ownerFirstName: "Ada",
        isSelf: true,
        notes: [note()],
        sharedWithMe: [],
        onOpenNote: vi.fn(),
      }),
    );
    const mark = container.querySelector('[aria-label="Listed lab-wide"]')!;
    expect(mark.textContent).toBe("Lab");
    expect(mark.querySelector(".lucide-users")).not.toBeNull();
    expect(container.querySelector(".lucide-landmark")).toBeNull();
  });

  it("heads the share dialog's lab listing section with the people icon", async () => {
    await mount(() =>
      createElement(DialogProvider, null, createElement(NoteShareModal, { note: note(), open: true, onClose: vi.fn(), onChanged: vi.fn() })),
    );
    const heading = Array.from(document.querySelectorAll("h3")).find((h) => h.textContent?.includes("Lab Documents page"))!;
    expect(heading.querySelector(".lucide-users")).not.toBeNull();
    expect(heading.querySelector(".lucide-landmark")).toBeNull();
  });
});
