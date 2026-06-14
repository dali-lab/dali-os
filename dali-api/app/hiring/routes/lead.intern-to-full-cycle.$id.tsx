import { useState } from "react";
import { Form, redirect, useLoaderData, useFetcher, Link } from "react-router";
import type { Route } from "./+types/lead.intern-to-full-cycle.$id";
import { prisma } from "~/lib/db";
import { requireAuth, forbidden } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import type { Question } from "~/types";
import type { Prisma } from "~/generated/prisma/client";
import { CycleSetupSection as Section } from "~/hiring/components/CycleSetupSection";
import { ChallengePreviewModal } from "~/hiring/components/ChallengePreviewModal";
import { RichTextEditor } from "~/components/RichTextEditor";
import { hasInfoBody } from "~/hiring/lib/info-body";
import { renderEmail } from "~/lib/email";
import {
  TEMPLATE_VARIABLES,
  decisionSlot,
  lintTemplate,
  type TemplateSlot,
  type DecisionSlotType,
} from "~/hiring/lib/email-variables";
import { AlertTriangle, CheckCircle, Eye, Mail, X } from "lucide-react";

import {
  zonedDayEndUtc,
  getZonedYMD,
  APPLICATION_TZ,
  APPLICATION_TZ_LABEL,
} from "~/lib/timezone";

export const meta: Route.MetaFunction = () => [
  { title: "Fellowship cycle · DALI OS" },
];

