import { useState } from "react";
import { redirect, useLoaderData, useFetcher, Link } from "react-router";
import type { Route } from "./+types/lead.intern-to-full-cycle.$id";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import type { Question } from "~/types";
import type { Prisma } from "~/generated/prisma/client";
import { CycleSetupSection as Section } from "~/hiring/components/CycleSetupSection";
import { ChallengePreviewModal } from "~/hiring/components/ChallengePreviewModal";
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

  const [allDomains, allFormVersions, allRubricVersions, members] = await Promise.all([
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
  ]);

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
      targetDomains: cycle.domains.map((d) => ({
        domainId: d.domainId,
        code: d.domain.code,
        displayName: d.domain.displayName,
        rubricVersionId: d.rubricVersionId,
        rubricLabel: d.rubricVersion
          ? `${d.rubricVersion.rubric.name} v${d.rubricVersion.versionNumber}`
          : null,
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
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub))) return new Response("Forbidden", { status: 403 });

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

  if (intent === "set-domain-rubric") {
    const domainId = formData.get("domainId") as string;
    const rubricVersionId = (formData.get("rubricVersionId") as string) || null;
    await prisma.domainApplicationCycle.update({
      where: {
        domainId_applicationCycleId: { domainId, applicationCycleId: cycleId },
      },
      data: { rubricVersionId },
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

  return Response.json({ error: "Unknown intent" }, { status: 400 });
}

// ─── UI ──────────────────────────────────────────────────────────────────────

export default function InternToFullCycleSetup() {
  const data = useLoaderData<typeof loader>();
  const { cycle, allDomains, allFormVersions, allRubricVersions, members } = data;
  const isOpen = cycle.status === "Open" || cycle.status === "UnderReview";

  return (
    <div className="max-w-4xl mx-auto py-8 px-6 space-y-8">
      <header className="flex items-center justify-between">
        <div>
          <Link to="/hiring/lead" className="text-xs text-muted-foreground hover:underline">
            ← All cycles
          </Link>
          <h1 className="font-heading text-2xl font-bold text-dark-blue mt-1">{cycle.name}</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Fellowship cycle · {cycle.status}
          </p>
        </div>
        <StatusButton cycleId={cycle.id} currentStatus={cycle.status} />
      </header>

      <CloseDateSection cycleId={cycle.id} closeDate={cycle.closeDate} disabled={isOpen} />

      <FormVersionSection
        cycleId={cycle.id}
        current={cycle.formVersion}
        allVersions={allFormVersions}
        disabled={isOpen}
      />

      <TargetDomainsSection
        cycleId={cycle.id}
        targetDomains={cycle.targetDomains}
        allDomains={allDomains}
        allRubricVersions={allRubricVersions}
        disabled={isOpen}
      />

      <ReviewersSection
        cycleId={cycle.id}
        reviewers={cycle.reviewers}
        targetDomains={cycle.targetDomains}
        members={members}
      />
    </div>
  );
}

function CloseDateSection({
  cycleId,
  closeDate,
  disabled,
}: {
  cycleId: string;
  closeDate: string | null;
  disabled: boolean;
}) {
  const fetcher = useFetcher();
  const initial = closeDate
    ? (() => {
        const { year, month, day } = getZonedYMD(new Date(closeDate), APPLICATION_TZ);
        return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      })()
    : "";
  const [value, setValue] = useState(initial);
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
        Applications stop at 11:59 PM {APPLICATION_TZ_LABEL} on this date.
      </p>
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
      { key: crypto.randomUUID(), type: "info", required: false, data: { label: "", body: "" } },
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
                  <textarea
                    value={q.data.body ?? ""}
                    onChange={(e) => update(idx, { data: { body: e.target.value } })}
                    placeholder="Free-form text shown to the applicant (e.g. instructions or context)."
                    rows={4}
                    className="w-full px-2 py-1.5 text-sm border border-border rounded-md"
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
                q.type === "info" ? (q.data.body ?? "").trim() : q.data.label.trim(),
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
              q.type === "info" ? (q.data.body ?? "").trim() : q.data.label.trim(),
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
  allRubricVersions,
  disabled,
}: {
  cycleId: string;
  targetDomains: {
    domainId: string;
    code: string;
    displayName: string;
    rubricVersionId: string | null;
    rubricLabel: string | null;
    isReady: boolean;
  }[];
  allDomains: { id: string; code: string; displayName: string }[];
  allRubricVersions: { id: string; label: string }[];
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
      description="Domains interns can apply to convert into. Each gets its own rubric and reviewer pool."
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
              allRubricVersions={allRubricVersions}
              disabled={disabled}
            />
          ))}
        </div>
      )}
    </Section>
  );
}

function DomainConfigRow({
  cycleId,
  domain,
  allRubricVersions,
  disabled,
}: {
  cycleId: string;
  domain: {
    domainId: string;
    displayName: string;
    rubricVersionId: string | null;
    rubricLabel: string | null;
    isReady: boolean;
  };
  allRubricVersions: { id: string; label: string }[];
  disabled: boolean;
}) {
  const fetcher = useFetcher();
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-2">
      <div className="text-sm font-medium text-dark-blue min-w-32">{domain.displayName}</div>
      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Rubric:</span>
        <select
          value={domain.rubricVersionId ?? ""}
          onChange={(e) =>
            fetcher.submit(
              {
                intent: "set-domain-rubric",
                domainId: domain.domainId,
                rubricVersionId: e.target.value,
              },
              { method: "post" },
            )
          }
          disabled={disabled}
          className="px-2 py-1 border border-border rounded text-xs"
        >
          <option value="">— none —</option>
          {allRubricVersions.map((rv) => (
            <option key={rv.id} value={rv.id}>
              {rv.label}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1 ml-3">
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
    </div>
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
