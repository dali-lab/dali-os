import { useState } from "react";
import { Link, redirect, useLoaderData, useNavigate, useRevalidator } from "react-router";
import type { Route } from "./+types/education.manage.templates";
import { requireAuth } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import { listTemplates } from "~/education/lib/templates-data";
import { Button } from "~/components/ui/Button";

export const meta: Route.MetaFunction = () => [{ title: "Application templates · Education" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isCore(auth.user.sub))) {
    throw new Response("Forbidden", { status: 403 });
  }
  const templates = await listTemplates();
  return {
    templates: templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description,
      createdAt: t.createdAt.toISOString(),
      questionCount: t._count.questions,
      createdBy: `${t.createdBy.firstName ?? ""} ${t.createdBy.lastName ?? ""}`.trim() || "Someone",
    })),
  };
}

export default function TemplatesList() {
  const data = useLoaderData<typeof loader>();
  const [creating, setCreating] = useState(false);
  return (
    <div className="p-6 md:p-10 max-w-3xl mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold text-dark-blue mt-2">Application templates</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Reusable question sets — apply with one click in the offering builder.
          </p>
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          + New template
        </Button>
      </div>

      {creating && <CreateForm onClose={() => setCreating(false)} />}

      {data.templates.length === 0 ? (
        <p className="text-sm text-muted-foreground italic">No templates yet.</p>
      ) : (
        <ul className="space-y-2">
          {data.templates.map((t) => (
            <li key={t.id}>
              <Link
                to={`/education/manage/templates/${t.id}`}
                className="block rounded-2xl border border-border bg-card p-4 hover:shadow-brand-2 transition"
              >
                <p className="font-semibold text-dark-blue">{t.name}</p>
                {t.description && <p className="text-sm text-muted-foreground mt-1">{t.description}</p>}
                <p className="text-xs text-muted-foreground mt-1">
                  {t.questionCount} question{t.questionCount === 1 ? "" : "s"} · by {t.createdBy} ·{" "}
                  {new Date(t.createdAt).toLocaleDateString()}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function CreateForm({ onClose }: { onClose: () => void }) {
  const [form, setForm] = useState({ name: "", description: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function create() {
    if (!form.name.trim()) {
      setError("Name required");
      return;
    }
    setBusy(true);
    setError(null);
    const res = await fetch("/api/education/templates", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.name,
        description: form.description || null,
        questions: [],
      }),
    });
    setBusy(false);
    if (res.ok) {
      const created = await res.json();
      navigate(`/education/manage/templates/${created.id}`);
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Create failed");
    }
  }

  return (
    <div className="mb-6 rounded-2xl border border-dashed border-border bg-card p-4 space-y-3">
      <h2 className="font-heading text-sm font-bold uppercase tracking-wider text-dark-blue">
        New template
      </h2>
      <input
        placeholder="Name (e.g. 'Standard miniseries application')"
        value={form.name}
        onChange={(e) => setForm({ ...form, name: e.target.value })}
        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
      />
      <textarea
        placeholder="Description (optional)"
        value={form.description}
        onChange={(e) => setForm({ ...form, description: e.target.value })}
        rows={2}
        className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm"
      />
      {error && <div className="text-sm text-red-700">{error}</div>}
      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" disabled={busy} onClick={create}>
          {busy ? "Creating..." : "Create"}
        </Button>
        <button onClick={onClose} className="text-xs text-muted-foreground hover:underline">
          Cancel
        </button>
      </div>
    </div>
  );
}
