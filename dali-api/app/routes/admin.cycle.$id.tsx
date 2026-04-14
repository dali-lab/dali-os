import { useState } from "react";
import { Form, useLoaderData } from "react-router";
import { redirect } from "react-router";
import type { Route } from "./+types/admin.cycle.$id";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { CheckCircle, Circle, ChevronRight, Plus, X } from "lucide-react";

const STATUS_SEQUENCE = [
  "Draft",
  "Open",
  "Closed",
  "DecisionsReleased",
] as const;

type CycleStatus = (typeof STATUS_SEQUENCE)[number];

function nextStatus(current: CycleStatus): CycleStatus | null {
  const idx = STATUS_SEQUENCE.indexOf(current);
  return idx < STATUS_SEQUENCE.length - 1 ? STATUS_SEQUENCE[idx + 1] : null;
}

const STATUS_LABELS: Record<CycleStatus, string> = {
  Draft: "Draft",
  Open: "Open",
  Closed: "Closed",
  DecisionsReleased: "Decisions Released",
};

const ADVANCE_LABELS: Record<CycleStatus, string> = {
  Draft: "Open Applications",
  Open: "Close Applications",
  Closed: "Release Decisions",
  DecisionsReleased: "",
};

const STATUS_COLORS: Record<CycleStatus, string> = {
  Draft: "bg-gray-100 text-gray-700",
  Open: "bg-green-100 text-green-700",
  Closed: "bg-yellow-100 text-yellow-700",
  DecisionsReleased: "bg-blue-100 text-blue-700",
};

export async function loader({ params }: Route.LoaderArgs) {
  const cycle = await prisma.applicationCycle.findUniqueOrThrow({
    where: { id: params.id },
    include: {
      domains: {
        include: {
          domain: {
            include: {
              domainLeadAssignments: {
                include: { member: { include: { user: true } } },
              },
            },
          },
        },
      },
      statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
      challengeVersions: { include: { challengeVersion: { include: { domain: true, challenge: true } } } },
      formVersion: true,
      applications: {
        include: {
          user: true,
          statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
          domainApplications: {
            include: { challengeVersion: { include: { domain: true } } },
          },
        },
      },
    },
  });

  const formVersionOptions = await prisma.applicationFormVersion.findMany({
    include: { applicationForm: true },
    orderBy: { createdAt: "desc" },
  });

  const allDomains = await prisma.domain.findMany({ orderBy: { name: "asc" } });

  return { cycle, formVersionOptions, allDomains };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "select-form") {
    const formVersionId = formData.get("formVersionId") as string;
    await prisma.applicationCycle.update({
      where: { id: params.id },
      data: { formVersionId },
    });
    return redirect(`/admin/cycle/${params.id}`);
  }

  if (intent === "remove-domain") {
    const domainId = formData.get("domainId") as string;
    await prisma.domainApplicationCycle.delete({
      where: { domainId_applicationCycleId: { domainId, applicationCycleId: params.id } },
    });
    return redirect(`/admin/cycle/${params.id}`);
  }

  if (intent === "add-domain") {
    const domainId = formData.get("domainId") as string;
    await prisma.domainApplicationCycle.create({
      data: { domainId, applicationCycleId: params.id },
    });
    return redirect(`/admin/cycle/${params.id}`);
  }

  if (intent === "advance-status") {

    const cycle = await prisma.applicationCycle.findUniqueOrThrow({
      where: { id: params.id },
      include: {
        statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
        domains: true,
        challengeVersions: { include: { challengeVersion: true } },
      },
    });

    const currentStatus = cycle.statusUpdates[0]?.newStatus ?? "Draft";
    const next = nextStatus(currentStatus as CycleStatus);
    if (!next) return null;

    if (currentStatus === "Draft") {
      const formReady = !!cycle.formVersionId;
      const allDomainsReady = cycle.domains.every((d) => d.isReady === true);
      if (!formReady || !allDomainsReady) return null;
    }

    await prisma.applicationCycleStatusUpdate.create({
      data: {
        newStatus: next,
        applicationCycleId: params.id,
        userId: auth.user.sub,
      },
    });
  }

  return redirect(`/admin/cycle/${params.id}`);
}

