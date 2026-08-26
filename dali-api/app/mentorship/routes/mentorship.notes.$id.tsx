import { useState } from "react";
import { redirect, useLoaderData } from "react-router";
import { Trash2, Smile, Meh, Frown } from "lucide-react";
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
import { useDialog } from "~/components/ui/dialog";
import { AreaPillNav } from "~/components/AreaPillNav";
import { canViewMentorship, canViewMentorNote } from "../lib/visibility";
import { mentorshipPills } from "../components/mentorshipPills";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { VIBES, VIBE_META, type Vibe } from "../lib/vibe";

type LoaderData = {
  id: string;
  weekOfIso: string;
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

// Suppresses the breadcrumb trail (see layout wayfinding contract).
export const handle = {
  areaPills: true,
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
      select: { code: true },
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
  });
}

const VIBE_ICON = { Good: Smile, Ok: Meh, Bad: Frown } as const;

export default function MentorNoteEditor() {
  const data = useLoaderData() as LoaderData;
  const dialog = useDialog();
  const { os, pageTitle, bodyText, iconBtn } = useOsChrome();
  const [vibe, setVibe] = useState<Vibe | null>(data.vibe);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );

  // The vibe is a discrete choice, so persist it immediately (no debounce).
  // Clicking the active vibe again clears it back to "no vibe set".
  async function pickVibe(next: Vibe) {
    if (!data.canEdit) return;
    const value = vibe === next ? null : next;
    setVibe(value);
    setStatus("saving");
    try {
      const res = await fetch(`/api/mentorship/notes/${data.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ vibe: value }),
      });
      if (!res.ok) throw new Error(`save failed: ${res.status}`);
      setStatus("saved");
    } catch {
      setStatus("error");
    }
  }

  async function handleDelete() {
    if (
      !(await dialog.confirm({
        title: "Delete this note?",
        description: "This cannot be undone.",
        confirmLabel: "Delete",
        tone: "destructive",
      }))
    )
      return;
    const res = await fetch(`/api/mentorship/notes/${data.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      window.location.assign("/mentorship");
    }
  }

  return (
    <main className="flex flex-col gap-4 w-full min-w-0">
      <AreaPillNav items={mentorshipPills({ active: "browse" })} />
      <header className="flex flex-col gap-1">
        <h1 className={pageTitle}>Notes on {fullName(data.mentee)}</h1>
        <p className={cn(bodyText, "inline-flex items-center gap-1")}>
          Author: {fullName(data.mentor)}
          <InfoTip content="Mentor notes are visible to the assigned mentor and Core members only — not to the mentee." />
        </p>
      </header>

      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn(bodyText, "inline-flex items-center gap-1")}>
          Vibe check
          <span className="text-accent-coral ml-0.5" aria-hidden>
            *
          </span>
          <InfoTip content="An at-a-glance signal for this week's note. Excellent = things are going well; Room for improvement = something to address; Concerning = needs follow-up. Visible to mentors and Core — not to the mentee." />
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
                  os ? "px-3.5 py-1.5 text-sm font-medium" : "px-2.5 py-1 text-xs",
                  active
                    ? VIBE_META[v].pill
                    : os
                    ? "border-os-container text-os-grey hover:border-os-container-hi hover:text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground",
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
      </div>

      <div className={cn("flex items-center justify-between", bodyText)}>
        <span>
          {data.canEdit
            ? status === "saving"
              ? "Saving…"
              : status === "saved"
              ? "Saved"
              : status === "error"
              ? "Save failed — try again"
              : "Auto-saves as you type"
            : "Read only"}
        </span>
        {data.canEdit && (
          <Tooltip content="Delete note">
            <button
              type="button"
              onClick={handleDelete}
              aria-label="Delete note"
              className={cn(
                "inline-flex items-center justify-center",
                os ? iconBtn : "p-1.5 text-accent-coral hover:underline",
              )}
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        )}
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
          className="min-h-[24rem] w-full"
        />
      ) : (
        <DocEditor
          features="notes"
          editable={false}
          initialContent={data.contentJson}
          className="min-h-[24rem] w-full"
        />
      )}
    </main>
  );
}
