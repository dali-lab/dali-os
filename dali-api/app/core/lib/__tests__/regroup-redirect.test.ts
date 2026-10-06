import { describe, it, expect } from "vitest";
import { regroupRedirect } from "~/core/lib/regroup-redirect.server";

const USER = "user_1";

function at(url: string) {
  return new Request(url);
}

describe("regroupRedirect", () => {
  it("sends the pre-regroup url to its canonical Core address", () => {
    const res = regroupRedirect(
      at("https://os.dali.dev/admin/email"),
      USER,
      "/admin/email",
      "/core/communications/email",
    );
    expect(res?.status).toBe(302);
    expect(res?.headers.get("location")).toBe("/core/communications/email");
  });

  // The email editor addresses one template with ?key=, so a bookmarked
  // deep-link has to survive the hop — losing it drops the operator on the list.
  it("carries the query string across", () => {
    const res = regroupRedirect(
      at("https://os.dali.dev/admin/email?key=hiring%3Adecision%3ARejected"),
      USER,
      "/admin/email",
      "/core/communications/email",
    );
    expect(res?.headers.get("location")).toBe(
      "/core/communications/email?key=hiring%3Adecision%3ARejected",
    );
  });

  it("carries sub-paths across", () => {
    const res = regroupRedirect(
      at("https://os.dali.dev/projects/intent-to-work/abc"),
      USER,
      "/projects/intent-to-work",
      "/core/intent-to-work",
    );
    expect(res?.headers.get("location")).toBe("/core/intent-to-work/abc");
  });

  // The alias re-exports the same loader, so the guard is the only thing
  // standing between the canonical path and a redirect loop.
  it("is inert on the canonical path", () => {
    expect(
      regroupRedirect(
        at("https://os.dali.dev/core/communications/email?key=auth%3Amagic_link"),
        USER,
        "/admin/email",
        "/core/communications/email",
      ),
    ).toBeNull();
  });

  // A sibling whose name merely starts with the redirected one keeps its own
  // page: /admin/email-senders is the transport config, not the editor.
  it("leaves a sibling path alone", () => {
    expect(
      regroupRedirect(
        at("https://os.dali.dev/admin/email-senders"),
        USER,
        "/admin/email",
        "/core/communications/email",
      ),
    ).toBeNull();
  });
});
