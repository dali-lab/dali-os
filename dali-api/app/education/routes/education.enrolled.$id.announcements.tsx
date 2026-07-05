import { useLoaderData } from "react-router";
import type { Route } from "./+types/education.enrolled.$id.announcements";
import { requireEnrollment } from "~/education/lib/auth";
import { prisma } from "~/lib/db";
import { AnnouncementsFeed } from "~/education/components/AnnouncementsFeed";

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireEnrollment(request, params.id);

  const announcements = await prisma.educationAnnouncement.findMany({
    where: { offeringId: params.id },
    orderBy: { sentAt: "desc" },
    take: 20,
    select: {
      id: true,
      body: true,
      sentAt: true,
      author: { select: { firstName: true, lastName: true } },
    },
  });

  return {
    announcements: announcements.map((a) => ({
      ...a,
      sentAt: a.sentAt.toISOString(),
    })),
  };
}

export default function EnrolledAnnouncements() {
  const { announcements } = useLoaderData<typeof loader>();
  return (
    <div>
      <h2 className="font-heading text-sm font-bold uppercase tracking-wider text-dark-blue mb-3">
        Announcements
      </h2>
      <AnnouncementsFeed items={announcements} />
    </div>
  );
}
