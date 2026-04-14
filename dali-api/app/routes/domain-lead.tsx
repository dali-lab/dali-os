import { useState, useEffect } from "react";
import { Form, Link, useLoaderData } from "react-router";
import { redirect } from "react-router";
import type { Route } from "./+types/domain-lead";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { CheckCircle, AlertTriangle, Plus, Trash2 } from "lucide-react";

const STATUS_LABELS: Record<string, string> = {
  Draft: "Draft",
  Open: "Open",
  Closed: "Closed",
  DecisionsReleased: "Decisions Released",
};

const STATUS_COLORS: Record<string, string> = {
  Draft: "bg-gray-100 text-gray-700",
  Open: "bg-green-100 text-green-700",
  Closed: "bg-yellow-100 text-yellow-700",
  DecisionsReleased: "bg-blue-100 text-blue-700",
};

const STATUS_MESSAGES: Record<string, string> = {
  Draft: "This cycle is still being set up.",
  Open: "Applications are open. Applicants can submit until the cycle closes.",
  Closed: "Submissions are closed. Review applications below.",
  DecisionsReleased: "Decisions have been released to applicants.",
};

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return { domainData: [] };

  const member = await prisma.dALIMember.findFirst({
    where: { userId: auth.user.sub },
  });

  if (!member) {
    return { domainData: [] };
  }

  const assignments = await prisma.domainLeadAssignment.findMany({
    where: { memberId: member.id },
    include: { domain: true },
  });

  const domainData = await Promise.all(
    assignments.map(async (assignment) => {
      const cycles = await prisma.applicationCycle.findMany({
        where: {
          domains: { some: { domainId: assignment.domainId } },
        },
        include: {
          statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
          domains: { where: { domainId: assignment.domainId } },
          challengeVersions: {
            include: {
              challengeVersion: { include: { challenge: true, domain: true } },
            },
          },
          applications: {
            include: {
              user: true,
              statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
              domainApplications: {
                where: { challengeVersion: { domainId: assignment.domainId } },
                include: { challengeVersion: { include: { domain: true } } },
              },
            },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 1,
      });

      const cycle = cycles[0] ?? null;
      if (!cycle) return { assignment, cycle: null, apps: [], challengeVersionOptions: [], selectedChallengeVersionId: null, isChallengeReady: false };

      // Challenge versions available for this domain
      const challengeVersionOptions = await prisma.challengeVersion.findMany({
        where: { domainId: assignment.domainId },
        include: { challenge: true },
        orderBy: { createdAt: "desc" },
      });

      // Currently selected challenge version(s) for this domain in this cycle
      const selectedChallengeVersionId =
        cycle.challengeVersions.find(
          (cv) => cv.challengeVersion.domainId === assignment.domainId
        )?.challengeVersionId ?? null;

      // isReady lives on DomainApplicationCycle (per domain+cycle, not per challenge version)
      const isChallengeReady = cycle.domains[0]?.isReady ?? false;

      const apps = cycle.applications.filter((app) => {
        const latestStatus = app.statusUpdates[0]?.newStatus;
        return latestStatus === "Submitted" && app.domainApplications.length > 0;
      });

      // Interviews for this domain in this cycle
      const currentStatus = cycle?.statusUpdates[0]?.newStatus ?? "Draft";
      const interviews = (currentStatus === "Closed" || currentStatus === "DecisionsReleased") && cycle
        ? await prisma.interview.findMany({
            where: {
              applicationCycleId: cycle.id,
              application: {
                domainApplications: {
                  some: { challengeVersion: { domainId: assignment.domainId } },
                },
              },
            },
            include: {
              application: {
                include: {
                  user: { select: { firstName: true, lastName: true } },
                  domainApplications: { include: { challengeVersion: { include: { domain: true } } } },
                },
              },
              assignments: {
                where: { status: "Active" },
                include: {
                  cycleReviewer: {
                    include: { daliMember: { include: { user: { select: { firstName: true, lastName: true } } } }, domain: true },
                  },
                },
              },
            },
            orderBy: { startTime: "asc" },
          })
        : [];

      // Reviewers for this domain in this cycle
      const reviewers = cycle
        ? await prisma.cycleReviewer.findMany({
            where: { applicationCycleId: cycle.id, domainId: assignment.domainId },
            include: { daliMember: { include: { user: true } }, domain: true },
          })
        : [];

      return { assignment, cycle, apps, challengeVersionOptions, selectedChallengeVersionId, isChallengeReady, interviews, reviewers };
    })
  );

  return { domainData };
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "select-challenge") {
    const cycleId = formData.get("cycleId") as string;
    const newVersionId = formData.get("challengeVersionId") as string;
    const domainId = formData.get("domainId") as string;

    // Remove any existing challenge version for this domain in this cycle
    const existing = await prisma.challengeVersionApplicationCycle.findMany({
      where: {
        applicationCycleId: cycleId,
        challengeVersion: { domainId },
      },
    });
    if (existing.length > 0) {
      await prisma.challengeVersionApplicationCycle.deleteMany({
        where: {
          applicationCycleId: cycleId,
          challengeVersionId: { in: existing.map((e) => e.challengeVersionId) },
        },
      });
    }

    await prisma.challengeVersionApplicationCycle.create({
      data: { challengeVersionId: newVersionId, applicationCycleId: cycleId },
    });
  }

  if (intent === "mark-ready") {
    const cycleId = formData.get("cycleId") as string;
    const domainId = formData.get("domainId") as string;
    await prisma.domainApplicationCycle.upsert({
      where: { domainId_applicationCycleId: { domainId, applicationCycleId: cycleId } },
      update: { isReady: true },
      create: { domainId, applicationCycleId: cycleId, isReady: true },
    });
  }

  if (intent === "unmark-ready") {
    const cycleId = formData.get("cycleId") as string;
    const domainId = formData.get("domainId") as string;
    await prisma.domainApplicationCycle.upsert({
      where: { domainId_applicationCycleId: { domainId, applicationCycleId: cycleId } },
      update: { isReady: false },
      create: { domainId, applicationCycleId: cycleId, isReady: false },
    });
  }

  return redirect("/domain-lead");
}

