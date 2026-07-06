import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { redirect, useLoaderData, useNavigate, useRevalidator } from "react-router";
import type { Route } from "./+types/domain-lead.delibs.$id";
import type { DragEndEvent } from "@dnd-kit/core";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { parseSessionCookie } from "~/lib/cookies";
import { isDomainLead } from "~/lib/roles";
import { requirePageSignedOrRedirect } from "~/hiring/lib/confidentiality";
import { GripVertical } from "lucide-react";
import { KanbanBoard, type KanbanColumn } from "~/components/board/KanbanBoard";
import { INITIAL_COLUMNS, FINAL_COLUMNS, buildColumnOrder } from "~/hiring/lib/delibs";
import { inReviewPipelineFilter } from "~/hiring/lib/application-pipeline-filter";
import { ApplicantContextModal } from "~/hiring/components/delibs/ApplicantContextModal";

// Same recommendation scale + tones used by the ApplicantContextModal, so the
// card's reviewer/interviewer recommendation pills read consistently.
const RECOMMENDATION_COLORS: Record<string, string> = {
  "Strong Hire": "bg-green-100 text-green-800 border-green-300",
  Hire: "bg-green-50 text-green-700 border-green-200",
  "Lean Hire": "bg-yellow-50 text-yellow-700 border-yellow-300",
  "Lean No Hire": "bg-orange-50 text-orange-700 border-orange-300",
  "No Hire": "bg-red-100 text-red-700 border-red-300",
};

export const meta: Route.MetaFunction = ({ data }) => {
  const domain = (data as any)?.session?.domain?.name;
  return [{ title: `${domain ? `${domain} ` : ""}delibs · DALI OS` }];
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isDomainLead(auth.user.sub))) return redirect("/");

  const me = await prisma.user.findUnique({
    where: { id: auth.user.sub },
    select: { firstName: true, lastName: true },
  });
  const userName =
    [me?.firstName, me?.lastName].filter(Boolean).join(" ") || auth.user.email;

  const session = await prisma.delibsSession.findUniqueOrThrow({
    where: { id: params.id },
    include: {
      domain: true,
      applicationCycle: {
        include: {
          statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
        },
      },
    },
  });

  const confRedirect = await requirePageSignedOrRedirect(
    auth.user.sub,
    session.applicationCycleId,
    request,
  );
  if (confRedirect) return confRedirect;

  // Load domain applications that qualify for this delibs type.
  // Initial: all reviews submitted, at least one review, no Final/Released decision.
  // Final: interview completed (Standard) OR all reviews submitted (InternToFull,
  //   which has no interview round), no post-interview Final/Released decision.
  const cycleTypeRow = await prisma.applicationCycle.findUniqueOrThrow({
    where: { id: session.applicationCycleId },
    select: { cycleType: true },
  });
  const isInternToFull = cycleTypeRow.cycleType === "InternToFull";

  const qualifyingFilter = session.type === "Initial"
    ? {
        reviews: { every: { submittedAt: { not: null } }, some: {} },
        decisions: { none: { stage: { in: ["Final" as const, "Released" as const] } } },
      }
    : isInternToFull
      ? {
          reviews: { every: { submittedAt: { not: null } }, some: {} },
          decisions: { none: { stage: { in: ["Final" as const, "Released" as const] } } },
        }
      : {
          interviews: { some: { status: "Completed" as const } },
        };

  const domainApplications = await prisma.domainApplication.findMany({
    where: {
      selected: true,
      // Standard cycles join Domain via challengeVersion. InternToFull cycles
      // store Domain directly.
      OR: [
        { challengeVersion: { domainId: session.domainId } },
        { domainId: session.domainId },
      ],
      application: {
        applicationCycleId: session.applicationCycleId,
        ...inReviewPipelineFilter,
      },
      ...qualifyingFilter,
    },
    include: {
      application: {
        include: {
          user: { select: { firstName: true, lastName: true } },
        },
      },
      reviews: {
        include: {
          cycleReviewer: {
            include: {
              user: {
                select: { firstName: true, lastName: true, daliEmail: true },
              },
            },
          },
        },
      },
      decisions: {
        orderBy: { createdAt: "desc" },
        take: 1,
      },
      interviews: {
        where: { status: { in: ["Scheduled", "Completed"] } },
        include: {
          assignments: {
            where: { status: "Active" },
            include: {
              cycleInterviewer: {
                include: { user: { select: { firstName: true, lastName: true } } },
              },
            },
          },
        },
      },
    },
  });

  const collabToken = parseSessionCookie(request);

  return { session, domainApplications, collabToken, userName };
}

