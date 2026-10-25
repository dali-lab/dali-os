import { useEffect, useMemo, useState } from "react";
import { data, Link, redirect, useFetcher, useNavigate, useRevalidator } from "react-router";
import { Check, Eye, MonitorPlay, Plus, Unlink2 } from "lucide-react";
import { z } from "zod";
import type { Route } from "./+types/journeys.$domain.$journeyId.edit";
import { buttonClasses } from "~/components/ui/Button";
import { useDialog } from "~/components/ui/dialog";
import { cn } from "~/lib/cn";
import { parseJson } from "~/lib/validate";
import { NoEditAccess } from "~/journeys/components/NoEditAccess";
import { EditorGraph, parseEdgeId } from "~/journeys/components/graph/EditorGraph";
import { JourneyOverviewPanel } from "~/journeys/components/editor/JourneyOverviewPanel";
import { ModuleEditorPanel } from "~/journeys/components/editor/ModuleEditorPanel";
import { useDraftAutosave, type SaveState } from "~/journeys/components/editor/useDraftAutosave";
import { journeyContentSchema, parseJourneyContent } from "~/journeys/lib/content-schema";
import {
  deleteJourney,
  discardDraft,
  findDomain,
  loadEditorJourney,
  publishJourney,
  requireJourneyViewer,
  saveDraft,
  toDomain,
} from "~/journeys/lib/journeys.server";
import { journeyTitle, sameContent } from "~/journeys/lib/journey";
import { addDependency, createModule, removeDependency, updateModule } from "~/journeys/lib/journey-edit";
import { validateJourney } from "~/journeys/lib/journey-validation";
import { domainPath, journeyPath, JOURNEYS_HOME, previewPath } from "~/journeys/lib/paths";
import { AccessButton } from "~/journeys/components/AccessDialog";
import { BackLink } from "~/journeys/components/BackLink";
import type { Journey } from "~/journeys/lib/types";

export const meta: Route.MetaFunction = () => [{ title: "Edit journey · DALI OS" }];

export const handle = { fitViewport: true, hideBreadcrumbs: true };

export async function loader({ request, params }: Route.LoaderArgs) {
  const viewer = await requireJourneyViewer(request);
  const domain = await findDomain(params.domain);
  if (!domain) throw redirect(JOURNEYS_HOME);
  const editor = await loadEditorJourney(viewer, domain.id, params.journeyId);
  if (!editor) throw redirect(domainPath(toDomain(domain).slug));
  return { domain: toDomain(domain), editor };
}

// Journey JSON carries whole lesson documents, so it outgrows the 1 MB default.
const MAX_BODY_BYTES = 8 * 1024 * 1024;

const bodySchema = z.discriminatedUnion("intent", [
  z.object({ intent: z.literal("save"), draft: journeyContentSchema, version: z.string() }),
  z.object({ intent: z.literal("publish"), draft: journeyContentSchema, version: z.string() }),
  z.object({ intent: z.literal("discard") }),
  z.object({ intent: z.literal("delete") }),
]);

export async function action({ request, params }: Route.ActionArgs) {
  const viewer = await requireJourneyViewer(request);
  const body = await parseJson(request, bodySchema, MAX_BODY_BYTES);
  if (body instanceof Response) return body;
  const result = await (async () => {
    switch (body.intent) {
      case "save":
      case "publish": {
        const draft = parseJourneyContent(body.draft);
        if (!draft) return { ok: false as const, status: 400, error: "That draft couldn't be read." };
        const save = body.intent === "save" ? saveDraft : publishJourney;
        return save(viewer, params.journeyId, draft, body.version);
      }
      case "discard":
        return discardDraft(viewer, params.journeyId);
      case "delete":
        return deleteJourney(viewer, params.journeyId);
    }
  })();
  if (!result.ok) return data(result, { status: result.status });
  if (body.intent === "delete" || ("deleted" in result && result.deleted)) {
    throw redirect(domainPath(params.domain));
  }
  return { ...result, intent: body.intent };
}

// Autosaves change nothing the page reads back, so skip reloading after them.
export function shouldRevalidate({
  actionResult,
  defaultShouldRevalidate,
}: {
  actionResult?: unknown;
  defaultShouldRevalidate: boolean;
}) {
  if ((actionResult as { intent?: string } | undefined)?.intent === "save") return false;
  return defaultShouldRevalidate;
}

