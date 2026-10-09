// Core's landing page: the playbook for running a term. One tab per season, a
// column per week, and a card for each thing that has to happen that week.

import { useEffect, useState } from "react";
import { redirect, useFetcher, useFetchers, useSearchParams, useSubmit } from "react-router";
import type { DragEndEvent } from "@dnd-kit/core";
import { Pin, Plus, Trash2 } from "lucide-react";
import { z } from "zod";
import type { Route } from "./+types/core.hub";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { currentTerm, getActiveCoreCycleTermIds, isAdmin, isCore } from "~/lib/roles";
import { getOpenCycles } from "~/hiring/lib/cycles";
import { isCoreCycleEligible } from "~/hiring/lib/core-hiring.server";
import { parseForm } from "~/lib/validate";
import { fullName, SEASON_NAMES } from "~/lib/display";
import { cn } from "~/lib/cn";
import { coreHandle } from "~/core/coreNav";
import {
  ALL_LAB,
  LAST_MILESTONE_WEEK,
  MILESTONE_SEASONS,
  MILESTONE_WEEKS,
  dropOrder,
  matchesDomainFilter,
  termWeek,
  weekLabel,
  type MilestoneSeason,
} from "~/core/lib/milestones";
import { useOsChrome } from "~/components/os-chrome";
import { OsTabBar } from "~/components/os-page";
import { osRoleChipClass } from "~/components/DomainChips";
import {
  KanbanBoard,
  type KanbanCardRenderOpts,
  type KanbanColumn,
} from "~/components/board/KanbanBoard";
import { Modal, ModalFooter, ModalHeader } from "~/components/Modal";
import { IconButton } from "~/components/ui/IconButton";
import { MultiSelect, Select } from "~/components/ui/floating";
import { filterPillClass } from "~/components/ui/floating/styles";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";

export const handle = coreHandle("hub");

export const meta: Route.MetaFunction = () => [{ title: "Core · DALI OS" }];

async function requireCoreUser(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) return { response: redirectToLogin(request) } as const;
  if (!(await isCore(auth.user.sub, request))) return { response: redirect("/") } as const;
  return { userId: auth.user.sub } as const;
}

/** The people a milestone can be handed to: this cycle's Core. */
async function currentCoreIds(request: Request): Promise<string[]> {
  const termIds = await getActiveCoreCycleTermIds(request);
  const rows = await prisma.coreAssignment.findMany({
    where: { termId: { in: termIds } },
    select: { userId: true },
    distinct: ["userId"],
  });
  return rows.map((r) => r.userId);
}

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub, request))) {
    // Non-Core members don't get the Core hub. If a Lab members (Core) cycle
    // is open and they're eligible to apply, send them to the application (the
    // invite email links here at /core) instead of bouncing them home. The
    // portal offers a choice when several are open.
    const openCore = await getOpenCycles({ applicants: "LabMembers" });
    if (openCore.length > 0 && (await isCoreCycleEligible(auth.user.sub))) {
      return redirect("/core/apply");
    }
    return redirect("/");
  }

  // isAdmin doesn't depend on anything else here (just the viewer id), so it
  // joins this wave instead of being awaited inline in the return below.
  const [rows, domains, coreIds, term, admin] = await Promise.all([
    prisma.coreMilestone.findMany({
      orderBy: [{ position: "asc" }, { createdAt: "asc" }],
      select: {
        id: true,
        season: true,
        week: true,
        title: true,
        detail: true,
        position: true,
        pinned: true,
        owners: { select: { user: { select: { id: true, firstName: true, lastName: true } } } },
        domains: { select: { domainId: true } },
      },
    }),
    prisma.domain.findMany({
      where: { active: true, isSystem: false },
      select: { id: true, displayName: true },
      orderBy: { displayName: "asc" },
    }),
    currentCoreIds(request),
    currentTerm(request),
    isAdmin(auth.user.sub),
  ]);
  const current = term ? { season: term.season, week: termWeek(term.startDate, new Date()) } : null;

  const coreMembers = await prisma.user.findMany({
    where: { id: { in: coreIds } },
    select: { id: true, firstName: true, lastName: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  });

  return {
    isAdmin: admin,
    current,
    domains: domains.map((d) => ({ id: d.id, name: d.displayName })),
    coreMembers: coreMembers.map((u) => ({ id: u.id, name: fullName(u) })),
    milestones: rows.map((m) => ({
      id: m.id,
      season: m.season,
      week: m.week,
      title: m.title,
      detail: m.detail,
      position: m.position,
      pinned: m.pinned,
      owners: m.owners.map((o) => ({ id: o.user.id, name: fullName(o.user) })),
      domainIds: m.domains.map((d) => d.domainId),
    })),
  };
}

