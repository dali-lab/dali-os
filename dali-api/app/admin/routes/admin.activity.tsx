import { Form, Link, redirect, useLoaderData } from "react-router";
import { useMemo, useState } from "react";
import type { Route } from "./+types/admin.activity";
import { AdminSectionHeader, adminHandle } from "~/admin/adminNav";
import { prisma } from "~/lib/db.server";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore, isAdmin } from "~/lib/roles";
import { cn } from "~/lib/cn";
import { AUDIT_ACTIONS, AUDIT_AREAS, auditAreaOf } from "~/lib/audit-actions";
import { resolveAuditTargets, type ResolvedTarget } from "~/lib/audit-targets";
import {
  APPLICATION_TZ,
  APPLICATION_TZ_LABEL,
  formatInTimeZone,
  getZonedYMD,
  zonedDayLabel,
} from "~/lib/timezone";
import {
  parseAuditFilters,
  buildAuditWhere,
  resolveAuditTextFilters,
  activeFilterParams,
  hasAnyFilter,
} from "~/lib/audit-query";
import { ChevronLeft, ChevronRight, X, ChevronDown, ChevronUp } from "lucide-react";
import { Tooltip, InfoTip, Select, Combobox } from "~/components/ui/floating";
import { OS_SELECT_TRIGGER_CLASS } from "~/components/ui/floating/styles";
import { SearchInput } from "~/components/ui/SearchInput";
import { Toggle } from "~/components/ui/Toggle";
import { DateField } from "~/components/ui/DateField";
import { useOsChrome } from "~/components/os-chrome";
import { EmptyState, Pill, type Tone } from "~/admin/components/console-ui";
import {
  AuditActorAvatar,
  AuditActorName,
  ShortId,
  auditPersonName,
  type AuditPerson,
} from "~/admin/components/AuditActor";
import { loadPeopleById } from "~/admin/lib/people.server";

export const handle = adminHandle("audit-log");

export const meta: Route.MetaFunction = () => [{ title: "Audit log · Admin · DALI OS" }];

const PAGE_SIZE = 50;

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) return redirect("/");

  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page") ?? "1") || 1);
  const skip = (page - 1) * PAGE_SIZE;
  const filters = parseAuditFilters(url.searchParams, { hideMcpReads: true });
  const baseWhere = buildAuditWhere(filters);
  const textPatch = await resolveAuditTextFilters(prisma, filters);
  const where = { ...baseWhere, ...textPatch };

  // One extra row detects a next page; count() over a large AuditLog is expensive.
  const rows = await prisma.auditLog.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    skip,
  });

  const hasNext = rows.length > PAGE_SIZE;
  const entries = rows.slice(0, PAGE_SIZE);

  const ids = new Set<string>();
  for (const e of entries) {
    if (e.userId) ids.add(e.userId);
    if (e.targetId) ids.add(e.targetId);
  }
  const userById = await loadPeopleById(prisma, ids);

  const resolvedTargets = await resolveAuditTargets(
    prisma,
    entries.filter((e) => e.targetId && !userById.has(e.targetId)),
  );

  const admin = await isAdmin(auth.user.sub);
  return {
    now: new Date().toISOString(),
    page,
    hasNext,
    filters,
    anyFilter: hasAnyFilter(filters),
    actions: AUDIT_ACTIONS,
    areas: AUDIT_AREAS,
    isAdmin: admin,
    entries: entries.map((e) => ({
      id: e.id,
      createdAt: e.createdAt.toISOString(),
      action: e.action,
      actor: e.userId ? (userById.get(e.userId) ?? null) : null,
      actorId: e.userId,
      target: e.targetId ? (userById.get(e.targetId) ?? null) : null,
      resolvedTarget: e.targetId ? (resolvedTargets.get(e.targetId) ?? null) : null,
      targetId: e.targetId,
      metadata: e.metadata,
      ip: e.ip,
    })),
  };
}


// A missing userId means an unauthenticated request (token validation failure,
// etc.), and "system" is the meaningful label.
function displayTarget(
  u: AuditPerson | null,
  resolved: ResolvedTarget | null,
  targetId: string | null,
) {
  if (u) return <span className="text-foreground">{auditPersonName(u)}</span>;
  if (resolved?.href) {
    return (
      <Link to={resolved.href} className="text-foreground hover:text-os-accent hover:underline">
        {resolved.label}
      </Link>
    );
  }
  if (resolved) return <span className="text-foreground">{resolved.label}</span>;
  return targetId ? <ShortId id={targetId} /> : <span className="text-os-muted">—</span>;
}

