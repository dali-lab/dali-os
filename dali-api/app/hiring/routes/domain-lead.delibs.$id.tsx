import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { Link, redirect, useLoaderData, useNavigate, useRevalidator } from "react-router";
import type { Route } from "./+types/domain-lead.delibs.$id";
import type { DragEndEvent } from "@dnd-kit/core";
import { prisma } from "~/lib/db";
import { recordRouteVisit } from "~/lib/user-pages.server";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { parseSessionCookie } from "~/lib/cookies";
import { isCycleAdmin } from "~/lib/roles";
import { requirePageSignedOrRedirect } from "~/hiring/lib/confidentiality";
import { GripVertical } from "lucide-react";
import { KanbanBoard, type KanbanColumn } from "~/components/board/KanbanBoard";
import { buildColumnOrder } from "~/hiring/lib/delibs";
import { findRound, parseTimeline } from "~/hiring/lib/cycle-timeline";
import { delibsQualifier } from "~/hiring/lib/cycle-stages.server";
import { inReviewPipelineFilter } from "~/hiring/lib/application-pipeline-filter";
import { ApplicantContextModal } from "~/hiring/components/delibs/ApplicantContextModal";
import { buttonClasses } from "~/components/ui/Button";
import { Pill } from "~/hiring/components/cycle-setup/SetupCard";
import { RECOMMENDATION_TONES } from "~/hiring/lib/labels";
import { useOsChrome } from "~/components/os-chrome";
import { useDialog } from "~/components/ui/dialog";
import { anonLabelMapForCycle, releasedDaIds, blindUser } from "~/hiring/lib/anonymization.server";

export const meta: Route.MetaFunction = ({ data }) => {
  const domain = (data as any)?.session?.domain?.name;
  return [{ title: `${domain ? `${domain} ` : ""}delibs · DALI OS` }];
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);

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

  // Access: the cycle's admin tier (Core hiring leads, Admins-only for Lab
  // members cycles), or a domain lead for THIS session's domain. A
  // lead for another domain can't open the board — and because Core cycles hang
  // off the synthetic CORE domain (which regular leads don't hold), Core-cycle
  // delibs stay limited to Admins (+ any explicit CORE lead).
  const [admin, leadsThisDomain] = await Promise.all([
    isCycleAdmin(auth.user.sub, session.applicationCycleId),
    prisma.domainLeadAssignment.findFirst({
      where: { userId: auth.user.sub, domainId: session.domainId },
      select: { id: true },
    }),
  ]);
  if (!admin && !leadsThisDomain) return redirect("/");

  const confRedirect = await requirePageSignedOrRedirect(
    auth.user.sub,
    session.applicationCycleId,
    request,
  );
  if (confRedirect) return confRedirect;

  // After the domain-lead + confidentiality gates — this delibs session lands
  // in the lead's recents, keyed to the domain.
  recordRouteVisit(
    auth.user.sub,
    `/hiring/domain-lead/delibs/${params.id}`,
    `${session.domain?.name ?? "Domain"} delibs`,
    request,
  );

  const cycle = await prisma.applicationCycle.findUniqueOrThrow({
    where: { id: session.applicationCycleId },
    select: { id: true, timeline: true, anonymizeReview: true },
  });
  // The board's round sets its columns and who qualifies. A round removed from
  // the timeline leaves its board behind with nothing to show.
  const round = findRound(parseTimeline(cycle.timeline), session.roundId);
  const columns = round ? round.columns : [];

  // A board whose round is gone has nothing to qualify for, so skip the query.
  const domainApplications = round
    ? await prisma.domainApplication.findMany({
        where: {
          selected: true,
          // DomainApplication.domainId is the authoritative domain link.
          domainId: session.domainId,
          application: {
            applicationCycleId: session.applicationCycleId,
            ...inReviewPipelineFilter,
          },
          ...(await delibsQualifier(cycle, session.roundId, session.domainId)),
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
      })
    : [];

  // Blind review: with anonymizeReview on, cards read "Applicant N" until that
  // applicant's decision is released.
  if (cycle.anonymizeReview) {
    const released = await releasedDaIds(domainApplications.map((d) => d.id));
    const labelMap = await anonLabelMapForCycle(session.applicationCycleId);
    for (const da of domainApplications) {
      if (released.has(da.id)) continue;
      const label = labelMap.get(da.application.id);
      if (label) da.application.user = blindUser(da.application.user, label);
    }
  }

  const collabToken = parseSessionCookie(request);

  return { session, domainApplications, collabToken, userName, round, columns };
}

type DomainApp = any;

// Shared status hues (app.css --os-status-*), so a delibs column reads like the
// reviews board and the project task board, in both themes.
const token = (name: string, part: "fill" | "ink" | "edge") => `var(--os-status-${name}-${part})`;

