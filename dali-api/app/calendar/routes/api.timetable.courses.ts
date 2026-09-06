import type { Route } from "./+types/api.timetable.courses";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isLabMember, getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { refreshSubjectOfferings } from "~/lib/timetable-cache.server";

// Shared gate: a logged-in lab member with the calendar feature on. Returns the
// userId on success, or a Response to short-circuit.
async function gate(request: Request): Promise<string | Response> {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const userId = auth.user.sub;
  if (!(await isLabMember(userId))) return Response.json({ error: "Forbidden" }, { status: 403 });
  const roles = await getUserRoles(userId, request);
  if (!(await isFeatureEnabled("calendar-unified", userId, roles, request)))
    return Response.json({ error: "Forbidden" }, { status: 403 });
  return userId;
}

// POST — live-refresh the given subjects' sections for a term from Dartmouth, so
// volatile data (seats) can be brought current on demand. Capped to a few
// subjects per call to bound the outbound requests.
export async function action({ request }: Route.ActionArgs) {
  const gated = await gate(request);
  if (gated instanceof Response) return gated;

  const form = await request.formData();
  const termId = String(form.get("termId") ?? "").trim();
  const subjects = String(form.get("subjects") ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .slice(0, 5);
  if (!termId || subjects.length === 0) return Response.json({ refreshed: 0 });

  let refreshed = 0;
  for (const subject of subjects) {
    try {
      refreshed += await refreshSubjectOfferings(termId, subject);
    } catch {
      // Best-effort: one subject's Oracle hiccup shouldn't fail the others.
    }
  }
  return Response.json({ refreshed });
}

// GET /api/timetable/courses?termId=...&q=...
// Backs the course-autofill typeahead in the class composer. Searches the
// pre-synced CourseOffering cache (populated by the timetable-sync job) for the
// given term, matching on the lowercased "subject number title" text. Returns
// enough per section to autofill title / period / location and to record which
// section was picked. Lab-member gated + behind the calendar-unified flag, the
// same audience/gate as the composer itself, so it isn't a public catalog when
// classes are off.

const LIMIT = 20;

export async function loader({ request }: Route.LoaderArgs) {
  const gated = await gate(request);
  if (gated instanceof Response) return gated;

  const url = new URL(request.url);
  const termId = url.searchParams.get("termId")?.trim() ?? "";
  const q = (url.searchParams.get("q") ?? "").trim().toLowerCase();
  if (!termId || q.length < 2) return Response.json({ courses: [] });

  const courses = await prisma.courseOffering.findMany({
    // searchText is stored lowercased, so a plain contains matches case-insensitively.
    where: { termId, searchText: { contains: q } },
    orderBy: [{ subject: "asc" }, { number: "asc" }, { section: "asc" }],
    take: LIMIT,
    select: {
      crn: true,
      subject: true,
      number: true,
      section: true,
      title: true,
      periodCode: true,
      periodText: true,
      building: true,
      room: true,
      instructor: true,
      crosslist: true,
      distributive: true,
      enrollLimit: true,
      enrollCurrent: true,
    },
  });

  return Response.json({ courses });
}
