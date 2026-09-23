import { type CSSProperties, useEffect, useMemo, useState } from "react";
import { isAdminOnlyCycle } from "~/hiring/lib/applicant-groups";
import { Link, redirect, useFetcher, useLoaderData } from "react-router";
import { Check, GripVertical, X } from "lucide-react";
import {
  DndContext,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Tooltip } from "~/components/ui/floating";
import { useDialog } from "~/components/ui/dialog";
import { Button } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { FilterPill } from "~/components/ui/filter-panel";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import type { Route } from "./+types/waitlists";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { getUserRoles } from "~/lib/roles";
import { tiedRanks } from "~/hiring/lib/waitlist";
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
  // Lab members cycle waitlisters are current lab members, so Admin-only. Hide
  // them from non-admin Core members who use this view for the other cycles.
  const visibleEntries = roles.isAdmin
    ? entries
    : entries.filter((e) => !isAdminOnlyCycle(e.cycle.applicants));
  return { entries: visibleEntries };
}

function fullName(e: WaitlistEntry): string {
  const f = e.applicant.firstName ?? "";
  const l = e.applicant.lastName ?? "";
  const joined = `${f} ${l}`.trim();
  return joined || e.applicant.dartmouthEmail || "(unknown)";
}

export default function WaitlistsPage() {
  const { entries } = useLoaderData<typeof loader>() as { entries: WaitlistEntry[] };
  const { pageTitle, bodyText } = useOsChrome();
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

  // Grouped from every entry, not the filtered ones: a domain's order spans
  // cycles, so ties and reordering are judged against the whole list.
  const byDomain = useMemo(() => {
    const map = new Map<string, { domain: WaitlistEntry["domain"]; rows: WaitlistEntry[] }>();
    for (const e of entries) {
      const slot = map.get(e.domain.id);
      if (slot) slot.rows.push(e);
      else map.set(e.domain.id, { domain: e.domain, rows: [e] });
    }
    for (const v of map.values()) v.rows.sort((a, b) => a.rank - b.rank);
    return [...map.values()].sort((a, b) =>
      (a.domain.displayName ?? a.domain.name).localeCompare(b.domain.displayName ?? b.domain.name),
    );
  }, [entries]);

  const filtering = cycleFilter !== "all";
  const visibleDomains = filtering
    ? byDomain.filter((g) => g.rows.some((r) => r.cycle.id === cycleFilter))
    : byDomain;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <div className="flex items-end justify-between gap-4">
          <h1 className={pageTitle}>Waitlists</h1>
          <span className="text-base text-os-grey tabular-nums">
            {entries.length} waitlisted
          </span>
        </div>
        <p className={cn(bodyText, "max-w-2xl")}>
          Everyone waitlisted, in one order per domain across cycles. Drag to
          reorder.
        </p>
      </div>

      {cycleOptions.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <FilterPill
            os
            size="md"
            selected={!filtering}
            onClick={() => setCycleFilter("all")}
          >
            All cycles ({entries.length})
          </FilterPill>
          {cycleOptions.map((c) => (
            <FilterPill
              key={c.id}
              os
              size="md"
              selected={cycleFilter === c.id}
              onClick={() => setCycleFilter(c.id)}
            >
              {c.name} ({c.count})
            </FilterPill>
          ))}
        </div>
      )}

      {visibleDomains.length === 0 ? (
        <div className="rounded-os-card bg-os-card px-6 py-12 text-center text-base text-os-grey">
          No one is on a waitlist.
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {visibleDomains.map((group) => (
            <DomainSection
              key={group.domain.id}
              domain={group.domain}
              rows={group.rows}
              cycleFilter={filtering ? cycleFilter : null}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function DomainSection({
  domain,
  rows,
  cycleFilter,
}: {
  domain: WaitlistEntry["domain"];
  rows: WaitlistEntry[];
  /** Set when a cycle chip is active. Only that cycle's rows show, and
   *  reordering is off since the hidden rows share the same order. */
  cycleFilter: string | null;
}) {
  const { sectionShell, sectionTitle, panel } = useOsChrome();
  const reorderFetcher = useFetcher<{ error?: string }>();

  // Optimistic order while the save is in flight. Once the loader returns the
  // saved ranks, the server order takes over again.
  const serverOrder = rows.map((r) => `${r.domainApplicationId}:${r.rank}`).join(",");
  const [pending, setPending] = useState<string[] | null>(null);
  useEffect(() => setPending(null), [serverOrder, reorderFetcher.data]);

  const ordered = pending
    ? pending.map((id) => rows.find((r) => r.domainApplicationId === id)!).filter(Boolean)
    : rows;
  const tied = pending ? new Set<number>() : tiedRanks(rows.map((r) => r.rank));
  const tieCount = rows.filter((r) => tied.has(r.rank)).length;
  const shown = cycleFilter ? ordered.filter((r) => r.cycle.id === cycleFilter) : ordered;
  const canReorder = !cycleFilter && rows.length > 1;

  const saveOrder = (order: string[]) => {
    setPending(order);
    reorderFetcher.submit(
      { domainId: domain.id, order },
      { method: "post", action: "/api/hiring/waitlist/reorder", encType: "application/json" },
    );
  };

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over || active.id === over.id) return;
    const ids = ordered.map((r) => r.domainApplicationId);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from === -1 || to === -1) return;
    saveOrder(arrayMove(ids, from, to));
  };

  return (
    <section className={sectionShell}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h2 className={sectionTitle}>{domain.displayName ?? domain.name}</h2>
        <span className="text-sm text-os-grey tabular-nums">{rows.length} waitlisted</span>
      </header>

      {tieCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-os-item bg-os-amber/10 px-5 py-3 text-sm text-os-amber">
          <span>
            {tieCount} people share a spot.{" "}
            {cycleFilter ? "Show all cycles to set the order." : "Drag them into order."}
          </span>
          {canReorder && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => saveOrder(rows.map((r) => r.domainApplicationId))}
            >
              Keep this order
            </Button>
          )}
        </div>
      )}
      {reorderFetcher.data?.error && (
        <p className="text-sm text-accent-coral">{reorderFetcher.data.error}</p>
      )}

      <div className={cn(panel, "overflow-hidden")}>
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext
            items={shown.map((r) => r.domainApplicationId)}
            strategy={verticalListSortingStrategy}
          >
            <ul>
              {shown.map((r) => {
                const position = ordered.indexOf(r) + 1;
                return (
                  <WaitlistRow
                    key={r.domainApplicationId}
                    entry={r}
                    rank={pending ? position : r.rank}
                    tied={tied.has(r.rank)}
                    draggable={canReorder}
                  />
                );
              })}
            </ul>
          </SortableContext>
        </DndContext>
      </div>
    </section>
  );
}

