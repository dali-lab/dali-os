import { useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import { DndContext, useDroppable, type DragEndEvent } from "@dnd-kit/core";
import {
  buildBoard,
  resolveAssignmentInputs,
  UNASSIGNED,
  type MemberCardModel,
  type MemberInput,
  type Assignment,
  type Preference,
} from "../lib/staffing-board";
import { CheckCircle2 } from "lucide-react";
import { MemberCard } from "./MemberCard";
import { BidModal } from "./BidModal";
import { FinalizeModal } from "./FinalizeModal";

type ProjectMeta = { id: string; name: string; status: "Active" | "Paused" | "Archived" };

type Props = {
  cycleId: string;
  termCode: string;
  terms: { id: string; code: string }[];
  projects: ProjectMeta[];
  members: MemberInput[];
  initialAssignments: Assignment[];
  domainNames: Record<string, string>;
  /** Staffing leads can drag. Members get a read-only board. */
  canManage: boolean;
};

export function StaffingBoard({
  cycleId,
  termCode,
  terms,
  projects,
  members,
  initialAssignments,
  domainNames,
  canManage,
}: Props) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [assignments, setAssignments] = useState<Assignment[]>(initialAssignments);
  const [error, setError] = useState<string | null>(null);
  const [openBidUserId, setOpenBidUserId] = useState<string | null>(null);
  // Project id whose finalize modal is open, or null.
  const [finalizeProjectId, setFinalizeProjectId] = useState<string | null>(null);

  const projectNames = useMemo(
    () => Object.fromEntries(projects.map((p) => [p.id, p.name])),
    [projects],
  );
  const projectIds = useMemo(() => projects.map((p) => p.id), [projects]);

  const board = useMemo(
    () => buildBoard({ projectIds, members, assignments }),
    [projectIds, members, assignments],
  );

  const memberById = useMemo(
    () => new Map(members.map((m) => [m.userId, m])),
    [members],
  );

  function handleDragEnd(event: DragEndEvent) {
    if (!canManage) return;
    const overId = event.over?.id;
    if (!overId || typeof overId !== "string") return;
    const data = event.active.data.current as { userId?: string; fromColumn?: string } | undefined;
    const userId = data?.userId;
    const fromColumn = data?.fromColumn ?? UNASSIGNED;
    if (!userId) return;
    if (overId === fromColumn) return;

    const member = memberById.get(userId);
    if (!member) return;

    // Optimistic: update local state immediately.
    const targetProjectId = overId === UNASSIGNED ? null : overId;
    const prevAssignments = assignments;

    let nextAssignments: Assignment[];
    let assignmentBody: { domainId: string; level: "P1" | "P2" | "P3" } | null = null;
    if (targetProjectId === null) {
      nextAssignments = assignments.filter((a) => a.userId !== userId);
    } else {
      assignmentBody = resolveAssignmentInputs(member, targetProjectId);
      if (!assignmentBody) {
        setError(
          `${member.firstName} ${member.lastName} has no preferences on file; can't infer a domain + level.`,
        );
        return;
      }
      const withoutOld = assignments.filter((a) => a.userId !== userId);
      nextAssignments = [
        ...withoutOld,
        { userId, projectId: targetProjectId, domainId: assignmentBody.domainId, level: assignmentBody.level },
      ];
    }
    setAssignments(nextAssignments);
    setError(null);

    void persist({
      cycleId,
      userId,
      projectId: targetProjectId,
      domainId: assignmentBody?.domainId,
      level: assignmentBody?.level,
    }).catch((err) => {
      setAssignments(prevAssignments);
      setError(err instanceof Error ? err.message : "Failed to save assignment");
    });
  }

  const openBidMember = openBidUserId ? memberById.get(openBidUserId) ?? null : null;
  const openBidColumnId = openBidUserId
    ? assignments.find((a) => a.userId === openBidUserId)?.projectId ?? null
    : null;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <h2 className="font-heading text-lg font-bold text-foreground">
            Staffing
          </h2>
          <label className="sr-only" htmlFor="staffing-term">
            Term
          </label>
          <select
            id="staffing-term"
            value={termCode}
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
              <option key={t.id} value={t.code}>
                {t.code}
              </option>
            ))}
          </select>
        </div>
        <p className="text-xs text-muted-foreground hidden sm:block">
          {canManage
            ? "Drag a member onto a project. Click a name to view their bid."
            : "Click a name to view their bid."}
        </p>
      </div>

      {error && (
        <div className="bg-destructive/10 border border-destructive/30 text-destructive text-sm rounded-md px-3 py-2">
          {error}
        </div>
      )}

      {/* Stable id: with multiple DndContexts mounting (tabbed workspace
          iframe + other boards) the default useId differs between SSR and
          client, hydration-mismatches dnd-kit's internal ids, and drag never
          activates. A fixed id keeps server/client deterministic. */}
      <DndContext id="staffing-board" onDragEnd={handleDragEnd}>
        {/* pt-1 keeps each column's top border off the scroll-clip edge so it
            stays visible; px on the row prevents the first/last column border
            being shaved by overflow-x. */}
        <div className="flex gap-3 overflow-x-auto pt-1 pb-3 px-0.5">
          <Column
            id={UNASSIGNED}
            title="Unassigned"
            subtitle={`${board[UNASSIGNED]?.length ?? 0} bidding`}
            tone="muted"
            cards={board[UNASSIGNED] ?? []}
            projectNames={projectNames}
            onOpenBid={setOpenBidUserId}
            draggable={canManage}
          />
          {projects.map((p) => (
            <Column
              key={p.id}
              id={p.id}
              title={p.name}
              subtitle={`${board[p.id]?.length ?? 0} assigned`}
              tone={p.status === "Active" ? "active" : "dim"}
              cards={board[p.id] ?? []}
              projectNames={projectNames}
              onOpenBid={setOpenBidUserId}
              draggable={canManage}
              onFinalize={canManage ? () => setFinalizeProjectId(p.id) : undefined}
            />
          ))}
        </div>
      </DndContext>

      {openBidMember && (
        <BidModal
          open={true}
          onClose={() => setOpenBidUserId(null)}
          memberName={`${openBidMember.firstName} ${openBidMember.lastName}`}
          preferences={openBidMember.preferences}
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
        />
      )}
    </div>
  );
}

