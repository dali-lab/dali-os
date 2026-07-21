import { useMemo, useState } from "react";
import { Link, redirect, useFetcher, useLoaderData } from "react-router";
import { Check, X, ListChecks } from "lucide-react";
import { Tooltip } from "~/components/ui/IconButton";
import { Button } from "~/components/ui/Button";
import { PageHeader } from "~/hiring/components/PageHeader";
import { EmptyState } from "~/hiring/components/EmptyState";
import type { Route } from "./+types/waitlists";
import { requireAuth } from "~/lib/auth";
import { getUserRoles } from "~/lib/roles";
import { hiringPills } from "~/hiring/components/hiringPills";
import { AreaPillNav } from "~/components/AreaPillNav";
import {
  listActiveWaitlistEntries,
  type WaitlistEntry,
} from "~/hiring/lib/waitlist.server";

export const handle = { areaPills: true };

export const meta: Route.MetaFunction = () => [
  { title: "Waitlists · Hiring · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  const roles = await getUserRoles(auth.user.sub);
  if (!roles.isCore) return redirect("/");

  const entries = await listActiveWaitlistEntries();
  return {
    entries,
    pillRoles: {
      isCore: roles.isCore,
      isDomainLead: roles.isDomainLead,
      isAdmin: roles.isAdmin,
      isInterviewer: roles.isInterviewer,
    },
  };
}

type LoaderData = {
  entries: WaitlistEntry[];
  pillRoles: {
    isCore: boolean;
    isDomainLead: boolean;
    isAdmin: boolean;
    isInterviewer: boolean;
  };
};

function fullName(e: WaitlistEntry): string {
  const f = e.applicant.firstName ?? "";
  const l = e.applicant.lastName ?? "";
  const joined = `${f} ${l}`.trim();
  return joined || e.applicant.dartmouthEmail || "(unknown)";
}

export default function WaitlistsPage() {
  const { entries, pillRoles } = useLoaderData<typeof loader>() as LoaderData;
  const [cycleFilter, setCycleFilter] = useState<string>("all");

  // Cycle chips: every cycle that contributes at least one active waitlister.
  const cycleOptions = useMemo(() => {
    const seen = new Map<string, { id: string; name: string; count: number }>();
    for (const e of entries) {
      const cur = seen.get(e.cycle.id);
      if (cur) cur.count += 1;
      else seen.set(e.cycle.id, { id: e.cycle.id, name: e.cycle.name, count: 1 });
    }
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [entries]);

  const filtered = useMemo(() => {
    if (cycleFilter === "all") return entries;
    return entries.filter((e) => e.cycle.id === cycleFilter);
  }, [entries, cycleFilter]);

  const byDomain = useMemo(() => {
    const map = new Map<string, { domain: WaitlistEntry["domain"]; rows: WaitlistEntry[] }>();
    for (const e of filtered) {
      const key = e.domain.id;
      const slot = map.get(key);
      if (slot) slot.rows.push(e);
      else map.set(key, { domain: e.domain, rows: [e] });
    }
    for (const v of map.values()) {
      v.rows.sort((a, b) => a.rank - b.rank);
    }
    return [...map.values()].sort((a, b) => {
      const ad = a.domain.displayName ?? a.domain.name;
      const bd = b.domain.displayName ?? b.domain.name;
      return ad.localeCompare(bd);
    });
  }, [filtered]);

  return (
    <div className="flex flex-col gap-5">
      <AreaPillNav items={hiringPills({ ...pillRoles, active: "waitlists" })} />
      <PageHeader
        title="Waitlists"
        subtitle="Everyone currently waitlisted across all cycles. Accepting runs the full release flow — member promotion, account provisioning, and the acceptance email — even after a cycle is completed. Removing closes the entry without notifying the applicant."
        chip={
          <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-bold text-foreground/80">
            {entries.length} active
          </span>
        }
      />

      {cycleOptions.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Filter by cycle
          </span>
          <button
            onClick={() => setCycleFilter("all")}
            className={`px-2.5 py-1 rounded-full text-xs font-medium ${
              cycleFilter === "all"
                ? "bg-foreground text-background"
                : "bg-muted text-foreground/80 hover:bg-muted/70"
            }`}
          >
            All ({entries.length})
          </button>
          {cycleOptions.map((c) => (
            <button
              key={c.id}
              onClick={() => setCycleFilter(c.id)}
              className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                cycleFilter === c.id
                  ? "bg-foreground text-background"
                  : "bg-muted text-foreground/80 hover:bg-muted/70"
              }`}
            >
              {c.name} ({c.count})
            </button>
          ))}
        </div>
      )}

      {byDomain.length === 0 ? (
        <EmptyState
          icon={ListChecks}
          title={
            entries.length === 0
              ? "No one is on a waitlist"
              : "No waitlisters in this cycle"
          }
          description={
            entries.length === 0
              ? "Applicants waitlisted during delibs will appear here, ranked within their domain."
              : "Choose a different cycle to see its waitlisted applicants."
          }
        />
      ) : (
        <div className="space-y-6">
          {byDomain.map((group) => (
            <DomainSection key={group.domain.id} domain={group.domain} rows={group.rows} />
          ))}
        </div>
      )}
    </div>
  );
}

function DomainSection({
  domain,
  rows,
}: {
  domain: WaitlistEntry["domain"];
  rows: WaitlistEntry[];
}) {
  return (
    <section className="bg-card border border-border rounded-xl overflow-hidden">
      <header className="flex items-center justify-between px-5 py-3 bg-muted/40 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">
          {domain.displayName ?? domain.name}
        </h2>
        <span className="text-xs text-muted-foreground">
          {rows.length} on the waitlist
        </span>
      </header>
      <table className="w-full text-sm">
        <thead className="text-xs uppercase tracking-wider text-muted-foreground/80">
          <tr className="text-left">
            <th className="px-5 py-2 w-16">Rank</th>
            <th className="px-5 py-2">Applicant</th>
            <th className="px-5 py-2">Cycle</th>
            <th className="px-5 py-2">Waitlisted</th>
            <th className="px-5 py-2 w-44 text-right">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <WaitlistRow key={r.domainApplicationId} entry={r} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function WaitlistRow({ entry }: { entry: WaitlistEntry }) {
  const acceptFetcher = useFetcher();
  const removeFetcher = useFetcher();
  const busy =
    acceptFetcher.state !== "idle" || removeFetcher.state !== "idle";

  const acceptError =
    acceptFetcher.data && (acceptFetcher.data as any).error
      ? ((acceptFetcher.data as any).error as string)
      : null;
  const removeError =
    removeFetcher.data && (removeFetcher.data as any).error
      ? ((removeFetcher.data as any).error as string)
      : null;

  const onAccept = () => {
    if (
      !window.confirm(
        `Accept ${fullName(entry)} off the waitlist? This will promote them to a member, provision their DALI account, and send the acceptance email.`,
      )
    )
      return;
    acceptFetcher.submit(
      {},
      {
        method: "post",
        action: `/api/hiring/waitlist/${entry.domainApplicationId}/accept`,
        encType: "application/json",
      },
    );
  };

  const onRemove = () => {
    if (
      !window.confirm(
        `Remove ${fullName(entry)} from the waitlist? No email will be sent. The applicant's other waitlist entries (if any) are unaffected.`,
      )
    )
      return;
    removeFetcher.submit(
      {},
      {
        method: "post",
        action: `/api/hiring/waitlist/${entry.domainApplicationId}/remove`,
        encType: "application/json",
      },
    );
  };

  return (
    <tr className="hover:bg-muted/40">
      <td className="px-5 py-3 font-semibold text-foreground">#{entry.rank}</td>
      <td className="px-5 py-3">
        <Link
          to={`/hiring/applications/${entry.domainApplicationId}`}
          className="font-medium text-foreground hover:text-accent-coral"
        >
          {fullName(entry)}
        </Link>
        {entry.applicant.dartmouthEmail && (
          <div className="text-xs text-muted-foreground">
            {entry.applicant.dartmouthEmail}
          </div>
        )}
        {(acceptError || removeError) && (
          <div className="mt-1 text-xs text-destructive">
            {acceptError ?? removeError}
          </div>
        )}
      </td>
      <td className="px-5 py-3 text-muted-foreground">{entry.cycle.name}</td>
      <td className="px-5 py-3 text-muted-foreground">
        {new Date(entry.waitlistedAt).toLocaleDateString("en-US", {
          month: "short",
          day: "numeric",
          year: "numeric",
        })}
      </td>
      <td className="px-5 py-3">
        <div className="flex items-center justify-end gap-2">
          <Button variant="primary" size="sm" onClick={onAccept} disabled={busy}>
            <Check className="h-3.5 w-3.5" />
            Accept
          </Button>
          <Tooltip label="Remove from waitlist">
            <Button
              variant="secondary"
              size="sm"
              onClick={onRemove}
              disabled={busy}
              aria-label="Remove from waitlist"
              className="px-2"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </Tooltip>
        </div>
      </td>
    </tr>
  );
}
