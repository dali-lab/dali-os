import type { Route } from "./+types/api.offerings.$id.announcements";
import { prisma } from "~/lib/db";
import { requireEducationManager } from "~/education/lib/access";
import { emitEvent } from "~/lib/notifications";
import { sendAnnouncementEmail } from "~/lib/education/email";

export async function action({ request, params }: Route.ActionArgs) {
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const offeringId = params.id!;
  const gate = await requireEducationManager(request, offeringId);
  if (!gate.ok) return gate.response;

  const body = (await request.json()) as { body: string };
  if (!body.body?.trim()) {
    return Response.json({ error: "body required" }, { status: 400 });
  }

  const [offering, author, recipients] = await Promise.all([
    prisma.educationOffering.findUnique({
      where: { id: offeringId },
      select: { title: true },
    }),
    prisma.user.findUnique({
      where: { id: gate.userId },
      select: { firstName: true, lastName: true },
    }),
    prisma.educationApplication.findMany({
      where: { offeringId, status: "Approved" },
      select: {
        applicantUserId: true,
        applicant: {
          select: { firstName: true, daliEmail: true, dartmouthEmail: true },
        },
      },
    }),
  ]);
  if (!offering) return Response.json({ error: "Not found" }, { status: 404 });

  const announcement = await prisma.educationAnnouncement.create({
    data: {
      offeringId,
      authorId: gate.userId,
      body: body.body.trim(),
    },
  });

  const authorName =
    [author?.firstName, author?.lastName].filter(Boolean).join(" ") || "Instructor";

  await emitEvent({
    type: "education.announcement_posted",
    recipients: recipients.map((r) => r.applicantUserId),
    payload: { offeringId, announcementId: announcement.id },
    inbox: {
      kind: "EducationAnnouncementPosted",
      title: `[${offering.title}] ${authorName}`,
      body: body.body.trim().slice(0, 280),
      link: `/portal/education/${offeringId}`,
      createdByUserId: gate.userId,
    },
  });

  // Email fan-out is best-effort; loop sequentially to keep memory predictable.
  for (const r of recipients) {
    const email = r.applicant.daliEmail ?? r.applicant.dartmouthEmail;
    if (!email) continue;
    await sendAnnouncementEmail({
      to: { email, firstName: r.applicant.firstName },
      offeringTitle: offering.title,
      authorName,
      body: body.body.trim(),
    });
  }

  return Response.json({ announcement }, { status: 201 });
}
