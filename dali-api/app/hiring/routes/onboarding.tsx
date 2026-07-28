import {
  redirect,
  useFetcher,
  useLoaderData,
  useNavigate,
  useSearchParams,
} from "react-router";
import { useEffect, useRef, useState } from "react";
import { Bell, Check } from "lucide-react";
import type { Route } from "./+types/onboarding";
import { requireAuth, unauthorized, forbidden } from "~/lib/auth";
import { isCore, getUserRoles } from "~/lib/roles";
import { hiringPills } from "~/hiring/components/hiringPills";
import { AreaPillNav } from "~/components/AreaPillNav";
import { IconButton } from "~/components/ui/IconButton";
import { useDialog } from "~/components/ui/dialog";
import { Avatar } from "~/components/ui/Avatar";
import { prisma } from "~/lib/db";
import { resolvePhotoUrl } from "~/lib/photo";
import {
  sendOnboardingReminders,
  isOnboardingRemindVia,
  type OnboardingReminderStep,
  type OnboardingRemindVia,
} from "~/members/lib/welcome.server";

export const handle = { areaPills: true };

export const meta: Route.MetaFunction = () => [
  { title: "Onboarding · Hiring · DALI OS" },
];

const REMIND_STEPS = ["email", "slack", "figma", "profile"] as const;
type RemindStep = (typeof REMIND_STEPS)[number];

function isRemindStep(v: string): v is RemindStep {
  return (REMIND_STEPS as readonly string[]).includes(v);
}

type OnboardingRow = {
  userId: string;
  name: string;
  photoUrl: string | null;
  domainKey: string;
  role: string;
  cycleId: string;
  cycleName: string;
  daliEmail: string | null;
  emailCreated: boolean;
  inSlack: boolean;
  figmaInvited: boolean;
  profileSubmitted: boolean;
};

function incompleteForStep(row: OnboardingRow, step: RemindStep): boolean {
  switch (step) {
    case "email":
      return !row.emailCreated;
    case "slack":
      return !row.inSlack;
    case "figma":
      return !row.figmaInvited;
    case "profile":
      return !row.profileSubmitted;
  }
}

