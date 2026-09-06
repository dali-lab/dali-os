import type { Route } from "./+types/api.timetable.courses";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isLabMember, getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";

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
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  const userId = auth.user.sub;
  if (!(await isLabMember(userId))) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  const roles = await getUserRoles(userId, request);
  if (!(await isFeatureEnabled("calendar-unified", userId, roles, request))) {
    return Response.json({ courses: [] });
  }

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
