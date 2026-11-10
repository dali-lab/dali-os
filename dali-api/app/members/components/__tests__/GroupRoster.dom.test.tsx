// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { DialogProvider } from "~/components/ui/dialog";
import { GroupRoster, type MemberCardData } from "../GroupRoster";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const member = (n: number): MemberCardData => ({
  id: `u${n}`,
  firstName: `Ada${n}`,
  lastName: "Tester",
  daliEmail: `ada${n}@example.edu`,
  photoUrl: null,
  coreTitles: [],
  domainRoles: [],
  isCurrentMember: true,
});
const many = (count: number) => Array.from({ length: count }, (_, i) => member(i));
const byId = (members: MemberCardData[]) => new Map(members.map((m) => [m.id, m]));

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function mount(Component: () => ReturnType<typeof createElement>) {
  const Stub = createRoutesStub([{ path: "/", Component }]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Stub, { initialEntries: ["/"] }));
  });
}

const roster = (props: { ids: string[]; members: MemberCardData[]; removable: boolean; groupId?: string }) => () =>
  createElement(
    DialogProvider,
    null,
    createElement(GroupRoster, {
      memberIds: props.ids,
      membersById: byId(props.members),
      removable: props.removable,
      groupId: props.groupId ?? "g1",
    }),
  );
const cards = () => container.querySelectorAll('a[href^="/members/"]');
const loadMore = () =>
  [...container.querySelectorAll("button")].find((b) => b.textContent === "Load more") as HTMLButtonElement | undefined;

describe("GroupRoster", () => {
  it("shows every member of a small group with no pager", async () => {
    const members = many(5);
    await mount(roster({ ids: members.map((m) => m.id), members, removable: true }));
    expect(cards()).toHaveLength(5);
    expect(loadMore()).toBeUndefined();
  });

  it("slices a large group to 50 and Load more reveals the rest", async () => {
    const members = many(130);
    await mount(roster({ ids: members.map((m) => m.id), members, removable: false }));
    expect(cards()).toHaveLength(50);
    expect(container.textContent).toContain("Showing 50 of 130");
    await act(async () => loadMore()!.click());
    await act(async () => loadMore()!.click());
    expect(cards()).toHaveLength(130);
    expect(loadMore()).toBeUndefined();
  });

  it("counts unknown members toward the slice", async () => {
    const members = many(3);
    await mount(roster({ ids: ["u0", "gone", "u1", "u2"], members, removable: false }));
    expect(container.textContent).toContain("Unknown member");
    expect(cards()).toHaveLength(3);
  });

  it("keeps Remove on cards revealed by Load more, and only on removable groups", async () => {
    const members = many(60);
    const ids = members.map((m) => m.id);
    await mount(roster({ ids, members, removable: true }));
    expect(container.querySelectorAll('button[aria-label^="Remove"]')).toHaveLength(50);
    await act(async () => loadMore()!.click());
    const last = container.querySelector('button[aria-label="Remove Ada59 Tester from group"]');
    expect(last).not.toBeNull();
    const form = last!.closest("form")!;
    expect((form.querySelector('input[name="intent"]') as HTMLInputElement).value).toBe("remove-member");
    expect((form.querySelector('input[name="userId"]') as HTMLInputElement).value).toBe("u59");
    act(() => root.unmount());
    container.remove();
    await mount(roster({ ids, members, removable: false }));
    expect(container.querySelectorAll('button[aria-label^="Remove"]')).toHaveLength(0);
  });

  it("returns to the first slice for a different group", async () => {
    const members = many(120);
    const ids = members.map((m) => m.id);
    let swap: (id: string) => void = () => {};
    const { useState } = await import("react");
    function Harness() {
      const [groupId, setGroupId] = useState("g1");
      swap = setGroupId;
      return roster({ ids, members, removable: false, groupId })();
    }
    await mount(Harness);
    await act(async () => loadMore()!.click());
    expect(cards()).toHaveLength(100);
    await act(async () => swap("g2"));
    expect(cards()).toHaveLength(50);
  });
});