/** Shared roster query for the board loader and remind action. */
async function loadOnboardingRows(args: {
  cycleId: string | "all" | null;
  domainKey: string | null;
}): Promise<{
  cycles: { id: string; name: string; cycleType: string }[];
  selectedCycleId: string | "all" | null;
  domains: { key: string; label: string }[];
  selectedDomain: string | null;
  rows: OnboardingRow[];
  allCycles: boolean;
}> {
  const cycles = await prisma.applicationCycle.findMany({
    select: { id: true, name: true, cycleType: true },
    orderBy: { createdAt: "desc" },
  });

  const allCycles = args.cycleId === "all";
  const selectedCycleId: string | "all" | null = allCycles
    ? "all"
    : args.cycleId && cycles.some((c) => c.id === args.cycleId)
      ? args.cycleId
      : (cycles[0]?.id ?? null);

  if (!selectedCycleId) {
    return {
      cycles,
      selectedCycleId: null,
      domains: [],
      selectedDomain: null,
      rows: [],
      allCycles: false,
    };
  }

  const decisions = await prisma.decision.findMany({
    where: {
      stage: "Released",
      type: "Accepted",
      domainApplication: {
        application: allCycles
          ? {}
          : { applicationCycleId: selectedCycleId as string },
      },
    },
    select: {
      id: true,
      createdAt: true,
      domainApplication: {
        select: {
          domain: { select: { displayName: true, name: true, code: true } },
          application: {
            select: {
              applicationCycleId: true,
              applicationCycle: { select: { id: true, name: true } },
              user: {
                select: {
                  id: true,
                  firstName: true,
                  lastName: true,
                  photoUrl: true,
                  daliEmail: true,
                  slackUserId: true,
                  figmaInvitedAt: true,
                  daliMember: { select: { onboardedAt: true } },
                  adminMembership: { select: { isStaff: true } },
                },
              },
            },
          },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Collapse re-releases: latest per (user, domain, cycle).
  const seen = new Set<string>();
  const rawRows: Array<Omit<OnboardingRow, "photoUrl"> & { rawPhotoUrl: string | null }> = [];
  for (const d of decisions) {
    const u = d.domainApplication.application.user;
    // Full-time staff aren't new-hire onboarding cases — skip them so a
    // staffer who once applied doesn't surface a stale onboarding checklist.
    if (u.adminMembership?.isStaff === true) continue;
    const dom = d.domainApplication.domain;
    const cycle = d.domainApplication.application.applicationCycle;
    const domainKey = dom.code ?? dom.name;
    const key = `${u.id}:${domainKey}:${cycle.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rawRows.push({
      userId: u.id,
      name: [u.firstName, u.lastName].filter(Boolean).join(" ") || u.daliEmail || u.id,
      rawPhotoUrl: u.photoUrl,
      domainKey,
      role: dom.displayName ?? dom.name,
      cycleId: cycle.id,
      cycleName: cycle.name,
      daliEmail: u.daliEmail,
      emailCreated: !!u.daliEmail,
      inSlack: !!u.slackUserId,
      figmaInvited: u.figmaInvitedAt != null,
      profileSubmitted: u.daliMember?.onboardedAt != null,
    });
  }

  // Resolve S3/presigned photo URLs once per user (a person can appear on
  // multiple domain/cycle rows).
  const photoByUser = new Map<string, string | null>();
  await Promise.all(
    [...new Set(rawRows.map((r) => r.userId))].map(async (userId) => {
      const raw = rawRows.find((r) => r.userId === userId)?.rawPhotoUrl ?? null;
      photoByUser.set(userId, await resolvePhotoUrl(raw));
    }),
  );

  const allRows: OnboardingRow[] = rawRows.map(({ rawPhotoUrl: _, ...r }) => ({
    ...r,
    photoUrl: photoByUser.get(r.userId) ?? null,
  }));

  const domains = Array.from(
    new Map(allRows.map((r) => [r.domainKey, r.role])).entries(),
  )
    .map(([key, label]) => ({ key, label }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const selectedDomain =
    args.domainKey && domains.some((d) => d.key === args.domainKey)
      ? args.domainKey
      : null;

  const rows = selectedDomain
    ? allRows.filter((r) => r.domainKey === selectedDomain)
    : allRows;

  return {
    cycles,
    selectedCycleId,
    domains,
    selectedDomain,
    rows,
    allCycles,
  };
}

// Core-only: this surfaces accepted-applicant PII (DALI emails) and per-member
// provisioning state, the same sensitivity tier as the hiring lead dashboard.
export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  const roles = await getUserRoles(auth.user.sub);
  if (!roles.isCore) return redirect("/");

  const pillRoles = {
    isCore: roles.isCore,
    isDomainLead: roles.isDomainLead,
    isAdmin: roles.isAdmin,
    isInterviewer: roles.isInterviewer,
  };

  const url = new URL(request.url);
  const requested = url.searchParams.get("cycle");
  const data = await loadOnboardingRows({
    cycleId: requested === "all" ? "all" : requested,
    domainKey: url.searchParams.get("domain"),
  });

  return { ...data, pillRoles };
}

// Toggle Figma invite, or blast a reminder to members incomplete on a step.
export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return unauthorized(request);
  if (!(await isCore(auth.user.sub))) {
    return forbidden(request);
  }

  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "toggleFigma") {
    const userId = String(form.get("userId") ?? "");
    const invited = form.get("invited") === "true";
    if (!userId) return Response.json({ error: "Missing userId" }, { status: 400 });

    await prisma.user.update({
      where: { id: userId },
      data: { figmaInvitedAt: invited ? new Date() : null },
    });
    return Response.json({ ok: true, figmaInvited: invited });
  }

  if (intent === "remind") {
    const stepRaw = String(form.get("step") ?? "");
    if (!isRemindStep(stepRaw)) {
      return Response.json({ error: "Invalid step" }, { status: 400 });
    }
    const viaRaw = String(form.get("via") ?? "");
    if (!isOnboardingRemindVia(viaRaw)) {
      return Response.json({ error: "Invalid via" }, { status: 400 });
    }
    const cycleParam = String(form.get("cycle") ?? "");
    const domainParam = String(form.get("domain") ?? "") || null;
    const { rows } = await loadOnboardingRows({
      cycleId: cycleParam === "all" ? "all" : cycleParam || null,
      domainKey: domainParam,
    });
    const userIds = [
      ...new Set(
        rows.filter((r) => incompleteForStep(r, stepRaw)).map((r) => r.userId),
      ),
    ];
    try {
      const { count, skipped } = await sendOnboardingReminders({
        actorId: auth.user.sub,
        step: stepRaw as OnboardingReminderStep,
        userIds,
        via: viaRaw,
      });
      return Response.json({ ok: true, count, skipped, step: stepRaw, via: viaRaw });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send reminders";
      return Response.json({ error: message }, { status: 500 });
    }
  }

  return Response.json({ error: "Unknown intent" }, { status: 400 });
}

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${
        ok ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"
      }`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${ok ? "bg-green-500" : "bg-muted-foreground/40"}`} />
      {label}
    </span>
  );
}

function FigmaCheckbox({ userId, invited }: { userId: string; invited: boolean }) {
  const fetcher = useFetcher<{ figmaInvited?: boolean }>();
  const pending = fetcher.formData?.get("invited");
  const checked = pending != null ? pending === "true" : invited;

  return (
    <label
      className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground"
      onClick={(e) => e.stopPropagation()}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={fetcher.state !== "idle"}
        onChange={() =>
          fetcher.submit(
            { intent: "toggleFigma", userId, invited: String(!checked) },
            { method: "post" },
          )
        }
        className="h-4 w-4 rounded border-border accent-green-600"
      />
      {checked ? "Invited" : "Not invited"}
    </label>
  );
}

const STEP_LABELS: Record<RemindStep, string> = {
  email: "DALI email",
  slack: "Slack",
  figma: "Figma",
  profile: "profile form",
};

const STEP_HEADERS: Record<RemindStep, string> = {
  email: "DALI email",
  slack: "Slack",
  figma: "Figma",
  profile: "Profile form",
};

const REMIND_VIA_OPTIONS: {
  via: OnboardingRemindVia;
  label: string;
  detail: string;
  /** Hide when the incomplete cohort can't receive this channel. */
  hideForStep?: RemindStep;
}[] = [
  {
    via: "inApp",
    label: "DALI OS",
    detail: "In-app notification only",
  },
  {
    via: "slack",
    label: "Slack DM",
    detail: "Direct message on Slack",
    // Incomplete on Slack ⇒ no slackUserId yet.
    hideForStep: "slack",
  },
  {
    via: "emailDali",
    label: "Email · DALI",
    detail: "Send to @dali.dartmouth.edu",
  },
  {
    via: "emailDartmouth",
    label: "Email · Dartmouth",
    detail: "Send to Dartmouth email",
  },
];

function RemindHeader({
  step,
  incompleteCount,
  cycle,
  domain,
}: {
  step: RemindStep;
  incompleteCount: number;
  cycle: string | "all";
  domain: string | null;
}) {
  const fetcher = useFetcher<{
    ok?: boolean;
    count?: number;
    skipped?: number;
    error?: string;
  }>();
  const dialog = useDialog();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const busy = fetcher.state !== "idle" && fetcher.formData?.get("step") === step;
  // This fetcher is scoped to this step's RemindHeader, so idle + ok already
  // means this step's send just succeeded. (formData is cleared once idle, so
  // it can't be read here.)
  const justSent = fetcher.state === "idle" && !!fetcher.data?.ok;

  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(e: PointerEvent) {
      if (menuRef.current?.contains(e.target as Node)) return;
      setMenuOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const tooltip = busy
    ? "Sending…"
    : justSent
      ? `Sent to ${fetcher.data?.count ?? 0}${
          fetcher.data?.skipped
            ? ` (${fetcher.data.skipped} skipped — no address)`
            : ""
        }`
      : incompleteCount === 0
        ? `All members have ${STEP_LABELS[step]}`
        : `Remind ${incompleteCount} incomplete on ${STEP_LABELS[step]}`;

  async function sendVia(via: OnboardingRemindVia) {
    setMenuOpen(false);
    if (incompleteCount === 0) return;
    const label = STEP_LABELS[step];
    const channel =
      via === "inApp"
        ? "DALI OS"
        : via === "slack"
          ? "Slack DM"
          : via === "emailDali"
            ? "email (DALI)"
            : "email (Dartmouth)";
    if (
      !(await dialog.confirm({
        title: `Send a ${channel} reminder to ${incompleteCount} member${
          incompleteCount === 1 ? "" : "s"
        } still missing ${label}?`,
        confirmLabel: "Send",
      }))
    ) {
      return;
    }
    fetcher.submit(
      {
        intent: "remind",
        step,
        via,
        cycle,
        domain: domain ?? "",
      },
      { method: "post" },
    );
  }

  return (
    <th className="px-5 py-3 font-heading font-semibold text-dark-blue align-bottom">
      <div className="relative flex items-center gap-1.5" ref={menuRef}>
        <span>{STEP_HEADERS[step]}</span>
        <IconButton
          label={tooltip}
          icon={justSent ? Check : Bell}
          disabled={busy || incompleteCount === 0}
          tooltipSide="top"
          tooltipPortal
          onClick={(e) => {
            e.stopPropagation();
            if (busy || incompleteCount === 0) return;
            setMenuOpen((o) => !o);
          }}
          className="text-accent-coral hover:bg-accent-coral/10 hover:text-accent-coral"
          iconClassName="h-3.5 w-3.5"
        />
        {menuOpen ? (
          <div
            role="menu"
            className="absolute left-0 top-full z-30 mt-1 w-56 rounded-md border border-border bg-background py-1 shadow-md"
          >
            <p className="px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              Send via
            </p>
            {REMIND_VIA_OPTIONS.filter((opt) => opt.hideForStep !== step).map(
              (opt) => (
                <button
                  key={opt.via}
                  type="button"
                  role="menuitem"
                  className="flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm hover:bg-muted"
                  onClick={() => sendVia(opt.via)}
                >
                  <span className="font-medium text-foreground">{opt.label}</span>
                  <span className="text-xs text-muted-foreground">{opt.detail}</span>
                </button>
              ),
            )}
          </div>
        ) : null}
      </div>
    </th>
  );
}

export default function HiringOnboarding() {
  const {
    cycles,
    selectedCycleId,
    domains,
    selectedDomain,
    rows,
    allCycles,
    pillRoles,
  } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  }

  const incompleteCounts: Record<RemindStep, number> = {
    email: new Set(rows.filter((r) => !r.emailCreated).map((r) => r.userId)).size,
    slack: new Set(rows.filter((r) => !r.inSlack).map((r) => r.userId)).size,
    figma: new Set(rows.filter((r) => !r.figmaInvited).map((r) => r.userId)).size,
    profile: new Set(rows.filter((r) => !r.profileSubmitted).map((r) => r.userId)).size,
  };

  const cycleValue = selectedCycleId ?? "";

  return (
    <div className="flex flex-col gap-4">
      <AreaPillNav items={hiringPills({ ...pillRoles, active: "onboarding" })} />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">Onboarding</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Accepted applicants and their onboarding progress.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {domains.length > 0 && (
            <select
              value={selectedDomain ?? ""}
              onChange={(e) => setParam("domain", e.target.value || null)}
              className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-dark-blue"
            >
              <option value="">All domains</option>
              {domains.map((d) => (
                <option key={d.key} value={d.key}>
                  {d.label}
                </option>
              ))}
            </select>
          )}
          {cycles.length > 0 && (
            <select
              value={cycleValue}
              onChange={(e) => setParam("cycle", e.target.value || null)}
              className="rounded-lg border border-border bg-card px-3 py-2 text-sm font-medium text-dark-blue"
            >
              <option value="all">All cycles</option>
              {cycles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {!selectedCycleId ? (
        <div className="rounded-2xl border border-border bg-card py-16 text-center">
          <p className="text-muted-foreground">No application cycles yet.</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card py-16 text-center">
          <p className="text-muted-foreground">
            {selectedDomain
              ? allCycles
                ? "No accepted applicants in this domain across cycles."
                : "No accepted applicants in this domain for the selected cycle."
              : allCycles
                ? "No accepted applicants across cycles yet."
                : "No accepted applicants in this cycle yet."}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border">
          <table className="w-full text-sm">
            <thead className="bg-brand-tint text-left">
              <tr>
                <th className="px-5 py-3 font-heading font-semibold text-dark-blue">Member</th>
                {allCycles && (
                  <th className="px-5 py-3 font-heading font-semibold text-dark-blue">Cycle</th>
                )}
                <th className="px-5 py-3 font-heading font-semibold text-dark-blue">Role</th>
                <RemindHeader
                  step="email"
                  incompleteCount={incompleteCounts.email}
                  cycle={cycleValue === "all" ? "all" : cycleValue}
                  domain={selectedDomain}
                />
                <RemindHeader
                  step="slack"
                  incompleteCount={incompleteCounts.slack}
                  cycle={cycleValue === "all" ? "all" : cycleValue}
                  domain={selectedDomain}
                />
                <RemindHeader
                  step="figma"
                  incompleteCount={incompleteCounts.figma}
                  cycle={cycleValue === "all" ? "all" : cycleValue}
                  domain={selectedDomain}
                />
                <RemindHeader
                  step="profile"
                  incompleteCount={incompleteCounts.profile}
                  cycle={cycleValue === "all" ? "all" : cycleValue}
                  domain={selectedDomain}
                />
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((r) => (
                <tr
                  key={`${r.userId}-${r.cycleId}-${r.domainKey}`}
                  onClick={() => navigate(`/members/${r.userId}`)}
                  className="cursor-pointer hover:bg-muted/30"
                >
                  <td className="px-5 py-3 font-medium text-dark-blue">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <Avatar
                        photoUrl={r.photoUrl}
                        name={r.name}
                        size="sm"
                        className="flex-shrink-0"
                      />
                      <span className="truncate">{r.name}</span>
                    </div>
                  </td>
                  {allCycles && (
                    <td className="px-5 py-3 text-muted-foreground">{r.cycleName}</td>
                  )}
                  <td className="px-5 py-3 text-muted-foreground">{r.role}</td>
                  <td className="px-5 py-3">
                    {r.emailCreated ? (
                      <span className="font-mono text-xs text-dark-blue">{r.daliEmail}</span>
                    ) : (
                      <StatusPill ok={false} label="Not created" />
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <StatusPill ok={r.inSlack} label={r.inSlack ? "Joined" : "Not joined"} />
                  </td>
                  <td className="px-5 py-3">
                    <FigmaCheckbox userId={r.userId} invited={r.figmaInvited} />
                  </td>
                  <td className="px-5 py-3">
                    <StatusPill
                      ok={r.profileSubmitted}
                      label={r.profileSubmitted ? "Submitted" : "Pending"}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
