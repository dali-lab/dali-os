import { useState } from "react";
import { redirect, useLoaderData, useFetcher, useParams } from "react-router";
import type { Route } from "./+types/core.growth.$userId";
import { requireAuth, redirectApplicantToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { canManageStaffing, canViewStaffing, currentTerm } from "~/lib/roles";
import { prisma } from "~/lib/db";
import { ensureStaffingCycle } from "~/projects/lib/staffing-cycle";
import { getSlotBinding } from "~/projects/lib/form-slots";
import { isGrowthSlot, type GrowthSlot } from "~/projects/lib/growth.server";
import { resolveTermFilter } from "~/lib/terms";
import { buildSubmissionView } from "~/projects/lib/submission-view.server";
import { UserSubmissionShell } from "~/projects/components/UserSubmissionShell";
import { applyEligibilityWithNotify } from "~/admin/lib/eligibility.server";
import { coreHandle } from "~/core/coreNav";
import { isLevel, type Level } from "~/lib/level";
import { cn } from "~/lib/cn";

export const meta: Route.MetaFunction = ({ data }) => [
  {
    title: `${
      (data as { record?: { name: string } } | undefined)?.record?.name ??
      "Growth Request"
    } · Growth · DALI OS`,
  },
];

export const handle = {
  ...coreHandle("growth"),
  breadcrumb: (data: unknown) =>
    (data as { record?: { name?: string } } | undefined)?.record?.name,
};

type RubricCriterion = {
  key: string;
  label: string;
  description?: string;
  maxScore: number;
};

function parseLevelStr(raw: string): Level | null {
  const s = raw.trim().toLowerCase();
  if (s === "p1" || s === "learner") return "P1";
  if (s === "p2" || s === "doer") return "P2";
  if (s === "p3" || s === "mentor") return "P3";
  return null;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const portalRedirect = redirectApplicantToPortal(auth);
  if (portalRedirect) return portalRedirect;
  if (!(await canViewStaffing(auth.user.sub))) return redirect("/");

  const { termId: filterTermId, isAll } = await resolveTermFilter(request);
  const fallbackTerm = await currentTerm();

  const term =
    !isAll && filterTermId
      ? await prisma.term.findUnique({
          where: { id: filterTermId },
          select: { id: true, code: true },
        })
      : fallbackTerm
        ? { id: fallbackTerm.id, code: fallbackTerm.code }
        : null;
  if (!term) return redirect("/core/growth");

  const cycle = await ensureStaffingCycle(term.id, term.code);

  // Try to find this user's submission in either Growth slot.
  let foundSlot: GrowthSlot | null = null;
  let row: Awaited<ReturnType<typeof buildSubmissionView>>["rows"][number] | undefined;
  let binding: Awaited<ReturnType<typeof getSlotBinding>> = null;

  for (const slot of ["level-up", "domain-join"] as GrowthSlot[]) {
    const b = await getSlotBinding(cycle.id, slot);
    const view = await buildSubmissionView({
      cycleIds: [cycle.id],
      slot,
      formId: b?.formId ?? null,
      userId: params.userId,
    });
    if (view.rows[0]) {
      foundSlot = slot;
      row = view.rows[0];
      binding = b;
      break;
    }
  }

  if (!row || !foundSlot) return redirect("/core/growth");

  const canManage = await canManageStaffing(auth.user.sub);

  // Load the raw submission so we can read the domain and level answers directly.
  const submission = await prisma.formSubmission.findFirst({
    where: {
      staffingCycleId: cycle.id,
      slot: foundSlot,
      userId: params.userId,
    },
    orderBy: { createdAt: "desc" },
    select: { id: true, answers: true },
  });
  const rawAnswers = (submission?.answers as Record<string, unknown>) ?? {};

  // Resolve the target domain ID and level from raw answers via the mapping.
  // Used for: (1) rubric lookup, (2) hidden form fields in the review UI.
  let resolvedDomainId: string | null = null;
  let resolvedTargetLevel: Level | null = null;

  if (binding?.mapping) {
    const domainEntry = binding.mapping.entries.find(
      (e) => e.role === "target-domain" && e.source === "question",
    );
    const levelEntry = binding.mapping.entries.find(
      (e) => e.role === "target-level" && e.source === "question",
    );

    if (domainEntry?.source === "question") {
      const rawDomain = rawAnswers[domainEntry.questionKey];
      if (typeof rawDomain === "string" && rawDomain.length > 0) {
        const domainRecord = await prisma.domain.findFirst({
          where: {
            OR: [
              { id: rawDomain },
              { displayName: { equals: rawDomain, mode: "insensitive" } },
            ],
          },
          select: { id: true },
        });
        if (domainRecord) resolvedDomainId = domainRecord.id;
      }
    }

    if (levelEntry?.source === "question") {
      const rawLevel = rawAnswers[levelEntry.questionKey];
      if (typeof rawLevel === "string") {
        const parsed = parseLevelStr(rawLevel);
        if (parsed) resolvedTargetLevel = parsed;
      }
    }
    // domain-join always targets P1 when no level question is mapped.
    if (foundSlot === "domain-join" && !resolvedTargetLevel) {
      resolvedTargetLevel = "P1";
    }
  }

  // Load the domain's rubric via Domain.levelUpRubricId (the proper association).
  // Falls back gracefully to no criteria when null — reviewer can still approve/decline.
  let rubricCriteria: RubricCriterion[] = [];
  let rubricVersionId: string | null = null;

  if (resolvedDomainId) {
    const domain = await prisma.domain.findUnique({
      where: { id: resolvedDomainId },
      select: { levelUpRubricId: true },
    });
    if (domain?.levelUpRubricId) {
      const rubric = await prisma.rubric.findUnique({
        where: { id: domain.levelUpRubricId },
        include: {
          versions: {
            orderBy: { versionNumber: "desc" },
            take: 1,
            select: { id: true, criteria: true },
          },
        },
      });
      const latestVersion = rubric?.versions[0];
      if (latestVersion) {
        rubricVersionId = latestVersion.id;
        rubricCriteria = (latestVersion.criteria as unknown as RubricCriterion[]) ?? [];
      }
    }
  }

  const existingReview = submission
    ? await prisma.levelUpReview.findFirst({
        where: { submissionId: submission.id },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          decision: true,
          note: true,
          scores: true,
          rubricVersionId: true,
          reviewerId: true,
          createdAt: true,
        },
      })
    : null;

  // Look up reviewer name separately (LevelUpReview has no Prisma relation).
  let reviewerName = "Unknown";
  if (existingReview?.reviewerId) {
    const reviewer = await prisma.user.findUnique({
      where: { id: existingReview.reviewerId },
      select: { firstName: true, lastName: true },
    });
    if (reviewer) reviewerName = `${reviewer.firstName} ${reviewer.lastName}`.trim();
  }

  return {
    record: { name: row.name, email: row.email },
    fields: row.detailFields,
    cycleName: cycle.name,
    slot: foundSlot,
    submissionId: submission?.id ?? null,
    canManage,
    rubricCriteria,
    rubricVersionId,
    resolvedDomainId,
    resolvedTargetLevel,
    existingReview: existingReview
      ? {
          id: existingReview.id,
          decision: existingReview.decision,
          note: existingReview.note,
          scores: (existingReview.scores as Record<string, number>) ?? {},
          rubricVersionId: existingReview.rubricVersionId,
          reviewerName,
          createdAt: existingReview.createdAt.toISOString(),
        }
      : null,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await canManageStaffing(auth.user.sub)))
    return Response.json({ error: "Forbidden" }, { status: 403 });

  const form = await request.formData();
  const intent = String(form.get("intent"));

  if (intent === "review-growth") {
    const submissionId = String(form.get("submissionId") ?? "");
    const subjectUserId = String(form.get("subjectUserId") ?? "");
    const domainId = String(form.get("domainId") ?? "");
    const rawTargetLevel = String(form.get("targetLevel") ?? "");
    const decision = String(form.get("decision") ?? "");
    const note = String(form.get("note") ?? "") || null;
    const rawRubricVersionId = String(form.get("rubricVersionId") ?? "") || null;
    const rawScores = String(form.get("scores") ?? "{}");
    const rawSlot = String(form.get("slot") ?? "level-up");

    if (
      !submissionId ||
      !subjectUserId ||
      !domainId ||
      !isLevel(rawTargetLevel) ||
      (decision !== "Approved" && decision !== "Declined")
    ) {
      return Response.json({ error: "Invalid parameters." }, { status: 400 });
    }
    if (!isGrowthSlot(rawSlot)) {
      return Response.json({ error: "Invalid slot." }, { status: 400 });
    }

    let scores: Record<string, number> = {};
    try {
      scores = JSON.parse(rawScores);
    } catch {
      // Scores are best-effort; no rubric = empty object.
    }

    await prisma.levelUpReview.create({
      data: {
        submissionId,
        subjectUserId,
        domainId,
        targetLevel: rawTargetLevel as Level,
        rubricVersionId: rawRubricVersionId,
        scores,
        decision: decision as "Approved" | "Declined",
        note,
        reviewerId: auth.user.sub,
      },
    });

    if (decision === "Approved") {
      await applyEligibilityWithNotify({
        userId: subjectUserId,
        domainId,
        level: rawTargetLevel as Level,
        actorId: auth.user.sub,
      });
    }

    return redirect(`/core/growth`);
  }

  return Response.json({ error: "Unknown intent" }, { status: 400 });
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function GrowthRequestDetail() {
  const data = useLoaderData<typeof loader>();
  const { userId } = useParams<{ userId: string }>();
  const fetcher = useFetcher();
  const [decision, setDecision] = useState<"Approved" | "Declined" | "">(
    (data.existingReview?.decision as "Approved" | "Declined") ?? "",
  );
  const [note, setNote] = useState(data.existingReview?.note ?? "");
  const [scores, setScores] = useState<Record<string, number>>(
    data.existingReview?.scores ?? {},
  );
  const pending = fetcher.state !== "idle";

  return (
    <div className="flex flex-col gap-6 max-w-3xl">
      <div>
        <h1 className="font-heading text-2xl font-bold text-foreground">
          {data.record.name}
        </h1>
        <p className="text-sm text-muted-foreground">
          {data.cycleName} ·{" "}
          {data.slot === "domain-join" ? "Domain Join request" : "Level Up request"}
        </p>
      </div>

      {/* Submission fields */}
      <UserSubmissionShell
        rows={data.fields.map((f) => ({
          key: f.key,
          label: f.label,
          value: f.value,
          mapped: f.mapped,
        }))}
      />

      {/* Existing review summary */}
      {data.existingReview && (
        <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-semibold text-foreground">Previous review</h2>
            <span
              className={cn(
                "text-xs font-medium px-2 py-0.5 rounded border",
                data.existingReview.decision === "Approved"
                  ? "bg-green-50 text-green-700 border-green-200"
                  : "bg-red-50 text-red-700 border-red-200",
              )}
            >
              {data.existingReview.decision}
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            By {data.existingReview.reviewerName} on{" "}
            {new Date(data.existingReview.createdAt).toLocaleDateString()}
          </p>
          {data.existingReview.note && (
            <p className="text-sm text-foreground whitespace-pre-wrap">
              {data.existingReview.note}
            </p>
          )}
        </div>
      )}

      {/* Review form — managers only */}
      {data.canManage && data.submissionId && (
        <div className="rounded-lg border border-border bg-card p-4 flex flex-col gap-4">
          <h2 className="text-sm font-semibold text-foreground">
            {data.existingReview ? "Submit another review" : "Review this request"}
          </h2>

          <fetcher.Form method="post" className="flex flex-col gap-4">
            <input type="hidden" name="intent" value="review-growth" />
            <input type="hidden" name="submissionId" value={data.submissionId} />
            <input type="hidden" name="subjectUserId" value={userId ?? ""} />
            <input type="hidden" name="slot" value={data.slot} />
            {/* Target domain and level resolved server-side from raw answers. */}
            <input
              type="hidden"
              name="domainId"
              value={data.resolvedDomainId ?? ""}
            />
            <input
              type="hidden"
              name="targetLevel"
              value={data.resolvedTargetLevel ?? ""}
            />
            {data.rubricVersionId && (
              <input type="hidden" name="rubricVersionId" value={data.rubricVersionId} />
            )}
            <input
              type="hidden"
              name="scores"
              value={JSON.stringify(scores)}
            />

            {/* Rubric criteria scoring. If no rubric is configured for this
                domain, show a hint so reviewers know to set one up. */}
            {data.rubricCriteria.length === 0 && data.resolvedDomainId && (
              <p className="text-xs text-muted-foreground">
                No rubric configured for this domain.{" "}
                <a href="/hiring/library?tab=rubrics" className="underline hover:text-foreground">
                  Manage rubrics →
                </a>
              </p>
            )}
            {data.rubricCriteria.length > 0 && (
              <div className="flex flex-col gap-3">
                <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
                  Rubric scores
                </p>
                {data.rubricCriteria.map((c) => (
                  <div key={c.key} className="flex flex-col gap-1">
                    <label className="text-sm font-medium text-foreground flex items-center justify-between">
                      <span>{c.label}</span>
                      <span className="text-xs text-muted-foreground font-normal">
                        / {c.maxScore}
                      </span>
                    </label>
                    {c.description && (
                      <p className="text-xs text-muted-foreground">{c.description}</p>
                    )}
                    <input
                      type="number"
                      min={0}
                      max={c.maxScore}
                      step={1}
                      value={scores[c.key] ?? ""}
                      onChange={(e) =>
                        setScores((prev) => ({
                          ...prev,
                          [c.key]: Math.min(c.maxScore, Math.max(0, Number(e.target.value))),
                        }))
                      }
                      className="w-24 rounded-md border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral"
                      placeholder="—"
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Decision */}
            <div className="flex flex-col gap-1.5">
              <p className="text-sm font-medium text-foreground">Decision</p>
              <div className="flex gap-3">
                {(["Approved", "Declined"] as const).map((d) => (
                  <label
                    key={d}
                    className="flex items-center gap-2 text-sm cursor-pointer"
                  >
                    <input
                      type="radio"
                      name="decision"
                      value={d}
                      checked={decision === d}
                      onChange={() => setDecision(d)}
                      className="text-accent-coral"
                    />
                    {d}
                  </label>
                ))}
              </div>
            </div>

            {/* Note */}
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-medium text-foreground" htmlFor="growth-review-note">
                Note <span className="text-muted-foreground font-normal">(optional)</span>
              </label>
              <textarea
                id="growth-review-note"
                name="note"
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                className="rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral resize-y"
                placeholder="Feedback for the member or internal notes…"
              />
            </div>

            {fetcher.data && !(fetcher.data as { ok?: boolean }).ok && (
              <p className="text-sm text-red-600">
                {(fetcher.data as { error?: string }).error ?? "Something went wrong."}
              </p>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={pending || !decision}
                className="px-4 py-2 text-sm font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 disabled:opacity-50 transition-colors"
              >
                {pending
                  ? "Saving…"
                  : decision === "Approved"
                    ? "Approve & apply"
                    : decision === "Declined"
                      ? "Decline"
                      : "Submit review"}
              </button>
            </div>
          </fetcher.Form>
        </div>
      )}
    </div>
  );
}

