import { describe, expect, it, vi } from "vitest";

vi.mock("~/lib/auth", () => ({ requireAuth: vi.fn(), forbidden: vi.fn() }));
vi.mock("~/lib/login-next", () => ({ redirectToLogin: vi.fn() }));
vi.mock("~/lib/roles", () => ({ isCore: vi.fn() }));
vi.mock("~/education/lib/certificate-templates.server", () => ({
  getCertificateTemplate: vi.fn(),
  getCertificateTemplateBgUrl: vi.fn(),
  renameCertificateTemplate: vi.fn(),
  saveCertificateTemplateFields: vi.fn(),
}));
vi.mock("~/education/components/CertificateTemplateEditor", () => ({ CertificateTemplateEditor: () => null }));

import type { ShouldRevalidateFunctionArgs } from "react-router";
import { shouldRevalidate } from "../education.certificate-templates.$templateId";

const args = (intent: string | null, defaultShouldRevalidate = true) => {
  const formData = intent === null ? undefined : new FormData();
  if (formData && intent) formData.set("intent", intent);
  return { formData, defaultShouldRevalidate } as unknown as ShouldRevalidateFunctionArgs;
};

describe("certificate template editor shouldRevalidate", () => {
  it("skips reloading the template after an autosave", () => {
    expect(shouldRevalidate(args("save-fields"))).toBe(false);
  });

  it("reloads as usual after a rename", () => {
    expect(shouldRevalidate(args("rename"))).toBe(true);
  });

  it("follows the default for navigations", () => {
    expect(shouldRevalidate(args(null, false))).toBe(false);
    expect(shouldRevalidate(args(null, true))).toBe(true);
  });
});
