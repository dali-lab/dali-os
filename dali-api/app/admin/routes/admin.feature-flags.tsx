// Admin → Platform → Feature flags. The registry (app/lib/feature-flags.ts)
// declares which flags exist; the FeatureFlag row is authoritative for
// targeting once saved.

import { redirect, useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, X } from "lucide-react";
import { useDialog } from "~/components/ui/dialog";
import type { Route } from "./+types/admin.feature-flags";
import { AdminSectionHeader, adminHandle } from "~/admin/adminNav";
import { EmptyState, Pill } from "~/admin/components/console-ui";
import { useOsChrome } from "~/components/os-chrome";
import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, isAdmin, currentTermMemberWhere } from "~/lib/roles";
import { MEMBER_LIST_ORDER_BY } from "~/lib/prisma-shapes";
import { fullName } from "~/lib/display";
import { cn } from "~/lib/cn";
import { ROLE_TARGETS, type RoleTarget } from "~/lib/feature-flags";
import { listFlagsForAdmin, type AdminFlagView } from "~/lib/feature-flags.server";
import { SearchInput } from "~/components/ui/SearchInput";
import { Toggle } from "~/components/ui/Toggle";
import { Checkbox } from "~/components/ui/Checkbox";
import { Radio } from "~/components/ui/Radio";
import { Combobox, InfoTip, Tooltip } from "~/components/ui/floating";

export const handle = adminHandle("flags");

export const meta: Route.MetaFunction = () => [
  { title: "Feature flags · Admin · DALI OS" },
];

const ROLE_LABELS: Record<RoleTarget, string> = {
  isCore: "Core",
  isAdmin: "Admin",
  isDomainLead: "Domain Lead",
  isInstructor: "Instructor",
  isInterviewer: "Interviewer",
  isStaff: "Staff",
  isAlumni: "Alumni",
};

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const memberWhere = await currentTermMemberWhere();
  const [flags, rows, users, viewerIsAdmin] = await Promise.all([
    listFlagsForAdmin(),
    prisma.featureFlag.findMany({ select: { key: true, updatedAt: true } }),
    prisma.user.findMany({
      where: memberWhere,
      orderBy: MEMBER_LIST_ORDER_BY,
      select: { id: true, firstName: true, lastName: true, daliEmail: true },
    }),
    isAdmin(auth.user.sub),
  ]);
  const updatedAt: Record<string, string> = Object.fromEntries(
    rows.map((r) => [r.key, r.updatedAt.toISOString()]),
  );

  return {
    flags,
    updatedAt,
    members: users.map((u) => ({ id: u.id, name: fullName(u), email: u.daliEmail })),
    viewerIsAdmin,
  };
}

type Member = { id: string; name: string; email: string | null };
type Targeting = Pick<AdminFlagView, "enabled" | "everyone" | "roles" | "userIds" | "variant">;

/** Who a flag is on for, in a few words, for the row's pill. */
export function flagTargetSummary(
  t: Pick<Targeting, "enabled" | "everyone" | "roles" | "userIds">,
): string {
  if (!t.enabled) return "Off";
  if (t.everyone) return "Everyone";
  const parts: string[] = [];
  if (t.roles.length > 0) parts.push(t.roles.map((r) => ROLE_LABELS[r]).join(", "));
  if (t.userIds.length > 0) {
    parts.push(`${t.userIds.length} ${t.userIds.length === 1 ? "person" : "people"}`);
  }
  return parts.length > 0 ? parts.join(" + ") : "No one";
}

/** A save that newly turns Everyone on reaches every user, so it confirms first. */
export function needsEveryoneConfirm(
  next: Pick<Targeting, "everyone">,
  saved: Pick<Targeting, "everyone">,
): boolean {
  return next.everyone && !saved.everyone;
}

export function matchesFlagQuery(
  flag: { key: string; label: string; description: string },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  return !q || `${flag.key} ${flag.label} ${flag.description}`.toLowerCase().includes(q);
}

function formatUpdated(iso: string | undefined): string {
  if (!iso) return "Default";
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.slice().sort().join() === b.slice().sort().join();

function usePersistFlag(flag: AdminFlagView, memberCount: number) {
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const revalidator = useRevalidator();
  const dialog = useDialog();

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) revalidator.revalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state]);

  async function persist(next: Targeting) {
    if (needsEveryoneConfirm(next, flag)) {
      const countLabel = memberCount > 0 ? ` (${memberCount} users)` : "";
      const ok = await dialog.confirm({
        title: `Enable ${flag.label} for everyone${countLabel}?`,
        description: `This turns on "${flag.key}" for all users regardless of role or individual targeting.`,
        confirmLabel: "Enable for everyone",
      });
      if (!ok) return;
    }
    fetcher.submit(
      { ...next, note: flag.note },
      { method: "PATCH", action: `/api/feature-flags/${flag.key}`, encType: "application/json" },
    );
  }

  return { fetcher, persist };
}

