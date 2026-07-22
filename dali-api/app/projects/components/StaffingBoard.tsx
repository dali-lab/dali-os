import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRevalidator } from "react-router";
import type { DragEndEvent } from "@dnd-kit/core";
import { KanbanBoard, type KanbanColumn } from "~/components/board/KanbanBoard";
import {
  buildBoard,
  resolveAssignmentInputs,
  UNASSIGNED,
  type MemberCardModel,
  type MemberInput,
  type Assignment,
  type Preference,
} from "../lib/staffing-board";
import { CheckCircle2, UserPlus } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { MemberCard, MemberCardPreview } from "./MemberCard";
import { RoleBadge } from "./RoleBadge";
import { BidModal } from "./BidModal";
import { FinalizeModal } from "./FinalizeModal";
import { AddMemberControl } from "./AddMemberControl";
import { AddExternalMentorModal } from "./AddExternalMentorModal";
import { DomainFilter } from "./DomainFilter";
import { sanitizeChannelName } from "~/slack/lib/channel-name";
import type { Level } from "~/lib/level";
import type { DomainLevel } from "../lib/staffing-board";

type ProjectMeta = {
  id: string;
  name: string;
  status: "Active" | "Paused" | "Archived";
  // Pre-fill the Finalize modal's editable fields (shared with the project page).
  githubTeamSlug?: string | null;
  slackChannelName?: string | null;
};

// Expected headcount per (project, domain) for this term — already summed
// across levels and sorted by domain name in the loader. Keyed by projectId.
// Absent / empty entries render as no demand chips (a project with no
// ProjectRoleRequest rows this term).
export type DomainDemand = { domainId: string; domainName: string; slots: number };

type Props = {
  cycleId: string;
  termId: string;
  terms: { id: string; code: string }[];
  // Domain filter: all domains for the dropdown, plus the currently-selected id
  // ("" = all). Selecting one narrows the board to members eligible in (or
  // already bid/staffed in) that domain. Driven server-side via ?domain=.
  domains: { id: string; name: string }[];
  selectedDomainId: string;
  projects: ProjectMeta[];
  members: MemberInput[];
  initialAssignments: Assignment[];
  // Manual within-column card order rows from the server (userId, columnKey,
  // sortKey). buildBoard applies one only when columnKey matches the card's
  // current column. Cards without a row sort by last name.
  cardOrder: { userId: string; columnKey: string; sortKey: number }[];
  // Project id → name for label resolution. Covers archived projects a member
  // ranked that aren't board columns, so cards/modal never show a raw id.
  projectNames: Record<string, string>;
  domainNames: Record<string, string>;
  demandByProject: Record<string, DomainDemand[]>;
  /** Staffing leads can drag. Members get a read-only board. */
  canManage: boolean;
};

