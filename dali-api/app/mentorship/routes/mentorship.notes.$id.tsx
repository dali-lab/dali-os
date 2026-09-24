import { useState } from "react";
import { redirect, useLoaderData } from "react-router";
import { Smile, Meh, Frown } from "lucide-react";
import type { Route } from "./+types/mentorship.notes.$id";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db";
import { recordRouteVisit } from "~/lib/user-pages.server";
import { isCore } from "~/lib/roles";
import { parseSessionCookie } from "~/lib/cookies";
import { DocEditor } from "~/components/doc";
import { ensureBlocks } from "~/collab/legacy/pm-to-blocknote";
import { Tooltip, InfoTip } from "~/components/ui/floating";
import { canViewMentorship, canViewMentorNote } from "../lib/visibility";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { VIBES, VIBE_META, type Vibe } from "../lib/vibe";
import { weekNumberInTerm } from "../lib/week";

type LoaderData = {
  id: string;
  weekOfIso: string;
  weekNumber: number | null;
  contentJson: unknown;
  vibe: Vibe | null;
  mentor: { id: string; firstName: string; lastName: string };
  mentee: { id: string; firstName: string; lastName: string };
  projectName: string;
  termCode: string;
  domainDisplay: string;
  canEdit: boolean;
  collabToken: string | null;
  userName: string;
};

function fullName(u: { firstName: string; lastName: string }) {
  return `${u.firstName} ${u.lastName}`.trim();
}

export const meta: Route.MetaFunction = () => [
  { title: "Mentor note · DALI OS" },
];

