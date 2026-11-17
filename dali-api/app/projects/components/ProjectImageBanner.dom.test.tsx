// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";

vi.mock("react-router", async (orig) => ({
  ...(await orig<typeof import("react-router")>()),
  useFetcher: () => ({ state: "idle", submit: vi.fn() }),
}));
vi.mock("~/components/PhotoCropModal", () => ({ PhotoCropModal: () => null }));
vi.mock("~/components/ui/dialog", () => ({ useDialog: () => ({ confirm: vi.fn() }) }));

import { renderDom } from "~/test-utils/render";
import { ProjectImageBanner } from "./ProjectImageBanner";

const base = { projectId: "p1", projectName: "Atlas", canEdit: false };

describe("ProjectImageBanner fallback cover", () => {
  it("shows the project's pattern cover when there is no image", () => {
    const { container } = renderDom(<ProjectImageBanner {...base} initialPreviewUrl={null} fallbackCover="pattern:poster?c=forest" />);
    const thumb = container.querySelector('[data-testid="cover-thumb"]') as HTMLElement;
    expect(thumb.style.backgroundColor).toBe("var(--art-forest)");
    expect(container.textContent).not.toContain("A");
  });

  it("prefers an image, and keeps the default banner with no cover", () => {
    const withImg = renderDom(<ProjectImageBanner {...base} initialPreviewUrl="https://x.example/a.png" fallbackCover="pattern:poster" />).container;
    expect(withImg.querySelector("img")).not.toBeNull();
    expect(withImg.querySelector('[data-testid="cover-thumb"]')).toBeNull();
    const none = renderDom(<ProjectImageBanner {...base} initialPreviewUrl={null} />).container;
    expect(none.textContent).toContain("A");
  });
});