// parseForm reads one value per key, so id lists travel comma-joined.
const idList = z
  .string()
  .optional()
  .transform((v) => Array.from(new Set((v ?? "").split(",").filter(Boolean))));
const week = z.coerce.number().int().min(0).max(LAST_MILESTONE_WEEK);

const MilestoneFields = z.object({
  season: z.enum(MILESTONE_SEASONS),
  week,
  title: z.string().trim().min(1).max(120),
  detail: z.string().trim().max(1000).optional().transform((v) => v || null),
  ownerIds: idList,
  domainIds: idList,
});

const ActionSchema = z.discriminatedUnion("intent", [
  MilestoneFields.extend({ intent: z.literal("create") }),
  MilestoneFields.extend({ intent: z.literal("update"), id: z.string().min(1) }),
  // `order` is the destination column top to bottom, the moved card included.
  z.object({ intent: z.literal("move"), id: z.string().min(1), week, order: idList }),
  z.object({ intent: z.literal("pin"), id: z.string().min(1), pinned: z.enum(["true", "false"]) }),
  z.object({ intent: z.literal("delete"), id: z.string().min(1) }),
]);

/** Owners must be current Core and domains real ones. A milestone being edited
 *  keeps whoever and whatever it already has, so last year's owner or a retired
 *  domain doesn't block an unrelated edit. */
async function assigneeError(
  request: Request,
  body: { ownerIds: string[]; domainIds: string[] },
  existingId?: string,
): Promise<string | null> {
  const existing = existingId
    ? await prisma.coreMilestone.findUnique({
        where: { id: existingId },
        select: { owners: { select: { userId: true } }, domains: { select: { domainId: true } } },
      })
    : null;
  if (existingId && !existing) return "That milestone no longer exists.";

  const okOwners = new Set([
    ...(await currentCoreIds(request)),
    ...(existing?.owners.map((o) => o.userId) ?? []),
  ]);
  if (body.ownerIds.some((id) => !okOwners.has(id))) return "Owners must be on the current Core.";

  const okDomains = new Set([
    ...(
      await prisma.domain.findMany({
        where: { id: { in: body.domainIds }, active: true, isSystem: false },
        select: { id: true },
      })
    ).map((d) => d.id),
    ...(existing?.domains.map((d) => d.domainId) ?? []),
  ]);
  if (body.domainIds.some((id) => !okDomains.has(id))) return "Pick domains from the list.";
  return null;
}

export async function action({ request }: Route.ActionArgs) {
  const gate = await requireCoreUser(request);
  if ("response" in gate) throw gate.response;

  const body = await parseForm(request, ActionSchema);
  if (body instanceof Response) return body;

  switch (body.intent) {
    case "create": {
      const error = await assigneeError(request, body);
      if (error) return { error };
      const last = await prisma.coreMilestone.aggregate({
        where: { season: body.season, week: body.week },
        _max: { position: true },
      });
      await prisma.coreMilestone.create({
        data: {
          season: body.season,
          week: body.week,
          position: (last._max.position ?? -1) + 1,
          title: body.title,
          detail: body.detail,
          owners: { create: body.ownerIds.map((userId) => ({ userId })) },
          domains: { create: body.domainIds.map((domainId) => ({ domainId })) },
        },
      });
      return { ok: true };
    }
    case "update": {
      const error = await assigneeError(request, body, body.id);
      if (error) return { error };
      await prisma.coreMilestone.update({
        where: { id: body.id },
        data: {
          season: body.season,
          week: body.week,
          title: body.title,
          detail: body.detail,
          owners: { deleteMany: {}, create: body.ownerIds.map((userId) => ({ userId })) },
          domains: { deleteMany: {}, create: body.domainIds.map((domainId) => ({ domainId })) },
        },
      });
      return { ok: true };
    }
    case "move": {
      await prisma.$transaction([
        prisma.coreMilestone.updateMany({ where: { id: body.id }, data: { week: body.week } }),
        ...body.order.map((id, position) =>
          prisma.coreMilestone.updateMany({ where: { id }, data: { position } }),
        ),
      ]);
      return { ok: true };
    }
    case "pin": {
      await prisma.coreMilestone.updateMany({
        where: { id: body.id },
        data: { pinned: body.pinned === "true" },
      });
      return { ok: true };
    }
    case "delete": {
      await prisma.coreMilestone.deleteMany({ where: { id: body.id } });
      return { ok: true };
    }
  }
}

