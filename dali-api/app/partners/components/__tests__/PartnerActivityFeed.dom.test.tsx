// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { PartnerActivityFeed, partnerActivityUrl, type PartnerActivity } from "../PartnerActivityFeed";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const note = (id: string, body: string, actorUserId: string | null = null): PartnerActivity => ({
  id,
  createdAt: "2026-10-01T12:00:00.000Z",
  applicationId: null,
  actorUserId,
  type: "Note",
  body,
  metadata: null,
});

let root: Root | null = null;
let container: HTMLDivElement;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  vi.unstubAllGlobals();
});

function render(props: { activities: PartnerActivity[]; nextCursor: string | null }) {
  if (!root) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  }
  act(() =>
    root!.render(
      createElement(PartnerActivityFeed, {
        ...props,
        scope: { orgId: "o1" },
        actorNames: { u1: "Ada Lovelace" },
        canEdit: false,
      }),
    ),
  );
}

const loadMoreButton = () =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === "Load more");

describe("PartnerActivityFeed paging", () => {
  it("builds the older-page url from the scope and cursor", () => {
    expect(partnerActivityUrl({ orgId: "o1" }, "a|b")).toBe("/api/partner-activity?orgId=o1&cursor=a%7Cb");
    expect(partnerActivityUrl({ contactId: "c1" }, "a|b")).toBe("/api/partner-activity?contactId=c1&cursor=a%7Cb");
  });

  it("shows no Load more on the last page", () => {
    render({ activities: [note("a1", "First")], nextCursor: null });
    expect(loadMoreButton()).toBeUndefined();
  });

  it("appends older rows with their actor names and hides the button at the end", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        items: [note("a0", "Older", "u1")],
        nextCursor: null,
        actorNames: { u1: "Ada Lovelace" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    render({ activities: [note("a1", "First")], nextCursor: "2026-10-01T12:00:00.000Z|a1" });

    await act(async () => loadMoreButton()!.click());

    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/partner-activity?orgId=o1&cursor=2026-10-01T12%3A00%3A00.000Z%7Ca1",
    );
    expect(container.textContent).toContain("First");
    expect(container.textContent).toContain("Older");
    expect(container.textContent).toContain("Ada Lovelace");
    expect(loadMoreButton()).toBeUndefined();
  });

  it("shows a newly logged activity after the loader refreshes, keeping older rows", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ items: [note("a0", "Older")], nextCursor: null }),
      }),
    );
    render({ activities: [note("a1", "First")], nextCursor: "2026-10-01T12:00:00.000Z|a1" });
    await act(async () => loadMoreButton()!.click());

    render({ activities: [note("a2", "Just logged"), note("a1", "First")], nextCursor: "2026-10-01T12:00:00.000Z|a1" });

    expect(container.textContent).toContain("Just logged");
    expect(container.textContent).toContain("Older");
  });
});