export default function DomainLeadDashboard() {
  const data = useLoaderData<typeof loader>() as any;
  const domainData = data?.domainData ?? [];

  if (domainData.length === 0) {
    return (
      <div className="text-center py-16">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Domain Lead Dashboard</h1>
        <p className="text-gray-500">You are not assigned as a domain lead for any domain.</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-gray-900">Domain Lead Dashboard</h1>

      {domainData.map(({ assignment, cycle, apps, challengeVersionOptions, selectedChallengeVersionId, isChallengeReady, interviews, reviewers: cycleReviewers }: any) => {
        const currentStatus = cycle?.statusUpdates[0]?.newStatus ?? null;

        return (
          <section key={assignment.id} className="space-y-4">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-semibold text-gray-800">{assignment.domain.name}</h2>
              {currentStatus && (
                <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[currentStatus]}`}>
                  {STATUS_LABELS[currentStatus]}
                </span>
              )}
            </div>

            {!cycle ? (
              <div className="bg-white border border-gray-200 rounded-lg p-6 text-gray-500 text-sm">
                No active cycle for this domain.
              </div>
            ) : (
              <>
                {currentStatus === "Draft" ? (
                  <DraftSection
                    cycle={cycle}
                    domainId={assignment.domainId}
                    challengeVersionOptions={challengeVersionOptions}
                    selectedChallengeVersionId={selectedChallengeVersionId}
                    isChallengeReady={isChallengeReady}
                  />
                ) : (
                  <>
                    <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
                      <div className="flex items-center justify-between">
                        <span className="font-medium text-gray-900">{cycle.name}</span>
                      </div>
                      <p className="text-sm text-gray-500">{STATUS_MESSAGES[currentStatus]}</p>
                      <div className="flex gap-6 text-sm">
                        <div>
                          <span className="font-semibold text-gray-900">{apps.length}</span>
                          <span className="text-gray-500 ml-1">submitted</span>
                        </div>
                      </div>
                    </div>

                    {apps.length > 0 && (
                      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
                            <tr>
                              <th className="px-6 py-3 text-left">Applicant</th>
                              <th className="px-6 py-3 text-left">Submitted</th>
                              <th className="px-6 py-3 text-right"></th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {apps.map((app: any) => (
                              <tr key={app.id} className="hover:bg-gray-50">
                                <td className="px-6 py-4 font-medium text-gray-900">
                                  {app.user.firstName} {app.user.lastName}
                                </td>
                                <td className="px-6 py-4 text-gray-500">
                                  {new Date(app.updatedAt).toLocaleDateString()}
                                </td>
                                <td className="px-6 py-4 text-right">
                                  <Link
                                    to={`/domain-lead/application/${app.id}`}
                                    className="text-blue-600 hover:text-blue-800 font-medium"
                                  >
                                    Review →
                                  </Link>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {apps.length === 0 && (
                      <div className="bg-white border border-gray-200 rounded-lg p-6 text-center text-gray-500 text-sm">
                        No submitted applications yet.
                      </div>
                    )}

                    {/* Reviewer Roster */}
                    {cycle && (
                      <ReviewerSection cycleId={cycle.id} domainId={assignment.domainId} initialReviewers={cycleReviewers} />
                    )}

                    {/* Interview Dashboard */}
                    {interviews.length > 0 && (
                      <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                        <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
                          <h3 className="font-semibold text-gray-900">Scheduled Interviews ({interviews.length})</h3>
                          {interviews.some((i: any) => i.status === 'NeedsReassignment') && (
                            <span className="flex items-center gap-1 text-xs font-bold text-red-700 bg-red-100 px-2 py-1 rounded-full">
                              <AlertTriangle className="w-3 h-3" />
                              Needs attention
                            </span>
                          )}
                        </div>
                        <table className="w-full text-sm">
                          <thead className="bg-gray-50 text-xs font-medium text-gray-500 uppercase tracking-wide">
                            <tr>
                              <th className="px-6 py-3 text-left">Applicant</th>
                              <th className="px-6 py-3 text-left">Time</th>
                              <th className="px-6 py-3 text-left">Status</th>
                              <th className="px-6 py-3 text-left">Reviewers</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {interviews.map((interview: any) => {
                              const isAlert = interview.status === 'NeedsReassignment';
                              const start = new Date(interview.startTime);
                              const end = new Date(interview.endTime);
                              return (
                                <tr key={interview.id} className={isAlert ? 'bg-red-50' : 'hover:bg-gray-50'}>
                                  <td className="px-6 py-4 font-medium text-gray-900">
                                    {interview.application.user.firstName} {interview.application.user.lastName}
                                  </td>
                                  <td className="px-6 py-4 text-gray-600">
                                    {start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}{' '}
                                    {start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} –{' '}
                                    {end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                                  </td>
                                  <td className="px-6 py-4">
                                    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${
                                      isAlert ? 'bg-red-100 text-red-700' :
                                      interview.status === 'Scheduled' ? 'bg-green-100 text-green-700' :
                                      'bg-gray-100 text-gray-600'
                                    }`}>
                                      {isAlert && <AlertTriangle className="w-3 h-3 mr-1" />}
                                      {interview.status}
                                    </span>
                                  </td>
                                  <td className="px-6 py-4 text-gray-600 text-xs">
                                    {interview.assignments
                                      .map((a: any) => {
                                        const name = a.cycleReviewer.daliMember.user
                                          ? `${a.cycleReviewer.daliMember.user.firstName} ${a.cycleReviewer.daliMember.user.lastName}`
                                          : '?';
                                        return `${name} (${a.role === 'InDomain' ? a.cycleReviewer.domain.name : 'Cross'})`;
                                      })
                                      .join(', ') || '—'}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </>
                )}
              </>
            )}
          </section>
        );
      })}
    </div>
  );
}

