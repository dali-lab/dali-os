import { useEffect, useMemo, useState } from "react";
import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/admin-console.announcements";
import { prisma } from "~/lib/db";
import { listVisibleGroupsForUser } from "~/lib/groups";
import { requireAuth } from "~/lib/auth";
import { isCore, currentTermMemberWhere } from "~/lib/roles";
import { MEMBER_LIST_ORDER_BY } from "~/lib/prisma-shapes";
import { fullName } from "~/lib/display";
import {
  Megaphone,
  Search,
  Users,
  UserRound,
  Globe,
  Paperclip,
  CheckCircle2,
} from "lucide-react";

export const meta: Route.MetaFunction = () => [
  { title: "Announcements · Operations · DALI OS" },
];

// Admin composer: write an announcement or a todo and send it to the whole
// lab, specific people, or a user group, with an optional due date and an
// optional attached published form. Sending fans out via the shared
// /api/notifications/send endpoint (one Notification row per recipient).

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isCore(auth.user.sub))) return redirect("/");

  // Recipient picker is for sending to current lab members — alumni and
  // applicants are excluded so a stale autocomplete suggestion can't
  // accidentally notify someone who's no longer on the lab roster.
  const memberWhere = await currentTermMemberWhere();
  const [users, visibleGroups, forms] = await Promise.all([
    prisma.user.findMany({
      where: memberWhere,
      orderBy: MEMBER_LIST_ORDER_BY,
      select: { id: true, firstName: true, lastName: true, daliEmail: true },
    }),
    listVisibleGroupsForUser(auth.user.sub),
    prisma.form.findMany({
      where: { published: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return {
    members: users.map((u) => ({
      id: u.id,
      name: fullName(u),
      email: u.daliEmail,
    })),
    groups: visibleGroups.map((g) => ({ id: g.id, name: g.name })),
    publishedForms: forms,
  };
}

export default function AnnouncementsPage() {
  const { members, groups, publishedForms } = useLoaderData<typeof loader>();

  // Composable audience: any mix of whole-lab + groups + individuals.
  const [allMembers, setAllMembers] = useState(false);
  const [pickedGroups, setPickedGroups] = useState<Set<string>>(new Set());
  const [pickedUsers, setPickedUsers] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [groupSearch, setGroupSearch] = useState("");

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [formId, setFormId] = useState("");
  const [formSearch, setFormSearch] = useState("");

  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<
    { ok: true; count: number } | { ok: false; error: string } | null
  >(null);

  // Auto-dismiss the success confirmation after a few seconds; errors stay
  // until the next send attempt.
  useEffect(() => {
    if (result?.ok) {
      const t = setTimeout(() => setResult(null), 6000);
      return () => clearTimeout(t);
    }
  }, [result]);

  const filteredMembers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return members;
    return members.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.email ?? "").toLowerCase().includes(q),
    );
  }, [members, search]);

  const filteredForms = useMemo(() => {
    const q = formSearch.trim().toLowerCase();
    if (!q) return publishedForms;
    return publishedForms.filter((f) => f.name.toLowerCase().includes(q));
  }, [publishedForms, formSearch]);

  const filteredGroups = useMemo(() => {
    const q = groupSearch.trim().toLowerCase();
    if (!q) return groups;
    return groups.filter((g) => g.name.toLowerCase().includes(q));
  }, [groups, groupSearch]);

  const selectedForm = publishedForms.find((f) => f.id === formId) ?? null;

  function toggleIn(
    setter: React.Dispatch<React.SetStateAction<Set<string>>>,
    id: string,
  ) {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const hasAudience =
    allMembers || pickedGroups.size > 0 || pickedUsers.size > 0;
  const canSend = title.trim().length > 0 && !sending && hasAudience;

  async function send() {
    setResult(null);
    setSending(true);
    try {
      const payload: Record<string, unknown> = {
        title: title.trim(),
        kind: "SystemAnnouncement",
        // Every send is actionable: it appears in recipients' Tasks.
        isTodo: true,
        allMembers,
        groupIds: Array.from(pickedGroups),
        userIds: Array.from(pickedUsers),
      };
      if (body.trim()) payload.body = body.trim();
      if (dueAt) payload.dueAt = new Date(dueAt).toISOString();
      if (formId) payload.formId = formId;

      const res = await fetch("/api/notifications/send", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const out = (await res.json().catch(() => ({}))) as {
        error?: string;
        count?: number;
      };
      if (!res.ok) {
        setResult({ ok: false, error: out.error ?? `Failed (${res.status}).` });
        return;
      }
      setResult({ ok: true, count: out.count ?? 0 });
      // Full reset after a successful send — clear the message, the attached
      // form, and the audience so the next one starts blank.
      setTitle("");
      setBody("");
      setDueAt("");
      setFormId("");
      setFormSearch("");
      setAllMembers(false);
      setPickedGroups(new Set());
      setPickedUsers(new Set());
      setSearch("");
      setGroupSearch("");
    } catch {
      setResult({ ok: false, error: "Network error — please try again." });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      <header className="flex items-start gap-3">
        <Megaphone className="w-6 h-6 text-accent-coral mt-0.5" />
        <div>
          <h1 className="font-heading text-2xl font-bold text-foreground">
            Announcements
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Send an announcement to the lab. It shows in recipients' Tasks and
            can carry a due date and an attached form.
          </p>
        </div>
      </header>

      {result && (
        <div
          className={`text-sm rounded-md px-3 py-2 border ${
            result.ok
              ? "bg-accent-coral/10 border-accent-coral/30 text-foreground"
              : "bg-destructive/10 border-destructive/30 text-destructive"
          }`}
        >
          {result.ok
            ? `Sent to ${result.count} recipient${result.count === 1 ? "" : "s"}.`
            : result.error}
        </div>
      )}

      {/* Due date */}
      <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">Due date</h2>
        <label className="flex flex-col gap-1 text-xs">
          <span className="text-muted-foreground">
            Optional — shown as the deadline in recipients' Tasks.
          </span>
          <input
            type="datetime-local"
            value={dueAt}
            onChange={(e) => setDueAt(e.target.value)}
            className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground w-64"
          />
        </label>
      </section>

      {/* Message */}
      <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
        <h2 className="text-sm font-semibold text-foreground">Message</h2>
        <input
          type="text"
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={200}
          className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
        />
        <textarea
          placeholder="Body (optional)"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          maxLength={2000}
          className="px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
        />
      </section>

      {/* Attach a form — its own card so it doesn't disappear under the body */}
      <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <Paperclip className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold text-foreground">
            Attach a form
          </h2>
          <span className="text-xs text-muted-foreground">
            optional · published forms only
          </span>
        </div>

        {publishedForms.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No published forms yet — publish a form from the Forms tab to
            attach it.
          </p>
        ) : selectedForm ? (
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-2 px-3 py-1.5 text-sm rounded-md border border-accent-coral/40 bg-accent-coral/10 text-foreground">
              <Paperclip className="w-3.5 h-3.5 text-accent-coral" />
              {selectedForm.name}
            </span>
            <button
              type="button"
              onClick={() => {
                setFormId("");
                setFormSearch("");
              }}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              Change
            </button>
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search published forms…"
                value={formSearch}
                onChange={(e) => setFormSearch(e.target.value)}
                className="w-72 pl-7 pr-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground"
              />
            </div>
            {formSearch.trim() && (
              <div className="max-h-48 w-72 overflow-y-auto border border-border rounded-md divide-y divide-border">
                {filteredForms.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => {
                      setFormId(f.id);
                      setFormSearch("");
                    }}
                    className="block w-full text-left px-3 py-2 text-sm text-foreground hover:bg-muted/40"
                  >
                    {f.name}
                  </button>
                ))}
                {filteredForms.length === 0 && (
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    No matching forms.
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </section>

      {/* Audience — compose freely; recipients are the union of all of these */}
      <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-4">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Audience</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            {allMembers
              ? "Going to the whole lab."
              : "Combine groups and people — recipients are everyone matched by at least one."}
          </p>
        </div>

        {/* Whole lab — when on, it supersedes the other selectors */}
        <label
          className={`flex items-center gap-2.5 rounded-lg border p-3 cursor-pointer transition-colors ${
            allMembers
              ? "border-accent-coral bg-accent-coral/10"
              : "border-border hover:bg-muted/40"
          }`}
        >
          <input
            type="checkbox"
            checked={allMembers}
            onChange={(e) => setAllMembers(e.target.checked)}
          />
          <Globe
            className={`w-4 h-4 ${allMembers ? "text-accent-coral" : "text-muted-foreground"}`}
          />
          <span className="text-sm text-foreground font-medium">Whole lab</span>
          <span className="text-xs text-muted-foreground">
            every current lab member ({members.length})
          </span>
        </label>

        {!allMembers && (
          <>
            {/* Groups — chip multi-select */}
            <div className="rounded-lg border border-border bg-muted/20 p-3 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">
                  User groups
                </span>
                {pickedGroups.size > 0 && (
                  <span className="text-xs text-accent-coral font-medium">
                    {pickedGroups.size} selected
                  </span>
                )}
              </div>
              {groups.length === 0 ? (
                <span className="text-xs text-muted-foreground">
                  No groups defined.
                </span>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Search groups…"
                      value={groupSearch}
                      onChange={(e) => setGroupSearch(e.target.value)}
                      className="w-full pl-7 pr-2 py-1.5 text-sm border border-border rounded-md bg-card text-foreground"
                    />
                  </div>
                  {filteredGroups.length === 0 ? (
                    <span className="text-xs text-muted-foreground">
                      No matching groups.
                    </span>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {filteredGroups.map((g) => {
                        const on = pickedGroups.has(g.id);
                        return (
                          <button
                            key={g.id}
                            type="button"
                            onClick={() => toggleIn(setPickedGroups, g.id)}
                            className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                              on
                                ? "bg-accent-coral text-white border-accent-coral"
                                : "border-border bg-card text-foreground hover:bg-muted/50"
                            }`}
                          >
                            {g.name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Specific people — searchable checklist */}
            <div className="rounded-lg border border-border bg-background p-3 flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <UserRound className="w-4 h-4 text-muted-foreground" />
                <span className="text-sm font-medium text-foreground">
                  Specific people
                </span>
                {pickedUsers.size > 0 && (
                  <span className="text-xs text-accent-coral font-medium">
                    {pickedUsers.size} selected
                  </span>
                )}
              </div>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search people…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-7 pr-2 py-1.5 text-sm border border-border rounded-md bg-card text-foreground"
                />
              </div>
              <div className="max-h-64 overflow-y-auto border border-border rounded-md divide-y divide-border bg-card">
                {filteredMembers.map((m) => (
                  <label
                    key={m.id}
                    className="flex items-center gap-2 px-3 py-2 text-sm hover:bg-muted/40 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={pickedUsers.has(m.id)}
                      onChange={() => toggleIn(setPickedUsers, m.id)}
                    />
                    <span className="text-foreground">{m.name}</span>
                    {m.email && (
                      <span className="text-xs text-muted-foreground truncate">
                        {m.email}
                      </span>
                    )}
                  </label>
                ))}
                {filteredMembers.length === 0 && (
                  <div className="px-3 py-2 text-sm text-muted-foreground">
                    No matches.
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {!hasAudience && (
          <p className="text-xs text-muted-foreground">
            Pick at least one audience above.
          </p>
        )}
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          className="px-4 py-2 text-sm font-medium rounded-lg bg-accent-coral text-white hover:bg-accent-coral/90 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {sending ? "Sending…" : "Send"}
        </button>
        {/* Inline confirmation next to the action, where the user is looking. */}
        {result?.ok && (
          <span
            role="status"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-green-700"
          >
            <CheckCircle2 className="w-4 h-4" />
            Sent to {result.count} recipient
            {result.count === 1 ? "" : "s"}.
          </span>
        )}
      </div>
    </div>
  );
}