export function StaffingBoard({
  cycleId,
  termId,
  terms,
  domains,
  selectedDomainId,
  projects,
  members,
  initialAssignments,
  cardOrder,
  projectNames,
  domainNames,
  demandByProject,
  canManage,
}: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const revalidator = useRevalidator();
  const [assignments, setAssignments] = useState<Assignment[]>(initialAssignments);
  // Optimistic copy of the server card order; drag updates it immediately and
  // the persist+revalidate reconciles. Same lifecycle as `assignments`.
  const [order, setOrder] = useState(cardOrder);
  const [error, setError] = useState<string | null>(null);
  const [openBidUserId, setOpenBidUserId] = useState<string | null>(null);
  // Project id whose finalize modal is open, or null.
  const [finalizeProjectId, setFinalizeProjectId] = useState<string | null>(null);

  // Per-card mentor/mentee role overrides for this cycle (userId → isMentor).
  // A member's role defaults to their level (P3 → mentor); an override flips it.
  // Refetched whenever the board revalidates. Managers only.
  const [mentorRoles, setMentorRoles] = useState<Record<string, boolean>>({});
  const loadMentorRoles = useCallback(() => {
    if (!canManage) return;
    fetch(`/api/staffing/mentor-role?cycleId=${encodeURIComponent(cycleId)}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setMentorRoles(d.overrides ?? {}))
      .catch(() => {});
  }, [cycleId, canManage]);
  useEffect(() => loadMentorRoles(), [loadMentorRoles]);
  // Held in a ref so the once-mounted SSE listener always calls the latest.
  const loadMentorRolesRef = useRef(loadMentorRoles);
  loadMentorRolesRef.current = loadMentorRoles;

  // Toggle a card's role. Optimistic, then refetch to reconcile.
  const toggleMentorRole = useCallback(
    async (userId: string, next: boolean) => {
      setMentorRoles((prev) => ({ ...prev, [userId]: next }));
      try {
        await fetch(`/api/staffing/mentor-role`, {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cycleId, userId, isMentor: next }),
        });
      } finally {
        loadMentorRolesRef.current();
      }
    },
    [cycleId],
  );

  // Per-member DomainEligibility chips shown on cards. Optimistic local copy
  // so level/domain edits feel instant; revalidation reconciles from the loader.
  const [domainLevelsByUser, setDomainLevelsByUser] = useState<
    Record<string, DomainLevel[]>
  >(() => Object.fromEntries(members.map((m) => [m.userId, m.domainLevels])));
  useEffect(() => {
    setDomainLevelsByUser(
      Object.fromEntries(members.map((m) => [m.userId, m.domainLevels])),
    );
  }, [members]);

  const membersForBoard = useMemo(
    () =>
      members.map((m) => ({
        ...m,
        domainLevels: domainLevelsByUser[m.userId] ?? m.domainLevels,
      })),
    [members, domainLevelsByUser],
  );

  const upsertDomainLevel = useCallback(
    async (userId: string, domainId: string, level: Level, domainName: string) => {
      const prev = domainLevelsByUser[userId] ?? [];
      const next: DomainLevel[] = prev.some((d) => d.domainId === domainId)
        ? prev.map((d) => (d.domainId === domainId ? { ...d, level } : d))
        : [...prev, { domainId, domainName, level }];
      setDomainLevelsByUser((map) => ({ ...map, [userId]: next }));

      // Keep live assignment level in sync when editing the assigned domain.
      const assignment = assignments.find((a) => a.userId === userId);
      const prevAssignments = assignments;
      if (assignment && assignment.domainId === domainId && assignment.level !== level) {
        setAssignments((list) =>
          list.map((a) => (a.userId === userId ? { ...a, level } : a)),
        );
      }

      setError(null);
      try {
        const res = await fetch("/api/staffing/eligibility", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cycleId, userId, domainId, level }),
        });
        if (!res.ok) {
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(json.error ?? `Failed: ${res.status}`);
        }
        revalidator.revalidate();
      } catch (err) {
        setDomainLevelsByUser((map) => ({ ...map, [userId]: prev }));
        setAssignments(prevAssignments);
        setError(err instanceof Error ? err.message : "Failed to update domain");
      }
    },
    [assignments, cycleId, domainLevelsByUser, revalidator],
  );

  // Non-roster external mentors placed on project columns. Managers only.
  type ExternalMentorRow = {
    id: string;
    projectId: string;
    domainId: string;
    userId: string;
    firstName: string;
    lastName: string;
  };
  const [externalMentors, setExternalMentors] = useState<ExternalMentorRow[]>([]);
  const loadExternalMentors = useCallback(() => {
    if (!canManage) return;
    fetch(`/api/staffing/external-mentor?cycleId=${encodeURIComponent(cycleId)}`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setExternalMentors(d.externalMentors ?? []))
      .catch(() => {});
  }, [cycleId, canManage]);
  useEffect(() => loadExternalMentors(), [loadExternalMentors]);
  const loadExternalMentorsRef = useRef(loadExternalMentors);
  loadExternalMentorsRef.current = loadExternalMentors;

  const removeExternalMentor = useCallback(async (id: string) => {
    setExternalMentors((prev) => prev.filter((e) => e.id !== id));
    try {
      await fetch(`/api/staffing/external-mentor?id=${encodeURIComponent(id)}`, {
        method: "DELETE",
        credentials: "include",
      });
    } finally {
      loadExternalMentorsRef.current();
    }
  }, []);

  // Project id whose "add external mentor" modal is open, or null.
  const [externalMentorProjectId, setExternalMentorProjectId] = useState<string | null>(null);

  // Number of drag saves currently in flight. While > 0 we hold off adopting
  // server data so a live push from someone else can't revert our own unsaved
  // optimistic move mid-drag. Once our save lands it revalidates and this clears.
  const pendingSaves = useRef(0);

  // Local `assignments` is the optimistic source of truth during a drag. When a
  // revalidation lands (our own save, or a live push from another lead), the
  // loader hands back fresh `initialAssignments` — adopt it so other people's
  // edits actually appear. Keyed off the prop's identity: React Router gives a
  // new array each loader run, so this only fires when server data changes.
  useEffect(() => {
    if (pendingSaves.current > 0) return;
    setAssignments(initialAssignments);
    setOrder(cardOrder);
  }, [initialAssignments, cardOrder]);

  // Live updates: subscribe to this cycle's SSE stream and revalidate on any
  // pushed change (assign / finalize / board-member by anyone) or periodic sync.
  // EventSource auto-reconnects, so a dropped connection self-heals. The bus is
  // per-instance (see staffing-events.server.ts); the `sync` heartbeat is the
  // cross-instance backstop.
  const revalidate = revalidator.revalidate;
  const revalidateRef = useRef(revalidate);
  revalidateRef.current = revalidate;
  useEffect(() => {
    const es = new EventSource(
      `/api/staffing/events?cycleId=${encodeURIComponent(cycleId)}`,
      { withCredentials: true },
    );
    const onPush = () => {
      revalidateRef.current();
      loadMentorRolesRef.current();
      loadExternalMentorsRef.current();
    };
    es.addEventListener("change", onPush);
    es.addEventListener("sync", onPush);
    return () => es.close();
  }, [cycleId]);

  const projectIds = useMemo(() => projects.map((p) => p.id), [projects]);

  const board = useMemo(
    () => buildBoard({ projectIds, members: membersForBoard, assignments, cardOrder: order }),
    [projectIds, membersForBoard, assignments, order],
  );

  const memberById = useMemo(
    () => new Map(membersForBoard.map((m) => [m.userId, m])),
    [membersForBoard],
  );

  // Flat userId → card lookup so the DragOverlay can render the active card
  // without knowing which column it came from.
  const cardByUserId = useMemo(() => {
    const map = new Map<string, MemberCardModel>();
    for (const cards of Object.values(board)) {
      for (const c of cards) map.set(c.userId, c);
    }
    return map;
  }, [board]);

  // userId → its current column key. The card's `data.fromColumn` (which the
  // drag handler reads to know where a card came from) used to live on each
  // MemberCard via columnId; now it's derived once from the built board.
  const columnIdOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const [columnKey, cards] of Object.entries(board)) {
      for (const c of cards) map.set(c.userId, columnKey);
    }
    return map;
  }, [board]);

  // Synthetic cards for external mentors, grouped by project column. They render
  // like distinct cards but aren't in `board`/`members`, so the drag handler
  // (keyed off memberById) naturally ignores them.
  const externalCardsByProject = useMemo(() => {
    const map = new Map<string, MemberCardModel[]>();
    for (const e of externalMentors) {
      const list = map.get(e.projectId) ?? [];
      list.push({
        userId: e.userId,
        firstName: e.firstName,
        lastName: e.lastName,
        email: null,
        photoUrl: null,
        isAdmin: false,
        coreTitles: [],
        domainLevels: [
          { domainId: e.domainId, domainName: domainNames[e.domainId] ?? "?", level: "P3" },
        ],
        level: "P3",
        topPreferences: [],
        unresolvedBid: false,
        manuallyAdded: false,
        isExternalMentor: true,
        externalMentorId: e.id,
      });
      map.set(e.projectId, list);
    }
    return map;
  }, [externalMentors, domainNames]);

  // userId → project column for external mentors, so a real card dropped onto an
  // external card resolves to that external's column (drop-at-end).
  const externalProjectByUser = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of externalMentors) map.set(e.userId, e.projectId);
    return map;
  }, [externalMentors]);

  function handleDragEnd(event: DragEndEvent) {
    if (!canManage) return;
    const overId = event.over?.id;
    if (!overId || typeof overId !== "string") return;
    const data = event.active.data.current as { userId?: string; fromColumn?: string } | undefined;
    const userId = data?.userId;
    const fromColumn = data?.fromColumn ?? UNASSIGNED;
    if (!userId) return;

    const member = memberById.get(userId);
    if (!member) return;

    // Resolve the target column + insertion index. `over` is either a card
    // (its userId — drop relative to it) or a column droppable (its id — drop
    // at the end). Column ids are UNASSIGNED or a project id; everything else
    // is a card userId.
    const isColumnId = overId === UNASSIGNED || projectIds.includes(overId);
    // Dropping onto an external-mentor card targets that mentor's column at the
    // end (external cards render after the roster and aren't reorderable).
    const overIsExternal = externalProjectByUser.has(overId);
    const toColumn = isColumnId
      ? overId
      : overIsExternal
        ? externalProjectByUser.get(overId)!
        : findColumnOf(board, overId) ?? fromColumn;
    const targetIds = (board[toColumn] ?? []).map((c) => c.userId);
    const overIndex = isColumnId || overIsExternal ? targetIds.length : targetIds.indexOf(overId);
    const movedWithinColumn = fromColumn === toColumn;

    // No-op: dropped on itself, or back where it already was.
    if (movedWithinColumn) {
      const fromIndex = targetIds.indexOf(userId);
      if (fromIndex === overIndex || (overIndex === -1)) return;
    }

    // Build the new ordered userId list for the destination column.
    const withoutMoved = targetIds.filter((id) => id !== userId);
    const insertAt = overIndex < 0 ? withoutMoved.length : Math.min(overIndex, withoutMoved.length);
    const nextDestIds = [
      ...withoutMoved.slice(0, insertAt),
      userId,
      ...withoutMoved.slice(insertAt),
    ];

    // A cross-column move also needs the assignment updated. Resolve domain +
    // level for a project column; UNASSIGNED clears the assignment.
    const targetProjectId = toColumn === UNASSIGNED ? null : toColumn;
    let assignmentBody: { domainId: string; level: "P1" | "P2" | "P3" } | null = null;
    if (!movedWithinColumn && targetProjectId !== null) {
      assignmentBody = resolveAssignmentInputs(member, targetProjectId);
      if (!assignmentBody) {
        setError(
          `Can't infer a domain + level for ${member.firstName} ${member.lastName}: they have no bid and ${
            member.domainLevels.length === 0
              ? "no domain eligibility"
              : "are eligible in multiple domains"
          }. Add a bid, or set their eligibility to a single domain.`,
        );
        return;
      }
    }

    const prevAssignments = assignments;
    const prevOrder = order;

    // Optimistic assignment update (only when the column changed).
    if (!movedWithinColumn) {
      const withoutOld = assignments.filter((a) => a.userId !== userId);
      setAssignments(
        targetProjectId === null
          ? withoutOld
          : [
              ...withoutOld,
              { userId, projectId: targetProjectId, domainId: assignmentBody!.domainId, level: assignmentBody!.level },
            ],
      );
    }

    // Optimistic order update for the destination column. Other users' rows are
    // preserved; the moved card and its new neighbours get fresh indices.
    setOrder((prev) => mergeColumnOrder(prev, toColumn, nextDestIds, userId));
    setError(null);

    pendingSaves.current += 1;
    const save = async () => {
      if (!movedWithinColumn) {
        await persist({
          cycleId,
          userId,
          projectId: targetProjectId,
          domainId: assignmentBody?.domainId,
          level: assignmentBody?.level,
        });
      }
      await persistOrder({ cycleId, columnKey: toColumn, userIds: nextDestIds });
    };
    void save()
      .then(() => revalidator.revalidate())
      .catch((err) => {
        setAssignments(prevAssignments);
        setOrder(prevOrder);
        setError(err instanceof Error ? err.message : "Failed to save");
      })
      .finally(() => {
        pendingSaves.current = Math.max(0, pendingSaves.current - 1);
      });
  }

  async function handleRemoveMember(userId: string) {
    setError(null);
    try {
      const res = await fetch("/api/staffing/board-member", {
        method: "DELETE",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cycleId, userId }),
      });
      if (!res.ok) {
        const json = (await res.json().catch(() => ({}))) as { error?: string };
        setError(json.error ?? `Failed to remove member: ${res.status}`);
        return;
      }
      revalidator.revalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to remove member");
    }
  }

  const openBidMember = openBidUserId ? memberById.get(openBidUserId) ?? null : null;
  const openBidColumnId = openBidUserId
    ? assignments.find((a) => a.userId === openBidUserId)?.projectId ?? null
    : null;

  const termCode = terms.find((t) => t.id === termId)?.code ?? "";

  // Per-column tone (kept from the original): the Unassigned column is muted,
  // active projects get the teal wash, paused/archived projects read as dim.
  const toneClasses: Record<"muted" | "active" | "dim", string> = {
    muted: "border-border bg-muted/20",
    active: "border-accent-teal/40 bg-accent-teal/[0.04]",
    dim: "border-border bg-card",
  };
  // pt-1/px on the row (the primitive's default row layout) keeps each column's
  // top + side borders off the scroll-clip edge so they stay visible.
  const shell = (tone: "muted" | "active" | "dim") =>
    `flex-shrink-0 w-64 border rounded-lg ${toneClasses[tone]} flex flex-col max-h-[calc(100vh-12rem)]`;
  // Only the card list scrolls; the header stays pinned. flex-1 + min-h-0 lets
  // it shrink within the column's max-height so overflow-y kicks in.
  const listClass = "flex flex-col gap-2 p-2 flex-1 min-h-0 overflow-y-auto";
  // An empty column keeps a tall drop target so a card can be dropped into it.
  const emptyDropTarget = () => (
    <div className="text-xs text-muted-foreground italic text-center py-4 min-h-[12rem]">
      Empty
    </div>
  );

  const columnSubtitle = (countLabel: string, demand?: DomainDemand[]) => (
    <>
      <div>{countLabel}</div>
      {demand && demand.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {demand.map((d) => (
            <span
              key={d.domainId}
              className="text-[10px] px-1.5 py-0.5 rounded-full border border-border bg-background text-muted-foreground"
              title={`Expected ${d.slots} ${d.domainName} this term`}
            >
              {d.domainName} · {d.slots}
            </span>
          ))}
        </div>
      )}
    </>
  );

  const columns: KanbanColumn<MemberCardModel>[] = [
    {
      id: UNASSIGNED,
      title: "Unassigned",
      subtitle: columnSubtitle(`${board[UNASSIGNED]?.length ?? 0} bidding`),
      cards: board[UNASSIGNED] ?? [],
      className: shell("muted"),
      listClassName: listClass,
      headerExtra: <span />,
      renderEmpty: emptyDropTarget,
    },
    ...projects.map<KanbanColumn<MemberCardModel>>((p) => {
      const tone = p.status === "Active" ? "active" : "dim";
      // Roster cards first, then external-mentor cards pinned at the end.
      const cards = [...(board[p.id] ?? []), ...(externalCardsByProject.get(p.id) ?? [])];
      return {
        id: p.id,
        title: p.name,
        subtitle: columnSubtitle(
          `${board[p.id]?.length ?? 0} assigned`,
          demandByProject[p.id],
        ),
        cards,
        className: shell(tone),
        listClassName: listClass,
        renderEmpty: emptyDropTarget,
        headerExtra: canManage ? (
          <div className="flex-shrink-0 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setExternalMentorProjectId(p.id)}
              title={`Add external mentor to ${p.name}`}
              aria-label={`Add external mentor to ${p.name}`}
              className="text-muted-foreground hover:text-accent-teal transition-colors"
            >
              <UserPlus className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setFinalizeProjectId(p.id)}
              title={`Finalize ${p.name}`}
              aria-label={`Finalize ${p.name}`}
              className="text-muted-foreground hover:text-accent-coral transition-colors"
            >
              <CheckCircle2 className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <span />
        ),
      };
    }),
  ];

  return (
    <div className="flex flex-col gap-3">
      {canManage && <TermChannelBanner termId={termId} termCode={termCode} />}
      {canManage && <SyncTeamsBanner termId={termId} termCode={termCode} />}
      <div className="flex items-center justify-end gap-3 flex-wrap">
        {canManage && <AddMemberControl cycleId={cycleId} />}
        <DomainFilter
          domains={domains}
          value={selectedDomainId}
          onChange={(id) => {
            setSearchParams(
              (prev) => {
                if (id) prev.set("domain", id);
                else prev.delete("domain");
                return prev;
              },
              { replace: true },
            );
          }}
        />
        <div className="flex items-center gap-2">
          <label className="sr-only" htmlFor="staffing-term">
            Term
          </label>
          <select
            id="staffing-term"
            value={termId}
            onChange={(e) => {
              setSearchParams(
                (prev) => {
                  prev.set("term", e.target.value);
                  return prev;
                },
                { replace: true },
              );
            }}
            className="text-sm px-2 py-1 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
          >
            {terms.map((t) => (
              <option key={t.id} value={t.id}>
                {t.code}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Stable id: with multiple DndContexts mounting (tabbed workspace
          iframe + other boards) the default useId differs between SSR and
          client, hydration-mismatches dnd-kit's internal ids, and drag never
          activates. A fixed id keeps server/client deterministic. The primitive
          owns the DndContext, the SortableContext per column, the coral isOver
          ring, and the DragOverlay; the staffing-specific optimistic state +
          index math + SSE guard stay in this component. */}
      <KanbanBoard<MemberCardModel>
        id="staffing-board"
        columns={columns}
        getCardId={(c) => c.userId}
        getCardData={(c) => ({ userId: c.userId, fromColumn: columnIdOf.get(c.userId) ?? UNASSIGNED })}
        draggable={canManage}
        sortable
        onDragEnd={handleDragEnd}
        error={error}
        renderCard={(card, { isDragging, dragHandleProps }) => (
          <MemberCard
            card={card}
            projectNames={projectNames}
            domainNames={domainNames}
            onOpenBid={() => setOpenBidUserId(card.userId)}
            // Remove (×): external-mentor cards remove their placement; roster
            // cards only on the Unassigned column (the destructive board-member
            // delete shouldn't surface from project columns).
            onRemove={
              card.isExternalMentor
                ? canManage && card.externalMentorId
                  ? () => void removeExternalMentor(card.externalMentorId!)
                  : undefined
                : canManage && columnIdOf.get(card.userId) === UNASSIGNED
                  ? () => handleRemoveMember(card.userId)
                  : undefined
            }
            draggable={canManage}
            dragHandleProps={dragHandleProps}
            isDragging={isDragging}
            mentorSlot={(() => {
              // Mentor/mentee role badge, on project-column cards for managers.
              // Default role follows the assignment level (P3 → mentor); the
              // override flips it. External mentors are inherently mentors.
              if (!canManage || card.isExternalMentor) return undefined;
              if (columnIdOf.get(card.userId) === UNASSIGNED) return undefined;
              const defaultMentor = card.level === "P3";
              const isMentor = mentorRoles[card.userId] ?? defaultMentor;
              return (
                <RoleBadge
                  isMentor={isMentor}
                  onToggle={() => void toggleMentorRole(card.userId, !isMentor)}
                />
              );
            })()}
            canEditDomains={canManage && !card.isExternalMentor}
            allDomains={domains}
            assignmentDomainId={
              assignments.find((a) => a.userId === card.userId)?.domainId ?? null
            }
            onChangeDomainLevel={(domainId, level) => {
              const name =
                domains.find((d) => d.id === domainId)?.name ??
                domainNames[domainId] ??
                "?";
              void upsertDomainLevel(card.userId, domainId, level, name);
            }}
            onAddDomain={(domainId, level) => {
              const name =
                domains.find((d) => d.id === domainId)?.name ??
                domainNames[domainId] ??
                "?";
              void upsertDomainLevel(card.userId, domainId, level, name);
            }}
          />
        )}
        renderOverlay={(activeId) => {
          const card = activeId ? cardByUserId.get(activeId) ?? null : null;
          return card ? (
            <MemberCardPreview
              card={card}
              projectNames={projectNames}
              domainNames={domainNames}
            />
          ) : null;
        }}
      />

      {openBidMember && (
        <BidModal
          open={true}
          onClose={() => setOpenBidUserId(null)}
          memberName={`${openBidMember.firstName} ${openBidMember.lastName}`}
          preferences={openBidMember.preferences}
          bidFields={openBidMember.bidFields ?? []}
          projectNames={projectNames}
          domainNames={domainNames}
          currentProjectId={openBidColumnId}
        />
      )}

      {finalizeProjectId && (
        <FinalizeModal
          open={true}
          onClose={() => setFinalizeProjectId(null)}
          cycleId={cycleId}
          projectId={finalizeProjectId}
          projectName={projectNames[finalizeProjectId] ?? "project"}
          defaultSlackChannel={
            projects.find((p) => p.id === finalizeProjectId)?.slackChannelName ??
            sanitizeChannelName(projectNames[finalizeProjectId] ?? "")
          }
          defaultGithubSlug={
            projects.find((p) => p.id === finalizeProjectId)?.githubTeamSlug ?? ""
          }
        />
      )}

      {externalMentorProjectId && (
        <AddExternalMentorModal
          open={true}
          onClose={() => setExternalMentorProjectId(null)}
          cycleId={cycleId}
          projectId={externalMentorProjectId}
          projectName={projectNames[externalMentorProjectId] ?? "project"}
          domains={domains}
          onAdded={() => loadExternalMentorsRef.current()}
        />
      )}
    </div>
  );
}

// Full-width banner: get-or-create a term-wide Slack channel (e.g. #26x) and
// invite all current-term Core + Admin/staff + everyone assigned to a project
// this term. The channel name is editable, defaulting to the term code.
function TermChannelBanner({ termId, termCode }: { termId: string; termCode: string }) {
  const [channel, setChannel] = useState(sanitizeChannelName(termCode));
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Keep the field in sync when the selected term changes.
  useEffect(() => {
    setChannel(sanitizeChannelName(termCode));
    setResult(null);
  }, [termCode]);

  async function run() {
    if (!channel.trim()) return;
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/staffing/term-channel", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ termId, channel: channel.trim() }),
      });
      const json = (await res.json().catch(() => ({}))) as { message?: string; error?: string };
      if (!res.ok) {
        setResult({ ok: false, message: json.error ?? `Failed: ${res.status}` });
        return;
      }
      setResult({ ok: true, message: json.message ?? "Done." });
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : "Network error" });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="w-full rounded-lg border border-accent-coral/30 bg-accent-coral/10 px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-heading font-semibold text-foreground">
          Term Slack channel{termCode ? ` for ${termCode}` : ""}
        </p>
        <p className="text-xs text-muted-foreground">
          Get-or-create a channel and invite all Core, staff, and everyone assigned to a project
          this term.
        </p>
        {result && (
          <p className={`text-xs mt-1 ${result.ok ? "text-accent-teal" : "text-destructive"}`}>
            {result.ok ? "✓ " : "✗ "}
            {result.message}
          </p>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        <span className="text-sm text-muted-foreground">#</span>
        <input
          type="text"
          value={channel}
          disabled={running}
          onChange={(e) => setChannel(e.target.value)}
          placeholder="26x"
          aria-label="Term channel name"
          className="w-32 px-2 py-1 text-sm border border-border rounded-md bg-background text-foreground disabled:opacity-60 focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
        />
        <Button
          variant="primary"
          size="sm"
          disabled={running || !channel.trim()}
          onClick={run}
          className="whitespace-nowrap"
        >
          {running ? "Creating…" : "Create + invite"}
        </Button>
      </div>
    </div>
  );
}

// Full-width banner: add-only GitHub team sync for every project staffed this
// term. Ensures each project's org team, adds its rostered members, and grants
// the team push on its repos. Idempotent — safe to re-run. Two-click confirm
// because it can send org invites in bulk.
function SyncTeamsBanner({ termId, termCode }: { termId: string; termCode: string }) {
  const [running, setRunning] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string; warnings?: string[] } | null>(
    null,
  );

  // Reset when the selected term changes.
  useEffect(() => {
    setResult(null);
    setConfirming(false);
  }, [termCode]);

  async function run() {
    setRunning(true);
    setResult(null);
    setConfirming(false);
    try {
      const res = await fetch("/api/staffing/sync-teams", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ termId }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        message?: string;
        error?: string;
        warnings?: string[];
      };
      if (!res.ok) {
        setResult({ ok: false, message: json.error ?? `Failed: ${res.status}` });
        return;
      }
      setResult({ ok: json.ok ?? true, message: json.message ?? "Done.", warnings: json.warnings });
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : "Network error" });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="w-full rounded-lg border border-accent-coral/30 bg-accent-coral/10 px-4 py-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="text-sm font-heading font-semibold text-foreground">
          Sync GitHub teams{termCode ? ` for ${termCode}` : ""}
        </p>
        <p className="text-xs text-muted-foreground break-words">
          For every project staffed this term: ensure its org team, add rostered members, and grant
          the team push on its repos. Add-only — never removes anyone. Safe to re-run.
        </p>
        {result && (
          <>
            <p className={`text-xs mt-1 break-words ${result.ok ? "text-accent-teal" : "text-destructive"}`}>
              {result.ok ? "✓ " : "✗ "}
              {result.message}
            </p>
            {result.warnings?.length ? (
              <ul className="text-xs text-muted-foreground mt-1 list-disc pl-4 max-h-32 overflow-auto break-words">
                {result.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">
        {confirming ? (
          <>
            <Button
              variant="primary"
              size="sm"
              disabled={running}
              onClick={run}
              className="whitespace-nowrap"
            >
              {running ? "Syncing…" : "Confirm sync"}
            </Button>
            <Button variant="ghost" size="sm" disabled={running} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            size="sm"
            disabled={running}
            onClick={() => setConfirming(true)}
            className="whitespace-nowrap"
          >
            Sync all current-term teams
          </Button>
        )}
      </div>
    </div>
  );
}

async function persist(args: {
  cycleId: string;
  userId: string;
  projectId: string | null;
  domainId?: string;
  level?: Preference["level"];
}): Promise<void> {
  const res = await fetch("/api/staffing/assign", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
}

async function persistOrder(args: {
  cycleId: string;
  columnKey: string;
  userIds: string[];
}): Promise<void> {
  const res = await fetch("/api/staffing/reorder", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Reorder failed: ${res.status}`);
  }
}

// The column a userId currently sits in, per the built board, or null.
function findColumnOf(
  board: Record<string, MemberCardModel[]>,
  userId: string,
): string | null {
  for (const [columnKey, cards] of Object.entries(board)) {
    if (cards.some((c) => c.userId === userId)) return columnKey;
  }
  return null;
}

// Replace the order rows for one column with `userIds` (in their new order),
// preserving every other column's rows. The moved user's any prior-column row
// is dropped so a stale entry can't linger.
function mergeColumnOrder(
  prev: { userId: string; columnKey: string; sortKey: number }[],
  columnKey: string,
  userIds: string[],
  movedUserId: string,
): { userId: string; columnKey: string; sortKey: number }[] {
  const kept = prev.filter(
    (o) => o.columnKey !== columnKey && o.userId !== movedUserId,
  );
  const fresh = userIds.map((userId, sortKey) => ({ userId, columnKey, sortKey }));
  return [...kept, ...fresh];
}
