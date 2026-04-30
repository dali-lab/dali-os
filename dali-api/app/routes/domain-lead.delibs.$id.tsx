import { useState, useCallback, useRef } from "react";
import { redirect, useLoaderData, useNavigate } from "react-router";
import type { Route } from "./+types/domain-lead.delibs.$id";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { isDomainLead } from "~/lib/roles";
import { requirePageSignedOrRedirect } from "~/lib/confidentiality";
import { ArrowLeft, GripVertical, X, Check } from "lucide-react";
import { INITIAL_COLUMNS, FINAL_COLUMNS } from "~/lib/delibs";
import { ApplicantContextModal } from "~/components/delibs/ApplicantContextModal";

export const meta: Route.MetaFunction = ({ data }) => {
  const domain = (data as any)?.session?.domain?.name;
  return [{ title: `${domain ? `${domain} ` : ""}delibs · DALI OS` }];
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return withAuth(auth, redirect("/login"));
  if (!(await isDomainLead(auth.user.sub))) return withAuth(auth, redirect("/"));

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
  // Final: interview completed, no post-interview Final/Released decision.
  const qualifyingFilter = session.type === "Initial"
    ? {
        reviews: { every: { submittedAt: { not: null } }, some: {} },
        decisions: { none: { stage: { in: ["Final" as const, "Released" as const] } } },
      }
    : {
        interviews: { some: { status: "Completed" as const } },
      };

  const domainApplications = await prisma.domainApplication.findMany({
    where: {
      challengeVersion: { domainId: session.domainId },
      application: {
        applicationCycleId: session.applicationCycleId,
        statusUpdates: { some: { newStatus: "Submitted" } },
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
              daliMember: {
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
      interviews: { where: { status: { in: ["Scheduled", "Completed"] } } },
    },
  });

  return withAuth(auth, { session, domainApplications });
}

type LoaderResult = {
  session: Awaited<ReturnType<typeof prisma.delibsSession.findUniqueOrThrow<any>>>;
  domainApplications: any[];
};
type DomainApp = any;

export default function DelibsKanban() {
  const { session, domainApplications } = useLoaderData<typeof loader>() as any;
  const navigate = useNavigate();

  const columns =
    session.type === "Initial" ? INITIAL_COLUMNS : FINAL_COLUMNS;
  const defaultColumn = columns[0];

  // Build lookup map
  const appMap = new Map<string, DomainApp>();
  for (const da of domainApplications) {
    appMap.set(da.id, da);
  }

  // Initialize column order from session or place all in default column
  const savedOrder = (session.columnOrder ?? {}) as Record<string, string[]>;
  const initialOrder: Record<string, string[]> = {};
  const placed = new Set<string>();

  for (const col of columns) {
    initialOrder[col] = [];
    for (const id of savedOrder[col] ?? []) {
      if (appMap.has(id) && !placed.has(id)) {
        initialOrder[col].push(id);
        placed.add(id);
      }
    }
  }
  // Place any unplaced apps in the default column
  for (const da of domainApplications) {
    if (!placed.has(da.id)) {
      initialOrder[defaultColumn].push(da.id);
    }
  }

  const [columnOrder, setColumnOrder] =
    useState<Record<string, string[]>>(initialOrder);
  const [dragItem, setDragItem] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [showCloseConfirm, setShowCloseConfirm] = useState(false);
  const [selectedDomainApplicationId, setSelectedDomainApplicationId] =
    useState<string | null>(null);
  // HTML5 drag-and-drop fires a stray `click` after `dragend` on some browsers;
  // suppress the modal-open click that immediately follows a drag.
  const wasDragging = useRef(false);

  const sendMove = useCallback(
    async (cardId: string, toColumn: string) => {
      setSaving(true);
      const res = await fetch(`/api/delibs/${session.id}/moves`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cardId, toColumn }),
      });
      if (res.ok) {
        const updated = await res.json();
        const serverOrder = (updated.columnOrder ?? {}) as Record<string, string[]>;
        // Reconcile from server's authoritative order so concurrent moves by
        // other reviewers surface without a page reload.
        const reconciled: Record<string, string[]> = {};
        for (const col of columns) reconciled[col] = serverOrder[col] ?? [];
        setColumnOrder(reconciled);
      }
      setSaving(false);
    },
    [session.id, columns]
  );

  function handleDragStart(id: string) {
    setDragItem(id);
    wasDragging.current = true;
  }

  function handleDragOver(e: React.DragEvent, col: string) {
    e.preventDefault();
    setDragOverCol(col);
  }

  function handleDrop(targetCol: string) {
    if (!dragItem) return;

    const cardId = dragItem;
    const newOrder = { ...columnOrder };
    // Optimistic local update
    for (const col of columns) {
      newOrder[col] = newOrder[col].filter((id) => id !== cardId);
    }
    newOrder[targetCol] = [...(newOrder[targetCol] ?? []), cardId];

    setColumnOrder(newOrder);
    setDragItem(null);
    setDragOverCol(null);
    sendMove(cardId, targetCol);
  }

  function handleDragEnd() {
    setDragItem(null);
    setDragOverCol(null);
  }

  async function handleClose() {
    setClosing(true);
    const res = await fetch(`/api/delibs/${session.id}`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intent: "close" }),
    });
    if (res.ok) {
      navigate("/domain-lead");
    }
    setClosing(false);
  }

  const isClosed = session.status === "Closed";

  const COLUMN_STYLES: Record<string, { bg: string; border: string; header: string; badge: string }> = {
    "No Decision": { bg: "bg-muted/50", border: "border-border", header: "text-foreground/80", badge: "bg-card text-muted-foreground border-border" },
    Interview: { bg: "bg-blue-50/50", border: "border-blue-200", header: "text-blue-800", badge: "bg-card text-blue-700 border-blue-200" },
    Accept: { bg: "bg-green-50/50", border: "border-green-200", header: "text-green-800", badge: "bg-card text-green-700 border-green-200" },
    Waitlist: { bg: "bg-yellow-50/50", border: "border-yellow-200", header: "text-yellow-800", badge: "bg-card text-yellow-700 border-yellow-200" },
    Reject: { bg: "bg-red-50/50", border: "border-red-200", header: "text-red-800", badge: "bg-card text-red-700 border-red-200" },
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <button
            onClick={() => navigate("/domain-lead")}
            className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground/80 mb-2"
          >
            <ArrowLeft className="w-4 h-4 mr-1" /> Back to Dashboard
          </button>
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
        />
      )}

      {/* Kanban Board */}
      <div className={`grid gap-4`} style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}>
        {columns.map((col) => {
          const style = COLUMN_STYLES[col] ?? COLUMN_STYLES["No Decision"];
          const items = columnOrder[col] ?? [];

          return (
            <div
              key={col}
              className={`rounded-xl border ${style.border} ${style.bg} p-4 min-h-[400px] transition-all ${
                dragOverCol === col ? "ring-2 ring-blue-400" : ""
              }`}
              onDragOver={(e) => handleDragOver(e, col)}
              onDrop={() => handleDrop(col)}
              onDragLeave={() => setDragOverCol(null)}
            >
              <div className="flex items-center justify-between border-b pb-2 mb-3" style={{ borderColor: "inherit" }}>
                <h3 className={`font-bold ${style.header}`}>{col}</h3>
                <span
                  className={`px-2 py-0.5 rounded-full text-xs font-bold border shadow-sm ${style.badge}`}
                >
                  {items.length}
                </span>
              </div>

              <div className="space-y-2">
                {items.map((id) => {
                  const da = appMap.get(id);
                  if (!da) return null;

                  const reviewCount = da.reviews.length;
                  const submittedCount = da.reviews.filter(
                    (r: any) => r.submittedAt
                  ).length;
                  const avgScore = da.reviews.length > 0
                    ? da.reviews.reduce((sum: number, r: any) => {
                        const scores = r.scores as Record<string, number>;
                        const vals = Object.values(scores);
                        return sum + (vals.length > 0 ? vals.reduce((a: number, b: number) => a + b, 0) / vals.length : 0);
                      }, 0) / da.reviews.length
                    : null;

                  return (
                    <div
                      key={id}
                      draggable={!isClosed}
                      onDragStart={() => handleDragStart(id)}
                      onDragEnd={handleDragEnd}
                      onClick={() => {
                        if (wasDragging.current) {
                          wasDragging.current = false;
                          return;
                        }
                        setSelectedDomainApplicationId(id);
                      }}
                      className={`bg-card p-3 rounded-lg border border-border shadow-sm transition-all ${
                        isClosed
                          ? "cursor-pointer"
                          : "cursor-grab hover:shadow-md active:cursor-grabbing"
                      } ${dragItem === id ? "opacity-50" : ""}`}
                    >
                      <div className="flex items-start gap-2">
                        {!isClosed && (
                          <GripVertical className="w-4 h-4 text-muted-foreground/50 mt-0.5 flex-shrink-0" />
                        )}
                        <div className="flex-1 min-w-0">
                          <h4 className="font-bold text-foreground text-sm truncate">
                            {da.application.user.firstName}{" "}
                            {da.application.user.lastName}
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
                          {da.reviews
                            .filter((r: any) => r.overallRecommendation)
                            .map((r: any) => (
                              <span
                                key={r.id}
                                className="inline-block mt-1 mr-1 text-[10px] font-medium px-1.5 py-0.5 rounded border border-border bg-muted/50 text-muted-foreground"
                              >
                                {r.overallRecommendation}
                              </span>
                            ))}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {items.length === 0 && (
                  <div className="py-8 text-center border-2 border-dashed border-gray-300 rounded-lg bg-card/50">
                    <p className="text-sm text-muted-foreground/70 italic">Empty</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
