import { useState } from "react";
import { data, redirect, useRevalidator } from "react-router";
import { Presentation } from "lucide-react";
import { z } from "zod";
import type { Route } from "./+types/slides.$pageId";
import { requireAuth, redirectPartnerToPortal, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { parseJson } from "~/lib/validate";
import { cn } from "~/lib/cn";
import { recordPageVisit } from "~/lib/user-pages.server";
import { deckAccess, loadDeck, saveDeck } from "~/lib/slide-decks.server";
import { drivePageTrail, type DrivePageAncestry } from "~/lib/drive-page-trail";
import { loadDrivePageAncestry } from "~/lib/drive-page-trail.server";
import { prisma } from "~/lib/db";
import { buttonClasses } from "~/components/ui/Button";
import { Segmented } from "~/components/ui/Segmented";
import { SlideViewer } from "~/components/slides/SlideViewer";
import { SlideEditorWorkspace } from "~/components/slides/editor/SlideEditorWorkspace";
import { slidesSchema, parseSlides } from "~/components/slides/slide-schema";
import { slideIssues } from "~/components/slides/slide-edit";
import { useDeckAutosave, type DeckSaveState } from "~/components/slides/useDeckAutosave";
import type { Slide } from "~/components/slides/types";

function DeckCrumbIcon({ iconEmoji }: { iconEmoji?: string | null }) {
  return (
    <span className="flex w-4 flex-shrink-0 items-center justify-center leading-none" aria-hidden>
      {iconEmoji ? <span className="text-sm">{iconEmoji}</span> : <Presentation className="h-3.5 w-3.5 text-muted-foreground" />}
    </span>
  );
}

export const meta: Route.MetaFunction = ({ data }) => {
  const t = (data as { title?: string } | undefined)?.title;
  return [{ title: t ? `${t} · DALI OS` : "Slides · DALI OS" }];
};

export const handle = {
  fitViewport: true,
  breadcrumbTrail: (d: unknown) => {
    const loaded = d as Partial<DrivePageAncestry> | undefined;
    return drivePageTrail(loaded, <DeckCrumbIcon iconEmoji={loaded?.iconEmoji} />);
  },
};

async function requireMember(request: Request) {
  const auth = await requireAuth(request);
  if (!auth.ok) throw redirectToLogin(request);
  if (await isNonMember(auth, request)) throw redirect("/portal");
  const partnerRedirect = await redirectPartnerToPortal(auth);
  if (partnerRedirect) throw partnerRedirect;
  return auth.user.sub;
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const userId = await requireMember(request);
  const page = await prisma.page.findUnique({ where: { id: params.pageId }, select: { kind: true } });
  // A page of another kind reached via this URL opens on its own surface.
  if (page && page.kind !== "Slides") throw redirect(`/documents/${params.pageId}`);
  const access = await deckAccess(userId, params.pageId, request);
  if (!access.ok) throw new Response("Not found", { status: 404 });
  const full = await prisma.page.findUniqueOrThrow({
    where: { id: params.pageId },
    select: { title: true, iconEmoji: true, workspaceType: true, workspaceId: true, parentPageId: true },
  });
  const [deck, ancestry] = await Promise.all([loadDeck(params.pageId), loadDrivePageAncestry(full, userId, request)]);
  recordPageVisit(userId, params.pageId, request);
  return { pageId: params.pageId, canEdit: access.canEdit, ...ancestry, ...deck };
}

// A deck carries whole slide bodies, so it can outgrow the 1 MB default.
const MAX_BODY_BYTES = 4 * 1024 * 1024;
const bodySchema = z.object({ intent: z.literal("save"), slides: slidesSchema, version: z.string() });

export async function action({ request, params }: Route.ActionArgs) {
  const userId = await requireMember(request);
  const body = await parseJson(request, bodySchema, MAX_BODY_BYTES);
  if (body instanceof Response) return body;
  const slides = parseSlides(body.slides);
  if (!slides) return data({ ok: false as const, status: 400, error: "That deck couldn't be read." }, { status: 400 });
  const result = await saveDeck(userId, params.pageId, slides, body.version, request);
  return result.ok ? result : data(result, { status: result.status });
}

// Saves change nothing the page reads back, so skip reloading after them.
export function shouldRevalidate({ formMethod, defaultShouldRevalidate }: { formMethod?: string; defaultShouldRevalidate: boolean }) {
  return formMethod === "POST" ? false : defaultShouldRevalidate;
}

export default function SlideDeckPage({ loaderData }: Route.ComponentProps) {
  const { title, canEdit, slides, version } = loaderData;
  if (!canEdit) return <DeckViewer title={title} slides={slides} />;
  // Keyed by version: Reload after a conflict brings a newer one, which
  // restarts the working copy from what the other person saved.
  return <DeckEditor key={version} title={title} initialSlides={slides} version={version} />;
}

function DeckViewer({ title, slides }: { title: string; slides: Slide[] }) {
  const [index, setIndex] = useState(0);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <h1 className="font-heading text-2xl font-semibold">{title}</h1>
      <div className="min-h-0 flex-1">
        {slides.length === 0 ? (
          <p className="text-os-grey">This deck doesn't have any slides yet.</p>
        ) : (
          <SlideViewer slides={slides} index={index} onIndexChange={setIndex} finalAction={{ label: "Back to start", onClick: () => setIndex(0) }} />
        )}
      </div>
    </div>
  );
}