type LoaderData = Route.ComponentProps["loaderData"];
type Milestone = LoaderData["milestones"][number];
type Named = { id: string; name: string };
/** What the modal is open on: an existing milestone, or a new one in a week. */
type Editing = Milestone | { id: null; week: number };

const SEASON_TABS = MILESTONE_SEASONS.map((s) => ({ key: s, label: SEASON_NAMES[s]! }));
const columnId = (w: number) => `week-${w}`;

export default function CoreMilestones({ loaderData }: Route.ComponentProps) {
  const { milestones, domains, coreMembers, current } = loaderData;
  const chrome = useOsChrome();
  const [params, setParams] = useSearchParams();
  const [filter, setFilter] = useState<string[]>([]);
  const [editing, setEditing] = useState<Editing | null>(null);
  const submit = useSubmit();

  const termParam = params.get("term") as MilestoneSeason | null;
  const season =
    termParam && MILESTONE_SEASONS.includes(termParam) ? termParam : (current?.season ?? "F");

  // A drag or a pin shows at once, while its save is still in flight. Each
  // card saves on its own fetcher, so a second drag never cancels the first.
  const pendingWeek = new Map<string, number>();
  const pendingPosition = new Map<string, number>();
  const pendingPinned = new Map<string, boolean>();
  for (const f of useFetchers()) {
    const intent = f.formData?.get("intent");
    if (intent === "move") {
      pendingWeek.set(String(f.formData!.get("id")), Number(f.formData!.get("week")));
      String(f.formData!.get("order")).split(",").forEach((id, i) => pendingPosition.set(id, i));
    } else if (intent === "pin") {
      pendingPinned.set(String(f.formData!.get("id")), f.formData!.get("pinned") === "true");
    }
  }

  const domainName = new Map(domains.map((d) => [d.id, d.name]));
  // Array.sort is stable, so cards a drag hasn't touched keep the loader's order.
  const inSeason = milestones
    .filter((m) => m.season === season)
    .map((m) => ({
      ...m,
      week: pendingWeek.get(m.id) ?? m.week,
      position: pendingPosition.get(m.id) ?? m.position,
      pinned: pendingPinned.get(m.id) ?? m.pinned,
    }))
    .sort((x, y) => x.position - y.position);
  const visible = inSeason.filter((m) => matchesDomainFilter(m.domainIds, filter));

  const columns: KanbanColumn<Milestone>[] = MILESTONE_WEEKS.map((w) => {
    const cards = visible.filter((m) => m.week === w);
    return {
      id: columnId(w),
      title: weekLabel(w),
      // The current week is the one tinted column. Restates the board's column
      // shell, which `className` replaces rather than extends.
      className: cn(
        "flex w-full flex-shrink-0 flex-col rounded-os-item border border-transparent md:w-64",
        current?.season === season && current.week === w ? "bg-os-accent/15" : "bg-os-card",
      ),
      cards,
      listClassName:
        "flex flex-col gap-2 p-2 min-h-[360px] max-h-[calc(100vh-14rem)] overflow-y-auto",
      headerExtra: (
        <div className="flex shrink-0 items-center gap-1">
          <span className="text-xs text-muted-foreground">{cards.length}</span>
          <IconButton
            label={`Add to ${weekLabel(w).toLowerCase()}`}
            icon={Plus}
            onClick={() => setEditing({ id: null, week: w })}
          />
        </div>
      ),
    };
  });

  function handleDragEnd(event: DragEndEvent) {
    if (!event.over) return;
    const id = String(event.active.id);
    const overId = String(event.over.id);
    if (overId === id) return;
    // `over` is a column, or a card standing in for its column and a slot in it.
    const overCard = inSeason.find((m) => m.id === overId);
    const toWeek = overCard?.week ?? MILESTONE_WEEKS.find((w) => columnId(w) === overId);
    if (toWeek === undefined) return;
    // Ordered against the whole column, not just what the filter is showing,
    // so hidden cards keep their places.
    const column = inSeason.filter((m) => m.week === toWeek).map((m) => m.id);
    const order = dropOrder(column, id, overCard?.id ?? null);
    if (order.join() === column.join()) return;
    submit(
      { intent: "move", id, week: String(toWeek), order: order.join(",") },
      { method: "post", navigate: false, fetcherKey: `milestone-move-${id}` },
    );
  }

  function togglePin(m: Milestone) {
    submit(
      { intent: "pin", id: m.id, pinned: String(!m.pinned) },
      { method: "post", navigate: false, fetcherKey: `milestone-pin-${m.id}` },
    );
  }

  const renderCard = (
    m: Milestone,
    { isDragging = false, dragHandleProps = {} }: Partial<KanbanCardRenderOpts> = {},
  ) => (
    <div
      {...dragHandleProps}
      role="button"
      tabIndex={0}
      onClick={() => setEditing(m)}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setEditing(m);
        }
      }}
      className={cn(
        "flex cursor-grab select-none flex-col gap-2 rounded-os-item bg-os-well p-3 active:cursor-grabbing",
        // A ring, not a border: app.css sets border-color on `*` outside any
        // layer, which outranks every border-colour utility.
        m.pinned && "ring-2 ring-inset ring-os-accent",
        isDragging ? "opacity-40" : "hover:bg-os-container/60",
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <h3 className="min-w-0 text-sm font-medium text-foreground">{m.title}</h3>
        <IconButton
          label={m.pinned ? "Unpin" : "Pin"}
          icon={Pin}
          aria-pressed={m.pinned}
          className="-mr-1 -mt-1 shrink-0"
          iconClassName={cn("h-3.5 w-3.5", m.pinned && "fill-current text-os-accent")}
          onClick={(e) => {
            e.stopPropagation();
            togglePin(m);
          }}
        />
      </div>
      {m.detail && <p className="line-clamp-3 whitespace-pre-line text-xs text-os-grey">{m.detail}</p>}
      <div className="flex flex-wrap gap-1">
        {m.domainIds.length === 0 ? (
          <span className={cn(CHIP, "bg-os-container text-os-grey")}>All lab</span>
        ) : (
          m.domainIds.map((id) => {
            const name = domainName.get(id);
            return name ? (
              <span key={id} className={cn(CHIP, osRoleChipClass(name))}>
                {name}
              </span>
            ) : null;
          })
        )}
      </div>
      <p className="text-xs text-os-grey">
        {m.owners.length > 0 ? m.owners.map((o) => o.name).join(", ") : "No owner"}
      </p>
    </div>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className={chrome.pageTitle}>Milestones</h1>
        </div>
        <button
          type="button"
          className="os-add-btn"
          onClick={() => setEditing({ id: null, week: current?.season === season ? current.week : 1 })}
        >
          <Plus className="h-4 w-4" aria-hidden />
          Add milestone
        </button>
      </div>

      <OsTabBar
        ariaLabel="Term"
        tabs={SEASON_TABS}
        active={season}
        onSelect={(key) => setParams({ term: key }, { replace: true })}
      />

      <div className="w-full sm:w-64">
        <MultiSelect
          values={filter}
          options={[
            { value: ALL_LAB, label: "All lab" },
            ...domains.map((d) => ({ value: d.id, label: d.name })),
          ]}
          onChange={setFilter}
          ariaLabel="Filter by domain"
          placeholder="All domains"
          buttonClassName={cn(filterPillClass(), "w-full")}
        />
      </div>

      <KanbanBoard<Milestone>
        id="core-milestones-board"
        columns={columns}
        getCardId={(m) => m.id}
        getCardData={(m) => ({ week: m.week })}
        draggable
        sortable
        onDragEnd={handleDragEnd}
        emptyLabel="Nothing yet"
        renderCard={renderCard}
        // The floating copy: a column scrolls, so a card dragged in place would
        // be clipped at its column's edge.
        renderOverlay={(activeId) => {
          const m = visible.find((x) => x.id === activeId);
          return m ? renderCard(m) : null;
        }}
      />

      <Modal open={editing !== null} onClose={() => setEditing(null)} labelledBy="milestone-modal-title">
        {editing && (
          <MilestoneForm
            key={editing.id ?? `new-${editing.week}`}
            editing={editing}
            season={season}
            domains={domains}
            coreMembers={coreMembers}
            onClose={() => setEditing(null)}
          />
        )}
      </Modal>
    </div>
  );
}

