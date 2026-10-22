import { describe, expect, it, vi } from "vitest";

vi.mock("~/components/ui/toast", () => ({ useToast: () => ({ error: vi.fn() }) }));

import { pendingForm, pendingJson } from "~/calendar/lib/fetcher-pending";

const form = new FormData();
form.set("intent", "x");

describe("pendingForm", () => {
  it("is the form while the fetcher is working on it", () => {
    expect(pendingForm({ state: "submitting", formData: form })).toBe(form);
    expect(pendingForm({ state: "loading", formData: form, data: null })).toBe(form);
  });

  it("is nothing once idle", () => {
    expect(pendingForm({ state: "idle", formData: form })).toBeUndefined();
  });

  it("is nothing when the action answered with an error", () => {
    expect(pendingForm({ state: "loading", formData: form, data: { error: "no" } })).toBeUndefined();
  });

  it("is the form for a retry that still carries the last attempt's error", () => {
    expect(pendingForm({ state: "submitting", formData: form, data: { error: "no" } })).toBe(form);
  });

  it("is nothing without a form", () => {
    expect(pendingForm({ state: "submitting" })).toBeUndefined();
  });
});

describe("pendingJson", () => {
  it("is the body while in flight and nothing after an error or when idle", () => {
    const json = { proposalId: "p1" };
    expect(pendingJson({ state: "submitting", json })).toBe(json);
    expect(pendingJson({ state: "idle", json })).toBeUndefined();
    expect(pendingJson({ state: "loading", json, data: { error: "no" } })).toBeUndefined();
    expect(pendingJson({ state: "submitting" })).toBeUndefined();
    expect(pendingJson({ state: "submitting", json, data: { error: "no" } })).toBe(json);
  });
});
