import type { Route } from "./+types/api.sessions.$id.attendance";
import { prisma } from "~/lib/db";
import { requireEducationManager } from "~/education/lib/access";

interface AttendancePayload {
  entries: Array<{
    applicationId: string;
    status: "Present" | "Absent" | "Excused";
  }>;
}

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const sessionId = params.id!;
  const session = await prisma.educationSession.findUnique({
    where: { id: sessionId },
    select: { offeringId: true },
  });
  if (!session) return Response.json({ error: "Not found" }, { status: 404 });
  const gate = await requireEducationManager(request, session.offeringId);
  if (!gate.ok) return gate.response;

  const body = (await request.json()) as AttendancePayload;
  await prisma.$transaction(
    body.entries.map((entry) =>
      prisma.educationAttendance.upsert({
        where: {
          applicationId_sessionId: {
            applicationId: entry.applicationId,
            sessionId,
          },
        },
        create: {
          applicationId: entry.applicationId,
          sessionId,
          status: entry.status,
        },
        update: { status: entry.status },
      }),
    ),
  );
  return Response.json({ ok: true, count: body.entries.length });
}