export default function AdminCycleDetails() {
  const data = useLoaderData<typeof loader>() as any;
  const cycle = data?.cycle;
  const formVersionOptions = data?.formVersionOptions ?? [];
  const allDomains = data?.allDomains ?? [];

  if (!cycle) {
    return <div className="text-gray-500 py-8 text-center">Cycle not found or access denied.</div>;
  }

  const currentStatus = (cycle.statusUpdates[0]?.newStatus ?? "Draft") as CycleStatus;
  const next = nextStatus(currentStatus);

  // Readiness checks for Draft → Open transition
  const formSelected = !!cycle.formVersionId;
  const allDomainsReady = cycle.domains.every((d: any) => d.isReady === true);
  const canAdvance = currentStatus !== "Draft" || (formSelected && allDomainsReady);

  const advanceBlockedReasons: string[] = [];
  if (currentStatus === "Draft") {
    if (!formSelected) advanceBlockedReasons.push("No application form selected");
    if (!allDomainsReady) advanceBlockedReasons.push("Not all domain leads have marked their challenge as ready");
  }

  // Submitted applications only
  const submittedApps = cycle.applications.filter((app: any) => {
    const latest = app.statusUpdates[0]?.newStatus;
    return latest === "Submitted";
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">{cycle.name}</h1>
          <span className={`mt-1 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[currentStatus]}`}>
            {STATUS_LABELS[currentStatus]}
          </span>
        </div>
        {next && (
          <div className="flex flex-col items-end gap-1">
            {advanceBlockedReasons.length > 0 && (
              <ul className="text-xs text-red-600 text-right space-y-0.5">
                {advanceBlockedReasons.map((r) => <li key={r}>• {r}</li>)}
              </ul>
            )}
            <Form method="post">
              <input type="hidden" name="intent" value="advance-status" />
              <button
                type="submit"
                disabled={!canAdvance}
                className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {ADVANCE_LABELS[currentStatus]}
                <ChevronRight className="w-4 h-4" />
              </button>
            </Form>
          </div>
        )}
      </div>

      {/* Status Stepper */}
      <div className="flex items-center gap-0">
        {STATUS_SEQUENCE.map((status, idx) => {
          const stepIdx = STATUS_SEQUENCE.indexOf(currentStatus);
          const isCompleted = idx < stepIdx;
          const isCurrent = idx === stepIdx;
          const isLast = idx === STATUS_SEQUENCE.length - 1;
          return (
            <div key={status} className="flex items-center">
              <div className="flex flex-col items-center">
                <div className={`flex items-center justify-center w-8 h-8 rounded-full border-2 ${
                  isCompleted ? "bg-blue-600 border-blue-600" :
                  isCurrent ? "bg-white border-blue-600" :
                  "bg-white border-gray-300"
                }`}>
                  {isCompleted ? (
                    <CheckCircle className="w-5 h-5 text-white" />
                  ) : isCurrent ? (
                    <div className="w-3 h-3 rounded-full bg-blue-600" />
                  ) : (
                    <Circle className="w-5 h-5 text-gray-300" />
                  )}
                </div>
                <span className={`mt-1 text-xs font-medium ${isCurrent ? "text-blue-600" : isCompleted ? "text-gray-600" : "text-gray-400"}`}>
                  {STATUS_LABELS[status]}
                </span>
              </div>
              {!isLast && (
                <div className={`w-16 h-0.5 mb-5 ${idx < stepIdx ? "bg-blue-600" : "bg-gray-200"}`} />
              )}
            </div>
          );
        })}
      </div>

      {/* Status-conditional content */}
      {currentStatus === "Draft" && (
        <DraftView cycle={cycle} formVersionOptions={formVersionOptions} allDomains={allDomains} />
      )}
      {currentStatus === "Open" && (
        <OpenView cycle={cycle} submittedApps={submittedApps} />
      )}
      {(currentStatus === "Closed" || currentStatus === "DecisionsReleased") && (
        <ApplicationsTable apps={submittedApps} />
      )}
    </div>
  );
}

function DraftView({ cycle, formVersionOptions, allDomains }: { cycle: any; formVersionOptions: any[]; allDomains: any[] }) {
  const domains: any[] = cycle.domains ?? [];
  const cycledomainIds = new Set(domains.map((d: any) => d.domain.id));
  const availableDomains = allDomains.filter((d: any) => !cycledomainIds.has(d.id));
  const readyCount = domains.filter((d: any) => d.isReady === true).length;
  const totalCount = domains.length;
  const allReady = readyCount === totalCount && totalCount > 0;
  const progressPct = totalCount > 0 ? Math.round((readyCount / totalCount) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* Form selector */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
        <h2 className="text-lg font-semibold text-gray-900">General Application</h2>
        <FormSelector
          cycleId={cycle.id}
          options={formVersionOptions}
          selectedId={cycle.formVersionId}
        />
      </div>

      {/* Domain Challenge Readiness */}
      <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Domain Challenge Readiness</h2>
            <p className="text-sm text-gray-500 mt-0.5">
              Domain leads must configure their challenge before applications can open.
            </p>
          </div>
          <div className="text-right shrink-0">
            <span className={`text-2xl font-bold ${allReady ? "text-green-600" : "text-gray-800"}`}>
              {readyCount} / {totalCount}
            </span>
            <p className="text-xs text-gray-500 mt-0.5">ready</p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${allReady ? "bg-green-500" : "bg-blue-500"}`}
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Domain cards */}
        {domains.length === 0 && availableDomains.length === 0 ? (
          <p className="text-gray-500 text-sm">No domains available.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {domains.map((domainEntry: any) => {
              const { domain, isReady } = domainEntry;
              const challengeEntry = cycle.challengeVersions.find(
                (cv: any) => cv.challengeVersion.domainId === domain.id
              );
              const isConfigured = !!challengeEntry && !isReady;
              const lead = domain.domainLeadAssignments?.[0]?.member?.user;
              const leadName = lead ? `${lead.firstName} ${lead.lastName}` : null;

              return (
                <div
                  key={domain.id}
                  className={`rounded-lg border p-4 space-y-2 ${
                    isReady
                      ? "border-green-200 bg-green-50"
                      : isConfigured
                      ? "border-yellow-200 bg-yellow-50"
                      : "border-gray-200 bg-gray-50"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-gray-900 text-sm">{domain.name}</span>
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          isReady
                            ? "bg-green-100 text-green-700"
                            : isConfigured
                            ? "bg-yellow-100 text-yellow-700"
                            : "bg-gray-200 text-gray-600"
                        }`}
                      >
                        {isReady ? "Ready" : isConfigured ? "Configured" : "Pending"}
                      </span>
                      <Form method="post">
                        <input type="hidden" name="intent" value="remove-domain" />
                        <input type="hidden" name="domainId" value={domain.id} />
                        <button type="submit" className="text-gray-400 hover:text-red-500 transition-colors" title="Remove domain">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </Form>
                    </div>
                  </div>
                  {leadName && (
                    <p className="text-xs text-gray-500">Lead: {leadName}</p>
                  )}
                  {challengeEntry ? (
                    <p className={`text-xs ${isReady ? "text-green-700" : "text-yellow-700"}`}>
                      {challengeEntry.challengeVersion.challenge.name}
                    </p>
                  ) : (
                    <p className="text-xs text-gray-400">No challenge configured</p>
                  )}
                </div>
              );
            })}
            {availableDomains.length > 0 && (
              <Form method="post" className="rounded-lg border-2 border-dashed border-gray-300 p-4 flex flex-col gap-2 justify-center">
                <input type="hidden" name="intent" value="add-domain" />
                <select name="domainId" className="text-sm border border-gray-300 rounded px-2 py-1 text-gray-700">
                  {availableDomains.map((d: any) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                <button type="submit" className="text-sm font-medium text-blue-600 hover:text-blue-800 flex items-center gap-1">
                  <Plus className="w-4 h-4" /> Add Domain
                </button>
              </Form>
            )}
          </div>
        )}

        {/* Banner */}
        {totalCount > 0 && (
          <div
            className={`rounded-lg px-4 py-3 text-sm ${
              allReady
                ? "bg-green-50 border border-green-200 text-green-800"
                : "bg-yellow-50 border border-yellow-200 text-yellow-800"
            }`}
          >
            {allReady
              ? "All domains are ready — you can open applications."
              : `Waiting on domain leads — ${totalCount - readyCount} domain${
                  totalCount - readyCount !== 1 ? "s" : ""
                } still need to configure their challenge before applications can open.`}
          </div>
        )}
      </div>
    </div>
  );
}

function FormSelector({ cycleId, options, selectedId }: {
  cycleId: string;
  options: any[];
  selectedId: string | null;
}) {
  const [previewId, setPreviewId] = useState<string>(selectedId ?? "");
  const previewVersion = options.find((fv: any) => fv.id === previewId);
  const questions: any[] = previewVersion?.questions ?? [];

  return (
    <div className="space-y-3">
      <Form method="post" className="flex items-end gap-3">
        <input type="hidden" name="intent" value="select-form" />
        <input type="hidden" name="cycleId" value={cycleId} />
        <div className="flex-1">
          <select
            name="formVersionId"
            value={previewId}
            onChange={(e) => setPreviewId(e.target.value)}
            className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="" disabled>Select a form…</option>
            {options.map((fv: any) => (
              <option key={fv.id} value={fv.id}>
                {new Date(fv.createdAt).toLocaleDateString()} — {fv.questions.length} question{fv.questions.length !== 1 ? "s" : ""}
              </option>
            ))}
          </select>
        </div>
        <button
          type="submit"
          disabled={!previewId}
          className="px-3 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Save
        </button>
      </Form>

      {questions.length > 0 && (
        <div className="border border-gray-200 rounded-md divide-y divide-gray-100">
          {questions.map((q: any, i: number) => (
            <div key={q.key} className="px-4 py-3">
              <span className="text-xs font-medium text-gray-400 uppercase tracking-wide mr-2">Q{i + 1}</span>
              <span className="text-sm text-gray-700">{q.data.label}</span>
              {q.required && <span className="ml-2 text-xs text-red-500">required</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function OpenView({ cycle, submittedApps }: { cycle: any; submittedApps: any[] }) {
  const countByDomain: Record<string, { name: string; count: number }> = {};
  for (const { domain } of cycle.domains) {
    countByDomain[domain.id] = { name: domain.name, count: 0 };
  }
  for (const app of submittedApps) {
    for (const da of app.domainApplications) {
      const domainId = da.challengeVersion.domainId;
      if (countByDomain[domainId]) countByDomain[domainId].count++;
    }
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
      <h2 className="text-lg font-semibold text-gray-900">Submissions</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="bg-blue-50 rounded-lg p-4 text-center">
          <div className="text-3xl font-bold text-blue-700">{submittedApps.length}</div>
          <div className="text-sm text-blue-600 mt-1">Total</div>
        </div>
        {Object.values(countByDomain).map(({ name, count }) => (
          <div key={name} className="bg-gray-50 rounded-lg p-4 text-center">
            <div className="text-3xl font-bold text-gray-700">{count}</div>
            <div className="text-sm text-gray-500 mt-1">{name}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ApplicationsTable({ apps }: { apps: any[] }) {
  if (apps.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-lg p-8 text-center">
        <p className="text-gray-500">No submitted applications.</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-lg font-semibold text-gray-900">Applications ({apps.length})</h2>
      </div>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
          <tr>
            <th className="px-6 py-3 text-left">Applicant</th>
            <th className="px-6 py-3 text-left">Domain(s)</th>
            <th className="px-6 py-3 text-left">Submitted</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {apps.map((app: any) => {
            const domains = app.domainApplications.map((da: any) => da.challengeVersion.domain.name);
            return (
              <tr key={app.id} className="hover:bg-gray-50">
                <td className="px-6 py-4 font-medium text-gray-900">
                  {app.user.firstName} {app.user.lastName}
                </td>
                <td className="px-6 py-4 text-gray-600">
                  {domains.join(", ") || "—"}
                </td>
                <td className="px-6 py-4 text-gray-500">
                  {new Date(app.updatedAt).toLocaleDateString()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
