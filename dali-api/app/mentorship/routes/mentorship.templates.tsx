import { useEffect, useRef, useState } from "react";
import { redirect, useFetcher, useLoaderData, useRevalidator } from "react-router";
import { Plus, Star, Trash2 } from "lucide-react";
import type { Route } from "./+types/mentorship.templates";
import { requireAuth } from "~/lib/auth";
import { prisma } from "~/lib/db";
import { isCore } from "~/lib/roles";
import { RichTextEditor } from "~/components/RichTextEditor";
import { AreaPillNav } from "~/components/AreaPillNav";
import { mentorshipPills } from "../components/mentorshipPills";

// Surfaces the area subtab row (see layout.tsx's areaPills handling).
export const handle = { areaPills: true };

export const meta: Route.MetaFunction = () => [
  { title: "Mentorship templates · DALI OS" },
];

type Template = {
  id: string;
  name: string;
  isDefault: boolean;
  contentJson: unknown;
};

type LoaderData = {
  templates: Template[];
};

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (auth.user.type === "applicant") return redirect("/portal");
  if (!(await isCore(auth.user.sub))) {
    throw new Response("Forbidden", { status: 403 });
  }
  const templates = await prisma.mentorNoteTemplate.findMany({
    orderBy: [{ isDefault: "desc" }, { name: "asc" }],
    select: { id: true, name: true, isDefault: true, contentJson: true },
  });
  const data: LoaderData = { templates };
  return data;
}

export default function MentorshipTemplates() {
  const data = useLoaderData() as LoaderData;
  const revalidator = useRevalidator();
  const createFetcher = useFetcher();
  const [editing, setEditing] = useState<Template | null>(null);

  async function createTemplate() {
    const name = window.prompt("New template name?");
    if (!name) return;
    const res = await fetch("/api/mentorship/templates", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, isDefault: data.templates.length === 0 }),
    });
    if (res.ok) revalidator.revalidate();
  }

  async function setDefault(t: Template) {
    await fetch(`/api/mentorship/templates/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isDefault: true }),
    });
    revalidator.revalidate();
  }

  async function deleteTemplate(t: Template) {
    if (!confirm(`Delete template "${t.name}"?`)) return;
    await fetch(`/api/mentorship/templates/${t.id}`, { method: "DELETE" });
    if (editing?.id === t.id) setEditing(null);
    revalidator.revalidate();
  }

  return (
    <main className="flex flex-col gap-6">
      <AreaPillNav items={mentorshipPills({ isCore: true, active: "templates" })} />
      <header className="flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">
            Note templates
          </h1>
          <p className="text-sm text-muted-foreground">
            Templates seed every new mentor note. The default template applies
            automatically.
          </p>
        </div>
        <button
          type="button"
          onClick={createTemplate}
          disabled={createFetcher.state !== "idle"}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-accent-coral text-white text-sm hover:opacity-90 disabled:opacity-50"
        >
          <Plus className="w-4 h-4" />
          New template
        </button>
      </header>

      <section className="bg-card border border-border rounded-lg">
        {data.templates.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            No templates yet. The first one you create becomes the default.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {data.templates.map((t) => (
              <li key={t.id} className="p-4 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setEditing(t)}
                  className="flex items-center gap-2 text-left"
                >
                  {t.isDefault && (
                    <Star className="w-4 h-4 text-accent-coral fill-current" />
                  )}
                  <span className="font-medium text-foreground">{t.name}</span>
                </button>
                <div className="flex items-center gap-2 text-sm">
                  {!t.isDefault && (
                    <button
                      type="button"
                      onClick={() => setDefault(t)}
                      className="text-accent-coral hover:underline"
                    >
                      Make default
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => deleteTemplate(t)}
                    className="inline-flex items-center gap-1 text-muted-foreground hover:text-accent-coral"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && (
        <TemplateEditor
          key={editing.id}
          template={editing}
          onClose={() => {
            setEditing(null);
            revalidator.revalidate();
          }}
        />
      )}
    </main>
  );
}

function TemplateEditor({
  template,
  onClose,
}: {
  template: Template;
  onClose: () => void;
}) {
  const [content, setContent] = useState<unknown>(template.contentJson);
  const [name, setName] = useState(template.name);
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      setStatus("saving");
      try {
        const res = await fetch(`/api/mentorship/templates/${template.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, contentJson: content }),
        });
        if (!res.ok) throw new Error("save failed");
        setStatus("saved");
      } catch {
        setStatus("error");
      }
    }, 800);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [content, name, template.id]);

  return (
    <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="font-heading text-lg font-semibold text-foreground bg-transparent border-b border-border focus:outline-none focus:border-accent-coral flex-1"
        />
        <span className="text-xs text-muted-foreground">
          {status === "saving"
            ? "Saving…"
            : status === "saved"
            ? "Saved"
            : status === "error"
            ? "Save failed"
            : ""}
        </span>
        <button
          type="button"
          onClick={onClose}
          className="text-sm text-muted-foreground hover:text-foreground"
        >
          Close
        </button>
      </div>
      <RichTextEditor
        value={content}
        onChange={setContent}
        placeholder="Sections, prompts, headings the mentor will fill in each week…"
        className="min-h-[12rem]"
      />
    </section>
  );
}