const CHIP = "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold";

function MilestoneForm({
  editing,
  season: boardSeason,
  domains,
  coreMembers,
  onClose,
}: {
  editing: Editing;
  season: MilestoneSeason;
  domains: Named[];
  coreMembers: Named[];
  onClose: () => void;
}) {
  const chrome = useOsChrome();
  const dialog = useDialog();
  const toast = useToast();
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const existing = editing.id !== null ? editing : null;
  const busy = fetcher.state !== "idle";

  const [season, setSeason] = useState<MilestoneSeason>(existing?.season ?? boardSeason);
  const [week, setWeek] = useState(String(editing.week));
  const [ownerIds, setOwnerIds] = useState(existing?.owners.map((o) => o.id) ?? []);
  const [domainIds, setDomainIds] = useState(existing?.domainIds ?? []);

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.error) toast.error(fetcher.data.error);
    else if (fetcher.data.ok) onClose();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state, fetcher.data]);

  // An owner from an earlier Core stays on the list so they can be seen and removed.
  const ownerOptions = [
    ...coreMembers,
    ...(existing?.owners.filter((o) => !coreMembers.some((c) => c.id === o.id)) ?? []),
  ].map((u) => ({ value: u.id, label: u.name }));

  const remove = async () => {
    if (!existing) return;
    const ok = await dialog.confirm({
      title: `Delete ${existing.title}?`,
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (ok) fetcher.submit({ intent: "delete", id: existing.id }, { method: "post" });
  };

  return (
    <>
      <ModalHeader
        titleId="milestone-modal-title"
        title={existing ? "Edit milestone" : "Add milestone"}
        onClose={onClose}
        actions={
          existing && (
            <IconButton label="Delete milestone" icon={Trash2} tone="destructive" onClick={remove} />
          )
        }
      />
      <fetcher.Form method="post" className={`${chrome.formClass} flex flex-col gap-5`}>
        <input type="hidden" name="intent" value={existing ? "update" : "create"} />
        {existing && <input type="hidden" name="id" value={existing.id} />}
        <input type="hidden" name="season" value={season} />
        <input type="hidden" name="week" value={week} />
        <input type="hidden" name="ownerIds" value={ownerIds.join(",")} />
        <input type="hidden" name="domainIds" value={domainIds.join(",")} />

        <label className="os-field-group">
          <span>Title</span>
          <input
            type="text"
            name="title"
            required
            maxLength={120}
            placeholder="Applications open"
            defaultValue={existing?.title ?? ""}
          />
        </label>
        <label className="os-field-group">
          <span>Details</span>
          <textarea name="detail" rows={3} maxLength={1000} defaultValue={existing?.detail ?? ""} />
        </label>

        <div className="grid grid-cols-2 gap-4">
          <div className="os-field-group">
            <span className="os-field-label">Term</span>
            <Select
              value={season}
              options={SEASON_TABS.map((t) => ({ value: t.key, label: t.label }))}
              onChange={setSeason}
              ariaLabel="Term"
              buttonClassName={chrome.formTrigger}
            />
          </div>
          <div className="os-field-group">
            <span className="os-field-label">Week</span>
            <Select
              value={week}
              options={MILESTONE_WEEKS.map((w) => ({ value: String(w), label: weekLabel(w) }))}
              onChange={setWeek}
              ariaLabel="Week"
              buttonClassName={chrome.formTrigger}
            />
          </div>
        </div>

        <div className="os-field-group">
          <span className="os-field-label">Owners</span>
          <MultiSelect
            values={ownerIds}
            options={ownerOptions}
            onChange={setOwnerIds}
            ariaLabel="Owners"
            placeholder="No owner"
            emptyLabel="No one is on Core this cycle"
            buttonClassName={chrome.formTrigger}
          />
        </div>
        <div className="os-field-group">
          <span className="os-field-label">Domains</span>
          <MultiSelect
            values={domainIds}
            options={domains.map((d) => ({ value: d.id, label: d.name }))}
            onChange={setDomainIds}
            ariaLabel="Domains"
            placeholder="All lab"
            buttonClassName={chrome.formTrigger}
          />
        </div>

        <ModalFooter onCancel={onClose}>
          <button type="submit" className="os-btn-primary" disabled={busy}>
            {existing ? "Save" : "Add milestone"}
          </button>
        </ModalFooter>
      </fetcher.Form>
    </>
  );
}
