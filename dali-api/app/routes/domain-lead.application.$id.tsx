import { Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/domain-lead.application.$id";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isDomainLead } from "~/lib/roles";

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");

  const member = await prisma.dALIMember.findFirst({
    where: { userId: auth.user.sub },
    include: { domainLeadAssignments: true },
  });

  if (!member || member.domainLeadAssignments.length === 0) {
    return redirect("/reviewer");
  }

  const leadDomainIds = member.domainLeadAssignments.map((a) => a.domainId);

  const da = await prisma.domainApplication.findUnique({
    where: { id: params.id },
    include: {
      challengeVersion: { include: { domain: true } },
      application: {
        include: {
          user: true,
          generalChallengeVersion: true,
          applicationCycle: {
            include: { statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 } },
          },
        },
      },
    },
  });

  if (!da) {
    return redirect("/domain-lead");
  }

  // Check that this domain application belongs to a domain the user leads
  if (!leadDomainIds.includes(da.challengeVersion.domainId!)) {
    return redirect("/domain-lead");
  }

  return { domainApplication: da, application: da.application };
}

export default function DomainLeadApplicationView() {
  const { domainApplication: da, application } = useLoaderData<typeof loader>() as any;

  const formVersion = application.generalChallengeVersion;
  const generalQuestions: any[] = formVersion?.questions ?? [];
  const challengeQuestions: any[] = da.challengeVersion.questions ?? [];

  return (
    <div className="space-y-6 max-w-3xl">
      <Link
        to="/domain-lead"
        className="text-sm text-blue-600 hover:text-blue-800 font-medium"
      >
        ← Back to Dashboard
      </Link>

      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          {application.user.firstName} {application.user.lastName}
        </h1>
        <p className="text-gray-500 mt-1">{application.applicationCycle.name}</p>
      </div>

      {/* General application answers */}
      {generalQuestions.length > 0 && (
        <section className="bg-white border border-gray-200 rounded-lg p-6 space-y-5">
          <h2 className="text-lg font-semibold text-gray-900">General Application</h2>
          {generalQuestions.map((q: any) => {
            const answer = application.answers?.[q.key];
            return (
              <div key={q.key}>
                <div className="text-sm font-medium text-gray-700 mb-1">{q.data.label}</div>
                <div className="text-sm text-gray-900 bg-gray-50 rounded p-3 whitespace-pre-wrap">
                  {answer || <span className="text-gray-400 italic">No answer provided</span>}
                </div>
              </div>
            );
          })}
        </section>
      )}

      {/* Domain challenge answers */}
      <section className="bg-white border border-gray-200 rounded-lg p-6 space-y-5">
        <h2 className="text-lg font-semibold text-gray-900">
          {da.challengeVersion.domain.name} Challenge
        </h2>
        {challengeQuestions.map((q: any) => {
          const answer = da.answers?.[q.key];
          return (
            <div key={q.key}>
              <div className="text-sm font-medium text-gray-700 mb-1">{q.data.label}</div>
              <div className="text-sm text-gray-900 bg-gray-50 rounded p-3 whitespace-pre-wrap">
                {answer || <span className="text-gray-400 italic">No answer provided</span>}
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
