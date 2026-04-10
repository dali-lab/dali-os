import { Link, useLoaderData } from "react-router";
import type { Route } from "./+types/domain-lead.application.$id";
import { prisma } from "~/lib/db";

export async function loader({ params }: Route.LoaderArgs) {
  // TODO: replace with session user once login flow is built
  const member = await prisma.dALIMember.findFirst({
    where: { daliEmail: "eng.lead@dali.dartmouth.edu" },
    include: { domainLeadAssignments: true },
  });

  if (!member) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }

  const leadDomainIds = member.domainLeadAssignments.map((a) => a.domainId);

  const application = await prisma.application.findUniqueOrThrow({
    where: { id: params.id },
    include: {
      user: true,
      applicationFormVersion: true,
      domainApplications: {
        include: {
          challengeVersion: { include: { domain: true } },
        },
      },
      applicationCycle: {
        include: { statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 } },
      },
    },
  });

  // Check that at least one domain application belongs to a domain the user leads
  const hasAccess = application.domainApplications.some((da) =>
    leadDomainIds.includes(da.challengeVersion.domainId)
  );

  if (!hasAccess) {
    return new Response(JSON.stringify({ error: "Forbidden" }), { status: 403 });
  }

  // Filter to only domain applications the user leads
  const visibleDomainApps = application.domainApplications.filter((da) =>
    leadDomainIds.includes(da.challengeVersion.domainId)
  );

  return { application, visibleDomainApps };
}

export default function DomainLeadApplicationView() {
  const data = useLoaderData<typeof loader>() as any;
  const application = data?.application;
  const visibleDomainApps = data?.visibleDomainApps ?? [];

  if (!application) {
    return <div className="text-gray-500 py-8 text-center">Application not found or access denied.</div>;
  }

  const formVersion = application.applicationFormVersion;
  const questions: any[] = formVersion?.questions ?? [];

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Back link */}
      <Link
        to="/domain-lead"
        className="text-sm text-blue-600 hover:text-blue-800 font-medium"
      >
        ← Back to Dashboard
      </Link>

      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">
          {application.user.firstName} {application.user.lastName}
        </h1>
        <p className="text-gray-500 mt-1">{application.applicationCycle.name}</p>
      </div>

      {/* General application answers */}
      {questions.length > 0 && (
        <section className="bg-white border border-gray-200 rounded-lg p-6 space-y-5">
          <h2 className="text-lg font-semibold text-gray-900">General Application</h2>
          {questions.map((q: any) => {
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
      {visibleDomainApps.map((da: any) => {
        const challengeQuestions: any[] = da.challengeVersion.questions ?? [];
        return (
          <section key={da.id} className="bg-white border border-gray-200 rounded-lg p-6 space-y-5">
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
        );
      })}
    </div>
  );
}
