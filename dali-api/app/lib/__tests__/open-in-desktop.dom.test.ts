// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  desktopOpenUrl,
  isOpenInDesktopExcluded,
  openInDesktopApp,
  OPEN_IN_DESKTOP_FALLBACK_MS,
} from "~/lib/open-in-desktop";
import { parseOpenInAppCookie, readOpenInAppCookie, writeOpenInAppCookie } from "~/lib/open-in-app-pref";

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(window, "location", "get").mockReturnValue({ href: "", pathname: "/", search: "", hash: "" } as Location);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("desktopOpenUrl", () => {
  it("encodes the path into the dalios deep link", () => {
    expect(desktopOpenUrl("/projects/a?x=1#h")).toBe("dalios://open?link=%2Fprojects%2Fa%3Fx%3D1%23h");
  });
});

describe("openInDesktopApp", () => {
  it("points the window at the deep link", () => {
    const loc = { href: "" } as Location;
    vi.spyOn(window, "location", "get").mockReturnValue(loc);
    openInDesktopApp("/a", { onFallback: vi.fn() });
    expect(loc.href).toBe("dalios://open?link=%2Fa");
  });

  it("falls back when focus is kept", () => {
    const onFallback = vi.fn();
    openInDesktopApp("/a", { onFallback });
    vi.advanceTimersByTime(OPEN_IN_DESKTOP_FALLBACK_MS);
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it("does not fall back after a blur", () => {
    const onFallback = vi.fn();
    const onOpened = vi.fn();
    openInDesktopApp("/a", { onFallback, onOpened });
    window.dispatchEvent(new Event("blur"));
    vi.advanceTimersByTime(OPEN_IN_DESKTOP_FALLBACK_MS * 2);
    expect(onFallback).not.toHaveBeenCalled();
    expect(onOpened).toHaveBeenCalledTimes(1);
  });

  it("does not fall back after the page is hidden", () => {
    const onFallback = vi.fn();
    openInDesktopApp("/a", { onFallback });
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    document.dispatchEvent(new Event("visibilitychange"));
    vi.advanceTimersByTime(OPEN_IN_DESKTOP_FALLBACK_MS * 2);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it("does not fall back once cancelled", () => {
    const onFallback = vi.fn();
    openInDesktopApp("/a", { onFallback })();
    vi.advanceTimersByTime(OPEN_IN_DESKTOP_FALLBACK_MS * 2);
    expect(onFallback).not.toHaveBeenCalled();
  });
});

describe("isOpenInDesktopExcluded", () => {
  it.each([
    ["/download", "", true],
    ["/settings", "", true],
    ["/settings/general", "", true],
    ["/login", "", true],
    ["/login/cas", "", true],
    ["/logout", "", true],
    ["/signup", "", true],
    ["/welcome", "", true],
    ["/auth/pair/x", "", true],
    ["/oauth/authorize", "", true],
    ["/link", "", true],
    ["/partner", "", true],
    ["/partner/projects", "", true],
    ["/portal/x", "", true],
    ["/api/notifications", "", true],
    ["/internal/jobs/tick", "", true],
    ["/projects", "?embed=1", true],
    ["/projects", "?embed=0", false],
    ["/projects/abc", "?tab=1", false],
    ["/", "", false],
    ["/settingsish", "", false],
    ["/linked", "", false],
    ["/authors", "", false],
  ])("%s%s -> %s", (path, search, expected) => {
    expect(isOpenInDesktopExcluded(path, search)).toBe(expected);
  });
});

describe("open-in-app cookie", () => {
  afterEach(() => {
    document.cookie = "dali_open_in_app=; Max-Age=0; Path=/";
  });

  it("parses on, off and missing", () => {
    expect(parseOpenInAppCookie("a=b; dali_open_in_app=1")).toBe(true);
    expect(parseOpenInAppCookie("dali_open_in_app=0")).toBe(false);
    expect(parseOpenInAppCookie("a=b")).toBe(false);
  });

  it("round-trips through document.cookie", () => {
    writeOpenInAppCookie(true);
    expect(readOpenInAppCookie()).toBe(true);
    writeOpenInAppCookie(false);
    expect(readOpenInAppCookie()).toBe(false);
  });
});