function DraftSection({ cycle, domainId, challengeVersionOptions, selectedChallengeVersionId, isChallengeReady }: {
  cycle: any;
  domainId: string;
  challengeVersionOptions: any[];
  selectedChallengeVersionId: string | null;
  isChallengeReady: boolean;
}) {
  const selectedVersion = challengeVersionOptions.find((cv: any) => cv.id === selectedChallengeVersionId);
  const questionCount: number = selectedVersion?.questions?.length ?? 0;

  // State 3: Challenge selected and marked ready — "Challenge Questions Finalized"
  if (selectedChallengeVersionId && isChallengeReady) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl p-8 flex flex-col items-center text-center space-y-6">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
          <CheckCircle className="w-8 h-8 text-green-600" />
        </div>
        <div className="space-y-1">
          <h3 className="text-xl font-bold text-gray-900">Challenge Questions Finalized</h3>
          <p className="text-gray-500 text-sm max-w-sm">
            Your {selectedVersion?.challenge?.name ?? "challenge"} has {questionCount} question{questionCount !== 1 ? "s" : ""} configured and is ready for applicants.
          </p>
        </div>

        <div className="w-full max-w-sm bg-gray-50 border border-gray-200 rounded-xl p-4 text-left space-y-3">
          <div className="grid grid-cols-2 divide-x divide-gray-200">
            <div className="pr-4">
              <p className="text-xs text-gray-500">Challenge Selected</p>
              <p className="font-bold text-gray-900 mt-0.5">Yes</p>
            </div>
            <div className="pl-4">
              <p className="text-xs text-gray-500">Questions Configured</p>
              <p className="font-bold text-gray-900 mt-0.5">{questionCount}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-green-600 text-sm font-medium pt-1 border-t border-gray-200">
            <CheckCircle className="w-4 h-4" />
            Ready for applications
          </div>
        </div>

        <Form method="post">
          <input type="hidden" name="intent" value="unmark-ready" />
          <input type="hidden" name="cycleId" value={cycle.id} />
          <input type="hidden" name="domainId" value={domainId} />
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Edit Challenge
          </button>
        </Form>
      </div>
    );
  }

  // State 2: Challenge selected but not yet marked ready — "Ready to finalize?"
  if (selectedChallengeVersionId && !isChallengeReady) {
    return (
      <div className="space-y-4">
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-6 space-y-4">
          <div className="flex gap-3">
            <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
              <CheckCircle className="w-5 h-5 text-blue-600" />
            </div>
            <div className="space-y-1">
              <h3 className="font-bold text-blue-900">Ready to finalize?</h3>
              <p className="text-sm text-blue-700 leading-relaxed">
                Once you mark your challenge as ready, your challenge questions will be locked in and visible to applicants when applications open. You can still return here to make edits before the application deadline.
              </p>
            </div>
          </div>
          <Form method="post">
            <input type="hidden" name="intent" value="mark-ready" />
            <input type="hidden" name="cycleId" value={cycle.id} />
            <input type="hidden" name="domainId" value={domainId} />
            <button
              type="submit"
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700"
            >
              <CheckCircle className="w-4 h-4" />
              Mark Configuration as Ready
            </button>
          </Form>
        </div>

        <ChallengeSelector
          cycleId={cycle.id}
          domainId={domainId}
          options={challengeVersionOptions}
          selectedId={selectedChallengeVersionId}
        />
      </div>
    );
  }

  // State 1: No challenge selected yet
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
      <div>
        <h3 className="font-semibold text-gray-900">Configure Challenge</h3>
        <p className="text-sm text-gray-500 mt-0.5">Select the challenge version applicants will complete for {cycle.name}.</p>
      </div>
      <ChallengeSelector
        cycleId={cycle.id}
        domainId={domainId}
        options={challengeVersionOptions}
        selectedId={selectedChallengeVersionId}
      />
    </div>
  );
}

