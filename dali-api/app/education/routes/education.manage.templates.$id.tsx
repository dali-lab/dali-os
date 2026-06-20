import { useState } from "react";
import { Link, redirect, useLoaderData, useNavigate, useRevalidator } from "react-router";
import type { Route } from "./+types/education.manage.templates.$id";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { getTemplate } from "~/education/lib/templates-data";
import { Button } from "~/components/ui/Button";

export const meta: Route.MetaFunction = ({ data }) => [
  { title: data && "template" in data ? `${(data as any).template.name} · Templates` : "Template · Education" },
];

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isCore(auth.user.sub))) {
    throw new Response("Forbidden", { status: 403 });
  }
  const template = await getTemplate(params.id);
  if (!template) throw new Response("Not found", { status: 404 });
  return {
    template: {
      id: template.id,
      name: template.name,
      description: template.description ?? "",
      questions: template.questions.map((q) => ({ prompt: q.prompt, required: q.required })),
    },
  };
}

export default function TemplateEditor() {
  const { template } = useLoaderData<typeof loader>();
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description);
  const [questions, setQuestions] = useState(template.questions);
  const [busy, setBusy] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const { revalidate } = useRevalidator();

  function update(i: number, patch: Partial<{ prompt: string; required: boolean }>) {
    setQuestions((prev) => prev.map((q, idx) => (idx === i ? { ...q, ...patch } : q)));
  }
  function add() {
    setQuestions((prev) => [...prev, { prompt: "", required: true }]);
  }
  function remove(i: number) {
    setQuestions((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function save() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/education/templates/${template.id}`, {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name,
        description,
        questions: questions.filter((q) => q.prompt.trim().length > 0),
      }),
    });
    setBusy(false);
    if (res.ok) {
      setSavedAt(new Date().toLocaleTimeString());
      revalidate();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Save failed");
    }
  }

  async function destroy() {
    if (!confirm("Delete this template? Offerings already using it keep their copy.")) return;
    const res = await fetch(`/api/education/templates/${template.id}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) navigate("/education/manage/templates");
  }

  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto">
      <div className="mb-4 flex items-center gap-3">
        <Link to="/education/manage/templates" className="text-xs text-muted-foreground hover:underline">
          ← All templates
        </Link>
      </div>

      <div className="space-y-4">
        <label className="block">
          <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm" />
        </label>
        <label className="block">
          <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">Description</span>
          <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm" />
        </label>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Questions</h3>
          <div className="space-y-2">
            {questions.map((q, i) => (
              <div key={i} className="rounded-lg border border-border bg-card p-3 space-y-2">
                <input
                  placeholder="Question text"
                  value={q.prompt}
                  onChange={(e) => update(i, { prompt: e.target.value })}
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
                />
                <div className="flex items-center justify-between">
                  <label className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <input type="checkbox" checked={q.required} onChange={(e) => update(i, { required: e.target.checked })} />
                    Required
                  </label>
                  <button onClick={() => remove(i)} className="text-xs text-red-600 hover:underline">Remove</button>
                </div>
              </div>
            ))}
            <Button size="sm" variant="secondary" onClick={add}>
              + Question
            </Button>
          </div>
        </div>

        {error && <div className="text-sm text-red-700">{error}</div>}
        {savedAt && <div className="text-sm text-green-700">Saved {savedAt}</div>}

        <div className="flex items-center gap-2 pt-2">
          <Button variant="primary" disabled={busy} onClick={save}>
            {busy ? "Saving..." : "Save template"}
          </Button>
          <button onClick={destroy} className="text-xs text-red-600 hover:underline ml-auto">
            Delete template
          </button>
        </div>
      </div>
    </div>
  );
}
