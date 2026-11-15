// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { RouterProvider, createMemoryRouter } from "react-router";
import { renderDom, click } from "~/test-utils/render";

vi.mock("~/lib/db.server", () => ({ prisma: {} }));
vi.mock("../../components/PartnerSettingsModal", () => ({
  PartnerSettingsModal: ({ board }: { board?: unknown }) => (
    <div data-testid="settings" data-board={board ? "yes" : "no"} />
  ),
}));

import Layout from "../partners-crm-layout";
import Referrals from "../core.partners.referrals";
import { PageRowControls } from "~/components/os-page";
import { Plus } from "lucide-react";

const referrals = [
  { id: "1", partnerName: "Ada Lovelace", partnerEmail: "ada@example.edu", partnerOrgName: "Analytical Co", referrerName: "Grace", tier: "Warm", status: "New", createdAt: "2026-11-01T00:00:00Z" },
  { id: "2", partnerName: "Alan Turing", partnerEmail: "alan@example.edu", partnerOrgName: "Bletchley Co", referrerName: "Grace", tier: "Cold", status: "New", createdAt: "2026-11-02T00:00:00Z" },
];

const onNew = vi.fn();

function Page({ name }: { name: string }) {
  return (
    <>
      <PageRowControls
        controls={[
          { kind: "search", key: "search", label: `${name} search`, value: "", onChange: () => {} },
          { key: "new", label: `New ${name}`, icon: Plus, primary: true, onClick: onNew },
        ]}
      />
      <p>{name} content</p>
    </>
  );
}

function mount(path: string) {
  const router = createMemoryRouter(
    [
      {
        Component: Layout,
        children: [
          { path: "/core/partners", element: <Page name="board" /> },
          { path: "/core/partners/renewals", element: <Page name="renewals" /> },
          {
            path: "/core/partners/referrals",
            loader: () => ({ referrals }),
            Component: Referrals,
          },
        ],
      },
    ],
    { initialEntries: [path] },
  );
  const view = renderDom(<RouterProvider router={router} />);
  return { router, ...view };
}

const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe("Partner CRM layout", () => {
  it("links every tab to its route and marks the open one", async () => {
    const { container } = mount("/core/partners/renewals");
    await settle();
    const links = [...container.querySelectorAll<HTMLAnchorElement>('nav[aria-label="Partners"] a')];
    expect(links.map((a) => [a.textContent, a.getAttribute("href")])).toEqual([
      ["Applications", "/core/partners"],
      ["Renewals", "/core/partners/renewals"],
      ["Planning", "/core/partners/planning"],
      ["Directory", "/core/partners/directory"],
      ["Referrals", "/core/partners/referrals"],
      ["Reports", "/core/partners/reports"],
    ]);
    expect(links.filter((a) => a.getAttribute("aria-current") === "page").map((a) => a.textContent)).toEqual(["Renewals"]);
  });

  it("marks only Applications on the bare route", async () => {
    const { container } = mount("/core/partners");
    await settle();
    const current = container.querySelectorAll('nav[aria-label="Partners"] a[aria-current="page"]');
    expect([...current].map((a) => a.textContent)).toEqual(["Applications"]);
  });

  it("keeps the header node across a page switch and swaps the controls", async () => {
    const { container, router } = mount("/core/partners");
    await settle();
    const header = container.querySelector("h1")!;
    expect(header.textContent).toBe("Partners");
    expect(container.querySelector('[aria-label="board search"]')).not.toBeNull();
    await act(async () => { await router.navigate("/core/partners/renewals"); });
    expect(container.querySelector("h1")).toBe(header);
    expect(container.querySelector('[aria-label="board search"]')).toBeNull();
    expect(container.querySelector('[aria-label="renewals search"]')).not.toBeNull();
  });

  it("renders page controls in the row, not in the content, and runs the primary action", async () => {
    const { container } = mount("/core/partners");
    await settle();
    const row = container.querySelector("[data-density]")!;
    const primary = [...container.querySelectorAll("button")].find((b) => b.textContent === "New board")!;
    expect(row.contains(primary)).toBe(true);
    expect(row.contains(container.querySelector('[aria-label="board search"]'))).toBe(true);
    click(primary);
    expect(onNew).toHaveBeenCalledOnce();
  });

  it("opens settings from the gear on any tab, with board display only on Applications", async () => {
    const board = mount("/core/partners");
    await settle();
    expect(board.container.querySelector('[data-testid="settings"]')).toBeNull();
    click(board.container.querySelector('button[aria-label="Partner settings"]')!);
    expect(board.container.querySelector('[data-testid="settings"]')!.getAttribute("data-board")).toBe("yes");
    expect(board.router.state.location.search).toBe("?settings=1");
    board.unmount();

    const other = mount("/core/partners/renewals?settings=1");
    await settle();
    expect(other.container.querySelector('[data-testid="settings"]')!.getAttribute("data-board")).toBe("no");
  });

  it("keeps referral search working inside the row", async () => {
    const { container } = mount("/core/partners/referrals");
    await settle();
    expect(container.textContent).toContain("Ada Lovelace");
    expect(container.textContent).toContain("Alan Turing");
    const search = container.querySelector<HTMLInputElement>('input[aria-label="Search referrals"]')!;
    expect(container.querySelector("[data-density]")!.contains(search)).toBe(true);
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    await act(async () => {
      set.call(search, "turing");
      search.dispatchEvent(new Event("input", { bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(container.textContent).not.toContain("Ada Lovelace");
    expect(container.textContent).toContain("Alan Turing");
  });
});
