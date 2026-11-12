import type { CycleApplicants } from "~/generated/prisma/enums";

/** Where an applicant fills in this cycle's application. */
export function applicantPortalPath(a: CycleApplicants, cycleId: string): string {
  switch (a) {
    case "Students":
      return `/portal/apply/${cycleId}`;
    case "Interns":
      return `/fellowship/${cycleId}`;
    case "LabMembers":
      return `/core/apply/${cycleId}`;
  }
}