// Maps an audit action string to a status tone by keyword.
function toneForAction(action: string): Tone {
  const a = action.toLowerCase();
  if (/delete|remove|archive|cancel|revoke|disable/.test(a)) return "bad";
  if (/grant|create|add|accept|enable|promote/.test(a)) return "ok";
  if (/update|edit|toggle|flag|set|config/.test(a)) return "warn";
  return "idle";
}

function groupByDay<T extends { createdAt: string }>(
  entries: T[],
  now: Date,
): Array<{ dayKey: string; label: string; items: T[] }> {
  const groups: Array<{ dayKey: string; label: string; items: T[] }> = [];
  const seen = new Map<string, number>();
  for (const e of entries) {
    const { year, month, day } = getZonedYMD(new Date(e.createdAt), APPLICATION_TZ);
    const key = `${year}-${month}-${day}`;
    if (!seen.has(key)) {
      seen.set(key, groups.length);
      groups.push({
        dayKey: key,
        label: zonedDayLabel(e.createdAt, now, APPLICATION_TZ, {
          month: "short",
          day: "numeric",
          year: "numeric",
        }),
        items: [],
      });
    }
    groups[seen.get(key)!].items.push(e);
  }
  return groups;
}

type EntryRow = ReturnType<typeof useLoaderData<typeof loader>>["entries"][number];