type ColumnTone = "muted" | "active" | "dim";

function Column({
  id,
  title,
  subtitle,
  tone,
  cards,
  projectNames,
  onOpenBid,
  draggable,
  onFinalize,
}: {
  id: string;
  title: string;
  subtitle: string;
  tone: ColumnTone;
  cards: MemberCardModel[];
  projectNames: Record<string, string>;
  onOpenBid: (userId: string) => void;
  draggable: boolean;
  // Only set for project columns the user can manage; renders the finalize
  // icon button in the header.
  onFinalize?: () => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id });
  const toneClasses: Record<ColumnTone, string> = {
    muted: "border-border bg-muted/20",
    active: "border-accent-teal/40 bg-accent-teal/[0.04]",
    dim: "border-border bg-card",
  };

  return (
    <div
      ref={setNodeRef}
      className={`flex-shrink-0 w-64 border rounded-lg ${toneClasses[tone]} ${
        isOver ? "ring-2 ring-accent-coral/40" : ""
      } flex flex-col`}
    >
      <div className="px-3 py-2 border-b border-border">
        <div className="flex items-center gap-1.5">
          <div className="text-sm font-semibold text-foreground truncate flex-1" title={title}>
            {title}
          </div>
          {onFinalize && (
            <button
              type="button"
              onClick={onFinalize}
              title={`Finalize ${title}`}
              aria-label={`Finalize ${title}`}
              className="flex-shrink-0 text-muted-foreground hover:text-accent-coral transition-colors"
            >
              <CheckCircle2 className="w-4 h-4" />
            </button>
          )}
        </div>
        <div className="text-[11px] text-muted-foreground">{subtitle}</div>
      </div>
      <div className="flex flex-col gap-2 p-2 min-h-[28rem]">
        {cards.length === 0 ? (
          <div className="text-xs text-muted-foreground italic text-center py-4">Empty</div>
        ) : (
          cards.map((card) => (
            <MemberCard
              key={card.userId}
              card={card}
              columnId={id}
              projectNames={projectNames}
              onOpenBid={() => onOpenBid(card.userId)}
              draggable={draggable}
            />
          ))
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