function WaitlistRow({
  entry,
  rank,
  tied,
  draggable,
}: {
  entry: WaitlistEntry;
  rank: number;
  tied: boolean;
  draggable: boolean;
}) {
  const dialog = useDialog();
  const acceptFetcher = useFetcher<{ error?: string }>();
  const removeFetcher = useFetcher<{ error?: string }>();
  const busy = acceptFetcher.state !== "idle" || removeFetcher.state !== "idle";
  const error = acceptFetcher.data?.error ?? removeFetcher.data?.error ?? null;

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: entry.domainApplicationId,
    disabled: !draggable,
  });
  const style: CSSProperties = { transform: CSS.Transform.toString(transform), transition };

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
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-4 border-t border-os-container bg-os-card px-6 py-4 first:border-t-0 transition-colors hover:bg-os-card-hover",
        isDragging && "relative z-10 opacity-80 shadow-lg",
      )}
    >
      {draggable && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          aria-label={`Reorder ${fullName(entry)}`}
          className="-ml-2 cursor-grab touch-none select-none rounded-os-item p-1 text-os-muted hover:text-foreground active:cursor-grabbing dnd-touch-handle"
        >
          <GripVertical className="h-5 w-5" aria-hidden />
        </button>
      )}

      <RankBadge rank={rank} tied={tied} />

      <div className="min-w-0 flex-1">
        <Link
          to={`/hiring/applications/${entry.domainApplicationId}`}
          className="block truncate text-base font-medium text-foreground hover:text-os-accent"
        >
          {fullName(entry)}
        </Link>
        <div className="truncate text-sm text-os-grey">
          {entry.cycle.name} · Waitlisted{" "}
          {new Date(entry.waitlistedAt).toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
            year: "numeric",
          })}
        </div>
        {error && <div className="mt-1 text-sm text-accent-coral">{error}</div>}
      </div>

      <div className="flex shrink-0 items-center gap-1">
        <Tooltip content="Runs the full release: member promotion, account setup, and the acceptance email, even if the cycle is closed.">
          <Button size="sm" onClick={onAccept} disabled={busy}>
            <Check className="h-4 w-4" aria-hidden />
            Accept
          </Button>
        </Tooltip>
        <IconButton label="Remove" icon={X} tone="destructive" onClick={onRemove} disabled={busy} />
      </div>
    </li>
  );
}

function RankBadge({ rank, tied }: { rank: number; tied: boolean }) {
  const badge = (
    <span
      className={cn(
        "relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full font-heading text-lg font-semibold tabular-nums",
        tied ? "bg-os-amber/15 text-os-amber" : "bg-os-accent/15 text-os-accent",
      )}
    >
      {rank}
      {tied && (
        <span
          aria-hidden
          className="absolute -right-1 -top-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-os-amber text-xs font-bold text-os-bg"
        >
          !
        </span>
      )}
    </span>
  );
  if (!tied) return badge;
  return (
    <Tooltip content={`Shares #${rank} with someone else. Drag to set the order.`}>
      <span tabIndex={0} aria-label={`Rank ${rank}, tied`}>
        {badge}
      </span>
    </Tooltip>
  );
}