function FlagRow({
  flag,
  members,
  updatedAt,
  first,
}: {
  flag: AdminFlagView;
  members: Member[];
  updatedAt: string | undefined;
  first: boolean;
}) {
  const { actionBtnPrimary, bodyText } = useOsChrome();
  const toggle = usePersistFlag(flag, members.length);
  const save = usePersistFlag(flag, members.length);
  const busy = toggle.fetcher.state !== "idle" || save.fetcher.state !== "idle";

  const [open, setOpen] = useState(false);
  const [everyone, setEveryone] = useState(flag.everyone);
  const [roles, setRoles] = useState<RoleTarget[]>(flag.roles);
  const [userIds, setUserIds] = useState<string[]>(flag.userIds);
  const [variant, setVariant] = useState<string | null>(flag.variant);

  const pending = toggle.fetcher.json as { enabled?: boolean } | undefined;
  const enabled =
    toggle.fetcher.state !== "idle" && pending?.enabled != null ? pending.enabled : flag.enabled;

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const addOptions = useMemo(
    () =>
      members
        .filter((m) => !userIds.includes(m.id))
        .map((m) => ({ value: m.id, label: m.email ? `${m.name} · ${m.email}` : m.name })),
    [members, userIds],
  );

  const dirty =
    everyone !== flag.everyone ||
    variant !== flag.variant ||
    !sameSet(roles, flag.roles) ||
    !sameSet(userIds, flag.userIds);

  const error =
    (toggle.fetcher.state === "idle" && toggle.fetcher.data?.error) ||
    (save.fetcher.state === "idle" && save.fetcher.data?.error) ||
    null;
  const justSaved = save.fetcher.state === "idle" && save.fetcher.data?.ok === true && !dirty;

  // The list switch flips only the master switch on the saved targeting, so an
  // unsaved edit in the open editor never goes live by accident.
  const flip = () =>
    void toggle.persist({
      enabled: !flag.enabled,
      everyone: flag.everyone,
      roles: flag.roles,
      userIds: flag.userIds,
      variant: flag.variant,
    });
  const saveDraft = () =>
    void save.persist({ enabled: flag.enabled, everyone, roles, userIds, variant });

  const variantLabel = flag.variants.find((v) => v.value === flag.variant)?.label;
  const panelId = `flag-${flag.key}-editor`;

  return (
    <li className={cn(!first && "border-t border-os-container/70")}>
      <div className="flex items-center gap-4 px-6 py-4">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls={panelId}
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
        >
          <ChevronDown
            className={cn(
              "mt-0.5 h-4 w-4 shrink-0 text-os-muted transition-transform",
              !open && "-rotate-90",
            )}
            aria-hidden
          />
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <code className="font-mono text-sm text-foreground">{flag.key}</code>
              <Pill tone={enabled ? "ok" : "idle"}>{flagTargetSummary({ ...flag, enabled })}</Pill>
              {variantLabel && <Pill>{variantLabel}</Pill>}
            </span>
            <span className="mt-0.5 block text-sm text-os-grey">
              <span className="font-medium text-foreground">{flag.label}</span>
              {flag.description && <> · {flag.description}</>}
            </span>
          </span>
        </button>
        <span className="hidden w-24 text-right text-xs text-os-muted sm:block">
          {formatUpdated(updatedAt)}
        </span>
        <Toggle
          tone="os"
          checked={enabled}
          disabled={busy}
          aria-label={`Turn ${flag.key} ${enabled ? "off" : "on"}`}
          onChange={flip}
        />
      </div>
      {error && !open && <p className="-mt-2 px-6 pb-3 text-xs text-destructive">{error}</p>}

      {open && (
        <div
          id={panelId}
          className="flex flex-col gap-5 border-t border-os-container/70 px-6 py-5 sm:pl-13"
        >
          {!enabled && (
            <p className={bodyText}>
              This flag is off for everyone. Targeting saved here applies once it is on.
            </p>
          )}

          {flag.variants.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold text-os-muted">Which one</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {flag.variants.map((v) => (
                  <Radio
                    key={v.value}
                    name={`${flag.key}-variant`}
                    checked={variant === v.value}
                    onChange={() => setVariant(v.value)}
                    label={v.label}
                    description={v.description}
                    className={cn(
                      "rounded-os-item border px-3 py-2.5",
                      variant === v.value ? "border-os-accent bg-os-accent/5" : "border-os-container",
                    )}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-1.5">
            <Checkbox
              tone="os"
              checked={everyone}
              onChange={(e) => setEveryone(e.target.checked)}
              label="Everyone"
              description="On for all users"
            />
            <InfoTip content="When checked, this flag is on for every user regardless of role or person targeting. Turn the switch off to turn it off for all." />
          </div>

          <div className="flex flex-col gap-2">
            <p className="inline-flex items-center gap-1 text-xs font-semibold text-os-muted">
              Roles
              <InfoTip content="The flag is on for any user who holds at least one of these roles. Ignored when Everyone is checked." />
            </p>
            <div className="flex flex-wrap gap-2">
              {ROLE_TARGETS.map((r) => {
                const on = roles.includes(r);
                return (
                  <label
                    key={r}
                    className={cn(
                      "inline-flex items-center rounded-full border px-3 py-1 text-sm transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-os-accent/40",
                      on
                        ? "border-os-accent/30 bg-os-accent/15 text-os-accent"
                        : "border-os-container text-os-grey hover:border-os-container-hi hover:text-foreground",
                      everyone ? "cursor-not-allowed opacity-50" : "cursor-pointer",
                    )}
                  >
                    <input
                      type="checkbox"
                      className="sr-only"
                      checked={on}
                      disabled={everyone}
                      onChange={() =>
                        setRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]))
                      }
                    />
                    {ROLE_LABELS[r]}
                  </label>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <p className="inline-flex items-center gap-1 text-xs font-semibold text-os-muted">
              Specific people
              <InfoTip content="Individual users who always get this flag regardless of role. Useful for staged rollouts or testing with named members." />
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              {userIds.map((id) => {
                const name = memberById.get(id)?.name ?? id;
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 rounded-full border border-os-container py-1 pl-3 pr-1 text-sm text-foreground"
                  >
                    {name}
                    <Tooltip content="Remove">
                      <button
                        type="button"
                        onClick={() => setUserIds((prev) => prev.filter((x) => x !== id))}
                        aria-label={`Remove ${name}`}
                        className="rounded-full p-0.5 text-os-muted transition-colors hover:bg-os-container hover:text-foreground"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </Tooltip>
                  </span>
                );
              })}
              <Combobox
                value=""
                options={addOptions}
                onChange={(id) => setUserIds((prev) => (prev.includes(id) ? prev : [...prev, id]))}
                ariaLabel={`Add a person to ${flag.key}`}
                placeholder="Add a person by name or email"
                emptyLabel={addOptions.length === 0 ? "Everyone is added" : "No matches"}
                className="min-w-64 rounded-full border border-dashed border-os-container px-3 py-1 text-sm"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              disabled={busy || !dirty}
              onClick={saveDraft}
              className={cn(actionBtnPrimary, "disabled:cursor-not-allowed disabled:opacity-50")}
            >
              {save.fetcher.state !== "idle" ? "Saving…" : "Save"}
            </button>
            {error && <span className="text-xs text-destructive">{error}</span>}
            {justSaved && <span className="text-xs text-os-green">Saved</span>}
          </div>
        </div>
      )}
    </li>
  );
}

export default function AdminFeatureFlags() {
  const { flags, members, updatedAt } = useLoaderData<typeof loader>();
  const { panel, bodyText } = useOsChrome();
  const [query, setQuery] = useState("");
  const visible = flags.filter((f) => matchesFlagQuery(f, query));

  return (
    <div className="flex flex-col gap-8">
      <AdminSectionHeader section="platform" />
      <div className="-mt-2 flex flex-col gap-4">
        <p className={cn(bodyText, "max-w-3xl")}>
          A flag is on for a user when its switch is on and any target matches: everyone, a listed role,
          or a named person. Turn the switch off to turn it off for everyone at once. Open a flag to
          choose who gets it.
        </p>
        <SearchInput
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search flags"
          aria-label="Search flags"
          containerClassName="md:w-80"
        />
      </div>
      <ul className={panel}>
        {visible.map((flag, i) => (
          <FlagRow
            key={flag.key}
            flag={flag}
            members={members}
            updatedAt={updatedAt[flag.key]}
            first={i === 0}
          />
        ))}
        {visible.length === 0 && (
          <li>
            <EmptyState>
              {flags.length === 0 ? "No flags registered." : `No flags match "${query}".`}
            </EmptyState>
          </li>
        )}
      </ul>
    </div>
  );
}
