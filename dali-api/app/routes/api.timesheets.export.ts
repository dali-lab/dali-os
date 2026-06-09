import type { Route } from "./+types/api.timesheets.export";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { withCors, handlePreflight } from "~/lib/cors";
import { deriveHires } from "~/lib/timesheet-hires";

// Export the caller's timesheet sections in the shape the JobX browser extension
// consumes:
//   { hireLabel, entries: [{ startAt, endAt, description, projectLabel }] }
//
// JobX timesheets are per-hire, so the extension fills one hire at a time. Pass
// ?hire=<hireKey> to pick which hire's sections to export; omit it to export the
// member's primary hire. Unassigned sections (hireKey null) are excluded — they
// have no JobX home until tagged. ?from / ?to (ISO dates) bound the window;
// default is the last 30 days, which comfortably covers a JobX pay period.
export async function loader({ request }: Route.LoaderArgs) {
  const preflight = handlePreflight(request);
  if (preflight) return preflight;

  const auth = await requireAuth(request);
  if (!auth.ok) return withCors(request, auth.response);
  const userId = auth.user.sub;

  const url = new URL(request.url);
  const hireKeyParam = url.searchParams.get("hire");

  const hires = await deriveHires(userId);
  if (hires.length === 0) {
    return withCors(
      request,
      Response.json({ error: "No hires for the current term" }, { status: 404 }),
    );
  }
  // Pick the requested hire, else the primary (first) hire.
  const hire = hireKeyParam
    ? hires.find((h) => h.key === hireKeyParam)
    : hires[0];
  if (!hire) {
    return withCors(
      request,
      Response.json({ error: "Unknown hire", availableHires: hires.map((h) => ({ key: h.key, label: h.label })) }, { status: 404 }),
    );
  }

  // Window: ?from/?to ISO, else last 30 days through now.
  const now = new Date();
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const from = fromParam && !isNaN(Date.parse(fromParam))
    ? new Date(fromParam)
    : new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const to = toParam && !isNaN(Date.parse(toParam)) ? new Date(toParam) : now;

  const sections = await prisma.timesheetSection.findMany({
    where: {
      userId,
      hireKey: hire.key,
      startTime: { gte: from, lte: to },
    },
    orderBy: { startTime: "asc" },
    take: 500,
  });

  const payload = {
    hireKey: hire.key,
    hireLabel: hire.label,
    from: from.toISOString(),
    to: to.toISOString(),
    // `availableHires` lets the extension offer a hire picker if it wants.
    availableHires: hires.map((h) => ({ key: h.key, label: h.label })),
    entries: sections.map((s) => ({
      startAt: s.startTime.toISOString(),
      endAt: s.endTime.toISOString(),
      description: s.note ?? "",
      projectLabel: hire.label,
    })),
  };

  return withCors(request, Response.json(payload));
}