const COLUMN_TOKENS: Record<string, string> = {
  "No Decision": "backlog",
  Interview: "todo",
  Advance: "todo",
  Accept: "done",
  Waitlist: "review",
  Reject: "cancelled",
};

export default function DelibsKanban() {
  const { session, domainApplications, collabToken, userName, round, columns } =
    useLoaderData<typeof loader>() as any;
  const navigate = useNavigate();
  const os = useOsChrome();
  const dialog = useDialog();

  const defaultColumn = columns[0];

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
  // end/cancel.
  const [dragItem, setDragItem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
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

  const isClosed = session.status === "Closed";

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
    // target. (Cross-column only — no within-column reorder.)
    for (const col of columns) {
      newOrder[col] = (newOrder[col] ?? []).filter((id: string) => id !== cardId);
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

  const kanbanColumns: KanbanColumn<DomainApp>[] = useMemo(
    () =>
      (columns as string[]).map((col) => {
        const name = COLUMN_TOKENS[col] ?? "backlog";
        const items = (columnOrder[col] ?? [])
          .map((id) => appMap.get(id))
          .filter((da): da is DomainApp => !!da);
        return {
          id: col,
          title: <span className="text-sm font-semibold">{col}</span>,
          cards: items,
          className: "flex min-h-[400px] w-full flex-col rounded-os-item bg-os-card",
          headerClassName: "flex items-center justify-between gap-2 rounded-t-os-item px-3 py-2",
          headerStyle: { background: token(name, "fill"), color: token(name, "ink") },
          listClassName: "flex flex-1 flex-col gap-2 p-2",
          headerExtra: (
            <span className="rounded-full border border-current/30 px-2 py-0.5 text-xs font-medium tabular-nums">
              {items.length}
            </span>
          ),
          renderEmpty: () => <p className="py-8 text-center text-sm text-os-grey">Empty</p>,
        };
      }),
    // appMap is rebuilt every render; columnOrder/columns drive the content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columns, columnOrder, domainApplications],
  );

  if (!round) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className={os.pageTitle}>Delibs · {session.domain.name}</h1>
        <p className={os.bodyText}>This board's round was removed from the cycle's timeline.</p>
        <Link to="/hiring/domain-lead" className="text-sm text-accent-coral hover:underline">
          Back to the domain page
        </Link>
      </div>
    );
  }

  async function confirmClose() {
    const counts = (columns as string[])
      .filter((c) => c !== defaultColumn)
      .map((c) => `${(columnOrder[c] ?? []).length} ${c.toLowerCase()}`)
      .join(", ");
    if (
      await dialog.confirm({
        title: "Close delibs and create draft decisions?",
        description: `${counts}. Anyone left in "${defaultColumn}" gets no decision.`,
        confirmLabel: "Close delibs",
        tone: "destructive",
      })
    )
      await handleClose();
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className={os.pageTitle}>
            {round.label} · {session.domain.name}
          </h1>
          <p className={os.bodyText}>Drag applications between columns. Changes save as you go.</p>
        </div>
        <div className="flex items-center gap-3">
          {saving && <span className="text-sm text-os-grey">Saving…</span>}
          {isClosed ? (
            <Pill>Closed</Pill>
          ) : (
            <button type="button" onClick={confirmClose} disabled={closing} className={buttonClasses("primary", "md")}>
              {closing ? "Closing…" : "Close delibs"}
            </button>
          )}
        </div>
      </div>

      {selectedDomainApplicationId && (
        <ApplicantContextModal
          domainApplicationId={selectedDomainApplicationId}
          onClose={() => setSelectedDomainApplicationId(null)}
          collabToken={collabToken}
          userName={userName}
          editable={round?.index === 0}
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
    <Pill key={key} dot={RECOMMENDATION_TONES[rec] ?? "neutral"}>
      {rec}
    </Pill>
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
      className={`rounded-os-item bg-os-well p-3 transition-all ${
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
            <span className="text-xs text-os-grey">
              {submittedCount}/{reviewCount} reviews
            </span>
            {avgScore !== null && (
              <span className="rounded-full bg-os-container px-2 py-0.5 text-xs font-medium text-foreground">
                avg {avgScore.toFixed(1)}
              </span>
            )}
          </div>
          {(hasReviewers || hasInterviewers) && (
            <div className="mt-2 space-y-2 border-t border-os-container pt-2">
              {hasReviewers && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-os-grey">
                    Reviewers
                  </p>
                  {reviewerNames.length > 0 && (
                    <p className="text-[10px] text-os-grey">
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
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-os-grey">
                    Interviewers
                  </p>
                  {interviewerNames.length > 0 && (
                    <p className="text-[10px] text-os-grey">
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
                    <p className="mt-0.5 text-[10px] italic text-os-grey">
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
