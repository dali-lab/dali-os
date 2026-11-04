import { Link, useFetcher } from "react-router";
import { Modal, ModalHeader } from "~/components/Modal";
import { Select } from "~/components/ui/floating";
import { ProjectIcon } from "~/components/ProjectIcon";
import { cn } from "~/lib/cn";
import type { PlanningProjectInfo } from "../../lib/planning-gap.server";

// Inline project info popup shown when a planner clicks a project row. Keeps
// Core on the planning page while letting them read the project at a glance
// and self-assign as PI for the upcoming term — the single action the planning
// flow actually asks for. Deeper edits live on the project page, reached via
// "Open project" at the bottom.
export function PlanningProjectModal({
  project,
  info,
  coreMembers,
  currentTermId,
  canEditPi,
  onClose,
}: {
  project: { id: string; name: string; iconEmoji: string | null };
  info: PlanningProjectInfo;
  coreMembers: { userId: string; name: string }[];
  currentTermId: string | null;
  canEditPi: boolean;
  onClose: () => void;
}) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";
  const error =
    fetcher.data && typeof fetcher.data === "object" && "error" in fetcher.data
      ? String((fetcher.data as { error: unknown }).error)
      : null;

  const setPi = (termId: string, piUserId: string) => {
    const form = new FormData();
    form.set("intent", "pi");
    form.set("projectId", project.id);
    form.set("termId", termId);
    form.set("piUserId", piUserId);
    fetcher.submit(form, { method: "post", action: "/core/partners/planning" });
  };

  return (
    <Modal open onClose={onClose} labelledBy="planning-project-title">
      <ModalHeader
        titleId="planning-project-title"
        title={
          <span className="flex min-w-0 items-center gap-2">
            <ProjectIcon iconEmoji={project.iconEmoji} />
            <span className="min-w-0 truncate">{project.name}</span>
          </span>
        }
        subtitle={info.partnerNames.length > 0 ? info.partnerNames.join(", ") : undefined}
        onClose={onClose}
        closeLabel="Close project info"
      />

      <div className="flex flex-col gap-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="rounded-full bg-os-container/70 px-2 py-0.5 font-medium text-foreground">
            {info.status}
          </span>
          {info.plannedTerms.length > 0 && (
            <span>
              {info.plannedTerms.length} planned{" "}
              {info.plannedTerms.length === 1 ? "term" : "terms"} ahead
            </span>
          )}
        </div>

        {info.description && (
          <p className="whitespace-pre-line text-sm text-foreground">{info.description}</p>
        )}

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Principal Investigators
          </h3>
          {info.plannedTerms.length === 0 ? (
            <p className="text-sm italic text-muted-foreground">
              No planned terms ahead — nothing to assign a PI to yet.
            </p>
          ) : (
            <div className="flex flex-col gap-2 rounded-os-card bg-os-container/40 p-3">
              {info.plannedTerms.map((t) => {
                const pi = info.pisByTerm[t.id] ?? null;
                const isCurrent = currentTermId !== null && t.id === currentTermId;
                const options = [
                  { value: "", label: "No PI" },
                  ...(pi && !coreMembers.some((m) => m.userId === pi.userId)
                    ? [{ value: pi.userId, label: pi.name }]
                    : []),
                  ...coreMembers.map((m) => ({ value: m.userId, label: m.name })),
                ];
                return (
                  <div
                    key={t.id}
                    className="grid grid-cols-[minmax(70px,100px)_minmax(0,1fr)] items-center gap-3"
                  >
                    <div className="text-xs font-medium text-muted-foreground">
                      {t.code}
                      {isCurrent && (
                        <span className="ml-2 rounded border border-accent-teal/40 bg-accent-teal/15 px-1.5 py-0.5 text-[10px] text-accent-teal">
                          Current
                        </span>
                      )}
                    </div>
                    {canEditPi ? (
                      <Select
                        ariaLabel={`PI for ${t.code}`}
                        value={pi?.userId ?? ""}
                        onChange={(v) => setPi(t.id, v)}
                        options={options}
                      />
                    ) : (
                      <div className="text-sm text-foreground">
                        {pi?.name ?? (
                          <span className="italic text-muted-foreground">No PI</span>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {error && (
            <p className="text-xs text-destructive">{error}</p>
          )}
        </section>

        <div className="flex items-center justify-between pt-2">
          <Link
            to={`/projects/${project.id}`}
            className={cn(
              "text-sm font-medium text-os-accent hover:underline",
              busy && "pointer-events-none opacity-60",
            )}
          >
            Open project →
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
