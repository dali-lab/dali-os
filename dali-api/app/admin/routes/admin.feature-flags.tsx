// Admin → System & Insights → Feature Flags. Per-flag targeting: a master
// Enabled switch, an Everyone toggle, role checkboxes, and a named-user
// allowlist. The registry (app/lib/feature-flags.ts) declares which flags
// exist; the FeatureFlag row is authoritative for targeting once saved.
// Core-visible (Admin + current-cycle Core) — same tier as the rest of the
// System & Insights cluster.

import { redirect, useFetcher, useLoaderData, useRevalidator } from "react-router";
import { useEffect, useMemo, useState } from "react";
import { useDialog } from "~/components/ui/dialog";
import type { Route } from "./+types/admin.feature-flags";
import { adminHandle } from "~/admin/adminNav";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, isAdmin, currentTermMemberWhere } from "~/lib/roles";
import { MEMBER_LIST_ORDER_BY } from "~/lib/prisma-shapes";
import { fullName } from "~/lib/display";
import { ROLE_TARGETS, type RoleTarget } from "~/lib/feature-flags";
import { listFlagsForAdmin, type AdminFlagView } from "~/lib/feature-flags.server";
import { buttonClasses } from "~/components/ui/Button";
import { InfoTip } from "~/components/ui/floating";

export const handle = adminHandle("feature-flags");

export const meta: Route.MetaFunction = () => [
  { title: "Feature Flags · Admin · DALI OS" },
];

// Human labels for the targetable role keys.
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
  const [flags, users, viewerIsAdmin] = await Promise.all([
    listFlagsForAdmin(),
    prisma.user.findMany({
      where: memberWhere,
      orderBy: MEMBER_LIST_ORDER_BY,
      select: { id: true, firstName: true, lastName: true, daliEmail: true },
    }),
    isAdmin(auth.user.sub),
  ]);

  return {
    flags,
    members: users.map((u) => ({ id: u.id, name: fullName(u), email: u.daliEmail })),
    viewerIsAdmin,
  };
}

type Member = { id: string; name: string; email: string | null };