const MIN_POOL_SIZE = 2;

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const cycle = await prisma.applicationCycle.findUniqueOrThrow({
    where: { id: params.id },
    include: {
      statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
      internToFullFormVersion: true,
      generalRubricVersion: { include: { rubric: true } },
      domains: {
        include: {
          domain: true,
          rubricVersion: { include: { rubric: true } },
        },
      },
      cycleReviewers: {
        include: {
          user: { select: { id: true, firstName: true, lastName: true, daliEmail: true } },
          domain: true,
        },
      },
    },
  });

  if (cycle.cycleType !== "InternToFull") {
    return redirect(`/hiring/lead/cycle/${cycle.id}`);
  }

  const [
    allDomains,
    allFormVersions,
    allRubricVersions,
    members,
    pendingDecisions,
    emailTemplates,
    currentDecisionEmails,
    releasedDecisions,
  ] = await Promise.all([
    prisma.domain.findMany({
      where: { active: true, isInternProgram: false },
      orderBy: { displayName: "asc" },
    }),
    prisma.internToFullFormVersion.findMany({
      orderBy: { version: "desc" },
      include: { createdBy: { select: { firstName: true, lastName: true } } },
    }),
    prisma.rubricVersion.findMany({
      include: { rubric: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.dALIMember.findMany({
      include: {
        user: { select: { id: true, firstName: true, lastName: true, daliEmail: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    // Draft + Final decisions awaiting hiring-lead action. Exclude Finals that
    // already have a Released child (Decision is append-only). For InternToFull
    // the Domain on DomainApplication is set directly (no challengeVersion).
    prisma.decision.findMany({
      where: {
        stage: { in: ["Draft", "Final"] },
        children: { none: { stage: "Released" } },
        domainApplication: {
          application: { applicationCycleId: params.id },
        },
      },
      include: {
        domainApplication: {
          include: {
            application: {
              include: {
                user: {
                  select: {
                    firstName: true,
                    lastName: true,
                    dartmouthEmail: true,
                    netId: true,
                  },
                },
              },
            },
            domain: { select: { name: true, displayName: true } },
          },
        },
        madeBy: { select: { firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    prisma.emailTemplate.findMany({
      include: { versions: { orderBy: { versionNumber: "desc" } } },
      orderBy: { name: "asc" },
    }),
    prisma.cycleDecisionEmail.findMany({
      where: { applicationCycleId: params.id },
      include: {
        emailTemplateVersion: { include: { template: { select: { name: true } } } },
      },
    }),
    prisma.decision.findMany({
      where: {
        stage: "Released",
        domainApplication: {
          application: { applicationCycleId: params.id },
        },
      },
      select: { type: true },
      distinct: ["type"],
    }),
  ]);
  const releasedDecisionTypes = releasedDecisions.map((d) => d.type);

  return {
    cycle: {
      id: cycle.id,
      name: cycle.name,
      status: cycle.statusUpdates[0]?.newStatus ?? "Draft",
      closeDate: cycle.closeDate ? cycle.closeDate.toISOString() : null,
      formVersion: cycle.internToFullFormVersion
        ? {
            id: cycle.internToFullFormVersion.id,
            version: cycle.internToFullFormVersion.version,
            questions: (cycle.internToFullFormVersion.questions as unknown as Question[]) ?? [],
          }
        : null,
      generalRubricVersionId: cycle.generalRubricVersionId,
      generalRubricLabel: cycle.generalRubricVersion
        ? `${cycle.generalRubricVersion.rubric.name} v${cycle.generalRubricVersion.versionNumber}`
        : null,
      targetDomains: cycle.domains.map((d) => ({
        domainId: d.domainId,
        code: d.domain.code,
        displayName: d.domain.displayName,
        isReady: d.isReady,
      })),
      // InternToFull uses a single reviewer pool: each member reads every DA
      // across all target domains. The schema still stores one CycleReviewer
      // row per (user, cycle, domain) so the existing fan-out (auto-assign,
      // review submission) works unchanged — dedupe by userId for the UI.
      reviewers: Array.from(
        new Map(
          cycle.cycleReviewers.map((r) => [
            r.userId,
            {
              userId: r.userId,
              displayName:
                [r.user.firstName, r.user.lastName].filter(Boolean).join(" ") ||
                r.user.daliEmail ||
                r.userId,
            },
          ]),
        ).values(),
      ),
    },
    allDomains: allDomains.map((d) => ({ id: d.id, code: d.code, displayName: d.displayName })),
    allFormVersions: allFormVersions.map((fv) => ({
      id: fv.id,
      version: fv.version,
      createdBy: [fv.createdBy.firstName, fv.createdBy.lastName].filter(Boolean).join(" "),
    })),
    allRubricVersions: allRubricVersions.map((rv) => ({
      id: rv.id,
      label: `${rv.rubric.name} v${rv.versionNumber}`,
    })),
    members: members.map((m) => ({
      userId: m.userId,
      displayName: [m.user.firstName, m.user.lastName].filter(Boolean).join(" ") || m.user.daliEmail || m.userId,
    })),
    pendingDecisions,
    emailTemplates,
    currentDecisionEmails,
    releasedDecisionTypes,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub))) return forbidden(request);

  const cycleId = params.id!;
  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "set-close-date") {
    const closeDate = (formData.get("closeDate") as string) || null;
    let parsedClose: Date | null = null;
    if (closeDate) {
      // Deadline is 11:59:59 PM Eastern on the selected date so interns get the
      // full day in the lab's local time (not late evening UTC on the server).
      const [y, m, d] = closeDate.split("-").map(Number);
      parsedClose = zonedDayEndUtc(y, m, d, APPLICATION_TZ);
    }
    // While the cycle is Open, a past close date would immediately flip the
    // cycle to UnderReview on the next loader hit (autoCloseIfExpired). That's
    // almost never what a lead means when editing a live cycle, so reject it.
    if (parsedClose && parsedClose.getTime() < Date.now()) {
      const latest = await prisma.applicationCycleStatusUpdate.findFirst({
        where: { applicationCycleId: cycleId },
        orderBy: { createdAt: "desc" },
        select: { newStatus: true },
      });
      if (latest?.newStatus === "Open") {
        return Response.json(
          { error: "Close date is in the past. Pick a future date, or close the cycle from the status control." },
          { status: 400 },
        );
      }
    }
    await prisma.applicationCycle.update({
      where: { id: cycleId },
      data: { closeDate: parsedClose },
    });
    return { ok: true };
  }

  if (intent === "set-form-version") {
    const formVersionId = (formData.get("formVersionId") as string) || null;
    await prisma.applicationCycle.update({
      where: { id: cycleId },
      data: { internToFullFormVersionId: formVersionId },
    });
    return { ok: true };
  }

  if (intent === "create-form-version") {
    const questions = JSON.parse((formData.get("questions") as string) || "[]") as Question[];
    // Use the highest existing version + 1; protected by the unique constraint.
    const latest = await prisma.internToFullFormVersion.findFirst({
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const nextVersion = (latest?.version ?? 0) + 1;
    const created = await prisma.internToFullFormVersion.create({
      data: {
        version: nextVersion,
        // Prisma's Json type rejects arrays — wrap via JSON round-trip cast.
        questions: questions as unknown as Prisma.InputJsonValue,
        createdById: auth.user.sub,
      },
    });
    await prisma.applicationCycle.update({
      where: { id: cycleId },
      data: { internToFullFormVersionId: created.id },
    });
    return { ok: true, formVersionId: created.id };
  }

  if (intent === "set-target-domains") {
    const desired = (JSON.parse((formData.get("domainIds") as string) || "[]") as string[]);
    const existing = await prisma.domainApplicationCycle.findMany({
      where: { applicationCycleId: cycleId },
      select: { domainId: true },
    });
    const existingIds = new Set(existing.map((e) => e.domainId));
    const desiredSet = new Set(desired);
    const toAdd = desired.filter((id) => !existingIds.has(id));
    const toRemove = [...existingIds].filter((id) => !desiredSet.has(id));
    if (toRemove.length > 0) {
      // Block removal once applications exist for that domain in this cycle to
      // avoid orphaning DomainApplications. The lead sees the message inline.
      const hasApps = await prisma.domainApplication.findFirst({
        where: {
          domainId: { in: toRemove },
          application: { applicationCycleId: cycleId },
        },
        select: { id: true },
      });
      if (hasApps) {
        return Response.json(
          { error: "Cannot remove a target domain after applicants have selected it." },
          { status: 409 },
        );
      }
    }

    // Pool members are stored as one CycleReviewer row per (user, cycle, domain);
    // sync the rowset whenever the target-domain set changes so the pool
    // invariant "every member is on every active domain" holds.
    const poolUserIds = Array.from(
      new Set(
        (
          await prisma.cycleReviewer.findMany({
            where: { applicationCycleId: cycleId },
            select: { userId: true },
          })
        ).map((r) => r.userId),
      ),
    );

    await prisma.$transaction(async (tx) => {
      if (toRemove.length > 0) {
        await tx.cycleReviewer.deleteMany({
          where: { applicationCycleId: cycleId, domainId: { in: toRemove } },
        });
        await tx.domainApplicationCycle.deleteMany({
          where: { applicationCycleId: cycleId, domainId: { in: toRemove } },
        });
      }
      if (toAdd.length > 0) {
        await tx.domainApplicationCycle.createMany({
          data: toAdd.map((domainId) => ({ applicationCycleId: cycleId, domainId })),
        });
        if (poolUserIds.length > 0) {
          await tx.cycleReviewer.createMany({
            data: toAdd.flatMap((domainId) =>
              poolUserIds.map((userId) => ({
                userId,
                applicationCycleId: cycleId,
                domainId,
              })),
            ),
            skipDuplicates: true,
          });
        }
      }
    });
    return { ok: true };
  }

  if (intent === "set-general-rubric") {
    const rubricVersionId = (formData.get("rubricVersionId") as string) || null;
    await prisma.applicationCycle.update({
      where: { id: cycleId },
      data: { generalRubricVersionId: rubricVersionId },
    });
    return { ok: true };
  }

  if (intent === "toggle-domain-ready") {
    const domainId = formData.get("domainId") as string;
    const ready = formData.get("ready") === "true";
    await prisma.domainApplicationCycle.update({
      where: {
        domainId_applicationCycleId: { domainId, applicationCycleId: cycleId },
      },
      data: { isReady: ready },
    });
    return { ok: true };
  }

  if (intent === "add-reviewer-pool") {
    // InternToFull cycles use a single reviewer pool. Adding a pool member
    // creates one CycleReviewer row per current target domain so the existing
    // per-domain fan-out (auto-assign, review join keys) keeps working.
    const userId = formData.get("userId") as string;
    const targetDomains = await prisma.domainApplicationCycle.findMany({
      where: { applicationCycleId: cycleId },
      select: { domainId: true },
    });
    if (targetDomains.length === 0) {
      return Response.json(
        { error: "Pick at least one target domain before adding reviewers." },
        { status: 409 },
      );
    }
    await prisma.cycleReviewer.createMany({
      data: targetDomains.map((d) => ({
        userId,
        applicationCycleId: cycleId,
        domainId: d.domainId,
      })),
      skipDuplicates: true,
    });
    return { ok: true };
  }

  if (intent === "remove-reviewer-pool") {
    const userId = formData.get("userId") as string;
    await prisma.cycleReviewer.deleteMany({
      where: { userId, applicationCycleId: cycleId },
    });
    return { ok: true };
  }

  if (intent === "set-decision-email") {
    const decisionType = formData.get("decisionType") as string;
    const emailTemplateVersionId = (formData.get("emailTemplateVersionId") as string) || null;
    const validTypes = ["Rejected", "InvitedToInterview", "Accepted", "Waitlisted"] as const;
    if (!validTypes.includes(decisionType as (typeof validTypes)[number])) {
      return Response.json({ error: "Invalid decision type" }, { status: 400 });
    }
    // Lock once a Released decision of this type exists for this cycle.
    const alreadyReleased = await prisma.decision.count({
      where: {
        stage: "Released",
        type: decisionType as (typeof validTypes)[number],
        domainApplication: { application: { applicationCycleId: cycleId } },
      },
    });
    if (alreadyReleased > 0) {
      return { ok: true };
    }
    if (emailTemplateVersionId) {
      await prisma.cycleDecisionEmail.upsert({
        where: {
          applicationCycleId_decisionType: {
            applicationCycleId: cycleId,
            decisionType: decisionType as (typeof validTypes)[number],
          },
        },
        update: { emailTemplateVersionId },
        create: {
          applicationCycleId: cycleId,
          decisionType: decisionType as (typeof validTypes)[number],
          emailTemplateVersionId,
        },
      });
    } else {
      await prisma.cycleDecisionEmail.deleteMany({
        where: {
          applicationCycleId: cycleId,
          decisionType: decisionType as (typeof validTypes)[number],
        },
      });
    }
    return { ok: true };
  }

  return Response.json({ error: "Unknown intent" }, { status: 400 });
}

// ─── UI ──────────────────────────────────────────────────────────────────────

export default function InternToFullCycleSetup() {
  const data = useLoaderData<typeof loader>();
  const {
    cycle,
    allDomains,
    allFormVersions,
    allRubricVersions,
    members,
    pendingDecisions,
    emailTemplates,
    currentDecisionEmails,
    releasedDecisionTypes,
  } = data;
  const isOpen = cycle.status === "Open" || cycle.status === "UnderReview";

  return (
    <div className="max-w-4xl mx-auto py-8 px-6 space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-dark-blue">{cycle.name}</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Fellowship cycle · {cycle.status}
          </p>
        </div>
        <StatusButton cycleId={cycle.id} currentStatus={cycle.status} />
      </header>

      <CloseDateSection
        cycleId={cycle.id}
        closeDate={cycle.closeDate}
        status={cycle.status}
      />

      <FormVersionSection
        cycleId={cycle.id}
        current={cycle.formVersion}
        allVersions={allFormVersions}
        disabled={isOpen}
      />

      <GeneralRubricSection
        cycleId={cycle.id}
        currentRubricVersionId={cycle.generalRubricVersionId}
        currentRubricLabel={cycle.generalRubricLabel}
        allRubricVersions={allRubricVersions}
      />

      <TargetDomainsSection
        cycleId={cycle.id}
        targetDomains={cycle.targetDomains}
        allDomains={allDomains}
        disabled={isOpen}
      />

      <ReviewersSection
        cycleId={cycle.id}
        reviewers={cycle.reviewers}
        targetDomains={cycle.targetDomains}
        members={members}
      />

      <DecisionEmailsSection
        emailTemplates={emailTemplates}
        currentDecisionEmails={currentDecisionEmails}
        releasedDecisionTypes={releasedDecisionTypes}
      />

      <DecisionsSection
        initialDecisions={pendingDecisions}
        currentDecisionEmails={currentDecisionEmails}
      />
    </div>
  );
}

function CloseDateSection({
  cycleId: _cycleId,
  closeDate,
  status,
}: {
  cycleId: string;
  closeDate: string | null;
  status: string;
}) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const initial = closeDate
    ? (() => {
        const { year, month, day } = getZonedYMD(new Date(closeDate), APPLICATION_TZ);
        return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      })()
    : "";
  const [value, setValue] = useState(initial);
  // Editable in Draft (cycle setup) and Open (live extensions/shortenings).
  // Locked once we're in UnderReview/Completed — the application window is
  // closed and changing the date here wouldn't reopen it.
  const disabled = status !== "Draft" && status !== "Open";
  const isOpen = status === "Open";
  const error = fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
  return (
    <Section title="Close date" description="When the application window closes for interns.">
      <div className="flex items-center gap-3">
        <input
          type="date"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={disabled}
          className="px-3 py-2 text-sm border border-border rounded-md disabled:opacity-50"
        />
        <button
          onClick={() =>
            fetcher.submit({ intent: "set-close-date", closeDate: value }, { method: "post" })
          }
          disabled={disabled || fetcher.state !== "idle"}
          className="px-4 py-2 rounded-md bg-accent-coral text-white text-sm font-medium hover:bg-accent-coral/90 disabled:opacity-50"
        >
          Save
        </button>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        {isOpen
          ? `Update to extend or shorten this active cycle. Applications stop at 11:59 PM ${APPLICATION_TZ_LABEL} on the selected date. Interns who already received the open-cycle notification may still see the old date.`
          : `Applications stop at 11:59 PM ${APPLICATION_TZ_LABEL} on this date.`}
      </p>
      {error && (
        <p className="mt-2 text-xs text-red-700">{error}</p>
      )}
    </Section>
  );
}

function FormVersionSection({
  cycleId,
  current,
  allVersions,
  disabled,
}: {
  cycleId: string;
  current: { id: string; version: number; questions: Question[] } | null;
  allVersions: { id: string; version: number; createdBy: string }[];
  disabled: boolean;
}) {
  const fetcher = useFetcher();
  const [creating, setCreating] = useState(false);
  const [previewing, setPreviewing] = useState(false);
  return (
    <Section
      title="Shortform"
      description="DB-backed questions interns will answer. Pin a version (or create a new one) — once the cycle is Open, the version is frozen for in-progress drafts."
    >
      {current ? (
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <p className="text-sm font-medium text-dark-blue">
            {(() => {
              const qCount = current.questions.filter((q) => q.type !== "info").length;
              const iCount = current.questions.length - qCount;
              const parts = [`${qCount} question${qCount === 1 ? "" : "s"}`];
              if (iCount > 0) parts.push(`${iCount} info block${iCount === 1 ? "" : "s"}`);
              return `v${current.version} (${parts.join(", ")})`;
            })()}
          </p>
          <button
            type="button"
            onClick={() => setPreviewing(true)}
            className="text-xs font-medium text-blue-700 hover:underline"
          >
            Preview
          </button>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground mb-3">No shortform pinned yet.</p>
      )}
      {!disabled && (
        <div className="flex flex-wrap items-center gap-2">
          <select
            defaultValue={current?.id ?? ""}
            onChange={(e) => {
              const id = e.target.value;
              if (!id) return;
              fetcher.submit({ intent: "set-form-version", formVersionId: id }, { method: "post" });
            }}
            className="px-3 py-2 text-sm border border-border rounded-md"
          >
            <option value="">— pick existing —</option>
            {allVersions.map((v) => (
              <option key={v.id} value={v.id}>
                v{v.version} · {v.createdBy}
              </option>
            ))}
          </select>
          <button
            onClick={() => setCreating(true)}
            className="px-3 py-2 text-sm font-medium text-blue-700 hover:underline"
          >
            + Create new version
          </button>
        </div>
      )}
      {creating && (
        <CreateFormVersionModal
          onClose={() => setCreating(false)}
          onSubmit={(questions) => {
            fetcher.submit(
              {
                intent: "create-form-version",
                questions: JSON.stringify(questions),
              },
              { method: "post" },
            );
            setCreating(false);
          }}
        />
      )}
      {previewing && current && (
        <ChallengePreviewModal
          challengeVersionId={current.id}
          challengeName="Shortform"
          versionLabel={`v${current.version}`}
          questions={current.questions}
          onClose={() => setPreviewing(false)}
        />
      )}
    </Section>
  );
}

function CreateFormVersionModal({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (qs: Question[]) => void;
}) {
  const [qs, setQs] = useState<Question[]>([
    { key: crypto.randomUUID(), type: "textarea", required: true, data: { label: "" } },
  ]);
  const [previewing, setPreviewing] = useState(false);
  function addQ() {
    setQs((prev) => [...prev, { key: crypto.randomUUID(), type: "textarea", required: false, data: { label: "" } }]);
  }
  function addInfo() {
    setQs((prev) => [
      ...prev,
      { key: crypto.randomUUID(), type: "info", required: false, data: { label: "" } },
    ]);
  }
  function removeQ(idx: number) {
    setQs((prev) => prev.filter((_, i) => i !== idx));
  }
  function move(idx: number, dir: -1 | 1) {
    setQs((prev) => {
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      return next;
    });
  }
  function update(
    idx: number,
    patch: Partial<Omit<Question, "data">> & { data?: Partial<Question["data"]> },
  ) {
    setQs((prev) =>
      prev.map((q, i) =>
        i === idx ? { ...q, ...patch, data: { ...q.data, ...(patch.data ?? {}) } } : q,
      ),
    );
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className="bg-card rounded-lg shadow-xl w-full max-w-2xl p-6 space-y-4 max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-foreground">New shortform version</h2>
          <button onClick={onClose} className="text-muted-foreground/70">✕</button>
        </div>
        <div className="space-y-3">
          {qs.map((q, idx) => {
            const isInfo = q.type === "info";
            return (
              <div key={q.key} className="border border-border rounded-md p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-muted-foreground">
                    {isInfo ? "Info text" : "Question"} {idx + 1}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => move(idx, -1)}
                      disabled={idx === 0}
                      className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
                      title="Move up"
                    >
                      ↑
                    </button>
                    <button
                      onClick={() => move(idx, 1)}
                      disabled={idx === qs.length - 1}
                      className="text-xs text-muted-foreground hover:text-foreground disabled:opacity-30"
                      title="Move down"
                    >
                      ↓
                    </button>
                    <button onClick={() => removeQ(idx)} className="text-xs text-red-600 hover:underline">
                      Remove
                    </button>
                  </div>
                </div>
                {isInfo ? (
                  <RichTextEditor
                    value={q.data.body}
                    onChange={(body) => update(idx, { data: { body } })}
                    placeholder="Free-form text shown to the applicant (e.g. instructions or context)."
                  />
                ) : (
                  <>
                    <input
                      value={q.data.label}
                      onChange={(e) => update(idx, { data: { label: e.target.value } })}
                      placeholder="Question prompt"
                      className="w-full px-2 py-1.5 text-sm border border-border rounded-md"
                    />
                    <input
                      value={q.data.description ?? ""}
                      onChange={(e) => update(idx, { data: { description: e.target.value } })}
                      placeholder="Description (optional, e.g. 'Keep it under 200 words.')"
                      className="w-full px-2 py-1.5 text-xs border border-border rounded-md text-muted-foreground"
                    />
                    <div className="flex items-center gap-4 text-xs">
                      <label className="flex items-center gap-1">
                        <input
                          type="checkbox"
                          checked={q.required}
                          onChange={(e) => update(idx, { required: e.target.checked })}
                        />
                        Required
                      </label>
                      <label className="flex items-center gap-1">
                        Type:
                        <select
                          value={q.type}
                          onChange={(e) => update(idx, { type: e.target.value as Question["type"] })}
                          className="px-2 py-0.5 border border-border rounded"
                        >
                          <option value="textarea">Long answer</option>
                          <option value="text">Short answer</option>
                        </select>
                      </label>
                    </div>
                  </>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex items-center gap-4">
          <button onClick={addQ} className="text-sm text-blue-700 hover:underline">
            + Add question
          </button>
          <button onClick={addInfo} className="text-sm text-blue-700 hover:underline">
            + Add info text
          </button>
        </div>
        <div className="flex justify-end gap-2 pt-3 border-t border-border">
          <button
            onClick={onClose}
            className="px-3 py-2 text-sm font-medium text-foreground/80 bg-card border border-gray-300 rounded-md hover:bg-muted/50"
          >
            Cancel
          </button>
          <button
            onClick={() => setPreviewing(true)}
            className="px-3 py-2 text-sm font-medium text-blue-700 bg-card border border-blue-300 rounded-md hover:bg-blue-50"
          >
            Preview
          </button>
          <button
            onClick={() => {
              const cleaned = qs.filter((q) =>
                q.type === "info" ? hasInfoBody(q.data.body) : q.data.label.trim(),
              );
              if (cleaned.length === 0) return;
              onSubmit(cleaned);
            }}
            className="px-3 py-2 text-sm font-medium text-white bg-accent-coral rounded-md hover:bg-accent-coral/90"
          >
            Create
          </button>
        </div>
      </div>
      {previewing && (
        // Stop propagation so the preview's overlay/close don't bubble up to
        // the create modal's outer onClick={onClose} and dismiss the draft.
        <div onClick={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
          <ChallengePreviewModal
            challengeVersionId="draft"
            challengeName="Shortform"
            versionLabel="Draft"
            questions={qs.filter((q) =>
              q.type === "info" ? hasInfoBody(q.data.body) : q.data.label.trim(),
            )}
            onClose={() => setPreviewing(false)}
          />
        </div>
      )}
    </div>
  );
}

function TargetDomainsSection({
  cycleId,
  targetDomains,
  allDomains,
  disabled,
}: {
  cycleId: string;
  targetDomains: {
    domainId: string;
    code: string;
    displayName: string;
    isReady: boolean;
  }[];
  allDomains: { id: string; code: string; displayName: string }[];
  disabled: boolean;
}) {
  const fetcher = useFetcher();
  const selectedIds = new Set(targetDomains.map((d) => d.domainId));

  function toggle(id: string) {
    const next = selectedIds.has(id)
      ? targetDomains.filter((d) => d.domainId !== id).map((d) => d.domainId)
      : [...targetDomains.map((d) => d.domainId), id];
    fetcher.submit(
      { intent: "set-target-domains", domainIds: JSON.stringify(next) },
      { method: "post" },
    );
  }

  return (
    <Section
      title="Target domains"
      description="Domains interns can apply to convert into. All domains share the cycle's general rubric and a single reviewer pool."
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
        {allDomains.map((d) => {
          const checked = selectedIds.has(d.id);
          return (
            <label
              key={d.id}
              className={`flex items-center gap-2 px-3 py-2 border rounded-md text-sm ${
                checked ? "border-blue-400 bg-blue-50" : "border-border"
              } ${disabled ? "opacity-50" : "cursor-pointer"}`}
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={() => toggle(d.id)}
              />
              {d.displayName}
            </label>
          );
        })}
      </div>
      {fetcher.data && "error" in fetcher.data && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 mb-3">
          {fetcher.data.error as string}
        </div>
      )}
      {targetDomains.length > 0 && (
        <div className="border-t border-border pt-3 space-y-2">
          {targetDomains.map((d) => (
            <DomainConfigRow
              key={d.domainId}
              cycleId={cycleId}
              domain={d}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

function DomainConfigRow({
  cycleId: _cycleId,
  domain,
  disabled,
}: {
  cycleId: string;
  domain: {
    domainId: string;
    displayName: string;
    isReady: boolean;
  };
  disabled: boolean;
}) {
  const fetcher = useFetcher();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2">
      <div className="text-sm font-medium text-dark-blue min-w-32">{domain.displayName}</div>
      <label className="flex items-center gap-1 text-xs">
        <input
          type="checkbox"
          checked={domain.isReady}
          disabled={disabled}
          onChange={(e) =>
            fetcher.submit(
              {
                intent: "toggle-domain-ready",
                domainId: domain.domainId,
                ready: String(e.target.checked),
              },
              { method: "post" },
            )
          }
        />
        Ready
      </label>
    </div>
  );
}

function GeneralRubricSection({
  cycleId: _cycleId,
  currentRubricVersionId,
  currentRubricLabel,
  allRubricVersions,
}: {
  cycleId: string;
  currentRubricVersionId: string | null;
  currentRubricLabel: string | null;
  allRubricVersions: { id: string; label: string }[];
}) {
  const fetcher = useFetcher();
  return (
    <Section
      title="Rubric"
      description="Scoring criteria reviewers use for every application in this cycle. Required before reviewers can be assigned."
    >
      {currentRubricLabel ? (
        <p className="text-sm font-medium text-dark-blue mb-3">{currentRubricLabel}</p>
      ) : (
        <p className="text-sm text-muted-foreground mb-3">No rubric pinned yet.</p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={currentRubricVersionId ?? ""}
          onChange={(e) => {
            fetcher.submit(
              { intent: "set-general-rubric", rubricVersionId: e.target.value },
              { method: "post" },
            );
          }}
          className="px-3 py-2 text-sm border border-border rounded-md"
        >
          <option value="">— pick a rubric version —</option>
          {allRubricVersions.map((rv) => (
            <option key={rv.id} value={rv.id}>
              {rv.label}
            </option>
          ))}
        </select>
        <Link
          to="/hiring/library?tab=rubrics"
          className="text-xs font-medium text-blue-700 hover:underline"
        >
          Manage rubrics →
        </Link>
      </div>
    </Section>
  );
}

function ReviewersSection({
  cycleId,
  reviewers,
  targetDomains,
  members,
}: {
  cycleId: string;
  reviewers: { userId: string; displayName: string }[];
  targetDomains: { domainId: string; code: string; displayName: string }[];
  members: { userId: string; displayName: string }[];
}) {
  const fetcher = useFetcher();
  const assignedIds = new Set(reviewers.map((r) => r.userId));
  const candidates = members.filter((m) => !assignedIds.has(m.userId));
  const meetsMin = reviewers.length >= MIN_POOL_SIZE;
  const error =
    fetcher.data && typeof fetcher.data === "object" && "error" in fetcher.data
      ? (fetcher.data.error as string)
      : null;

  return (
    <Section
      title="Reviewers"
      description={`Single reviewer pool — every reviewer reads every application across all target domains. Add at least ${MIN_POOL_SIZE}.`}
    >
      {targetDomains.length === 0 ? (
        <p className="text-sm text-muted-foreground">Pick target domains first.</p>
      ) : (
        <div className="border border-border rounded-md p-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold text-dark-blue">Reviewer pool</h3>
            <span
              className={`text-xs px-2 py-0.5 rounded-full ${
                meetsMin ? "bg-green-100 text-green-700" : "bg-yellow-100 text-yellow-800"
              }`}
            >
              {reviewers.length} / {MIN_POOL_SIZE}
            </span>
          </div>
          <ul className="space-y-1 mb-2">
            {reviewers.map((r) => (
              <li key={r.userId} className="flex items-center justify-between text-sm">
                <span>{r.displayName}</span>
                <button
                  onClick={() =>
                    fetcher.submit(
                      { intent: "remove-reviewer-pool", userId: r.userId },
                      { method: "post" },
                    )
                  }
                  className="text-xs text-red-600 hover:underline"
                >
                  Remove
                </button>
              </li>
            ))}
            {reviewers.length === 0 && (
              <li className="text-xs text-muted-foreground italic">No reviewers in the pool yet.</li>
            )}
          </ul>
          <select
            defaultValue=""
            onChange={(e) => {
              const userId = e.target.value;
              if (!userId) return;
              fetcher.submit(
                { intent: "add-reviewer-pool", userId },
                { method: "post" },
              );
              e.currentTarget.value = "";
            }}
            className="text-sm px-2 py-1.5 border border-border rounded"
          >
            <option value="">+ Add reviewer…</option>
            {candidates.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.displayName}
              </option>
            ))}
          </select>
          {error && (
            <p className="mt-2 text-xs text-red-600">{error}</p>
          )}
        </div>
      )}
    </Section>
  );
}

// ─── Decision Emails (template bindings) ────────────────────────────────────

const DECISION_EMAIL_SLOTS: ReadonlyArray<{
  type: DecisionSlotType;
  label: string;
  description: string;
}> = [
  { type: "Rejected", label: "Rejected", description: "Sent when a Rejected decision is released to the applicant." },
  { type: "Waitlisted", label: "Waitlisted", description: "Sent when an applicant is placed on the waitlist." },
  { type: "Accepted", label: "Accepted", description: "Sent when an applicant is offered a spot." },
];

function DecisionEmailsSection({
  emailTemplates,
  currentDecisionEmails,
  releasedDecisionTypes,
}: {
  emailTemplates: any[];
  currentDecisionEmails: any[];
  releasedDecisionTypes: string[];
}) {
  return (
    <Section
      title="Decision emails"
      description="Pick which template fires when each decision type is released. Slots without a binding will not send an email. Once a decision of a given type has been released, its slot locks for this cycle."
    >
      <div className="space-y-3">
        {DECISION_EMAIL_SLOTS.map((slot) => {
          const binding = currentDecisionEmails.find((b: any) => b.decisionType === slot.type);
          const locked = releasedDecisionTypes.includes(slot.type);
          return (
            <DecisionEmailPicker
              key={slot.type}
              slot={slot}
              binding={binding ?? null}
              emailTemplates={emailTemplates}
              locked={locked}
            />
          );
        })}
      </div>
    </Section>
  );
}

function SlotVariableHint({ slot }: { slot: TemplateSlot }) {
  const vars = TEMPLATE_VARIABLES[slot];
  return (
    <p className="text-xs text-muted-foreground/80">
      Supports{" "}
      {vars.map((v, i) => (
        <span key={v}>
          {i > 0 && ", "}
          <code className="font-mono bg-muted px-1 rounded">{`{{${v}}}`}</code>
        </span>
      ))}
      .
    </p>
  );
}

function DecisionEmailPicker({
  slot,
  binding,
  emailTemplates,
  locked,
}: {
  slot: { type: DecisionSlotType; label: string; description: string };
  binding: any | null;
  emailTemplates: any[];
  locked: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const currentVersionId: string | null = binding?.emailTemplateVersionId ?? null;
  const currentLabel = binding
    ? `${binding.emailTemplateVersion.template.name} — v${binding.emailTemplateVersion.versionNumber}`
    : null;

  return (
    <div className="border border-border rounded-lg p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="text-sm font-bold text-foreground">{slot.label}</h4>
          <p className="text-xs text-muted-foreground">{slot.description}</p>
          <SlotVariableHint slot={decisionSlot(slot.type)} />
        </div>
        {!editing && !locked && (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-blue-600 hover:text-blue-800 font-medium shrink-0"
          >
            {currentLabel ? "Change" : "Assign"}
          </button>
        )}
      </div>

      {locked ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle className="w-4 h-4 text-green-600" />
          <span>{currentLabel ?? "No template assigned"}</span>
          <span className="text-xs text-muted-foreground/70 ml-2">
            (locked — decisions of this type already released)
          </span>
        </div>
      ) : !editing ? (
        currentLabel ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle className="w-4 h-4 text-green-600" />
            <span>{currentLabel}</span>
          </div>
        ) : (
          <div className="text-sm text-orange-700 bg-orange-50 border border-orange-200 rounded px-2 py-1">
            No template assigned — releasing a {slot.label} decision will not send an email.
          </div>
        )
      ) : (
        <Form
          method="post"
          preventScrollReset
          className="flex items-end gap-2 flex-wrap"
          onSubmit={() => setEditing(false)}
        >
          <input type="hidden" name="intent" value="set-decision-email" />
          <input type="hidden" name="decisionType" value={slot.type} />
          <div className="flex-1 min-w-[14rem]">
            <select
              name="emailTemplateVersionId"
              defaultValue={currentVersionId ?? ""}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">No template (skip email)</option>
              {emailTemplates
                .filter((t: any) => t.versions.length > 0)
                .flatMap((t: any) =>
                  t.versions.map((v: any) => (
                    <option key={v.id} value={v.id}>
                      {t.name} — v{v.versionNumber}
                    </option>
                  )),
                )}
            </select>
          </div>
          <button
            type="submit"
            className="px-3 py-2 text-sm font-medium rounded-lg bg-accent-coral hover:bg-accent-coral/90 text-white transition"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="px-3 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
        </Form>
      )}
    </div>
  );
}

// ─── Decisions ready for finalize / release ─────────────────────────────────

function DecisionsSection({
  initialDecisions,
  currentDecisionEmails,
}: {
  initialDecisions: any[];
  currentDecisionEmails: any[];
}) {
  const [decisions, setDecisions] = useState<any[]>(initialDecisions);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [previewDecisionId, setPreviewDecisionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const boundTypes = new Set(currentDecisionEmails.map((b: any) => b.decisionType));
  const drafts = decisions.filter((d) => d.stage === "Draft");
  const finals = decisions.filter((d) => d.stage === "Final");
  const releasableFinals = finals.filter((d) => boundTypes.has(d.type));
  const skipped = finals.length - releasableFinals.length;

  async function finalizeOne(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/hiring/decisions/${id}/finalize`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Finalize failed (HTTP ${res.status}).`);
        return;
      }
      const newFinal = await res.json();
      // Replace the Draft row with the new Final row so the UI flips its action.
      setDecisions((prev) => {
        const dropped = prev.filter((d) => d.id !== id);
        const oldDraft = prev.find((d) => d.id === id);
        if (!oldDraft) return dropped;
        return [
          {
            ...oldDraft,
            id: newFinal.id,
            stage: "Final",
          },
          ...dropped,
        ];
      });
    } finally {
      setBusyId(null);
    }
  }

  async function releaseOne(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/hiring/decisions/${id}/release`, {
        method: "POST",
        credentials: "include",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? `Release failed (HTTP ${res.status}).`);
        return;
      }
      setDecisions((prev) => prev.filter((d) => d.id !== id));
    } finally {
      setBusyId(null);
    }
  }

  async function finalizeAllDrafts() {
    if (drafts.length === 0) return;
    setBulkBusy(true);
    setError(null);
    try {
      for (const d of drafts) {
        const res = await fetch(`/api/hiring/decisions/${d.id}/finalize`, {
          method: "POST",
          credentials: "include",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error ?? `Finalize failed for one or more decisions (HTTP ${res.status}).`);
          break;
        }
        const newFinal = await res.json();
        setDecisions((prev) => {
          const dropped = prev.filter((x) => x.id !== d.id);
          return [{ ...d, id: newFinal.id, stage: "Final" }, ...dropped];
        });
      }
    } finally {
      setBulkBusy(false);
    }
  }

  async function releaseAllFinals() {
    if (releasableFinals.length === 0) return;
    setBulkBusy(true);
    setError(null);
    try {
      for (const d of releasableFinals) {
        const res = await fetch(`/api/hiring/decisions/${d.id}/release`, {
          method: "POST",
          credentials: "include",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setError(body.error ?? `Release failed for one or more decisions (HTTP ${res.status}).`);
          break;
        }
        setDecisions((prev) => prev.filter((x) => x.id !== d.id));
      }
    } finally {
      setBulkBusy(false);
    }
  }

  const previewing = previewDecisionId
    ? decisions.find((d) => d.id === previewDecisionId)
    : null;
  const previewBinding = previewing
    ? currentDecisionEmails.find((b: any) => b.decisionType === previewing.type)
    : null;

  return (
    <Section
      title="Decisions"
      description="Finalize Draft decisions, then release Final decisions to send the applicant their result email. Release is irreversible."
    >
      <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-900 inline-flex items-center gap-2 mb-4">
        <Mail className="w-3.5 h-3.5 flex-shrink-0" aria-hidden />
        <span>
          <span className="font-semibold">Release</span> emails the applicant using the bound template and cannot be undone.
        </span>
      </div>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800 mb-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <div className="flex-1">{error}</div>
          <button
            type="button"
            onClick={() => setError(null)}
            className="text-red-700 hover:text-red-900 text-xs font-medium"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <button
          type="button"
          onClick={finalizeAllDrafts}
          disabled={bulkBusy || drafts.length === 0}
          className="px-3 py-1.5 text-sm font-medium rounded-lg bg-accent-coral hover:bg-accent-coral/90 text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Finalize all drafts ({drafts.length})
        </button>
        <button
          type="button"
          onClick={releaseAllFinals}
          disabled={bulkBusy || releasableFinals.length === 0}
          title={
            skipped > 0
              ? `${skipped} decision${skipped === 1 ? "" : "s"} skipped — no email template bound on Decision emails above`
              : undefined
          }
          className="px-3 py-1.5 text-sm font-medium rounded-lg bg-green-600 hover:bg-green-700 text-white transition disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
        >
          <Mail className="w-3.5 h-3.5" aria-hidden />
          Release all finals ({releasableFinals.length})
          {skipped > 0 && ` — ${skipped} skipped`}
        </button>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 border-b border-border">
            <tr>
              <th className="text-left px-3 py-2 font-semibold text-foreground/80">Applicant</th>
              <th className="text-left px-3 py-2 font-semibold text-foreground/80">Domain</th>
              <th className="text-left px-3 py-2 font-semibold text-foreground/80">Decision</th>
              <th className="text-left px-3 py-2 font-semibold text-foreground/80">Stage</th>
              <th className="text-right px-3 py-2 font-semibold text-foreground/80">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {decisions.map((d) => {
              const hasBinding = boundTypes.has(d.type);
              const applicantName = `${d.domainApplication.application.user.firstName ?? ""} ${d.domainApplication.application.user.lastName ?? ""}`.trim();
              const domainLabel = d.domainApplication.domain?.displayName ?? d.domainApplication.domain?.name ?? "—";
              return (
                <tr key={d.id} className="hover:bg-muted/30 transition">
                  <td className="px-3 py-2 font-medium text-foreground">{applicantName}</td>
                  <td className="px-3 py-2 text-muted-foreground">{domainLabel}</td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold ${
                        d.type === "Accepted"
                          ? "bg-green-100 text-green-700"
                          : d.type === "Rejected"
                            ? "bg-red-100 text-red-700"
                            : d.type === "Waitlisted"
                              ? "bg-yellow-100 text-yellow-700"
                              : "bg-blue-100 text-blue-700"
                      }`}
                    >
                      {d.type}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                        d.stage === "Draft" ? "bg-gray-100 text-gray-700" : "bg-purple-100 text-purple-700"
                      }`}
                    >
                      {d.stage}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <div className="inline-flex flex-wrap items-center justify-end gap-2">
                      {d.stage === "Final" && (
                        <button
                          type="button"
                          onClick={() => setPreviewDecisionId(d.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-lg border border-border bg-card hover:bg-muted/40 text-foreground transition"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          Preview
                        </button>
                      )}
                      {d.stage === "Draft" ? (
                        <button
                          type="button"
                          onClick={() => finalizeOne(d.id)}
                          disabled={busyId === d.id || bulkBusy}
                          className="px-2.5 py-1 text-xs font-medium rounded-lg bg-accent-coral hover:bg-accent-coral/90 text-white transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {busyId === d.id ? "Finalizing…" : "Finalize"}
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => releaseOne(d.id)}
                          disabled={busyId === d.id || bulkBusy || !hasBinding}
                          title={
                            !hasBinding
                              ? `No email template bound to ${d.type} in this cycle. Bind one in Decision emails above.`
                              : undefined
                          }
                          className="px-2.5 py-1 text-xs font-medium rounded-lg bg-green-600 hover:bg-green-700 text-white transition disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-1"
                        >
                          <Mail className="w-3.5 h-3.5" aria-hidden />
                          {busyId === d.id ? "Releasing…" : "Release"}
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
            {decisions.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground/70">
                  No decisions awaiting action. Run deliberations to create Draft decisions.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {previewing && (
        <DecisionEmailPreviewModal
          decision={previewing}
          binding={previewBinding ?? null}
          onClose={() => setPreviewDecisionId(null)}
        />
      )}
    </Section>
  );
}

function PreviewLintWarning({ unknown, unfilled }: { unknown: string[]; unfilled: string[] }) {
  return (
    <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 space-y-1">
      <div className="flex items-center gap-1.5 font-semibold">
        <AlertTriangle className="w-3.5 h-3.5" />
        Template warnings
      </div>
      {unknown.length > 0 && (
        <p>
          Unknown placeholder{unknown.length > 1 ? "s" : ""}:{" "}
          {unknown.map((t, i) => (
            <span key={t}>
              {i > 0 && ", "}
              <code className="font-mono bg-amber-100 px-1 rounded">{`{{${t}}}`}</code>
            </span>
          ))}
          . Will ship as literal text.
        </p>
      )}
      {unfilled.length > 0 && (
        <p>
          Not populated for this slot:{" "}
          {unfilled.map((t, i) => (
            <span key={t}>
              {i > 0 && ", "}
              <code className="font-mono bg-amber-100 px-1 rounded">{`{{${t}}}`}</code>
            </span>
          ))}
          . Will render as empty.
        </p>
      )}
    </div>
  );
}

function DecisionEmailPreviewModal({
  decision,
  binding,
  onClose,
}: {
  decision: any;
  binding: any | null;
  onClose: () => void;
}) {
  const firstName = decision.domainApplication.application.user.firstName ?? "";
  const domain =
    decision.domainApplication.domain?.displayName ??
    decision.domainApplication.domain?.name ??
    "";
  const tmpl = binding?.emailTemplateVersion ?? null;
  const rendered = tmpl ? renderEmail(tmpl, { firstName, domain }) : null;
  const slot: TemplateSlot | undefined = decision.type
    ? decisionSlot(decision.type as DecisionSlotType)
    : undefined;
  const lint = tmpl
    ? (() => {
        const subj = lintTemplate(tmpl.subject, slot);
        const body = lintTemplate(tmpl.body, slot);
        return {
          unknown: Array.from(new Set([...subj.unknown, ...body.unknown])),
          unfilled: Array.from(new Set([...subj.unfilled, ...body.unfilled])),
        };
      })()
    : null;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-lg shadow-xl w-full max-w-2xl max-h-[80vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 px-4 sm:px-6 py-3 sm:py-4 border-b border-border">
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-foreground">Email preview</h2>
            <p className="text-xs text-muted-foreground break-words">
              {decision.domainApplication.application.user.firstName}{" "}
              {decision.domainApplication.application.user.lastName}
              {" · "}
              {domain}
              {" · "}
              <span className="font-medium">{decision.type}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground/70 hover:text-foreground flex-shrink-0"
            aria-label="Close preview"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="px-4 sm:px-6 py-4 space-y-4">
          {tmpl ? (
            <>
              {lint && (lint.unknown.length > 0 || lint.unfilled.length > 0) && (
                <PreviewLintWarning unknown={lint.unknown} unfilled={lint.unfilled} />
              )}
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">From</h3>
                <p className="mt-1 text-sm text-foreground">applications@dali.dartmouth.edu</p>
              </div>
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">To</h3>
                <p className="mt-1 text-sm text-foreground">
                  {decision.domainApplication.application.user.dartmouthEmail ??
                    (decision.domainApplication.application.user.netId
                      ? `${decision.domainApplication.application.user.netId}@dartmouth.edu`
                      : "(no address on file)")}
                </p>
              </div>
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Subject</h3>
                <p className="mt-1 text-sm text-foreground">{rendered?.subject ?? ""}</p>
              </div>
              <div>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Body</h3>
                <div
                  className="mt-1 prose prose-sm max-w-none text-foreground"
                  dangerouslySetInnerHTML={{ __html: rendered?.html ?? "" }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Template: <span className="font-medium">{binding?.emailTemplateVersion?.template?.name}</span>
                {" "}— v{binding?.emailTemplateVersion?.versionNumber}
              </p>
            </>
          ) : (
            <div className="rounded-lg bg-orange-50 border border-orange-200 p-4 text-sm text-orange-800">
              <p className="font-medium">No template assigned for {decision.type} in this cycle.</p>
              <p className="mt-1">
                Releasing this decision will not send an email. Bind a template in the Decision emails section above.
              </p>
            </div>
          )}
        </div>
        <div className="px-4 sm:px-6 py-3 border-t border-border bg-muted/30 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-3 py-2 text-sm font-medium text-foreground/80 bg-card border border-gray-300 rounded-md hover:bg-muted/50"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

function StatusButton({ cycleId, currentStatus }: { cycleId: string; currentStatus: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function transition(to: "Open" | "UnderReview" | "Completed") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/hiring/cycles/${cycleId}/status`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newStatus: to }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Failed.");
      } else {
        window.location.reload();
      }
    } finally {
      setBusy(false);
    }
  }

  const next = currentStatus === "Draft" ? "Open" : currentStatus === "Open" ? "UnderReview" : currentStatus === "UnderReview" ? "Completed" : null;

  return (
    <div className="flex flex-col items-end gap-1">
      {next && (
        <button
          onClick={() => transition(next as any)}
          disabled={busy}
          className="px-4 py-2 rounded-md bg-accent-coral text-white text-sm font-medium hover:bg-accent-coral/90 disabled:opacity-50"
        >
          {busy ? "Working…" : `Move to ${next}`}
        </button>
      )}
      {error && <span className="text-xs text-red-600 max-w-xs">{error}</span>}
    </div>
  );
}