function ChallengeSelector({ cycleId, domainId, options, selectedId }: {
  cycleId: string;
  domainId: string;
  options: any[];
  selectedId: string | null;
}) {
  const [previewId, setPreviewId] = useState<string>(selectedId ?? "");
  const previewVersion = options.find((cv: any) => cv.id === previewId);
  const questions: any[] = previewVersion?.questions ?? [];

  return (
    <div className="space-y-3 pt-1">
      <Form method="post" className="flex items-end gap-3">
        <input type="hidden" name="intent" value="select-challenge" />
        <input type="hidden" name="cycleId" value={cycleId} />
        <input type="hidden" name="domainId" value={domainId} />
        <div className="flex-1">
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Challenge
          </label>
          <select
            name="challengeVersionId"
            value={previewId}
            onChange={(e) => setPreviewId(e.target.value)}
            className="w-full px-3 py-2 text-sm text-gray-900 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="" disabled>Select a challenge…</option>
            {options.map((cv: any) => (
              <option key={cv.id} value={cv.id}>
                {cv.challenge.name} (v{cv.id.slice(-4)})
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

function ReviewerSection({ cycleId, domainId, initialReviewers }: {
  cycleId: string;
  domainId: string;
  initialReviewers: any[];
}) {
  const [reviewers, setReviewers] = useState(initialReviewers);
  const [members, setMembers] = useState<any[]>([]);
  const [selectedMemberId, setSelectedMemberId] = useState('');

  useEffect(() => {
    fetch('/api/members', { credentials: 'include' })
      .then(r => r.ok ? r.json() : [])
      .then(setMembers)
      .catch(() => {});
  }, []);

  async function addReviewer() {
    if (!selectedMemberId) return;
    const res = await fetch(`/api/cycles/${cycleId}/reviewers`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ daliMemberId: selectedMemberId, domainId, isLead: false }),
    });
    if (res.ok) {
      const reviewer = await res.json();
      setReviewers(prev => [...prev, reviewer]);
      setSelectedMemberId('');
    }
  }

  async function removeReviewer(reviewerId: string) {
    const res = await fetch(`/api/cycles/${cycleId}/reviewers/${reviewerId}`, {
      method: 'DELETE', credentials: 'include',
    });
    if (res.ok) setReviewers(prev => prev.filter(r => r.id !== reviewerId));
  }

  // Filter out members already assigned as reviewers for this domain
  const existingMemberIds = new Set(reviewers.map((r: any) => r.daliMemberId));
  const availableMembers = members.filter(m => !existingMemberIds.has(m.id));

  return (
    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
        <h3 className="font-semibold text-gray-900">Reviewers for this Domain ({reviewers.length})</h3>
      </div>
      <div className="p-4 space-y-3">
        <div className="flex gap-2 items-end">
          <div className="flex-1">
            <label className="block text-xs font-medium text-gray-500 mb-1">Add Reviewer</label>
            <select
              value={selectedMemberId}
              onChange={e => setSelectedMemberId(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Select member...</option>
              {availableMembers.map((m: any) => (
                <option key={m.id} value={m.id}>
                  {m.user ? `${m.user.firstName} ${m.user.lastName}` : m.id}
                </option>
              ))}
            </select>
          </div>
          <button
            onClick={addReviewer}
            disabled={!selectedMemberId}
            className="flex items-center gap-1 px-3 py-2 text-sm font-medium rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition disabled:opacity-50"
          >
            <Plus className="w-4 h-4" /> Add
          </button>
        </div>
        {reviewers.length > 0 ? (
          <div className="divide-y divide-gray-100">
            {reviewers.map((r: any) => (
              <div key={r.id} className="flex items-center justify-between py-2">
                <span className="text-sm font-medium text-gray-900">
                  {r.daliMember?.user ? `${r.daliMember.user.firstName} ${r.daliMember.user.lastName}` : r.daliMemberId}
                </span>
                <button onClick={() => removeReviewer(r.id)} className="text-red-500 hover:text-red-700">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-gray-400 text-center py-3">No reviewers assigned yet.</p>
        )}
      </div>
    </div>
  );
}
