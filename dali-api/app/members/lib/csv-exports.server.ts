import { defineCsvExport } from "~/lib/csv-export.server";
import { prisma } from "~/lib/db";
import { primaryEmail } from "~/lib/display";
import { graduateProgramLabel } from "~/lib/dartmouth-people";
import { LAB_MEMBER_WHERE, MEMBER_LIST_ORDER_BY } from "~/lib/prisma-shapes";
import { resolveTermFilter } from "~/lib/terms";
import { deriveCoreTitles } from "~/lib/core-titles";

// Members directory — mirrors app/members/routes/members.tsx loader. That
// page has no isCore/isAdmin gate beyond "authenticated and not an
// applicant" (applicants are bounced to /portal): every lab member can see
// every other lab member's directory row. The export replicates the exact
// same predicate, not a stricter or looser one.

defineCsvExport({
  id: "members-directory",
  filename: (ctx) => {
    const status = ctx.searchParams.get("status") === "alumni" ? "alumni" : "active";
    return `members-${status}-${new Date().toISOString().slice(0, 10)}.csv`;
  },
  authorize: async (ctx) => ctx.user.type !== "applicant",
  async rows(ctx) {
    const status = ctx.searchParams.get("status") === "alumni" ? "alumni" : "active";
    const { termId, isAll } = await resolveTermFilter(ctx.request);

    const activeInTerm =
      status === "alumni" || isAll || !termId
        ? {}
        : {
            OR: [
              { coreAssignments: { some: { termId } } },
              { projectAssignments: { some: { termId } } },
              { adminMembership: { isStaff: true } },
            ],
          };

    const domains = await prisma.domain.findMany({
      where: { active: true },
      select: { id: true },
    });
    const domainParam = ctx.searchParams.get("domain") ?? "";
    const domainId = domains.some((d) => d.id === domainParam) ? domainParam : "";
    const inDomain = domainId ? { domainEligibilities: { some: { domainId } } } : {};

    const alumniCondition = status === "alumni" ? { membershipStatus: "Alumni" as const } : {};

    const users = await prisma.user.findMany({
      where: { ...LAB_MEMBER_WHERE, ...activeInTerm, ...inDomain, ...alumniCondition },
      orderBy:
        status === "alumni"
          ? [{ classYear: "desc" as const }, ...MEMBER_LIST_ORDER_BY]
          : MEMBER_LIST_ORDER_BY,
      select: {
        firstName: true,
        lastName: true,
        daliEmail: true,
        dartmouthEmail: true,
        personalEmail: true,
        pronouns: true,
        classYear: true,
        dartmouthDepartmentClass: true,
        adminMembership: { select: { isStaff: true } },
        coreAssignments: { select: { leadTitle: true } },
        domainEligibilities: { select: { level: true, domain: { select: { displayName: true } } } },
      },
    });

    const out: unknown[][] = [
      ["Name", "Email", "Pronouns", "Class/Program", "Staff", "Core Titles", "Domain Roles"],
    ];
    for (const u of users) {
      out.push([
        `${u.firstName} ${u.lastName}`.trim(),
        primaryEmail(u) ?? "",
        u.pronouns ?? "",
        u.classYear ? `Class of ${u.classYear}` : (graduateProgramLabel(u.dartmouthDepartmentClass) ?? ""),
        u.adminMembership?.isStaff === true ? "yes" : "",
        deriveCoreTitles(u.coreAssignments).join("; "),
        u.domainEligibilities.map((e) => `${e.domain.displayName} (${e.level})`).join("; "),
      ]);
    }
    return out;
  },
});
