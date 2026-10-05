import { useMemo, useState } from "react";
import { useFetcher, Link } from "react-router";
import { Plus, Trash2, Check } from "lucide-react";
import { ProjectIcon } from "~/components/ProjectIcon";
import { PartnerFavicon } from "./PartnerFavicon";

export type LooseEnd = {
  id: string;
  text: string;
  done: boolean;
  createdAt: string;
  project: { id: string; name: string; iconEmoji: string | null } | null;
  partnerOrg: { id: string; name: string; faviconChar: string | null } | null;
};

// The hub's personal "backlog" — a per-user todo list that lives alongside
// the pipeline. Not a notification and not a project task; just the Core
// member's own list of partner-adjacent follow-ups.
export function LooseEnds({ todos }: { todos: LooseEnd[] }) {
  const addFetcher = useFetcher();
  const [text, setText] = useState("");
  const [showDone, setShowDone] = useState(false);

  // Optimistic append so the input clears instantly after submit — the loader
  // revalidates in the background and resyncs the row list.
  const pendingAdd = useMemo(() => {
    if (!addFetcher.formData) return null;
    if (addFetcher.formData.get("_intent") !== "todo/create") return null;
    const t = String(addFetcher.formData.get("text") ?? "").trim();
    return t ? t : null;
  }, [addFetcher.formData]);

  const list = useMemo(() => {
    const sorted = [...todos].sort(
      (a, b) =>
        Number(a.done) - Number(b.done) ||
        b.createdAt.localeCompare(a.createdAt),
    );
    const filtered = showDone ? sorted : sorted.filter((t) => !t.done);
    return filtered;
  }, [todos, showDone]);

  const openCount = todos.filter((t) => !t.done).length;

  function submitAdd(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;
    addFetcher.submit(
      { _intent: "todo/create", text: trimmed },
      { method: "post", action: "/partners" },
    );
    setText("");
  }

  return (
    <section className="hub-panel hub-loose-ends">
      <header className="hub-section-heading">
        <div className="flex-1">
          <h2>Loose ends<span className="hub-heading-count">{openCount}</span></h2>
          <p className="text-xs text-muted-foreground">
            Your follow-ups. A little less to keep in your head.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setShowDone((s) => !s)}
          aria-pressed={showDone}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          {showDone ? "Hide done" : "Show done"}
        </button>
      </header>
      <div className="px-3 pt-3">
        <form
          onSubmit={submitAdd}
          className="hub-todo-form"
        >
          <Plus className="h-4 w-4 text-muted-foreground" aria-hidden />
          <input
            type="text"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Jot a loose end…"
            aria-label="New loose end"
            // !bg-transparent beats the global `input` background rule from
            // app.css so the input doesn't paint a card-colored rectangle
            // over its parent's tint.
            className="flex-1 !bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          {text.trim() && (
            <button
              type="submit"
              className="text-[11px] font-semibold uppercase tracking-wider text-accent-coral hover:text-accent-coral-light"
            >
              Save
            </button>
          )}
        </form>
      </div>
      {addFetcher.data?.error && <p className="hub-form-error" role="alert">{addFetcher.data.error}</p>}
      <div className="hub-todo-list">
        {pendingAdd && (
          <LooseEndRow
            todo={{
              id: "pending",
              text: pendingAdd,
              done: false,
              createdAt: new Date().toISOString(),
              project: null,
              partnerOrg: null,
            }}
            pending
          />
        )}
        {list.length === 0 && !pendingAdd && (
          <p className="text-center text-xs text-muted-foreground py-10">
            Nothing loose. Cheers.
          </p>
        )}
        {list.map((t) => (
          <LooseEndRow key={t.id} todo={t} />
        ))}
      </div>
    </section>
  );
}

function LooseEndRow({ todo, pending }: { todo: LooseEnd; pending?: boolean }) {
  const toggleFetcher = useFetcher();
  const deleteFetcher = useFetcher();
  // Optimistic toggle: honor the in-flight value before the loader replies.
  const optimisticDone = toggleFetcher.formData
    ? toggleFetcher.formData.get("done") === "1"
    : todo.done;
  // Optimistic delete: hide the row before the loader replies.
  if (deleteFetcher.formData && deleteFetcher.formData.get("_intent") === "todo/delete") {
    return null;
  }

  return (
    <div className="hub-todo-row group">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          toggleFetcher.submit(
            { _intent: "todo/toggle", id: todo.id, done: optimisticDone ? "0" : "1" },
            { method: "post", action: "/partners" },
          )
        }
        aria-pressed={optimisticDone}
        aria-label={optimisticDone ? "Mark as not done" : "Mark as done"}
        className={
          optimisticDone
            ? "mt-0.5 h-4 w-4 shrink-0 rounded border border-os-accent bg-os-accent text-os-bg flex items-center justify-center"
            : "mt-0.5 h-4 w-4 shrink-0 rounded border border-border hover:border-os-container-hi"
        }
      >
        {optimisticDone && <Check className="h-3 w-3" strokeWidth={3} aria-hidden />}
      </button>
      <div className="flex-1 min-w-0">
        <div
          className={
            optimisticDone
              ? "text-sm text-muted-foreground line-through"
              : "text-sm text-foreground"
          }
        >
          {todo.text}
          {pending && <span className="ml-2 text-xs text-muted-foreground">(saving…)</span>}
        </div>
        {(todo.project || todo.partnerOrg) && (
          <div className="flex items-center gap-1.5 mt-1 flex-wrap">
            {todo.project && (
              <Link
                to={`/projects/${todo.project.id}`}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-os-well px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <ProjectIcon iconEmoji={todo.project.iconEmoji} size="sm" />
                {todo.project.name}
              </Link>
            )}
            {todo.partnerOrg && (
              <Link
                to={`/partners/${todo.partnerOrg.id}`}
                className="inline-flex items-center gap-1 rounded-full border border-border bg-os-well px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <PartnerFavicon name={todo.partnerOrg.name} size="xs" />
                {todo.partnerOrg.name}
              </Link>
            )}
          </div>
        )}
      </div>
      {!pending && (
        <button
          type="button"
          onClick={() =>
            deleteFetcher.submit(
              { _intent: "todo/delete", id: todo.id },
              { method: "post", action: "/partners" },
            )
          }
          className="hub-todo-delete text-muted-foreground hover:text-destructive"
          aria-label="Delete loose end"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}