export const handle = {
  docKey: "mentorship.notes",
  docTitle: "Mentorship notes",
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");
  if (!(await canViewMentorship(auth.user.sub))) {
    throw new Response("Forbidden", { status: 403 });
  }

  const note = await prisma.mentorNote.findUnique({
    where: { id: params.id! },
    select: {
      id: true,
      mentorId: true,
      menteeId: true,
      projectId: true,
      termId: true,
      domainId: true,
      weekOf: true,
      contentJson: true,
      vibe: true,
      mentor: { select: { id: true, firstName: true, lastName: true } },
      mentee: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (!note) throw new Response("Not found", { status: 404 });
  if (!(await canViewMentorNote(auth.user.sub, note))) {
    throw new Response("Forbidden", { status: 403 });
  }

  // After the visibility gate — the note the viewer can open lands in recents.
  recordRouteVisit(
    auth.user.sub,
    `/mentorship/notes/${note.id}`,
    `${fullName(note.mentee)} — mentor note`,
    request,
  );

  const [project, term, domain, core, me] = await Promise.all([
    prisma.project.findUnique({
      where: { id: note.projectId },
      select: { name: true },
    }),
    prisma.term.findUnique({
      where: { id: note.termId },
      select: { code: true, startDate: true },
    }),
    prisma.domain.findUnique({
      where: { id: note.domainId },
      select: { displayName: true },
    }),
    isCore(auth.user.sub),
    prisma.user.findUnique({
      where: { id: auth.user.sub },
      select: { firstName: true, lastName: true },
    }),
  ]);

  const data: LoaderData = {
    id: note.id,
    weekOfIso: note.weekOf.toISOString(),
    weekNumber: term ? weekNumberInTerm(note.weekOf, term.startDate) : null,
    // Read view renders blocks; legacy rows still hold ProseMirror JSON until
    // their first collab edit, so normalize server-side.
    contentJson: ensureBlocks(note.contentJson),
    vibe: note.vibe,
    mentor: note.mentor,
    mentee: note.mentee,
    projectName: project?.name ?? "Unknown",
    termCode: term?.code ?? "?",
    domainDisplay: domain?.displayName ?? "Unknown",
    canEdit: note.mentorId === auth.user.sub || core,
    collabToken: parseSessionCookie(request),
    userName: [me?.firstName, me?.lastName].filter(Boolean).join(" ") || "Mentor",
  };
  return data;
}

function fmt(d: string) {
  return new Date(d).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    // weekOf is a Monday at UTC midnight; local time would show Sunday in the US.
    timeZone: "UTC",
  });
}

// Cancel BlockNote's drag-handle gutter (theme.css: 0.75rem mobile, 54px sm+)
// so body text lines up with the page header.
const EDITOR_CLASS =
  "min-h-[24rem] -ml-3 w-[calc(100%+0.75rem)] sm:-ml-[54px] sm:w-[calc(100%+54px)]";

const VIBE_ICON = { Good: Smile, Ok: Meh, Bad: Frown } as const;

export default function MentorNoteEditor() {
  const data = useLoaderData() as LoaderData;
  const { pageTitle, bodyText } = useOsChrome();
  const [vibe, setVibe] = useState<Vibe | null>(data.vibe);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );

  // The vibe is a discrete choice, so persist it immediately (no debounce). It's
  // required (a note without one reads as "not filled in" on the grid), so
  // picking is one-way — clicking the active vibe again doesn't clear it.
  async function pickVibe(next: Vibe) {
    if (!data.canEdit || vibe === next) return;
    setVibe(next);
    setStatus("saving");
    try {
      const res = await fetch(`/api/mentorship/notes/${data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vibe: next }),
      });
      if (!res.ok) throw new Error(`save failed: ${res.status}`);
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }

  return (
    <main className="flex flex-col gap-4 w-full min-w-0">
      <header className="flex flex-col gap-1">
        <h1 className={pageTitle}>Notes on {fullName(data.mentee)}</h1>
        <p className="text-base text-os-grey">
          {data.weekNumber != null && `Week ${data.weekNumber} · `}
          {fmt(data.weekOfIso)}
        </p>
        <p className={cn(bodyText, "inline-flex items-center gap-1")}>
          Author: {fullName(data.mentor)}
          <InfoTip content="Mentor notes are visible to all lab mentors and Core members — not to the mentee. Only the author or Core can edit a note." />
        </p>
      </header>

      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn(bodyText, "inline-flex items-center gap-1")}>
          Vibe check
          <span className="text-accent-coral ml-0.5" aria-hidden>
            *
          </span>
          <InfoTip content="How this week went. Excellent means things are going well, Room for improvement means something to work on, Concerning means it needs follow-up. Mentors and Core can see this, the mentee can't." />
          :
        </span>
        <div className="flex items-center gap-1.5">
          {VIBES.map((v) => {
            const Icon = VIBE_ICON[v];
            const active = vibe === v;
            const vibeButton = (
              <button
                key={v}
                type="button"
                onClick={() => pickVibe(v)}
                disabled={!data.canEdit}
                aria-pressed={active}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border transition",
                  "px-3.5 py-1.5 text-sm font-medium",
                  active
                    ? VIBE_META[v].pill
                    : "border-os-container text-os-grey hover:border-os-container-hi hover:text-foreground",
                  data.canEdit ? "" : "cursor-default opacity-70",
                )}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {VIBE_META[v].label}
              </button>
            );
            if (!data.canEdit) {
              return (
                <Tooltip
                  key={v}
                  content="Read only — only the mentor or Core can set the vibe."
                  variant="rich"
                >
                  {/* Disabled buttons don't fire hover events; span captures them. */}
                  <span>{vibeButton}</span>
                </Tooltip>
              );
            }
            return vibeButton;
          })}
        </div>
        <span className={cn(bodyText, "ml-auto")}>
          {!data.canEdit
            ? "Read only"
            : status === "saving"
            ? "Saving…"
            : status === "saved"
            ? "Saved"
            : status === "error"
            ? "Save failed, try again"
            : null}
        </span>
      </div>

      {data.canEdit && data.collabToken ? (
        <DocEditor
          features="notes"
          collab={{
            documentName: `mentorNote:${data.id}:body`,
            token: data.collabToken,
            userName: data.userName,
          }}
          placeholder="What went well, what's blocked, what to follow up on…"
          className={EDITOR_CLASS}
        />
      ) : (
        <DocEditor
          features="notes"
          editable={false}
          initialContent={data.contentJson}
          className={EDITOR_CLASS}
        />
      )}
    </main>
  );
}
