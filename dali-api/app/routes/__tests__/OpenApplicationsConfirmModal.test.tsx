import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("~/lib/db");
vi.mock("~/lib/auth", () => ({
  requireAuth: vi.fn(),
  withAuth: <T,>(_auth: unknown, value: T) => value,
}));
vi.mock("~/lib/roles");
vi.mock("~/lib/email");

import { OpenApplicationsConfirmModal } from "~/routes/admin.cycle.$id";

describe("OpenApplicationsConfirmModal", () => {
  const baseProps = {
    cycleId: "cycle-123",
    closeDate: null,
    onClose: () => {},
    onOpened: () => {},
    onError: () => {},
  };

  it("renders the irreversibility warning when shown", () => {
    const html = renderToStaticMarkup(
      createElement(OpenApplicationsConfirmModal, baseProps),
    );
    expect(html).toContain("Open applications for this cycle?");
    expect(html).toContain("This is irreversible for the cycle.");
  });

  it("warns that the general challenge and domain challenges are no longer editable", () => {
    const html = renderToStaticMarkup(
      createElement(OpenApplicationsConfirmModal, baseProps),
    );
    expect(html).toMatch(
      /general challenge and per-domain challenges will no longer be editable/i,
    );
  });

  it("renders Cancel and confirm buttons with the expected labels", () => {
    const html = renderToStaticMarkup(
      createElement(OpenApplicationsConfirmModal, baseProps),
    );
    expect(html).toContain(">Cancel<");
    expect(html).toContain(">Open applications<");
  });

  it("surfaces the configured close date in the warning copy when provided", () => {
    const closeDate = new Date("2026-05-15T23:59:59Z");
    const html = renderToStaticMarkup(
      createElement(OpenApplicationsConfirmModal, {
        ...baseProps,
        closeDate,
      }),
    );
    expect(html).toContain("Applications close:");
    // toLocaleDateString output varies by env locale, but the year/month
    // should appear in any common format — assert a stable substring.
    expect(html).toMatch(/2026/);
  });

  it("renders the dialog with role and aria-labelledby (a11y)", () => {
    const html = renderToStaticMarkup(
      createElement(OpenApplicationsConfirmModal, baseProps),
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="open-confirm-heading-cycle-123"');
  });
});