export default function JourneyEditorRoute({ loaderData }: Route.ComponentProps) {
  const { domain, editor } = loaderData;
  // Bumped after a discard so the working copy restarts from the server's draft.
  const [generation, setGeneration] = useState(0);
  if (!editor.role) {
    return (
      <NoEditAccess
        journeyName={editor.title.trim() || "Untitled journey"}
        owners={editor.owners}
        backHref={domainPath(domain.slug)}
        viewHref={editor.isPublished ? journeyPath(domain.slug, editor.id) : undefined}
      />
    );
  }
  return (
    <JourneyEditor
      key={`${editor.draft.id}:${generation}`}
      onDiscarded={() => setGeneration((g) => g + 1)}
      domain={domain}
      draft={editor.draft}
      published={editor.published}
      version={editor.version}
      isOwner={editor.role === "owner"}
      roleLabel={editor.role === "owner" ? "Owner" : "Can edit"}
    />
  );
}

function SaveStatus({ state, isLive, hasChanges, justPublished }: { state: SaveState; isLive: boolean; hasChanges: boolean; justPublished: boolean }) {
  const dot = (cls: string) => <span className={cn("h-2 w-2 rounded-full", cls)} aria-hidden />;
  let content;
  if (state === "conflict") content = <>{dot("bg-destructive")}Someone else changed this journey</>;
  else if (state === "error") content = <>{dot("bg-destructive")}Not saved</>;
  else if (state === "saving" || state === "unsaved") content = <>{dot("bg-os-muted")}Saving</>;
  else if (justPublished) content = <><Check className="h-4 w-4 text-os-green" aria-hidden />Published</>;
  else if (!isLive) content = <>{dot("bg-os-amber")}Draft, not published yet</>;
  else if (hasChanges) content = <>{dot("bg-os-amber")}Unpublished changes</>;
  else content = <>{dot("bg-os-green")}Up to date with live</>;
  return (
    <p className="flex items-center gap-2 text-sm text-os-grey" aria-live="polite">
      {content}
    </p>
  );
}