type LoaderResult = {
  session: Awaited<ReturnType<typeof prisma.delibsSession.findUniqueOrThrow<any>>>;
  domainApplications: any[];
};
type DomainApp = any;

export default function DelibsKanban() {
  const { session, domainApplications, collabToken, userName } =
    useLoaderData<typeof loader>() as any;
  const navigate = useNavigate();

  const columns =
    session.type === "Initial" ? INITIAL_COLUMNS : FINAL_COLUMNS;
  const defaultColumn = columns[0];

  // Build lookup map
  const appMap = new Map<string, DomainApp>();
  for (const da of domainApplications) {
    appMap.set(da.id, da);
  }

  // Initialize column order from session, sweeping never-moved apps into the
  // default column (the server only persists cards that have been moved).
  const savedOrder = (session.columnOrder ?? {}) as Record<string, string[]>;
  const initialOrder = buildColumnOrder(
    savedOrder,
    appMap.keys(),
    columns,
    defaultColumn,
  );

  const [columnOrder, setColumnOrder] =
    useState<Record<string, string[]>>(initialOrder);
  // The card currently being dragged, or null. Drives the
  // revalidate/poll-adoption guard below. Set on @dnd-kit drag start, cleared on
  // end/cancel. (@dnd-kit's activation-distance sensor also removes the stray
  // post-drag click the old native-HTML5 `wasDragging` ref had to suppress.)
  const [dragItem, setDragItem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [selectedDomainApplicationId, setSelectedDomainApplicationId] =
    useState<string | null>(null);

  // Resync local columnOrder from the loader after a revalidation, so concurrent
  // moves by other leads (or newly qualifying apps) show up without a reload.
  // Skip while the user is mid-drag or while a move POST is in flight — the
  // optimistic local state is authoritative until the server response lands.
  const dragItemRef = useRef(dragItem);
  const savingRef = useRef(saving);
  const appMapRef = useRef(appMap);
  dragItemRef.current = dragItem;
  savingRef.current = saving;
  appMapRef.current = appMap;
  useEffect(() => {
    if (dragItemRef.current || savingRef.current) return;
    setColumnOrder(initialOrder);
    // initialOrder is recomputed every render from loader data + columns;
    // depending on its JSON form keeps the effect tied to actual data changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(initialOrder)]);

  // cardId → its current column, so each draggable card can carry its origin
  // column in `data.fromColumn` (the drag handler reads it to skip same-column
  // drops).
  const columnIdOf = useMemo(() => {
    const map = new Map<string, string>();
    for (const [col, ids] of Object.entries(columnOrder)) {
      for (const id of ids) map.set(id, col);
    }
    return map;
  }, [columnOrder]);

  // Poll the loader every 5s while the session is active so other leads' moves
  // and newly qualifying applications surface without a manual refresh.
  const revalidator = useRevalidator();
  useEffect(() => {
    if (session.status !== "Active") return;
    const t = setInterval(() => {
      if (dragItemRef.current || savingRef.current) return;
      if (revalidator.state === "idle") revalidator.revalidate();
    }, 5000);
    return () => clearInterval(t);
  }, [session.status, revalidator]);

  const sendMove = useCallback(
    async (cardId: string, toColumn: string) => {
      setSaving(true);
      const res = await fetch(`/api/hiring/delibs/${session.id}/moves`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId, toColumn }),
      });
      if (res.ok) {
        const updated = await res.json();
        const serverOrder = (updated.columnOrder ?? {}) as Record<string, string[]>;
        // Reconcile from the server's authoritative order, but re-add never-moved
        // cards (which the server omits from columnOrder) to the default column so
        // they don't disappear after a drag.
        setColumnOrder(
          buildColumnOrder(serverOrder, appMapRef.current.keys(), columns, defaultColumn),
        );
      }
      setSaving(false);
    },
    [session.id, columns, defaultColumn]
  );

  function handleDragEnd(event: DragEndEvent) {
    setDragItem(null);
    if (isClosed) return;
    const overId = event.over?.id;
    if (!overId || typeof overId !== "string") return;
    const data = event.active.data.current as
      | { cardId?: string; fromColumn?: string }
      | undefined;
    const cardId = data?.cardId;
    const fromColumn = data?.fromColumn;
    if (!cardId) return;
    const targetCol = overId;
    if (targetCol === fromColumn) return;

    const newOrder = { ...columnOrder };
    // Optimistic local update: drop the card from every column, append to the
    // target. (Cross-column only — no within-column reorder, matching the old
    // native-drag behavior.)
    for (const col of columns) {
      newOrder[col] = (newOrder[col] ?? []).filter((id) => id !== cardId);
    }
    newOrder[targetCol] = [...(newOrder[targetCol] ?? []), cardId];

    setColumnOrder(newOrder);
    sendMove(cardId, targetCol);
  }

  async function handleClose() {
    setClosing(true);
    const res = await fetch(`/api/hiring/delibs/${session.id}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "close" }),
    });
    if (res.ok) {
      navigate("/hiring/domain-lead");
    }
    setClosing(false);
  }

  const isClosed = session.status === "Closed";

  // Per-column color theming is real product intent — kept verbatim. (The drop
  // ring itself is now the shared coral ring from KanbanBoard, not the old
  // blue-400 ring; flagged for QA.)
  const COLUMN_STYLES: Record<string, { bg: string; border: string; header: string; badge: string }> = {
    "No Decision": { bg: "bg-muted/50", border: "border-border", header: "text-foreground/80", badge: "bg-card text-muted-foreground border-border" },
    Interview: { bg: "bg-blue-50/50", border: "border-blue-200", header: "text-blue-800", badge: "bg-card text-blue-700 border-blue-200" },
    Accept: { bg: "bg-green-50/50", border: "border-green-200", header: "text-green-800", badge: "bg-card text-green-700 border-green-200" },
    Waitlist: { bg: "bg-yellow-50/50", border: "border-yellow-200", header: "text-yellow-800", badge: "bg-card text-yellow-700 border-yellow-200" },
    Reject: { bg: "bg-red-50/50", border: "border-red-200", header: "text-red-800", badge: "bg-card text-red-700 border-red-200" },
  };

  const kanbanColumns: KanbanColumn<DomainApp>[] = useMemo(
    () =>
      columns.map((col) => {
        const style = COLUMN_STYLES[col] ?? COLUMN_STYLES["No Decision"];
        const items = (columnOrder[col] ?? [])
          .map((id) => appMap.get(id))
          .filter((da): da is DomainApp => !!da);
        return {
          id: col,
          title: <span className={`font-bold ${style.header}`}>{col}</span>,
          cards: items,
          className: `rounded-xl border ${style.border} ${style.bg} p-4 min-h-[400px] transition-all flex flex-col`,
          headerClassName: "flex items-center justify-between border-b border-current/20 pb-2 mb-3",
          listClassName: "space-y-2",
          headerExtra: (
            <span
              className={`px-2 py-0.5 rounded-full text-xs font-bold border shadow-sm ${style.badge}`}
            >
              {items.length}
            </span>
          ),
          renderEmpty: () => (
            <div className="py-8 text-center border-2 border-dashed border-gray-300 rounded-lg bg-card/50">
              <p className="text-sm text-muted-foreground/70 italic">Empty</p>
            </div>
          ),
        };
      }),
    // appMap + COLUMN_STYLES are rebuilt every render; columnOrder/columns drive
    // the actual content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columns, columnOrder, domainApplications],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">
            {session.type === "Initial" ? "Initial" : "Final"} Deliberations —{" "}
            {session.domain.name}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Drag applications between columns. Changes save automatically.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {saving && (
            <span className="text-xs text-muted-foreground/70">Saving...</span>
          )}
          {isClosed ? (
            <span className="px-3 py-1.5 text-sm font-medium bg-muted text-muted-foreground rounded-lg">
              Closed
            </span>
          ) : (
            <button
              onClick={() => setShowCloseConfirm(true)}
              className="px-4 py-2 text-sm font-medium rounded-lg bg-red-600 hover:bg-red-700 text-white transition"
            >
              Close Delibs
            </button>
          )}
        </div>
      </div>

      {/* Close confirmation */}
      {showCloseConfirm && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="text-sm font-bold text-red-900">
              Close deliberations and create Draft decisions?
            </p>
            <p className="text-xs text-red-700 mt-0.5">
              {columns
                .filter((c) => c !== defaultColumn)
                .map(
                  (c) =>
                    `${(columnOrder[c] ?? []).length} ${c.toLowerCase()}`
                )
                .join(", ")}
              . Items in "{defaultColumn}" will not receive a decision.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowCloseConfirm(false)}
              className="px-3 py-1.5 text-sm font-medium text-foreground/80 bg-card border border-gray-300 rounded-lg hover:bg-muted/50"
            >
              Cancel
            </button>
            <button
              onClick={handleClose}
              disabled={closing}
              className="px-3 py-1.5 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-50"
            >
              {closing ? "Closing..." : "Confirm & Close"}
            </button>
          </div>
        </div>
      )}

      {selectedDomainApplicationId && (
        <ApplicantContextModal
          domainApplicationId={selectedDomainApplicationId}
          onClose={() => setSelectedDomainApplicationId(null)}
          collabToken={collabToken}
          userName={userName}
          editable={session.type === "Initial"}
        />
      )}

      {/* Kanban Board. Migrated from native HTML5 drag to @dnd-kit via the
          shared KanbanBoard primitive: keyboard drag now works, the stray
          post-drag click is gone (activation-distance sensor), and the drop
          ring is the shared coral instead of the old blue-400. Per-column
          color theming is preserved through each column's className. */}
      <KanbanBoard<DomainApp>
        id={`delibs-board-${session.id}`}
        layout="grid"
        columns={kanbanColumns}
        getCardId={(da) => da.id}
        getCardData={(da) => ({ cardId: da.id, fromColumn: columnIdOf.get(da.id) ?? defaultColumn })}
        draggable={!isClosed}
        onDragStart={(event) => setDragItem(String(event.active.id))}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDragItem(null)}
        renderCard={(da, { isDragging, dragHandleProps }) => (
          <DelibsCard
            da={da}
            isClosed={isClosed}
            isDragging={isDragging}
            dragHandleProps={dragHandleProps}
            onOpen={() => setSelectedDomainApplicationId(da.id)}
          />
        )}
        // A floating copy of the dragged card, portaled above the grid. Without
        // this, the in-flow card can clip under an adjacent grid column (the OS
        // drag image the old native-HTML5 drag used floated above everything).
        renderOverlay={(activeId) => {
          const da = activeId ? appMap.get(activeId) ?? null : null;
          return da ? (
            <DelibsCard
              da={da}
              isClosed={false}
              isDragging={false}
              dragHandleProps={{}}
              onOpen={() => {}}
              overlay
            />
          ) : null;
        }}
      />
    </div>
  );
}

// One applicant card on the delibs board. The whole card is the drag handle
// (the @dnd-kit activation-distance sensor lets a press that doesn't move land
// as a click that opens the applicant modal).
function DelibsCard({
  da,
  isClosed,
  isDragging,
  dragHandleProps,
  onOpen,
  overlay = false,
}: {
  da: DomainApp;
  isClosed: boolean;
  isDragging: boolean;
  dragHandleProps: Record<string, unknown>;
  onOpen: () => void;
  /** Rendered inside the DragOverlay — a static floating copy with a shadow. */
  overlay?: boolean;
}) {
  const reviewCount = da.reviews.length;
  const submittedCount = da.reviews.filter((r: any) => r.submittedAt).length;
  const avgScore =
    da.reviews.length > 0
      ? da.reviews.reduce((sum: number, r: any) => {
          const scores = r.scores as Record<string, number>;
          const vals = Object.values(scores);
          return (
            sum +
            (vals.length > 0
              ? vals.reduce((a: number, b: number) => a + b, 0) / vals.length
              : 0)
          );
        }, 0) / da.reviews.length
      : null;

  const fmt = (u: any) =>
    u ? `${u.firstName ?? ""} ${u.lastName ?? ""}`.trim() : "";
  const recPill = (rec: string, key: string) => (
    <span
      key={key}
      className={`inline-block text-[10px] font-medium px-1.5 py-0.5 rounded border ${
        RECOMMENDATION_COLORS[rec] ?? "border-border bg-muted/50 text-muted-foreground"
      }`}
    >
      {rec}
    </span>
  );
  // Reviewer recommendations: one per submitted review.
  const reviewerNames = Array.from(
    new Set(
      (da.reviews ?? [])
        .map((r: any) => fmt(r.cycleReviewer?.user))
        .filter(Boolean),
    ),
  );
  const reviewerRecs = (da.reviews ?? [])
    .filter((r: any) => r.overallRecommendation)
    .map((r: any) => ({ id: r.id, rec: r.overallRecommendation as string }));
  // Interviewer recommendation: the joint interview rec.
  const interviewerNames = Array.from(
    new Set(
      (da.interviews ?? [])
        .flatMap((iv: any) => iv.assignments ?? [])
        .map((a: any) => fmt(a.cycleInterviewer?.user))
        .filter(Boolean),
    ),
  );
  const interviewRecs = (da.interviews ?? [])
    .filter((iv: any) => iv.recommendation)
    .map((iv: any) => ({ id: iv.id, rec: iv.recommendation as string }));

  const hasReviewers = reviewerNames.length > 0 || reviewerRecs.length > 0;
  const hasInterviewers = interviewerNames.length > 0 || interviewRecs.length > 0;

  return (
    <div
      {...(overlay || isClosed ? {} : dragHandleProps)}
      onClick={overlay ? undefined : onOpen}
      role={overlay ? undefined : "button"}
      tabIndex={overlay ? undefined : 0}
      onKeyDown={
        overlay
          ? undefined
          : (e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                onOpen();
              }
            }
      }
      className={`bg-card p-3 rounded-lg border border-border transition-all ${
        overlay
          ? "shadow-lg cursor-grabbing"
          : isClosed
            ? "shadow-sm cursor-pointer"
            : "shadow-sm cursor-grab hover:shadow-md active:cursor-grabbing"
      } ${isDragging ? "opacity-50" : ""}`}
    >
      <div className="flex items-start gap-2">
        {!isClosed && (
          <GripVertical className="w-4 h-4 text-muted-foreground/50 mt-0.5 flex-shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <h4 className="font-bold text-foreground text-sm truncate">
            {da.application.user.firstName} {da.application.user.lastName}
          </h4>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-muted-foreground">
              {submittedCount}/{reviewCount} reviews
            </span>
            {avgScore !== null && (
              <span className="text-xs font-medium text-blue-600 bg-blue-50 px-1.5 py-0.5 rounded">
                avg {avgScore.toFixed(1)}
              </span>
            )}
          </div>
          {(hasReviewers || hasInterviewers) && (
            <div className="mt-2 pt-2 border-t border-border space-y-2">
              {hasReviewers && (
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    Reviewers
                  </p>
                  {reviewerNames.length > 0 && (
                    <p className="text-[10px] text-muted-foreground">
                      {reviewerNames.join(", ")}
                    </p>
                  )}
                  {reviewerRecs.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {reviewerRecs.map((r: { id: string; rec: string }) =>
                        recPill(r.rec, r.id),
                      )}
                    </div>
                  )}
                </div>
              )}
              {hasInterviewers && (
                <div>
                  <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    Interviewers
                  </p>
                  {interviewerNames.length > 0 && (
                    <p className="text-[10px] text-muted-foreground">
                      {interviewerNames.join(", ")}
                    </p>
                  )}
                  {interviewRecs.length > 0 ? (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {interviewRecs.map((r: { id: string; rec: string }) =>
                        recPill(r.rec, r.id),
                      )}
                    </div>
                  ) : (
                    <p className="text-[10px] text-muted-foreground/60 italic mt-0.5">
                      No interview recommendation yet.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
