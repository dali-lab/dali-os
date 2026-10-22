import type { PrismaClient } from "~/generated/prisma/client";

export type AuditTargetModel =
  | "page"
  | "project"
  | "projectFile"
  | "group"
  | "domain"
  | "partnerOrg"
  | "educationOffering"
  | "activity"
  | "room"
  | "releaseNote";

// Longest matching prefix wins, so an exception (project.assignment.* targets
// a user, already resolved elsewhere) can sit beside its broader rule. Actions
// whose targetId is mixed or has no label (sessions, recordings, interviews)
// are deliberately absent and keep the short-id fallback.
const TARGET_RULES: ReadonlyArray<readonly [prefix: string, model: AuditTargetModel | null]> = [
  ["page.", "page"],
  ["note.", "page"],
  ["document.", "page"],
  ["lab-document.", "page"],
  ["project.", "project"],
  ["project.assignment.", null],
  ["staffing.finalize", "project"],
  ["staffing.externalMentor.", "project"],
  ["projectFile.", "projectFile"],
  ["group.", "group"],
  ["domain.create", "domain"],
  ["domain.delete", "domain"],
  ["email.domain_added_notice", "domain"],
  ["partner.org.", "partnerOrg"],
  ["partner.invite", "partnerOrg"],
  ["education.offering.", "educationOffering"],
  ["education.announcement.", "educationOffering"],
  ["education.certificate.", "educationOffering"],
  ["education.form-binding.", "educationOffering"],
  ["education.instructors.", "educationOffering"],
  ["activities.", "activity"],
  ["room.create", "room"],
  ["room.update", "room"],
  ["release_note.", "releaseNote"],
];

export function auditTargetModel(action: string): AuditTargetModel | null {
  let best: { len: number; model: AuditTargetModel | null } | null = null;
  for (const [prefix, model] of TARGET_RULES) {
    if (action.startsWith(prefix) && (!best || prefix.length > best.len)) {
      best = { len: prefix.length, model };
    }
  }
  return best?.model ?? null;
}

export type ResolvedTarget = { label: string; href: string | null };

type Row = { id: string; label: string };
type Loader = (db: AuditTargetPrisma, ids: string[]) => Promise<Row[]>;

export type AuditTargetPrisma = Pick<
  PrismaClient,
  | "page"
  | "project"
  | "projectFile"
  | "groupDefinition"
  | "domain"
  | "partnerOrg"
  | "educationOffering"
  | "activity"
  | "room"
  | "releaseNote"
>;

// Only routes that exist in app/routes.ts. drive/reveal resolves any page id.
const MODELS: Record<
  AuditTargetModel,
  { load: Loader; href: ((id: string) => string) | null }
> = {
  page: {
    load: async (db, ids) =>
      (await db.page.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } })).map(
        (r) => ({ id: r.id, label: r.title }),
      ),
    href: (id) => `/drive/reveal/${id}`,
  },
  project: {
    load: async (db, ids) =>
      (await db.project.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map(
        (r) => ({ id: r.id, label: r.name }),
      ),
    href: (id) => `/projects/${id}`,
  },
  projectFile: {
    load: async (db, ids) =>
      (
        await db.projectFile.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } })
      ).map((r) => ({ id: r.id, label: r.title })),
    href: null,
  },
  group: {
    load: async (db, ids) =>
      (
        await db.groupDefinition.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      ).map((r) => ({ id: r.id, label: r.name })),
    href: null,
  },
  domain: {
    load: async (db, ids) =>
      (
        await db.domain.findMany({ where: { id: { in: ids } }, select: { id: true, displayName: true } })
      ).map((r) => ({ id: r.id, label: r.displayName })),
    href: null,
  },
  partnerOrg: {
    load: async (db, ids) =>
      (
        await db.partnerOrg.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
      ).map((r) => ({ id: r.id, label: r.name })),
    href: (id) => `/core/partners/orgs/${id}`,
  },
  educationOffering: {
    load: async (db, ids) =>
      (
        await db.educationOffering.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } })
      ).map((r) => ({ id: r.id, label: r.title })),
    href: (id) => `/education/${id}`,
  },
  activity: {
    load: async (db, ids) =>
      (await db.activity.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map(
        (r) => ({ id: r.id, label: r.name }),
      ),
    href: (id) => `/admin/activities/${id}`,
  },
  room: {
    load: async (db, ids) =>
      (await db.room.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })).map(
        (r) => ({ id: r.id, label: r.name }),
      ),
    href: null,
  },
  releaseNote: {
    load: async (db, ids) =>
      (
        await db.releaseNote.findMany({ where: { id: { in: ids } }, select: { id: true, title: true } })
      ).map((r) => ({ id: r.id, label: r.title })),
    href: (id) => `/release-notes/${id}`,
  },
};

export function groupTargetIdsByModel(
  entries: ReadonlyArray<{ action: string; targetId: string | null }>,
): Map<AuditTargetModel, string[]> {
  const byModel = new Map<AuditTargetModel, Set<string>>();
  for (const e of entries) {
    if (!e.targetId) continue;
    const model = auditTargetModel(e.action);
    if (!model) continue;
    if (!byModel.has(model)) byModel.set(model, new Set());
    byModel.get(model)!.add(e.targetId);
  }
  return new Map(Array.from(byModel, ([model, ids]) => [model, Array.from(ids)]));
}

// One findMany per model that actually appears on the page.
export async function resolveAuditTargets(
  db: AuditTargetPrisma,
  entries: ReadonlyArray<{ action: string; targetId: string | null }>,
): Promise<Map<string, ResolvedTarget>> {
  const grouped = groupTargetIdsByModel(entries);
  const resolved = new Map<string, ResolvedTarget>();
  await Promise.all(
    Array.from(grouped, async ([model, ids]) => {
      const { load, href } = MODELS[model];
      for (const row of await load(db, ids)) {
        resolved.set(row.id, { label: row.label, href: href ? href(row.id) : null });
      }
    }),
  );
  return resolved;
}
