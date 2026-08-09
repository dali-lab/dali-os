import { useMemo, useState } from "react";
import { Link, redirect, useFetcher, useLoaderData } from "react-router";
import { Check, X } from "lucide-react";
import { Tooltip } from "~/components/ui/IconButton";
import { useDialog } from "~/components/ui/dialog";
import type { Route } from "./+types/waitlists";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles } from "~/lib/roles";
import {
  listActiveWaitlistEntries,
  type WaitlistEntry,
} from "~/hiring/lib/waitlist.server";


export const meta: Route.MetaFunction = () => [
  { title: "Waitlists · Hiring · DALI OS" },
];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-foreground">Waitlists</h1>
        <span className="text-sm text-muted-foreground">
          {entries.length} active waitlister{entries.length === 1 ? "" : "s"}
        </span>
      </div>

      <p className="text-sm text-muted-foreground max-w-2xl">
        Everyone currently waitlisted across all cycles. Accepting from here
        runs the full release flow — member promotion, account provisioning,
        and the acceptance email — even if the cycle is already completed.
        Removing closes the waitlist entry without notifying the applicant.
      </p>

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
        <div className="bg-card border-2 border-dashed border-gray-300 rounded-xl p-8 text-center">
          <p className="text-muted-foreground mb-1">
            {entries.length === 0
              ? "No one is currently on a waitlist."
              : "No waitlisters match the selected cycle."}
          </p>
        </div>
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
        <tbody className="divide-y divide-gray-100">
          {rows.map((r) => (
            <WaitlistRow key={r.domainApplicationId} entry={r} />
          ))}
        </tbody>
      </table>
    </section>
  );
}

function WaitlistRow({ entry }: { entry: WaitlistEntry }) {
  const dialog = useDialog();
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

  const onAccept = async () => {
    if (
      !(await dialog.confirm({
        title: `Accept ${fullName(entry)} off the waitlist?`,
        description:
          "This will promote them to a member, provision their DALI account, and send the acceptance email.",
        confirmLabel: "Accept",
      }))
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

  const onRemove = async () => {
    if (
      !(await dialog.confirm({
        title: `Remove ${fullName(entry)} from the waitlist?`,
        description:
          "No email will be sent. The applicant's other waitlist entries (if any) are unaffected.",
        confirmLabel: "Remove",
        tone: "destructive",
      }))
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
          className="font-medium text-foreground hover:text-blue-600"
        >
          {fullName(entry)}
        </Link>
        {entry.applicant.dartmouthEmail && (
          <div className="text-xs text-muted-foreground">
            {entry.applicant.dartmouthEmail}
          </div>
        )}
        {(acceptError || removeError) && (
          <div className="mt-1 text-xs text-red-600">
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
          <button
            onClick={onAccept}
            disabled={busy}
            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-white bg-green-600 rounded-md hover:bg-green-700 disabled:opacity-50"
          >
            <Check className="w-3.5 h-3.5" />
            Accept
          </button>
          <Tooltip label="Remove">
            <button
              onClick={onRemove}
              disabled={busy}
              aria-label="Remove"
              className="inline-flex items-center justify-center p-1.5 text-xs font-medium text-foreground/80 bg-card border border-border rounded-md hover:bg-muted disabled:opacity-50"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        </div>
      </td>
    </tr>
  );
}
