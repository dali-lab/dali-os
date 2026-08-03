import { useEffect, useRef, useState } from "react";
import { Check, Eye, Landmark, Lock, Trash2, Users, X } from "lucide-react";
import { Modal, ModalHeader } from "~/components/Modal";
import { buttonClasses } from "~/components/ui/Button";
import type { NoteSummary } from "~/members/lib/personal-notes.server";

// Everything about a note's audience, in one place: who can see it at all,
// who it's shared with by name, and whether it's been put forward for the
// lab-wide Documents page.
//
// They're one dialog rather than three controls because they're one decision —
// "who reads this" — and splitting them across the rail would make the
// relationship between public, shared and listed harder to see, not easier.

type Option = { id: string; label: string };
type Share = { id: string; principalType: string; principalId: string; label: string };

async function post(body: Record<string, string>): Promise<any> {
  const form = new FormData();
  for (const [k, v] of Object.entries(body)) form.append(k, v);
  const res = await fetch("/api/notes", { method: "POST", body: form, credentials: "include" });
  return res.json().catch(() => ({}));
}

export function NoteShareModal({
  note,
  open,
  onClose,
  onChanged,
}: {
  note: NoteSummary;
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [isPublic, setIsPublic] = useState(note.visibility === "public");
  const [listing, setListing] = useState(note.labListing);
  const [shares, setShares] = useState<Share[]>([]);
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<Option[]>([]);
  const [groups, setGroups] = useState<Option[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setIsPublic(note.visibility === "public");
    setListing(note.labListing);
    setError(null);
    void post({ intent: "shares", pageId: note.id }).then((d) => setShares(d.shares ?? []));
    void post({ intent: "share-options", q: "" }).then((d) => setGroups(d.groups ?? []));
  }, [open, note.id, note.visibility, note.labListing]);

  // Debounced member search — two characters before we ask, so typing a name
  // doesn't fire a request per keystroke.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setMembers([]);
      return;
    }
    const t = setTimeout(() => {
      void post({ intent: "share-options", q }).then((d) => setMembers(d.members ?? []));
    }, 200);
    return () => clearTimeout(t);
  }, [query, open]);

  async function run(body: Record<string, string>, after?: () => void) {
    setBusy(true);
    setError(null);
    const res = await post(body);
    setBusy(false);
    if (res?.error) {
      setError(res.error);
      return;
    }
    after?.();
    onChanged();
  }

  async function refreshShares() {
    const d = await post({ intent: "shares", pageId: note.id });
    setShares(d.shares ?? []);
  }

  const alreadyShared = new Set(shares.map((s) => `${s.principalType}:${s.principalId}`));

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="note-share-title"
      initialFocusRef={searchRef}
      containerClassName="bg-card rounded-2xl shadow-brand-2 max-w-lg w-full p-5 sm:p-6 my-auto max-h-[85vh] overflow-y-auto"
    >
      <ModalHeader
        titleId="note-share-title"
        title={`Who can see “${note.title}”`}
        onClose={onClose}
      />

      {error && (
        <p className="mb-3 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      {/* Visibility. Two states, stated as what each one does rather than as
          an abstract label. */}
      <fieldset className="flex flex-col gap-2 mb-5">
        <legend className="text-xs font-semibold text-muted-foreground mb-1">Visibility</legend>
        {(
          [
            [false, Lock, "Only you", "Nobody else sees it, unless you share it below."],
            [true, Eye, "On your profile", "Anyone who can see your profile can read it."],
          ] as const
        ).map(([value, Icon, label, hint]) => (
          <label
            key={label}
            className={`flex items-start gap-3 rounded-md border px-3 py-2 cursor-pointer transition-colors ${
              isPublic === value
                ? "border-accent-coral bg-accent-coral/5"
                : "border-border hover:bg-muted/30"
            }`}
          >
            <input
              type="radio"
              name="note-visibility"
              className="sr-only"
              checked={isPublic === value}
              disabled={busy}
              onChange={() => {
                setIsPublic(value);
                void run({
                  intent: "visibility",
                  pageId: note.id,
                  public: String(value),
                });
              }}
            />
            <Icon
              className={`w-4 h-4 mt-0.5 shrink-0 ${isPublic === value ? "text-accent-coral" : "text-muted-foreground"}`}
            />
            <span className="flex flex-col min-w-0">
              <span className="text-sm font-medium text-foreground">{label}</span>
              <span className="text-xs text-muted-foreground">{hint}</span>
            </span>
            {isPublic === value && <Check className="w-4 h-4 text-accent-coral shrink-0" />}
          </label>
        ))}
      </fieldset>

      {/* Named shares — additive, and they work whether or not it's public. */}
      <div className="flex flex-col gap-2 mb-5">
        <h3 className="text-xs font-semibold text-muted-foreground">
          Shared with
          <span className="font-normal"> — they can read it, even while it's private</span>
        </h3>

        {shares.length > 0 && (
          <ul className="flex flex-col gap-1">
            {shares.map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-2 text-sm px-2 py-1 rounded-md bg-muted/30"
              >
                <Users className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1 min-w-0 truncate text-foreground">{s.label}</span>
                <span className="text-xs text-muted-foreground">
                  {s.principalType === "Group" ? "Group" : "Member"}
                </span>
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Stop sharing with ${s.label}`}
                  onClick={() =>
                    void run(
                      { intent: "share-remove", pageId: note.id, shareId: s.id },
                      refreshShares,
                    )
                  }
                  className="text-muted-foreground hover:text-destructive transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search members by name"
          className="px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
        />

        {members.length > 0 && (
          <ul className="flex flex-col gap-0.5 border border-border rounded-md p-1">
            {members.map((m) => {
              const shared = alreadyShared.has(`User:${m.id}`);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    disabled={busy || shared}
                    onClick={() =>
                      void run(
                        {
                          intent: "share-add",
                          pageId: note.id,
                          principalType: "User",
                          principalId: m.id,
                        },
                        () => {
                          setQuery("");
                          void refreshShares();
                        },
                      )
                    }
                    className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted/40 disabled:opacity-50 disabled:hover:bg-transparent"
                  >
                    {m.label}
                    {shared && <span className="text-xs text-muted-foreground"> — already shared</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {groups.length > 0 && (
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Or share with a group</span>
            <select
              disabled={busy}
              defaultValue=""
              onChange={(e) => {
                if (!e.target.value) return;
                const id = e.target.value;
                e.target.value = "";
                void run(
                  {
                    intent: "share-add",
                    pageId: note.id,
                    principalType: "Group",
                    principalId: id,
                  },
                  refreshShares,
                );
              }}
              className="px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground"
            >
              <option value="">Pick a group…</option>
              {groups
                .filter((g) => !alreadyShared.has(`Group:${g.id}`))
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
            </select>
          </label>
        )}
      </div>

      {/* Lab listing. Only offered once the page is public, because Core can't
          list something the lab can't read. */}
      <div className="flex flex-col gap-2 border-t border-border pt-4">
        <h3 className="text-xs font-semibold text-muted-foreground inline-flex items-center gap-1.5">
          <Landmark className="w-3.5 h-3.5" />
          Lab Documents page
        </h3>
        {listing === "Listed" ? (
          <p className="text-sm text-foreground">
            Listed — anyone in the lab can find this on the Documents page.
          </p>
        ) : listing === "Proposed" ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">Waiting for Core to review it.</p>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run({ intent: "withdraw", pageId: note.id }, () => setListing("None"))
              }
              className={buttonClasses("ghost", "sm")}
            >
              Withdraw
            </button>
          </div>
        ) : !isPublic ? (
          <p className="text-sm text-muted-foreground">
            Make the page public first — Core can't list something the lab can't read.
          </p>
        ) : (
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              {listing === "Declined"
                ? "Core didn't list this one. You can ask again."
                : "Ask Core to put this on the lab's Documents page."}
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void run({ intent: "propose", pageId: note.id }, () => setListing("Proposed"))
              }
              className={buttonClasses("secondary", "sm")}
            >
              Propose
            </button>
          </div>
        )}
      </div>

      <div className="flex justify-between items-center gap-2 pt-5">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (!window.confirm(`Delete “${note.title}”? This can't be undone.`)) return;
            void run({ intent: "delete", pageId: note.id }, onClose);
          }}
          className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-destructive transition-colors"
        >
          <Trash2 className="w-4 h-4" />
          Delete page
        </button>
        <button type="button" onClick={onClose} className={buttonClasses("primary", "sm")}>
          Done
        </button>
      </div>
    </Modal>
  );
}
