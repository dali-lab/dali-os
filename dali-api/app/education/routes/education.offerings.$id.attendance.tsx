import { useLoaderData, Form, useNavigation } from "react-router";
import type { Route } from "./+types/education.offerings.$id.attendance";
import { prisma } from "~/lib/db";
import { requireEducationManager } from "~/education/lib/access";
import { EducationTabs } from "~/education/components/EducationTabs";

export async function loader({ request, params }: Route.LoaderArgs) {
  const gate = await requireEducationManager(request, params.id);
  if (!gate.ok) return gate.response;
  const offering = await prisma.educationOffering.findUnique({
    where: { id: params.id },
    select: { id: true, title: true },
  });
  if (!offering) return new Response("Not found", { status: 404 });
  const [sessions, applications] = await Promise.all([
    prisma.educationSession.findMany({
      where: { offeringId: params.id },
      orderBy: { sequence: "asc" },
      include: {
        attendances: { select: { applicationId: true, status: true } },
      },
    }),
    prisma.educationApplication.findMany({
      where: { offeringId: params.id, status: "Approved" },
      orderBy: { submittedAt: "asc" },
      include: { applicant: { select: { firstName: true, lastName: true } } },
    }),
  ]);
  return { offering, sessions, applications };
}

export async function action({ request, params }: Route.ActionArgs) {
  const gate = await requireEducationManager(request, params.id);
  if (!gate.ok) return gate.response;
  const fd = await request.formData();
  const sessionId = String(fd.get("sessionId"));
  const entries = Array.from(fd.entries())
    .filter(([k]) => k.startsWith("status:"))
    .map(([k, v]) => ({
      applicationId: k.slice("status:".length),
      status: String(v) as "Present" | "Absent" | "Excused",
    }));
  await prisma.$transaction(
    entries.map((e) =>
      prisma.educationAttendance.upsert({
        where: {
          applicationId_sessionId: {
            applicationId: e.applicationId,
            sessionId,
          },
        },
        create: {
          applicationId: e.applicationId,
          sessionId,
          status: e.status,
        },
        update: { status: e.status },
      }),
    ),
  );
  return null;
}

export default function Attendance() {
  const { offering, sessions, applications } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  return (
    <div className="max-w-5xl mx-auto p-6">
      <EducationTabs offeringId={offering.id} offeringTitle={offering.title} />
      {sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">Create a session first.</p>
      ) : (
        sessions.map((s) => {
          const existing = new Map(
            s.attendances.map((a) => [a.applicationId, a.status]),
          );
          return (
            <Form
              method="post"
              key={s.id}
              className="bg-card border border-border rounded-md p-3 mb-4"
            >
              <input type="hidden" name="sessionId" value={s.id} />
              <h3 className="font-heading font-semibold text-sm text-dark-blue mb-2">
                #{s.sequence} · {new Date(s.datetime).toLocaleString()}
              </h3>
              <table className="w-full text-sm">
                <tbody>
                  {applications.map((a) => {
                    const cur = existing.get(a.id) ?? "";
                    return (
                      <tr key={a.id} className="border-t border-border">
                        <td className="py-1">
                          {a.applicant.firstName} {a.applicant.lastName}
                        </td>
                        <td className="py-1 text-right">
                          <select
                            name={`status:${a.id}`}
                            defaultValue={cur}
                            className="border border-border rounded px-2 py-0.5 text-xs bg-white"
                          >
                            <option value="">—</option>
                            <option value="Present">Present</option>
                            <option value="Absent">Absent</option>
                            <option value="Excused">Excused</option>
                          </select>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <button
                type="submit"
                disabled={nav.state !== "idle"}
                className="mt-2 px-3 py-1.5 bg-accent-coral text-white text-xs font-medium rounded-md"
              >
                Save attendance
              </button>
            </Form>
          );
        })
      )}
    </div>
  );
}
