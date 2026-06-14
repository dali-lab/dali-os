import { useEffect, useRef, useState } from "react";
import { Link, redirect, useLoaderData } from "react-router";
import { ArrowLeft, Trash2 } from "lucide-react";
import type { Route } from "./+types/mentorship.notes.$id";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { RichTextEditor } from "~/components/RichTextEditor";
import { canViewMentorship } from "../lib/visibility";

export const meta: Route.MetaFunction = () => [
  { title: "Mentor note · DALI OS" },
];

type LoaderData = {
  id: string;
  weekOfIso: string;
  contentJson: unknown;
  mentor: { id: string; firstName: string; lastName: string };
  mentee: { id: string; firstName: string; lastName: string };
  projectName: string;
  termCode: string;
  domainDisplay: string;
  canEdit: boolean;
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
      mentor: { select: { id: true, firstName: true, lastName: true } },
      mentee: { select: { id: true, firstName: true, lastName: true } },
    },
  });
  if (!note) throw new Response("Not found", { status: 404 });

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

function fullName(u: { firstName: string; lastName: string }) {
  return `${u.firstName} ${u.lastName}`.trim();
}

export default function MentorNoteEditor() {
  const data = useLoaderData() as LoaderData;
  const [value, setValue] = useState<unknown>(data.contentJson);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const saveTimer = useRef<number | null>(null);

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
    if (!confirm("Delete this note? This cannot be undone.")) return;
    const res = await fetch(`/api/mentorship/notes/${data.id}`, {
      method: "DELETE",
    });
    if (res.ok) {
      window.location.assign("/mentorship");
    }
  }

  return (
    <main className="px-4 md:px-8 py-6 max-w-3xl mx-auto flex flex-col gap-4">
      <Link
        to="/mentorship"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to mentorship
      </Link>

      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-xl font-bold text-foreground">
          Notes on {fullName(data.mentee)}
        </h1>
        <p className="text-sm text-muted-foreground">
          {data.projectName} · {data.domainDisplay} · {data.termCode} · week of{" "}
          {fmt(data.weekOfIso)}
        </p>
        <p className="text-xs text-muted-foreground">
          Author: {fullName(data.mentor)}
        </p>
      </header>

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
          <button
            type="button"
            onClick={handleDelete}
            className="inline-flex items-center gap-1 text-accent-coral hover:underline"
          >
            <Trash2 className="w-3.5 h-3.5" />
            Delete
          </button>
        )}
      </div>

      <RichTextEditor
        value={value}
        onChange={setValue}
        disabled={!data.canEdit}
        placeholder="What went well, what's blocked, what to follow up on…"
        className="min-h-[16rem]"
      />
    </main>
  );
}