function TimelineEntry({ e, areaLabel }: { e: EntryRow; areaLabel: string }) {
  const { iconBtn } = useOsChrome();
  const [open, setOpen] = useState(false);
  const hasDetail = !!(e.metadata || e.ip);
  const time = formatInTimeZone(e.createdAt, APPLICATION_TZ, {
    hour: "numeric",
    minute: "2-digit",
  });

  return (
    <li>
      <div className="flex items-center gap-3 rounded-os-item px-4 py-3 transition-colors hover:bg-os-card-hover">
        <AuditActorAvatar actor={e.actor} actorId={e.actorId} />
        <p className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 text-sm text-os-grey">
          <AuditActorName actor={e.actor} actorId={e.actorId} />
          <span className="rounded bg-os-container/70 px-1.5 py-0.5 font-mono text-[11px] text-foreground">
            {e.action}
          </span>
          {(e.target || e.targetId) && (
            <span className="flex min-w-0 items-center gap-1">
              <span className="text-os-muted">→</span>
              {displayTarget(e.target, e.resolvedTarget, e.targetId)}
            </span>
          )}
        </p>
        <span className="hidden sm:block">
          <Pill tone={toneForAction(e.action)}>{areaLabel}</Pill>
        </span>
        <time
          dateTime={e.createdAt}
          className="w-16 shrink-0 text-right text-xs tabular-nums text-os-muted"
        >
          {time}
        </time>
        {hasDetail ? (
          <Tooltip content={open ? "Hide details" : "Show details"}>
            <button
              type="button"
              aria-label={open ? "Collapse details" : "Expand details"}
              aria-expanded={open}
              onClick={() => setOpen((v) => !v)}
              className={cn(iconBtn, "shrink-0")}
            >
              {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </button>
          </Tooltip>
        ) : (
          <span className="w-7 shrink-0" aria-hidden />
        )}
      </div>
      {open && hasDetail && (
        <div className="mb-2 ml-[60px] mr-4 space-y-2 rounded-os-item bg-os-well p-3">
          {e.metadata && (
            <pre className="whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-os-grey">
              {JSON.stringify(e.metadata, null, 2)}
            </pre>
          )}
          {e.ip && <p className="font-mono text-[11px] text-os-muted">IP: {e.ip}</p>}
        </div>
      )}
    </li>
  );
}

export default function AdminConsoleActivity() {
  const { page, hasNext, filters, anyFilter, actions, areas, entries, now } =
    useLoaderData<typeof loader>();
  const { panel, actionBtn, actionBtnPrimary, iconBtn } = useOsChrome();
  const [action, setAction] = useState<string>(filters.action ?? "");
  const actionOptions = useMemo(
    () => [{ value: "", label: "All actions" }, ...actions.map((a) => ({ value: a, label: a }))],
    [actions],
  );
  const areaOptions = useMemo(() => [{ value: "", label: "All areas" }, ...areas], [areas]);
  const areaLabelOf = useMemo(() => new Map(areas.map((a) => [a.value, a.label])), [areas]);

  function pageHref(nextPage: number): string {
    const params = activeFilterParams(filters);
    if (nextPage > 1) params.set("page", String(nextPage));
    const qs = params.toString();
    return qs ? `?${qs}` : "?";
  }

  const groups = groupByDay(entries, new Date(now));
  const label = "flex flex-col gap-1.5 text-xs font-semibold text-os-muted";

  return (
    <div className="flex flex-col gap-6">
      <AdminSectionHeader section="insights" />

      <Form method="get" className={cn(panel, "flex flex-col gap-4 p-5")}>
        <div className="grid gap-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className={label}>
            <span className="inline-flex items-center gap-1">
              Person
              <InfoTip content="Matches as actor or target. Returns events where this person did something or had something done to them. An IP address matches requests from it; a partial one like 129.170 matches the range." />
            </span>
            <SearchInput
              size="sm"
              name="person"
              defaultValue={filters.person ?? ""}
              placeholder="Name, email, id, or IP"
              aria-label="Person or IP"
            />
          </div>
          <div className={label}>
            Area
            <Select name="area" defaultValue={filters.area ?? ""} options={areaOptions} ariaLabel="Area" />
          </div>
          <div className={label}>
            Action
            <Combobox
              value={action}
              options={actionOptions}
              onChange={setAction}
              ariaLabel="Action"
              placeholder="All actions"
              className={cn(OS_SELECT_TRIGGER_CLASS, "w-full")}
            />
            <input type="hidden" name="action" value={action} />
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className={label}>
            From
            <DateField mode="date" name="from" defaultValue={filters.from ?? ""} ariaLabel="From date" />
          </label>
          <label className={label}>
            To
            <DateField mode="date" name="to" defaultValue={filters.to ?? ""} ariaLabel="To date" />
          </label>
          <div className="pb-1.5">
            <Toggle
              tone="os"
              name="mcpReads"
              value="1"
              defaultChecked={filters.mcpReads}
              label="Include MCP reads"
            />
          </div>
          <span className="flex-1" />
          {anyFilter && (
            <Link to="?" className={actionBtn()}>
              <X className="h-4 w-4" />
              Clear filters
            </Link>
          )}
          <button type="submit" className={actionBtnPrimary}>
            Apply
          </button>
        </div>
      </Form>

      <div className="flex items-center gap-3 px-1 text-xs text-os-muted">
        <Pill>Page {page}</Pill>
        <span>Times in {APPLICATION_TZ_LABEL}</span>
      </div>

      {entries.length === 0 ? (
        <div className={panel}>
          <EmptyState>
            {anyFilter ? "No activity matches these filters." : "No activity on this page."}
          </EmptyState>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map(({ dayKey, label: dayLabel, items }) => (
            <section key={dayKey} className="flex flex-col gap-2" aria-label={dayLabel}>
              <h2 className="px-1 text-sm font-semibold text-os-grey">{dayLabel}</h2>
              <ol className={cn(panel, "p-2")}>
                {items.map((e) => {
                  const area = auditAreaOf(e.action);
                  return <TimelineEntry key={e.id} e={e} areaLabel={areaLabelOf.get(area) ?? area} />;
                })}
              </ol>
            </section>
          ))}
        </div>
      )}

      <nav className="flex items-center justify-between" aria-label="Audit log pagination">
        {page > 1 ? (
          <Tooltip content="Previous">
            <Link
              to={pageHref(page - 1)}
              prefetch="render"
              aria-label="Previous"
              className={cn(iconBtn, "border border-os-container")}
            >
              <ChevronLeft className="h-4 w-4" />
            </Link>
          </Tooltip>
        ) : (
          <span />
        )}
        {hasNext ? (
          <Tooltip content="Next">
            <Link
              to={pageHref(page + 1)}
              prefetch="render"
              aria-label="Next"
              className={cn(iconBtn, "border border-os-container")}
            >
              <ChevronRight className="h-4 w-4" />
            </Link>
          </Tooltip>
        ) : (
          <span className="text-xs text-os-muted">End of log</span>
        )}
      </nav>
    </div>
  );
}
