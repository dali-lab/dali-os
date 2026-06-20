import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/portal.education.$id";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { OfferingDetail } from "~/education/components/OfferingDetail";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: data && "offering" in data ? `${(data as any).offering.title} · DALI Education` : "Offering · DALI Education" },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");

  const offering = await prisma.educationOffering.findUnique({
    where: { id: params.id },
    include: {
      instructors: { include: { user: { select: { id: true, firstName: true, lastName: true } } } },
      sessions: { orderBy: { sequence: "asc" } },
      _count: { select: { applications: { where: { status: "Approved" } } } },
    },
  });
  if (!offering || offering.status !== "Published") {
    throw new Response("Not found", { status: 404 });
  }

  const myApp = await prisma.educationApplication.findUnique({
    where: { applicantUserId_offeringId: { applicantUserId: auth.user.sub, offeringId: offering.id } },
    select: { status: true },
  });

  return {
    offering: serialize(offering),
    approvedCount: offering._count.applications,
    myStatus: (myApp?.status ?? null) as
      | "Submitted" | "Approved" | "Waitlisted" | "Rejected" | "Withdrawn" | null,
  };
}

export default function PortalOfferingDetail() {
  const data = useLoaderData<typeof loader>();
  return (
    <div className="px-6 md:px-16 lg:px-24 py-10">
      <OfferingDetail
        offering={data.offering as any}
        approvedCount={data.approvedCount}
        myStatus={data.myStatus}
        applyHref={`/portal/education/${data.offering.id}/apply`}
        enrolledHref={`/portal/education/${data.offering.id}/enrolled`}
      />
    </div>
  );
}

function serialize(o: any) {
  return {
    id: o.id,
    title: o.title,
    type: o.type,
    capacity: o.capacity,
    startsAt: o.startsAt.toISOString(),
    endsAt: o.endsAt.toISOString(),
    registrationOpensAt: o.registrationOpensAt.toISOString(),
    registrationClosesAt: o.registrationClosesAt.toISOString(),
    requiresReview: o.requiresReview,
    instructors: o.instructors,
    sessions: o.sessions.map((s: any) => ({ ...s, datetime: s.datetime.toISOString() })),
  };
}