function SaveStatus({ state }: { state: DeckSaveState }) {
  const label: Record<DeckSaveState, string> = {
    saved: "Saved",
    unsaved: "Saving",
    saving: "Saving",
    conflict: "Someone else changed this deck",
    error: "Not saved",
  };
  const dot = state === "saved" ? "bg-os-green" : state === "conflict" || state === "error" ? "bg-destructive" : "bg-os-muted";
  return (
    <p className="flex items-center gap-2 text-sm text-os-grey" aria-live="polite">
      <span className={cn("h-2 w-2 rounded-full", dot)} aria-hidden />
      {label[state]}
    </p>
  );
}

type Mode = "edit" | "preview";

function DeckEditor({ title, initialSlides, version }: { title: string; initialSlides: Slide[]; version: string }) {
  const { revalidate } = useRevalidator();
  const { slides, edit, state, error, retry } = useDeckAutosave(initialSlides, version);
  const [mode, setMode] = useState<Mode>("edit");
  const [previewIndex, setPreviewIndex] = useState(0);
  const issues = slideIssues(slides);

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-6 gap-y-3">
        <h1 className="min-w-0 truncate font-heading text-2xl font-semibold">{title}</h1>
        <div className="flex flex-wrap items-center gap-3">
          <SaveStatus state={state} />
          {state === "conflict" && (
            <button type="button" onClick={() => revalidate()} className={buttonClasses("secondary", "sm")}>
              Reload
            </button>
          )}
          {state === "error" && (
            <button type="button" onClick={retry} title={error ?? undefined} className={buttonClasses("secondary", "sm")}>
              Try again
            </button>
          )}
          <Segmented
            ariaLabel="Mode"
            value={mode}
            onChange={setMode}
            options={[
              { value: "edit", label: "Edit" },
              { value: "preview", label: "Preview" },
            ]}
          />
        </div>
      </header>
      {issues.length > 0 && mode === "edit" && (
        <p className="shrink-0 text-sm text-os-amber" title={issues.join("\n")}>
          {issues.length === 1 ? issues[0] : `${issues.length} slides need a title or an image.`}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-hidden rounded-os-card bg-os-card">
        {mode === "edit" ? (
          <div className="os-form h-full">
            <SlideEditorWorkspace slides={slides} initialSlideId={null} onChangeSlides={edit} />
          </div>
        ) : slides.length === 0 ? (
          <p className="p-6 text-os-grey">Add a slide to preview it.</p>
        ) : (
          <SlideViewer
            slides={slides}
            index={Math.min(previewIndex, slides.length - 1)}
            onIndexChange={setPreviewIndex}
            finalAction={{ label: "Back to editing", onClick: () => setMode("edit") }}
          />
        )}
      </div>
    </div>
  );
}
