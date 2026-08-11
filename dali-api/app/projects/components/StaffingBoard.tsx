import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRevalidator } from "react-router";
import { Select } from "~/components/ui/floating";
import type { DragEndEvent } from "@dnd-kit/core";
import { KanbanBoard, type KanbanColumn } from "~/components/board/KanbanBoard";
import {
  buildBoard,
  resolveAssignmentDomains,
  UNASSIGNED,
  type MemberCardModel,
  type MemberInput,
  type Assignment,
  type Preference,
} from "../lib/staffing-board";
import { CheckCircle2, Plus, UserPlus } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { ProjectIcon } from "~/components/ProjectIcon";
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
  iconEmoji?: string | null;
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
  // Member + column whose bid modal is open (column highlights their current
  // project among the bids), or null.
  const [openBid, setOpenBid] = useState<{ userId: string; columnKey: string } | null>(null);
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

      // Keep live assignment level in sync when editing an assigned domain.
      const prevAssignments = assignments;
      if (assignments.some((a) => a.userId === userId && a.domainId === domainId && a.level !== level)) {
        setAssignments((list) =>
          list.map((a) =>
            a.userId === userId && a.domainId === domainId ? { ...a, level } : a,
          ),
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

  const toggleAssignmentDomain = useCallback(
    async (userId: string, projectId: string, domainId: string) => {
      const current = assignments.filter(
        (a) => a.userId === userId && a.projectId === projectId,
      );
      if (current.length === 0) return;

      const has = current.some((a) => a.domainId === domainId);
      let next: Assignment[];
      if (has) {
        if (current.length === 1) {
          setError("Keep at least one domain, or drag the card to Unassigned.");
          return;
        }
        next = current.filter((a) => a.domainId !== domainId);
      } else {
        const levels = domainLevelsByUser[userId] ?? members.find((m) => m.userId === userId)?.domainLevels ?? [];
        const dl = levels.find((d) => d.domainId === domainId);
        if (!dl) {
          setError("Add that domain to their eligibility first.");
          return;
        }
        next = [...current, { userId, projectId, domainId, level: dl.level }];
      }

      const prevAssignments = assignments;
      setAssignments((list) => [
        ...list.filter((a) => !(a.userId === userId && a.projectId === projectId)),
        ...next,
      ]);
      setError(null);
      try {
        await persist({
          cycleId,
          userId,
          projectId,
          domains: next.map((a) => ({ domainId: a.domainId, level: a.level })),
        });
        revalidator.revalidate();
      } catch (err) {
        setAssignments(prevAssignments);
        setError(err instanceof Error ? err.message : "Failed to update domains");
      }
    },
    [assignments, cycleId, domainLevelsByUser, members, revalidator],
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

  // Synthetic cards for external mentors, grouped by project column. They render
  // like distinct cards but aren't in `board`/`members`, so the drag handler
  // (keyed off memberById) naturally ignores them.
  const externalCardsByProject = useMemo(() => {
    const map = new Map<string, MemberCardModel[]>();
    for (const e of externalMentors) {
      const list = map.get(e.projectId) ?? [];
      list.push({
        userId: e.userId,
        columnKey: e.projectId,
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
        assignmentDomainIds: [e.domainId],
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

  // Flat cardId → card lookup so the DragOverlay can render the active card. The
  // external-mentor cards live outside `board`, so fold them in too.
  const cardByCardId = useMemo(() => {
    const map = new Map<string, MemberCardModel>();
    for (const cards of Object.values(board)) {
      for (const c of cards) map.set(cardId(c.userId, c.columnKey), c);
    }
    for (const cards of externalCardsByProject.values()) {
      for (const c of cards) map.set(cardId(c.userId, c.columnKey), c);
    }
    return map;
  }, [board, externalCardsByProject]);

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

    // Resolve the destination column. `over` is either a column droppable (its
    // id is UNASSIGNED or a projectId) or a card (a composite `userId::columnKey`
    // — resolve its column). An external-mentor card isn't in `board`, so its
    // userId won't be found in destUserIds and the drop falls to the end.
    const isColumnId = overId === UNASSIGNED || projectIds.includes(overId);
    const over = isColumnId ? null : parseCardId(overId);
    const toColumn = isColumnId ? overId : over!.columnKey;
    // Roster userIds in the destination column, in current display order (order
    // + assignment identity are tracked per userId within a column).
    const destUserIds = (board[toColumn] ?? []).map((c) => c.userId);
    const overIndex = (() => {
      if (isColumnId) return destUserIds.length;
      const idx = destUserIds.indexOf(over!.userId);
      return idx === -1 ? destUserIds.length : idx;
    })();
    const movedWithinColumn = fromColumn === toColumn;

    // No-op: dropped back where it already was.
    if (movedWithinColumn && destUserIds.indexOf(userId) === overIndex) return;

    // Build the new ordered userId list for the destination column.
    const withoutMoved = destUserIds.filter((id) => id !== userId);
    const insertAt = Math.min(overIndex, withoutMoved.length);
    const nextDestIds = [
      ...withoutMoved.slice(0, insertAt),
      userId,
      ...withoutMoved.slice(insertAt),
    ];

    // A cross-column move also updates the assignment, scoped to the two columns
    // involved. Resolve domain(s) + level for a project column; UNASSIGNED just
    // removes the member from the source project.
    const targetProjectId = toColumn === UNASSIGNED ? null : toColumn;
    const sourceProjectId = fromColumn === UNASSIGNED ? null : fromColumn;
    let assignmentDomains: { domainId: string; level: "P1" | "P2" | "P3" }[] | null = null;
    if (!movedWithinColumn && targetProjectId !== null) {
      assignmentDomains = resolveAssignmentDomains(member, targetProjectId);
      if (!assignmentDomains) {
        setError(
          `Can't infer a domain + level for ${member.firstName} ${member.lastName}: they have no bid and no domain eligibility. Add a bid or set their eligibility.`,
        );
        return;
      }
    }

    const prevAssignments = assignments;
    const prevOrder = order;

    // Optimistic assignment update: drop the member's rows on the SOURCE project
    // only (their other projects stay put), then add the target rows.
    if (!movedWithinColumn) {
      const withoutSource = sourceProjectId
        ? assignments.filter(
            (a) => !(a.userId === userId && a.projectId === sourceProjectId),
          )
        : assignments;
      setAssignments(
        targetProjectId === null
          ? withoutSource
          : [
              ...withoutSource,
              ...assignmentDomains!.map((d) => ({
                userId,
                projectId: targetProjectId,
                domainId: d.domainId,
                level: d.level,
              })),
            ],
      );
    }

    // Optimistic order update for the destination column. Other users' rows are
    // preserved; the moved card and its new neighbours get fresh indices.
    setOrder((prev) => mergeColumnOrder(prev, toColumn, nextDestIds, userId, fromColumn));
    setError(null);

    pendingSaves.current += 1;
    const save = async () => {
      if (!movedWithinColumn) {
        await persist({
          cycleId,
          userId,
          projectId: targetProjectId,
          fromProjectId: sourceProjectId ?? undefined,
          domains: assignmentDomains ?? undefined,
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

  // Remove a member from ONE project (× on a project-column card). Their rows on
  // other projects are untouched.
  async function removeFromProject(userId: string, projectId: string) {
    const prevAssignments = assignments;
    setAssignments((list) =>
      list.filter((a) => !(a.userId === userId && a.projectId === projectId)),
    );
    setError(null);
    try {
      await persist({ cycleId, userId, projectId: null, fromProjectId: projectId });
      revalidator.revalidate();
    } catch (err) {
      setAssignments(prevAssignments);
      setError(err instanceof Error ? err.message : "Failed to remove from project");
    }
  }

  // Add a member to a project additively (per-column search). Domains are
  // resolved the same way a drag does; other projects are left intact.
  async function addMemberToProject(userId: string, projectId: string) {
    const member = memberById.get(userId);
    if (!member) return;
    const domains = resolveAssignmentDomains(member, projectId);
    if (!domains) {
      setError(
        `Can't infer a domain + level for ${member.firstName} ${member.lastName}: they have no bid and no domain eligibility. Add a bid or set their eligibility.`,
      );
      return;
    }
    const prevAssignments = assignments;
    setAssignments((list) => [
      ...list.filter((a) => !(a.userId === userId && a.projectId === projectId)),
      ...domains.map((d) => ({ userId, projectId, domainId: d.domainId, level: d.level })),
    ]);
    setError(null);
    try {
      await persist({ cycleId, userId, projectId, domains });
      revalidator.revalidate();
    } catch (err) {
      setAssignments(prevAssignments);
      setError(err instanceof Error ? err.message : "Failed to add member");
    }
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

  const openBidMember = openBid ? memberById.get(openBid.userId) ?? null : null;
  const openBidColumnId =
    openBid && openBid.columnKey !== UNASSIGNED ? openBid.columnKey : null;

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
        title: (
          <span className="flex items-center gap-1.5 min-w-0">
            <ProjectIcon iconEmoji={p.iconEmoji} />
            <span className="truncate">{p.name}</span>
          </span>
        ),
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
            <AddMemberToProjectControl
              projectName={p.name}
              members={membersForBoard}
              assignedUserIds={new Set((board[p.id] ?? []).map((c) => c.userId))}
              onAdd={(userId) => void addMemberToProject(userId, p.id)}
            />
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
          <Select
            value={termId}
            options={terms.map((t) => ({ value: t.id, label: t.code }))}
            ariaLabel="Term"
            buttonClassName="inline-flex items-center justify-between gap-1 text-sm px-2 py-1 border border-border rounded-md bg-background text-foreground transition-colors hover:bg-muted/40"
            onChange={(value) => {
              setSearchParams(
                (prev) => {
                  prev.set("term", value);
                  return prev;
                },
                { replace: true },
              );
            }}
          />
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
        getCardId={(c) => cardId(c.userId, c.columnKey)}
        getCardData={(c) => ({ userId: c.userId, fromColumn: c.columnKey })}
        draggable={canManage}
        sortable
        onDragEnd={handleDragEnd}
        error={error}
        renderCard={(card, { isDragging, dragHandleProps }) => (
          <MemberCard
            card={card}
            projectNames={projectNames}
            domainNames={domainNames}
            onOpenBid={() => setOpenBid({ userId: card.userId, columnKey: card.columnKey })}
            // Remove (×): external-mentor cards remove their placement; on the
            // Unassigned column a roster card's × removes them from the board;
            // on a project column it removes them from just that project.
            onRemove={
              card.isExternalMentor
                ? canManage && card.externalMentorId
                  ? () => void removeExternalMentor(card.externalMentorId!)
                  : undefined
                : !canManage
                  ? undefined
                  : card.columnKey === UNASSIGNED
                    ? () => handleRemoveMember(card.userId)
                    : () => void removeFromProject(card.userId, card.columnKey)
            }
            draggable={canManage}
            dragHandleProps={dragHandleProps}
            isDragging={isDragging}
            mentorSlot={(() => {
              // Mentor/mentee role badge, on project-column cards for managers.
              // Default role follows the assignment level (P3 → mentor); the
              // override flips it. External mentors are inherently mentors.
              if (!canManage || card.isExternalMentor) return undefined;
              if (card.columnKey === UNASSIGNED) return undefined;
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
            assignmentDomainIds={card.assignmentDomainIds}
            onToggleAssignmentDomain={
              canManage && !card.isExternalMentor && card.columnKey !== UNASSIGNED
                ? (domainId) => void toggleAssignmentDomain(card.userId, card.columnKey, domainId)
                : undefined
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
          const card = activeId ? cardByCardId.get(activeId) ?? null : null;
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
          onClose={() => setOpenBid(null)}
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

// Per-project "add member" search. Unlike the board-wide AddMemberControl (which
// adds a non-bidder to the Unassigned pool), this staffs an existing board member
// onto ONE project additively — the way to put someone on a second project.
// Search is client-side over the already-loaded members; members already on this
// project are excluded, but those staffed elsewhere are included.
function AddMemberToProjectControl({
  projectName,
  members,
  assignedUserIds,
  onAdd,
}: {
  projectName: string;
  members: MemberInput[];
  assignedUserIds: Set<string>;
  onAdd: (userId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const query = q.trim().toLowerCase();
  const results =
    query.length < 2
      ? []
      : members
          .filter((m) => !assignedUserIds.has(m.userId))
          .filter((m) => {
            const name = `${m.firstName} ${m.lastName}`.toLowerCase();
            return name.includes(query) || (m.email ?? "").toLowerCase().includes(query);
          })
          .slice(0, 20);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title={`Add member to ${projectName}`}
        aria-label={`Add member to ${projectName}`}
        className="text-muted-foreground hover:text-accent-teal transition-colors"
      >
        <Plus className="w-4 h-4" />
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-64 bg-card border border-border rounded-md shadow-lg z-50 p-2">
          <input
            autoFocus
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search members…"
            className="w-full text-sm px-2 py-1.5 border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-teal/30"
          />
          <div className="mt-2 max-h-64 overflow-y-auto flex flex-col gap-0.5">
            {query.length >= 2 && results.length === 0 && (
              <p className="text-xs text-muted-foreground px-1 py-1">No members found.</p>
            )}
            {results.map((m) => (
              <button
                key={m.userId}
                type="button"
                onClick={() => {
                  onAdd(m.userId);
                  setOpen(false);
                  setQ("");
                }}
                className="text-left px-2 py-1.5 rounded hover:bg-muted flex flex-col"
              >
                <span className="text-sm text-foreground">
                  {m.firstName} {m.lastName}
                </span>
                {m.email && <span className="text-[11px] text-muted-foreground">{m.email}</span>}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

async function persist(args: {
  cycleId: string;
  userId: string;
  projectId: string | null;
  fromProjectId?: string;
  domainId?: string;
  level?: Preference["level"];
  domains?: { domainId: string; level: Preference["level"] }[];
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

// Board card identity is (userId, columnKey): a member staffed on multiple
// projects has one card per column, so userId alone isn't unique. dnd-kit uses
// this string as both the draggable id and the React key.
function cardId(userId: string, columnKey: string): string {
  return `${userId}::${columnKey}`;
}
function parseCardId(id: string): { userId: string; columnKey: string } {
  const i = id.indexOf("::");
  return i === -1
    ? { userId: id, columnKey: UNASSIGNED }
    : { userId: id.slice(0, i), columnKey: id.slice(i + 2) };
}

// Replace the order rows for the destination column with `userIds` (in their new
// order), preserving every other column's rows. The moved user's stale row in the
// SOURCE column is dropped (a member can legitimately hold order rows in several
// columns now, so we can't clear all of their rows).
function mergeColumnOrder(
  prev: { userId: string; columnKey: string; sortKey: number }[],
  columnKey: string,
  userIds: string[],
  movedUserId: string,
  fromColumn: string,
): { userId: string; columnKey: string; sortKey: number }[] {
  const kept = prev.filter(
    (o) =>
      o.columnKey !== columnKey &&
      !(o.userId === movedUserId && o.columnKey === fromColumn),
  );
  const fresh = userIds.map((userId, sortKey) => ({ userId, columnKey, sortKey }));
  return [...kept, ...fresh];
}
