// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { createRoutesStub } from "react-router";
import { DialogProvider } from "~/components/ui/dialog";
import { ProfileRequestButtons } from "../ProfileRequestButtons";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

type Props = Parameters<typeof ProfileRequestButtons>[0];

async function mount(overrides: Partial<Props>) {
  const props: Props = {
    isSelf: false,
    openTo: { coffeeChats: false, resumeReviews: false },
    firstName: "Ada",
    coffeeChatSent: false,
    resumeReviewSent: false,
    ...overrides,
  };
  const Stub = createRoutesStub([{ path: "/", Component: () => createElement(DialogProvider, null, createElement(ProfileRequestButtons, props)) }]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Stub, { initialEntries: ["/"] }));
  });
}

const labels = () => Array.from(container.querySelectorAll("button")).map((b) => b.textContent?.trim());

describe("ProfileRequestButtons", () => {
  it("shows only the coffee chat button when only coffee chats are on", async () => {
    await mount({ openTo: { coffeeChats: true, resumeReviews: false } });
    expect(labels()).toEqual(["Coffee chat"]);
  });

  it("shows only the resume review button when only resume reviews are on", async () => {
    await mount({ openTo: { coffeeChats: false, resumeReviews: true } });
    expect(labels()).toEqual(["Resume review"]);
  });

  it("shows both buttons when both are on", async () => {
    await mount({ openTo: { coffeeChats: true, resumeReviews: true } });
    expect(labels()).toEqual(["Coffee chat", "Resume review"]);
  });

  it("shows nothing when the person is open to neither", async () => {
    await mount({});
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  it("shows nothing on your own profile", async () => {
    await mount({ isSelf: true, openTo: { coffeeChats: true, resumeReviews: true } });
    expect(container.querySelectorAll("button")).toHaveLength(0);
  });

  it("keeps a sent coffee chat disabled without affecting the resume review button", async () => {
    await mount({ openTo: { coffeeChats: true, resumeReviews: true }, coffeeChatSent: true });
    const [coffee, resume] = Array.from(container.querySelectorAll("button"));
    expect(coffee.textContent?.trim()).toBe("Coffee chat invite sent");
    expect(coffee.disabled).toBe(true);
    expect(resume.disabled).toBe(false);
  });
});
