import {
  redirect,
  useFetcher,
  useLoaderData,
  useNavigate,
  useSearchParams,
} from "react-router";
import { Bell, Check } from "lucide-react";
import type { Route } from "./+types/onboarding";
import { requireAuth, unauthorized, forbidden } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, getUserRoles } from "~/lib/roles";
import { IconButton } from "~/components/ui/IconButton";
import { useDialog } from "~/components/ui/dialog";
import { Avatar } from "~/components/ui/Avatar";
import { Checkbox } from "~/components/ui/Checkbox";
import { prisma } from "~/lib/db";
import { resolvePhotoUrl } from "~/lib/photo";
import {
  sendOnboardingReminders,
  isOnboardingRemindVia,
  type OnboardingReminderStep,
  type OnboardingRemindVia,
} from "~/members/lib/welcome.server";
import { Menu, Select } from "~/components/ui/floating";
import { filterPillClass } from "~/components/ui/floating/styles";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";

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
  /** The term a cycle's members start in, filtered separately from the cycle. */
  termId: string | null;
}): Promise<{
  cycles: { id: string; name: string }[];
  terms: { id: string; code: string }[];
  hasUntermed: boolean;
  selectedTermId: string | null;
  selectedCycleId: string | "all" | null;
  domains: { key: string; label: string }[];
  selectedDomain: string | null;
  rows: OnboardingRow[];
  allCycles: boolean;
}> {
  const allCyclesRows = await prisma.applicationCycle.findMany({
    select: { id: true, name: true, term: { select: { id: true, code: true, startDate: true } } },
    orderBy: { createdAt: "desc" },
  });

  // Start term and cycle are two different questions, so they get a filter
  // each: the term narrows which cycles the cycle filter offers.
  const terms = Array.from(
    new Map(
      allCyclesRows
        .filter((c) => c.term)
        .map((c) => [c.term!.id, { id: c.term!.id, code: c.term!.code, startDate: c.term!.startDate }]),
    ).values(),
  )
    .sort((a, b) => b.startDate.getTime() - a.startDate.getTime())
    .map(({ id, code }) => ({ id, code }));

  // "none" is a real choice: cycles predating the term link, or ones whose term
  // hasn't been picked on Setup yet.
  const hasUntermed = allCyclesRows.some((c) => !c.term);
  const selectedTermId =
    args.termId === "none"
      ? hasUntermed
        ? "none"
        : null
      : args.termId && terms.some((t) => t.id === args.termId)
        ? args.termId
        : null;
  const inTerm = selectedTermId
    ? allCyclesRows.filter((c) => (selectedTermId === "none" ? !c.term : c.term?.id === selectedTermId))
    : allCyclesRows;
  const cycles = inTerm.map(({ id, name }) => ({ id, name }));

  // With a term picked, the cycle filter starts at "all" so the term alone
  // narrows the list; without one, the newest cycle opens as before.
  const allCycles = args.cycleId === "all" || (!args.cycleId && selectedTermId != null);
  const selectedCycleId: string | "all" | null = allCycles
    ? "all"
    : args.cycleId && cycles.some((c) => c.id === args.cycleId)
      ? args.cycleId
      : (cycles[0]?.id ?? null);

  if (!selectedCycleId) {
    return {
      cycles,
      terms,
      hasUntermed,
      selectedTermId,
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
          ? selectedTermId
            ? { applicationCycleId: { in: cycles.map((c) => c.id) } }
            : {}
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
    terms,
    hasUntermed,
    selectedTermId,
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
  if (!auth.ok) return redirectToLogin(request);
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
    termId: url.searchParams.get("term"),
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
      termId: String(form.get("term") ?? "") || null,
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
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        ok ? "bg-os-green/15 text-os-green" : "bg-os-container text-os-grey",
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", ok ? "bg-os-green" : "bg-os-muted")} />
      {label}
    </span>
  );
}

function FigmaCheckbox({ userId, invited }: { userId: string; invited: boolean }) {
  const fetcher = useFetcher<{ figmaInvited?: boolean }>();
  const pending = fetcher.formData?.get("invited");
  const checked = pending != null ? pending === "true" : invited;

  return (
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events
    <span onClick={(e) => e.stopPropagation()}>
      <Checkbox
        className="inline-flex cursor-pointer items-center gap-2 text-sm text-os-grey"
        checked={checked}
        disabled={fetcher.state !== "idle"}
        onChange={() =>
          fetcher.submit(
            { intent: "toggleFigma", userId, invited: String(!checked) },
            { method: "post" },
          )
        }
        label={checked ? "Invited" : "Not invited"}
      />
    </span>
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
  term,
}: {
  step: RemindStep;
  incompleteCount: number;
  cycle: string | "all";
  domain: string | null;
  term: string | null;
}) {
  const fetcher = useFetcher<{
    ok?: boolean;
    count?: number;
    skipped?: number;
    error?: string;
  }>();
  const dialog = useDialog();
  const busy = fetcher.state !== "idle" && fetcher.formData?.get("step") === step;
  // This fetcher is scoped to this step's RemindHeader, so idle + ok already
  // means this step's send just succeeded. (formData is cleared once idle, so
  // it can't be read here.)
  const justSent = fetcher.state === "idle" && !!fetcher.data?.ok;

  const tooltip = busy
    ? "Sending…"
    : justSent
      ? `Sent to ${fetcher.data?.count ?? 0}${
          fetcher.data?.skipped
            ? ` (${fetcher.data.skipped} skipped, no address)`
            : ""
        }`
      : incompleteCount === 0
        ? `All members have ${STEP_LABELS[step]}`
        : `Remind ${incompleteCount} incomplete on ${STEP_LABELS[step]}`;

  async function sendVia(via: OnboardingRemindVia) {
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
        term: term ?? "",
      },
      { method: "post" },
    );
  }

  return (
    <th className="px-6 py-4 font-medium align-bottom">
      <div className="flex items-center gap-1.5">
        <span>{STEP_HEADERS[step]}</span>
        <Menu
          align="left"
          ariaLabel="Send reminder via"
          trigger={
            <IconButton
              label={tooltip}
              icon={justSent ? Check : Bell}
              disabled={busy || incompleteCount === 0}
              tooltipSide="top"
              className="text-os-accent hover:bg-os-accent/15 hover:text-os-accent"
              iconClassName="h-3.5 w-3.5"
            />
          }
        >
          {REMIND_VIA_OPTIONS.filter((opt) => opt.hideForStep !== step).map(
            (opt) => (
              <Menu.Item
                key={opt.via}
                onSelect={() => void sendVia(opt.via)}
                disabled={busy}
              >
                <span className="flex flex-col items-start gap-0.5">
                  <span className="font-medium text-foreground">{opt.label}</span>
                  <span className="text-xs text-muted-foreground">{opt.detail}</span>
                </span>
              </Menu.Item>
            ),
          )}
        </Menu>
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
    terms,
    hasUntermed,
    selectedTermId,
  } = useLoaderData<typeof loader>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  function setParams(values: Record<string, string | null>) {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearchParams(next, { replace: true });
  }
  const setParam = (key: string, value: string | null) => setParams({ [key]: value });

  const incompleteCounts: Record<RemindStep, number> = {
    email: new Set(rows.filter((r) => !r.emailCreated).map((r) => r.userId)).size,
    slack: new Set(rows.filter((r) => !r.inSlack).map((r) => r.userId)).size,
    figma: new Set(rows.filter((r) => !r.figmaInvited).map((r) => r.userId)).size,
    profile: new Set(rows.filter((r) => !r.profileSubmitted).map((r) => r.userId)).size,
  };

  const cycleValue = selectedCycleId ?? "";
  const { pageTitle, bodyText, panel } = useOsChrome();
  const remindCycle = cycleValue === "all" ? "all" : cycleValue;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className={pageTitle}>Onboarding</h1>
        <p className={bodyText}>Accepted applicants and their onboarding progress.</p>
      </div>

      {cycles.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          {(terms.length > 1 || (terms.length === 1 && hasUntermed)) && (
            <Select
              ariaLabel="Starts"
              value={selectedTermId ?? ""}
              placeholder="Any start"
              onChange={(v) => setParams({ term: v || null, cycle: null })}
              options={[
                { value: "", label: "Any start" },
                ...terms.map((t) => ({ value: t.id, label: t.code })),
                ...(hasUntermed ? [{ value: "none", label: "No start set" }] : []),
              ]}
              buttonClassName={cn(filterPillClass(), "w-full sm:w-44")}
            />
          )}
          <Select
            ariaLabel="Cycle"
            value={cycleValue}
            onChange={(v) => setParam("cycle", v || null)}
            options={[
              { value: "all", label: "All cycles" },
              ...cycles.map((c) => ({ value: c.id, label: c.name })),
            ]}
            buttonClassName={cn(filterPillClass(), "w-full sm:w-64")}
          />
          {domains.length > 0 && (
            <Select
              ariaLabel="Domain"
              value={selectedDomain ?? ""}
              placeholder="All domains"
              onChange={(v) => setParam("domain", v || null)}
              options={[
                { value: "", label: "All domains" },
                ...domains.map((d) => ({ value: d.key, label: d.label })),
              ]}
              buttonClassName={cn(filterPillClass(), "w-full sm:w-56")}
            />
          )}
          <span className="ml-auto text-base text-os-grey tabular-nums">
            {rows.length} {rows.length === 1 ? "member" : "members"}
          </span>
        </div>
      )}

      {!selectedCycleId ? (
        <div className={cn(panel, "py-16 text-center text-base text-os-grey")}>
          No application cycles yet.
        </div>
      ) : rows.length === 0 ? (
        <div className={cn(panel, "py-16 text-center text-base text-os-grey")}>
          {selectedDomain
            ? allCycles
              ? "No accepted applicants in this domain across cycles."
              : "No accepted applicants in this domain for the selected cycle."
            : allCycles
              ? "No accepted applicants across cycles yet."
              : "No accepted applicants in this cycle yet."}
        </div>
      ) : (
        <div className={cn(panel, "overflow-hidden")}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead className="text-left text-xs uppercase tracking-wide text-os-grey">
                <tr>
                  <th className="px-6 py-4 font-medium">Member</th>
                  {allCycles && <th className="px-6 py-4 font-medium">Cycle</th>}
                  <th className="px-6 py-4 font-medium">Role</th>
                  {REMIND_STEPS.map((step) => (
                    <RemindHeader
                      key={step}
                      step={step}
                      incompleteCount={incompleteCounts[step]}
                      cycle={remindCycle}
                      domain={selectedDomain}
                      term={selectedTermId}
                    />
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={`${r.userId}-${r.cycleId}-${r.domainKey}`}
                    onClick={() => navigate(`/members/${r.userId}`)}
                    className="cursor-pointer border-t border-os-container transition-colors hover:bg-os-card-hover"
                  >
                    <td className="px-6 py-3.5">
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar
                          photoUrl={r.photoUrl}
                          name={r.name}
                          size="sm"
                          className="flex-shrink-0"
                        />
                        <span className="truncate text-base font-medium text-foreground">
                          {r.name}
                        </span>
                      </div>
                    </td>
                    {allCycles && <td className="px-6 py-3.5 text-os-grey">{r.cycleName}</td>}
                    <td className="px-6 py-3.5 text-foreground">{r.role}</td>
                    <td className="px-6 py-3.5">
                      {r.emailCreated ? (
                        <span className="font-mono text-xs text-foreground">{r.daliEmail}</span>
                      ) : (
                        <StatusPill ok={false} label="Not created" />
                      )}
                    </td>
                    <td className="px-6 py-3.5">
                      <StatusPill ok={r.inSlack} label={r.inSlack ? "Joined" : "Not joined"} />
                    </td>
                    <td className="px-6 py-3.5">
                      <FigmaCheckbox userId={r.userId} invited={r.figmaInvited} />
                    </td>
                    <td className="px-6 py-3.5">
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
        </div>
      )}
    </div>
  );
}
