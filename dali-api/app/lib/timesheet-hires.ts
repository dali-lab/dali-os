import { prisma } from "~/lib/db";
import { currentTerm } from "~/lib/roles";
import { HIRE_PALETTE, type Hire, type HireType } from "~/lib/timesheet-hires.shared";

// Server-only hire derivation. Client-safe types/constants/helpers live in
// timesheet-hires.shared.ts (no prisma import) so the calendar route's client
// component can use them without bundling Prisma into the browser.
//
// A "hire" is one of the member's paid roles for the current term, mirroring how
// Dartmouth JobX models employment: a member can hold several (e.g. Core *and* a
// P3 Fullstack project role), each its own timesheet. Hires are DERIVED from the
// assignment tables, not stored — so the timesheet always reflects the member's
// actual current staffing. `key` is a stable identifier persisted on
// TimesheetSection.hireKey; it must stay constant across loads for a given role.

export {
  UNASSIGNED_COLOR,
  primaryHire,
  colorForHire,
  type Hire,
  type HireType,
} from "~/lib/timesheet-hires.shared";

// Precedence for picking the member's "primary" hire (drag-create default).
const TYPE_ORDER: Record<HireType, number> = {
  Core: 0,
  Admin: 1,
  DomainLead: 2,
  Instructor: 3,
  Project: 4,
};

type RawHire = { key: string; label: string; type: HireType };

/**
 * Resolve the member's hires for the current term from the assignment tables.
 * Returns [] when the Term table is unseeded (currentTerm() === null) — the
 * timesheet still works for unassigned/imported blocks.
 */
export async function deriveHires(userId: string): Promise<Hire[]> {
  const term = await currentTerm();
  if (!term) return [];

  const [core, projects, instructor, domainLead, admin] = await Promise.all([
    prisma.coreAssignment.findMany({
      where: { userId, termId: term.id },
      select: { id: true, leadTitle: true },
    }),
    prisma.projectAssignment.findMany({
      where: { userId, termId: term.id },
      select: {
        id: true,
        level: true,
        projectId: true,
        domainId: true,
        project: { select: { name: true } },
        domain: { select: { displayName: true } },
      },
    }),
    prisma.instructorAssignment.findMany({
      where: { userId, termId: term.id },
      select: { id: true, offeringId: true, offering: { select: { title: true } } },
    }),
    prisma.domainLeadAssignment.findMany({
      where: { userId, termId: term.id },
      select: { id: true, domainId: true, domain: { select: { displayName: true } } },
    }),
    prisma.adminMembership.findUnique({ where: { userId }, select: { id: true } }),
  ]);

  const raw: RawHire[] = [];

  for (const c of core) {
    raw.push({
      key: "core",
      label: c.leadTitle ? `Core — ${c.leadTitle}` : "DALI Core",
      type: "Core",
    });
  }
  // Multiple Core titles collapse to one "core" hire; de-dup below keeps the
  // first label. (Distinct Core timesheets per title aren't a JobX concept.)

  for (const p of projects) {
    raw.push({
      key: `project:${p.projectId}:${p.domainId}:${p.level}`,
      label: `${p.level} ${p.domain.displayName} — ${p.project.name}`,
      type: "Project",
    });
  }

  for (const i of instructor) {
    raw.push({
      key: `instructor:${i.offeringId}`,
      label: `Instructor — ${i.offering.title}`,
      type: "Instructor",
    });
  }

  for (const d of domainLead) {
    raw.push({
      key: `domainlead:${d.domainId}`,
      label: `Domain Lead — ${d.domain.displayName}`,
      type: "DomainLead",
    });
  }

  if (admin) {
    raw.push({ key: "admin", label: "Admin", type: "Admin" });
  }

  // De-dup by key (e.g. multiple Core titles → one "core").
  const byKey = new Map<string, RawHire>();
  for (const h of raw) if (!byKey.has(h.key)) byKey.set(h.key, h);
  const unique = Array.from(byKey.values());

  // Stable color assignment: sort keys deterministically, index into the palette.
  const colorOrder = [...unique].sort((a, b) => a.key.localeCompare(b.key));
  const colorByKey = new Map<string, string>();
  colorOrder.forEach((h, i) => colorByKey.set(h.key, HIRE_PALETTE[i % HIRE_PALETTE.length]));

  // Present in precedence order (Core first) so the primary hire is unique[0].
  unique.sort(
    (a, b) => TYPE_ORDER[a.type] - TYPE_ORDER[b.type] || a.label.localeCompare(b.label),
  );

  return unique.map((h) => ({ ...h, color: colorByKey.get(h.key)! }));
}