function JourneyEditor({
  domain,
  draft: initialDraft,
  published,
  version,
  isOwner,
  roleLabel,
  onDiscarded,
}: {
  domain: { slug: string; name: string };
  draft: Journey;
  published: Journey | null;
  version: string;
  isOwner: boolean;
  roleLabel: string;
  onDiscarded: () => void;
}) {
  const dialog = useDialog();
  const navigate = useNavigate();
  const { revalidate } = useRevalidator();
  const { draft, edit, state, error, publish, retry, publishing, published: publishCount } = useDraftAutosave(initialDraft, version);
  const lifecycle = useFetcher<{ ok: boolean; intent?: string; error?: string }>();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const [justPublished, setJustPublished] = useState(false);

  useEffect(() => {
    if (!publishCount) return;
    setJustPublished(true);
    const timer = window.setTimeout(() => setJustPublished(false), 2000);
    return () => window.clearTimeout(timer);
  }, [publishCount]);

  const issues = useMemo(() => validateJourney(draft), [draft]);
  const issueCounts = useMemo(
    () =>
      issues.reduce<Record<string, number>>((acc, i) => {
        if (i.moduleId) acc[i.moduleId] = (acc[i.moduleId] ?? 0) + 1;
        return acc;
      }, {}),
    [issues],
  );

  const isLive = published !== null;
  const hasChanges = !published || !sameContent(draft, published);
  const selected = draft.modules.find((m) => m.id === selectedId) ?? null;

  const handleAddModule = () => {
    const mod = createModule(draft, selectedId);
    edit((j) => ({ ...j, modules: [...j.modules, mod] }));
    setSelectedEdgeId(null);
    setSelectedId(mod.id);
  };

  const handleRemoveSelectedEdge = () => {
    const parsed = selectedEdgeId ? parseEdgeId(selectedEdgeId) : null;
    if (parsed) edit((j) => removeDependency(j, parsed.moduleId, parsed.prereqId));
    setSelectedEdgeId(null);
  };

  const handleDiscard = async () => {
    const ok = await dialog.confirm(
      isLive
        ? { title: "Discard unpublished changes?", description: "The draft goes back to what learners see now.", confirmLabel: "Discard", tone: "destructive" }
        : { title: "Discard this journey?", description: "It has never been published, so it's deleted.", confirmLabel: "Discard journey", tone: "destructive" },
    );
    if (ok) lifecycle.submit({ intent: "discard" }, { method: "post", encType: "application/json" });
  };

  const handleDelete = async () => {
    const ok = await dialog.confirm({
      title: `Delete ${journeyTitle(draft)}?`,
      description: isLive ? "It disappears for learners right away, along with their progress." : undefined,
      confirmLabel: "Delete journey",
      tone: "destructive",
    });
    if (ok) lifecycle.submit({ intent: "delete" }, { method: "post", encType: "application/json" });
  };

  // The fetcher goes idle only after the loaders have reloaded, so the fresh
  // draft is already in hand when the editor remounts.
  useEffect(() => {
    if (lifecycle.state === "idle" && lifecycle.data?.ok && lifecycle.data.intent === "discard") onDiscarded();
  }, [lifecycle.state, lifecycle.data, onDiscarded]);

  return (
    <div className="flex min-h-[760px] flex-1 flex-col gap-4 md:min-h-0">
      <header className="flex shrink-0 flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <BackLink to={domainPath(domain.slug)}>{`${domain.name} journeys`}</BackLink>
          <h1 className="mt-2 flex min-w-0 items-baseline gap-2 font-heading text-2xl font-semibold">
            <span className="truncate">{journeyTitle(draft)}</span>
            <span className="shrink-0 text-sm font-normal text-os-muted">Editing · {roleLabel}</span>
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <AccessButton journeyId={draft.id} variant="button" />
          <SaveStatus state={state} isLive={isLive} hasChanges={hasChanges} justPublished={justPublished} />
          {state === "conflict" && (
            <button type="button" onClick={() => revalidate()} className={buttonClasses("secondary", "md")}>
              Reload
            </button>
          )}
          {state === "error" && (
            <button type="button" onClick={retry} className={buttonClasses("secondary", "md")} title={error ?? undefined}>
              Try again
            </button>
          )}
          {hasChanges && (isLive || isOwner) && (
            <button type="button" onClick={handleDiscard} className={buttonClasses("ghost", "md")}>
              {isLive ? "Discard" : "Discard journey"}
            </button>
          )}
          <button
            type="button"
            onClick={() => navigate(previewPath(domain.slug, draft.id))}
            disabled={state !== "saved"}
            title={state === "saved" ? "See the draft as a learner, with every module open" : "Wait for your changes to save"}
            className={buttonClasses("secondary", "md")}
          >
            <MonitorPlay className="h-4 w-4" aria-hidden />
            Preview
          </button>
          {isLive && (
            <Link to={journeyPath(domain.slug, draft.id)} className={buttonClasses("secondary", "md")}>
              <Eye className="h-4 w-4" aria-hidden />
              View live
            </Link>
          )}
          <button
            type="button"
            onClick={publish}
            disabled={!hasChanges || issues.length > 0 || publishing || state === "conflict"}
            title={issues.length > 0 ? "Fix the listed issues first" : undefined}
            className={buttonClasses("primary", "md")}
          >
            Publish
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col gap-4">
        <div className="relative h-[300px] shrink-0 overflow-hidden rounded-os-card bg-os-well">
          <EditorGraph
            journey={draft}
            selectedId={selectedId}
            selectedEdgeId={selectedEdgeId}
            issueCounts={issueCounts}
            onSelectModule={setSelectedId}
            onSelectEdge={setSelectedEdgeId}
            onMove={(id, position) => edit((j) => updateModule(j, id, (m) => ({ ...m, position })))}
            onConnect={(prereqId, moduleId) => edit((j) => addDependency(j, moduleId, prereqId))}
            onRemoveDependency={(moduleId, prereqId) => {
              edit((j) => removeDependency(j, moduleId, prereqId));
              setSelectedEdgeId(null);
            }}
          />
          <div className="absolute left-4 top-4 flex flex-wrap items-center gap-2" data-graph-controls>
            <button type="button" onClick={handleAddModule} className={buttonClasses("secondary", "sm")}>
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {selected ? "Add module after this" : "Add module"}
            </button>
            {selectedEdgeId && (
              <button type="button" onClick={handleRemoveSelectedEdge} className={buttonClasses("secondary", "sm", "text-destructive")}>
                <Unlink2 className="h-3.5 w-3.5" aria-hidden />
                Remove dependency
              </button>
            )}
          </div>
        </div>

        <aside
          aria-label={selected ? "Module editor" : "Journey settings"}
          className="flex min-h-[520px] flex-1 flex-col overflow-hidden rounded-os-card bg-os-card md:min-h-0"
        >
          {selected ? (
            <ModuleEditorPanel
              key={selected.id}
              journey={draft}
              module={selected}
              issues={issues.filter((i) => i.moduleId === selected.id)}
              onChange={edit}
              onClose={() => setSelectedId(null)}
            />
          ) : (
            <JourneyOverviewPanel
              journey={draft}
              issues={issues}
              isPublished={isLive}
              isOwner={isOwner}
              onChange={edit}
              onDelete={handleDelete}
              onSelectModule={(id) => {
                setSelectedEdgeId(null);
                setSelectedId(id);
              }}
            />
          )}
        </aside>
      </div>
    </div>
  );
}
