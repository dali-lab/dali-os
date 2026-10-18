import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");

const FILES = [
  "admin/routes/admin.payroll.tsx",
  "admin/routes/admin.tsx",
  "admin/routes/admin.payroll-export.tsx",
  "admin/components/PayrollBudgetPanel.tsx",
  "admin/routes/admin.infrastructure.tsx",
  "hiring/components/InternalCyclePortalView.tsx",
  "hiring/routes/waitlists.tsx",
  "hiring/components/ConfidentialityAgreementDetail.tsx",
  "hiring/routes/cycles.$cycleId.confidentiality.tsx",
  "signing/components/SigningDocumentsPage.tsx",
  "signing/routes/sign._index.tsx",
  "signing/components/SigningFillView.tsx",
  "education/routes/education.manage.assignments.$assignmentId.tsx",
  "education/components/CertificateTemplateEditor.tsx",
];

describe("admin, hiring, signing and education surfaces", () => {
  it.each(FILES)("%s uses no brand coral", (file) => {
    expect(read(file)).not.toMatch(/accent-coral(?!-light)/);
  });

  // Raw Tailwind red/amber/green are light-only; the os and destructive
  // tokens carry a dark value, so warnings and errors stay readable there.
  it.each(FILES)("%s uses theme tokens, not raw red, amber or green", (file) => {
    expect(read(file)).not.toMatch(/\b(text|bg|border)-(red|amber|green)-\d{2,3}\b/);
  });

  it("shows waitlist errors in the destructive colour", () => {
    const src = read("hiring/routes/waitlists.tsx");
    expect(src).toContain('text-destructive">{fetcher.data.error}');
    expect(src).toContain('text-destructive">{reorderFetcher.data.error}');
  });
});
