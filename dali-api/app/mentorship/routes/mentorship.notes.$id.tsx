import { useEffect, useRef, useState } from "react";
import { redirect, useLoaderData } from "react-router";
import { Trash2, Smile, Meh, Frown } from "lucide-react";
import type { Route } from "./+types/mentorship.notes.$id";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { RichTextEditor } from "~/components/RichTextEditor";
import { Tooltip } from "~/components/ui/IconButton";
import { useDialog } from "~/components/ui/dialog";
import { AreaPillNav } from "~/components/AreaPillNav";
import { canViewMentorship, canViewMentorNote } from "../lib/visibility";
import { mentorshipPills } from "../components/mentorshipPills";
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
  if (!auth.ok) return redirect("/login");
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

  const [project, term, domain, core] = await Promise.all([
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
  ]);

  const data: LoaderData = {
    id: note.id,
    weekOfIso: note.weekOf.toISOString(),
    contentJson: note.contentJson,
    vibe: note.vibe,
    mentor: note.mentor,
    mentee: note.mentee,
    projectName: project?.name ?? "Unknown",
    termCode: term?.code ?? "?",
    domainDisplay: domain?.displayName ?? "Unknown",
    canEdit: note.mentorId === auth.user.sub || core,
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
  const [value, setValue] = useState<unknown>(data.contentJson);
  const [vibe, setVibe] = useState<Vibe | null>(data.vibe);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const saveTimer = useRef<number | null>(null);

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

  // Debounced autosave on edit. Authoritative state is server-side; if we miss
  // a flush, the next edit re-triggers it.
  useEffect(() => {
    if (!data.canEdit) return;
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(async () => {
      setStatus("saving");
      try {
        const res = await fetch(`/api/mentorship/notes/${data.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contentJson: value }),
        });
        if (!res.ok) throw new Error(`save failed: ${res.status}`);
        setStatus("saved");
      } catch {
        setStatus("error");
      }
    }, 800);
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
    };
  }, [value, data.id, data.canEdit]);

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
        <h1 className="font-heading text-xl font-bold text-foreground">
          Notes on {fullName(data.mentee)}
        </h1>
        <p className="text-xs text-muted-foreground">
          Author: {fullName(data.mentor)}
        </p>
      </header>

      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          Vibe check
          <span className="text-accent-coral ml-0.5" aria-hidden>
            *
          </span>
          :
        </span>
        <div className="flex items-center gap-1.5">
          {VIBES.map((v) => {
            const Icon = VIBE_ICON[v];
            const active = vibe === v;
            return (
              <button
                key={v}
                type="button"
                onClick={() => pickVibe(v)}
                disabled={!data.canEdit}
                aria-pressed={active}
                title={VIBE_META[v].label}
                className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs transition ${
                  active
                    ? VIBE_META[v].pill
                    : "border-border text-muted-foreground hover:text-foreground"
                } ${data.canEdit ? "" : "cursor-default opacity-70"}`}
              >
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {VIBE_META[v].label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
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
          <Tooltip label="Delete">
            <button
              type="button"
              onClick={handleDelete}
              aria-label="Delete"
              className="inline-flex items-center justify-center p-1.5 text-accent-coral hover:underline"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        )}
      </div>

      <RichTextEditor
        value={value}
        onChange={setValue}
        disabled={!data.canEdit}
        richToolbar
        enableImages
        placeholder="What went well, what's blocked, what to follow up on…"
        className="min-h-[24rem] w-full"
      />
    </main>
  );
}