function FlagCard({ flag, members }: { flag: AdminFlagView; members: Member[] }) {
  const saveFetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const revalidator = useRevalidator();
  const dialog = useDialog();
  const busy = saveFetcher.state !== "idle";

  const [enabled, setEnabled] = useState(flag.enabled);
  const [everyone, setEveryone] = useState(flag.everyone);
  const [roles, setRoles] = useState<RoleTarget[]>(flag.roles);
  const [userIds, setUserIds] = useState<string[]>(flag.userIds);
  const [variant, setVariant] = useState<string | null>(flag.variant);
  const [search, setSearch] = useState("");

  const memberById = useMemo(
    () => new Map(members.map((m) => [m.id, m])),
    [members],
  );
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    return members
      .filter(
        (m) =>
          !userIds.includes(m.id) &&
          (m.name.toLowerCase().includes(q) ||
            (m.email ?? "").toLowerCase().includes(q)),
      )
      .slice(0, 8);
  }, [search, members, userIds]);

  const dirty =
    enabled !== flag.enabled ||
    everyone !== flag.everyone ||
    variant !== flag.variant ||
    roles.slice().sort().join() !== flag.roles.slice().sort().join() ||
    userIds.slice().sort().join() !== flag.userIds.slice().sort().join();

  function toggleRole(r: RoleTarget) {
    setRoles((prev) =>
      prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r],
    );
  }

  async function save() {
    // Confirm when the save would newly turn "everyone" on — this makes the
    // flag active for every user, which can be a large-scale change.
    const everyoneNewlyOn = everyone && !flag.everyone;
    if (everyoneNewlyOn) {
      const memberCount = members.length;
      const countLabel = memberCount > 0 ? ` (${memberCount} users)` : "";
      const ok = await dialog.confirm({
        title: `Enable ${flag.label} for everyone${countLabel}?`,
        description: `This turns on "${flag.key}" for all users regardless of role or individual targeting.`,
        confirmLabel: "Enable for everyone",
      });
      if (!ok) return;
    }
    saveFetcher.submit(
      { enabled, everyone, roles, userIds, note: flag.note, variant },
      {
        method: "PATCH",
        action: `/api/feature-flags/${flag.key}`,
        encType: "application/json",
      },
    );
  }

  // Refresh the loader once a save lands so the baseline (which drives the
  // "dirty" comparison and the Saved indicator) reflects what was persisted.
  useEffect(() => {
    if (saveFetcher.state === "idle" && saveFetcher.data?.ok) revalidator.revalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveFetcher.state]);
  const justSaved = saveFetcher.state === "idle" && saveFetcher.data?.ok === true;

  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-mono text-sm font-medium text-zinc-900">{flag.key}</p>
          <p className="mt-0.5 text-sm font-semibold text-foreground">{flag.label}</p>
          <p className="mt-0.5 text-xs text-zinc-500">{flag.description}</p>
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={() => setEnabled((v) => !v)}
          className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
            enabled
              ? "bg-green-100 text-green-800 hover:bg-green-200"
              : "bg-zinc-200 text-zinc-600 hover:bg-zinc-300"
          } disabled:opacity-50`}
        >
          {enabled ? "Enabled" : "Disabled"}
        </button>
      </div>

      <div className={`mt-4 flex flex-col gap-4 ${enabled ? "" : "opacity-50"}`}>
        {flag.variants.length > 0 && (
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Which one
            </p>
            <div className="mt-1.5 flex flex-col gap-1.5">
              {flag.variants.map((v) => (
                <label
                  key={v.value}
                  className={`flex items-start gap-2 rounded-md border px-2.5 py-2 text-sm ${
                    variant === v.value
                      ? "border-accent-coral bg-accent-coral/5"
                      : "border-zinc-200"
                  } ${enabled ? "cursor-pointer" : "opacity-50"}`}
                >
                  <input
                    type="radio"
                    name={`${flag.key}-variant`}
                    className="mt-1"
                    checked={variant === v.value}
                    disabled={!enabled}
                    onChange={() => setVariant(v.value)}
                  />
                  <span>
                    <span className="font-medium text-zinc-900">{v.label}</span>
                    <span className="block text-xs text-zinc-500">{v.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        <label className="flex items-center gap-2 text-sm text-zinc-700">
          <input
            type="checkbox"
            checked={everyone}
            disabled={!enabled}
            onChange={(e) => setEveryone(e.target.checked)}
          />
          Everyone
          <span className="text-xs text-zinc-400">(on for all users)</span>
          <InfoTip content="When checked, this flag is on for every user regardless of role or person targeting. Disable the master switch above to turn it off for all." />
        </label>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 inline-flex items-center gap-1">
            Roles
            <InfoTip content="The flag is on for any user who holds at least one of these roles. Ignored when Everyone is checked." />
          </p>
          <div className="mt-1.5 flex flex-wrap gap-2">
            {ROLE_TARGETS.map((r) => (
              <label
                key={r}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs ${
                  roles.includes(r)
                    ? "border-accent-coral bg-accent-coral/10 text-accent-coral"
                    : "border-zinc-300 text-zinc-600"
                } ${everyone || !enabled ? "opacity-50" : "cursor-pointer"}`}
              >
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={roles.includes(r)}
                  disabled={everyone || !enabled}
                  onChange={() => toggleRole(r)}
                />
                {ROLE_LABELS[r]}
              </label>
            ))}
          </div>
        </div>

        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500 inline-flex items-center gap-1">
            Specific people
            <InfoTip content="Individual users who always get this flag regardless of role. Useful for staged rollouts or testing with named members." />
          </p>
          {userIds.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {userIds.map((id) => {
                const m = memberById.get(id);
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-700"
                  >
                    {m ? m.name : id}
                    <button
                      type="button"
                      disabled={!enabled}
                      onClick={() => setUserIds((prev) => prev.filter((x) => x !== id))}
                      className="text-zinc-400 hover:text-zinc-700 disabled:opacity-50"
                      aria-label="Remove"
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
          )}
          <div className="relative mt-1.5 max-w-sm">
            <input
              type="text"
              value={search}
              disabled={!enabled}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Add a person by name or email…"
              className="w-full rounded-md border border-zinc-300 px-2.5 py-1.5 text-sm disabled:opacity-50"
            />
            {matches.length > 0 && (
              <ul className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-zinc-200 bg-white shadow-lg">
                {matches.map((m) => (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setUserIds((prev) => [...prev, m.id]);
                        setSearch("");
                      }}
                      className="block w-full px-3 py-1.5 text-left text-sm hover:bg-zinc-50"
                    >
                      {m.name}
                      {m.email && (
                        <span className="ml-1 text-xs text-zinc-400">{m.email}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          disabled={busy || !dirty}
          onClick={() => void save()}
          className={buttonClasses("primary", "sm")}
        >
          {busy ? "Saving…" : "Save"}
        </button>
        {saveFetcher.data?.error && (
          <span className="text-xs text-red-600">{saveFetcher.data.error}</span>
        )}
        {justSaved && !dirty && (
          <span className="text-xs text-green-700">Saved</span>
        )}
      </div>
    </div>
  );
}

export default function AdminFeatureFlags() {
  const { flags, members } = useLoaderData<typeof loader>();
  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="font-heading text-2xl font-bold text-foreground">Feature Flags</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Roll a feature out gradually. A flag is on for a user when it's enabled
          and any target matches — everyone, a listed role, or a named person.
          Disable the master switch to turn it off for everyone at once. Some
          flags offer a choice rather than on/off: pick which one the people
          they target get.
        </p>
      </header>
      <div className="flex flex-col gap-3">
        {flags.map((flag) => (
          <FlagCard key={flag.key} flag={flag} members={members} />
        ))}
      </div>
    </div>
  );
}
