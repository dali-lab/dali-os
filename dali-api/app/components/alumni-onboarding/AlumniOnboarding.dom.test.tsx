// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RouterProvider, createMemoryRouter } from "react-router";
import { AlumniOnboarding, type OnboardingView } from "./AlumniOnboarding";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const data: OnboardingView = {
  firstName: "Ada",
  fullName: "Ada Lovelace",
  classYear: 2024,
  majors: ["Computer Science", "Studio Art"],
  minors: ["Economics"],
  hometown: "Portland, Oregon",
  basedIn: {
    currentLocation: "Brooklyn, New York",
    currentLocationGeonameId: 5110302,
    currentLocationLat: 40.6,
    currentLocationCity: "Brooklyn",
    currentLocationRegion: "New York",
    currentLocationCountry: "United States",
  },
  emails: { onFile: ["ada@dali.dartmouth.edu"], personal: "ada@example.com", preferred: null },
  linkedinUrl: "",
  personalSite: "",
  birthday: "",
  dietaryRestrictions: "",
  dali: { projectCount: 3, termCount: 6, projectNames: ["Habitat Map", "Hood Museum AR"], rolesLine: "Developer, then design lead" },
  now: { id: "w1", position: "Product designer", company: "Spotify", location: "New York", year: null },
  before: { id: "w2", position: "Design intern", company: "Etsy", location: null, year: 2023 },
  funFact: "",
  outsideOfWork: "",
  askMeAbout: [],
  openTo: { coffeeChats: true, resumeReviews: false, partnerReferrals: false, mentoring: false, speaking: false },
  photoUrl: null,
  blockId: "t4",
  nameTag: { name: "Ada Lovelace '24", subtitle: "Product designer, Spotify" },
  worthALook: {
    connect: { title: "Alumni in New York", detail: "31 nearby on Connect" },
    peers: { detail: "4 people who also worked on Habitat Map" },
  },
};

let container: HTMLDivElement;
let root: Root;
const posts: Record<string, string>[] = [];

function mount(view: OnboardingView, reply: unknown = { ok: true }) {
  posts.length = 0;
  const router = createMemoryRouter(
    [
      {
        path: "/",
        element: createElement(AlumniOnboarding, { data: view }),
        action: async ({ request }) => {
          posts.push(Object.fromEntries(await request.formData()) as Record<string, string>);
          return Response.json(reply);
        },
      },
    ],
    { initialEntries: ["/"] },
  );
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(RouterProvider, { router })));
}

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const button = (label: string) =>
  [...container.querySelectorAll("button")].find((b) => b.textContent?.trim() === label) as HTMLButtonElement;

async function click(label: string) {
  await act(async () => {
    button(label).click();
  });
}

describe("onboarding flow", () => {
  it("opens on the details step with the prefilled rows and 8 of 18 blocks", () => {
    mount(data);
    const text = container.textContent ?? "";
    expect(text).toContain("Welcome back,");
    expect(text).toContain("Check your details");
    expect(text).toContain("Class of 2024");
    expect(text).toContain("Computer Science and Studio Art, Economics minor");
    expect(text).toContain("Brooklyn, New York");
    expect(text).toContain("ada@example.com");
    expect(text).not.toContain("LinkedIn");
    expect(text).toContain("3 projects, 6 terms");
    expect(text).toContain("Developer, then design lead");
    expect(text).toContain("Product designer at Spotify");
    expect(text).toContain("Design intern at Etsy, 2023");
    expect(text).toContain("8");
    expect(text).toContain("of 18");
  });

  it("walks through interests and open-to, saving each step, then shows the finish", async () => {
    mount(data);
    await click("Looks good");
    expect(container.textContent).toContain("Step 2 of 3");
    expect(container.textContent).toContain("13");

    await click("Grad school");
    await click("Next");
    expect(posts[0]).toMatchObject({ intent: "save-about", askMeAbout: '["Grad school"]' });
    expect(container.textContent).toContain("What are you open to?");

    const partner = container.querySelector('input[aria-label="Partner referrals"]') as HTMLInputElement;
    await act(async () => {
      partner.click();
    });
    await click("Finish");
    expect(posts[1]).toEqual({ intent: "finish", coffeeChats: "on", partnerReferrals: "on" });
    expect(container.textContent).toContain("You're all set,");
    expect(container.textContent).toContain("Worth a look");
    expect(container.textContent).toContain("Ada Lovelace '24");
  });

  it("stays on the step and shows the error when a save is rejected", async () => {
    mount(data, { error: "Pick up to 10 topics, 40 characters each." });
    await click("Looks good");
    await click("Next");
    expect(container.textContent).toContain("Step 2 of 3");
    expect(container.textContent).toContain("Pick up to 10 topics, 40 characters each.");
  });

  it("goes back a step without saving", async () => {
    mount(data);
    await click("Looks good");
    await click("Back");
    expect(container.textContent).toContain("Check your details");
    expect(posts).toHaveLength(0);
  });

  it("offers a way out on every step but the last, and no game link at the end", async () => {
    mount(data);
    const exit = () => [...container.querySelectorAll("a")].find((a) => a.textContent?.includes("Finish later"));
    expect(exit()?.getAttribute("href")).toBe("/");
    await click("Looks good");
    expect(exit()).toBeTruthy();
    await click("Next");
    expect(exit()).toBeTruthy();
    await click("Finish");
    expect(exit()).toBeUndefined();
    expect(container.textContent).not.toContain("pixel lab");
  });

  it("shows the DALI record read-only and sends a correction from it", async () => {
    mount(data);
    const card = button("Anything off?").closest("div.rounded-os-card") as HTMLElement;
    expect([...card.querySelectorAll("button")].map((b) => b.textContent)).toEqual(["Anything off?"]);
    expect(card.textContent).toContain("3 projects, 6 terms");
    await click("Anything off?");
    const note = container.querySelector('textarea[name="note"]') as HTMLTextAreaElement;
    await act(async () => {
      note.value = "Also on Rauner Archive in 24W";
      (note.closest("form") as HTMLFormElement).requestSubmit();
    });
    expect(posts[0]).toEqual({ intent: "report-history", note: "Also on Rauner Archive in 24W" });
    expect(container.textContent).toContain("Sent to DALI staff");
    expect(button("Anything off?")).toBeUndefined();
  });

  it("edits majors and minors as lists in the class row", async () => {
    mount(data);
    await act(async () => {
      [...container.querySelectorAll("button")].find((b) => b.textContent === "Edit")!.click();
    });
    await click("Economics");
    await act(async () => {
      (container.querySelector('input[name="majors"]')!.closest("form") as HTMLFormElement).requestSubmit();
    });
    expect(posts[0]).toMatchObject({
      intent: "save-class",
      classYear: "2024",
      majors: '["Computer Science","Studio Art"]',
      minors: "[]",
    });
  });
});
