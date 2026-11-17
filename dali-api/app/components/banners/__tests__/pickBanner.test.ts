import { describe, expect, it } from "vitest";
import { pickBanner } from "~/components/banners/BannerHost";
import type { BannerDTO } from "~/core/lib/banners.server";

const b = (id: string, trigger: "AppOpen" | "Page", triggerPath: string | null = null) =>
  ({ id, trigger, triggerPath, untilFormId: null }) as BannerDTO;

describe("pickBanner", () => {
  const live = [b("open", "AppOpen"), b("cal", "Page", "/calendar")];

  it("opens the app-open banner only on the first load, and not in a page-scoped embed", () => {
    expect(pickBanner(live, "all", "/", true, new Set())?.id).toBe("open");
    expect(pickBanner(live, "all", "/", false, new Set())).toBeNull();
    expect(pickBanner(live, "page", "/", true, new Set())).toBeNull();
  });

  it("opens a page banner when its page is visited", () => {
    expect(pickBanner(live, "page", "/calendar/meeting/1", false, new Set())?.id).toBe("cal");
    expect(pickBanner(live, "all", "/calendar", false, new Set())?.id).toBe("cal");
  });

  it("never opens the same banner twice in one document", () => {
    expect(pickBanner(live, "all", "/calendar", true, new Set(["open"]))?.id).toBe("cal");
    expect(pickBanner(live, "all", "/calendar", true, new Set(["open", "cal"]))).toBeNull();
  });
});
