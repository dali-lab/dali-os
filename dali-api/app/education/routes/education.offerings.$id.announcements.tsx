import { useLoaderData, Form, useNavigation } from "react-router";
import type { Route } from "./+types/education.offerings.$id.announcements";
import { prisma } from "~/lib/db";
import { requireEducationManager } from "~/education/lib/access";
import { emitEvent } from "~/lib/notifications";
import { sendAnnouncementEmail } from "~/lib/education/email";
import { EducationTabs } from "~/education/components/EducationTabs";

export async function loader({ request, params }: Route.LoaderArgs) {
  const gate = await requireEducationManager(request, params.id);
  if (!gate.ok) return gate.response;
  const offering = await prisma.educationOffering.findUnique({
    where: { id: params.id },
    select: { id: true, title: true },
  });
  if (!offering) return new Response("Not found", { status: 404 });
  const announcements = await prisma.educationAnnouncement.findMany({
    where: { offeringId: params.id },
    orderBy: { sentAt: "desc" },
    include: { author: { select: { firstName: true, lastName: true } } },
  });
  return { offering, announcements };
}

export async function action({ request, params }: Route.ActionArgs) {
  const gate = await requireEducationManager(request, params.id);
  if (!gate.ok) return gate.response;
  const fd = await request.formData();
  const body = String(fd.get("body") || "").trim();
  if (!body) return { error: "body required" };

  const [offering, author, recipients] = await Promise.all([
    prisma.educationOffering.findUnique({
      where: { id: params.id! },
      select: { title: true },
    }),
    prisma.user.findUnique({
      where: { id: gate.userId },
      select: { firstName: true, lastName: true },
    }),
    prisma.educationApplication.findMany({
      where: { offeringId: params.id!, status: "Approved" },
      include: {
        applicant: {
          select: { firstName: true, daliEmail: true, dartmouthEmail: true },
        },
      },
    }),
  ]);
  const announcement = await prisma.educationAnnouncement.create({
    data: { offeringId: params.id!, authorId: gate.userId, body },
  });
  const authorName =
    [author?.firstName, author?.lastName].filter(Boolean).join(" ") || "Instructor";
  await emitEvent({
    type: "education.announcement_posted",
    recipients: recipients.map((r) => r.applicantUserId),
    payload: { offeringId: params.id, announcementId: announcement.id },
    inbox: {
      kind: "EducationAnnouncementPosted",
      title: `[${offering?.title ?? ""}] ${authorName}`,
      body: body.slice(0, 280),
      link: `/portal/education/${params.id}`,
      createdByUserId: gate.userId,
    },
  });
  for (const r of recipients) {
    const email = r.applicant.daliEmail ?? r.applicant.dartmouthEmail;
    if (!email) continue;
    await sendAnnouncementEmail({
      to: { email, firstName: r.applicant.firstName },
      offeringTitle: offering?.title ?? "",
      authorName,
      body,
    });
  }
  return null;
}

export default function Announcements() {
  const { offering, announcements } = useLoaderData<typeof loader>();
  const nav = useNavigation();
  return (
    <div className="max-w-3xl mx-auto p-6">
      <EducationTabs offeringId={offering.id} offeringTitle={offering.title} />
      <Form method="post" className="bg-card border border-border rounded-md p-3 mb-4">
        <label className="block">
          <span className="text-xs font-medium text-muted-foreground">
            Send to approved enrollees
          </span>
          <textarea
            name="body"
            required
            rows={3}
            className="mt-1 block w-full border border-border rounded-md px-2 py-1 text-sm"
            placeholder="What do you want to say?"
          />
        </label>
        <button
          type="submit"
          disabled={nav.state !== "idle"}
          className="mt-2 px-3 py-1.5 bg-accent-coral text-white text-sm font-medium rounded-md"
        >
          Send announcement
        </button>
      </Form>
      <ul className="space-y-3">
        {announcements.map((a) => (
          <li key={a.id} className="bg-card border border-border rounded-md p-3">
            <p className="text-xs text-muted-foreground mb-1">
              {a.author.firstName} {a.author.lastName} ·{" "}
              {new Date(a.sentAt).toLocaleString()}
            </p>
            <p className="text-sm whitespace-pre-wrap">{a.body}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
