import { useEffect, useRef, useState } from "react";
import { Check, Globe, Lock, Users, X } from "lucide-react";
import { Modal, ModalHeader } from "~/components/Modal";
import { buttonClasses } from "~/components/ui/Button";

// Who can read one lab-wide document. Two states plus an additive share list,
// the same shape as the personal-note dialog — a member who has shared a note
// already knows how this works.
//
// The Core caveat is stated in the dialog rather than left implicit: the hub is
// the lab's shelf, and promising a privacy from Core that the model doesn't
// enforce would be worse than saying so.

type Option = { id: string; label: string };
type Share = { id: string; principalType: string; principalId: string; label: string };

async function post(body: Record<string, string>): Promise<any> {
  const form = new FormData();
  for (const [k, v] of Object.entries(body)) form.append(k, v);
  const res = await fetch("/api/lab-documents/access", {
    method: "POST",
    body: form,
    credentials: "include",
  });
  return res.json().catch(() => ({}));
}

export function LabDocAccessModal({
  doc,
  open,
  onClose,
  onChanged,
}: {
  doc: { id: string; title: string };
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [restricted, setRestricted] = useState(false);
  const [shares, setShares] = useState<Share[]>([]);
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<Option[]>([]);
  const [groups, setGroups] = useState<Option[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setQuery("");
    void post({ intent: "state", pageId: doc.id }).then((d) => {
      if (d?.error) {
        setError(d.error);
        return;
      }
      setRestricted(!!d.restricted);
      setShares(d.shares ?? []);
    });
    void post({ intent: "share-options", q: "" }).then((d) => setGroups(d.groups ?? []));
  }, [open, doc.id]);

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
    const d = await post({ intent: "state", pageId: doc.id });
    setShares(d.shares ?? []);
  }

  const alreadyShared = new Set(shares.map((s) => `${s.principalType}:${s.principalId}`));

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="lab-doc-access-title"
      initialFocusRef={searchRef}
      containerClassName="bg-card rounded-2xl shadow-brand-2 max-w-lg w-full p-5 sm:p-6 my-auto max-h-[85vh] overflow-y-auto"
    >
      <ModalHeader
        titleId="lab-doc-access-title"
        title={`Who can see “${doc.title}”`}
        onClose={onClose}
      />

      {error && (
        <p className="mb-3 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      <fieldset className="flex flex-col gap-2 mb-5">
        <legend className="text-xs font-semibold text-muted-foreground mb-1">Access</legend>
        {(
          [
            [
              false,
              Globe,
              "Everyone in the lab",
              "Any lab member can open and edit it. This is how lab documents work by default.",
            ],
            [
              true,
              Lock,
              "Only people you pick",
              "You and the people below. Everyone else stops seeing it on the Documents page.",
            ],
          ] as const
        ).map(([value, Icon, label, hint]) => (
          <label
            key={label}
            className={`flex items-start gap-3 rounded-md border px-3 py-2 cursor-pointer transition-colors ${
              restricted === value
                ? "border-accent-coral bg-accent-coral/5"
                : "border-border hover:bg-muted/30"
            }`}
          >
            <input
              type="radio"
              name="lab-doc-access"
              className="sr-only"
              checked={restricted === value}
              disabled={busy}
              onChange={() => {
                setRestricted(value);
                void run({
                  intent: "restrict",
                  pageId: doc.id,
                  restricted: String(value),
                });
              }}
            />
            <Icon
              className={`w-4 h-4 mt-0.5 shrink-0 ${restricted === value ? "text-accent-coral" : "text-muted-foreground"}`}
            />
            <span className="flex flex-col min-w-0">
              <span className="text-sm font-medium text-foreground">{label}</span>
              <span className="text-xs text-muted-foreground">{hint}</span>
            </span>
            {restricted === value && <Check className="w-4 h-4 text-accent-coral shrink-0" />}
          </label>
        ))}
      </fieldset>

      <div className="flex flex-col gap-2 mb-5">
        <h3 className="text-xs font-semibold text-muted-foreground">
          Shared with
          <span className="font-normal"> — they can read it, even while it's restricted</span>
        </h3>

        {shares.length > 0 && (
          <ul className="flex flex-col gap-1">
            {shares.map((s) => (
              // bg-muted at 30% over a white card is ~99% white — the rows read
              // as nothing at all in light mode. Full muted plus a hairline so
              // each grant is visibly its own chip.
              <li
                key={s.id}
                className="flex items-center gap-2 text-sm px-2.5 py-1.5 rounded-md border border-border bg-muted"
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
                    void run({ intent: "share-remove", pageId: doc.id, shareId: s.id }, refreshShares)
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
                          pageId: doc.id,
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
                    {shared && (
                      <span className="text-xs text-muted-foreground"> — already shared</span>
                    )}
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
                    pageId: doc.id,
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

      <p className="text-xs text-muted-foreground border-t border-border pt-4">
        Core can always open lab documents — restricting one takes it off the lab's shelf, it
        doesn't hide it from lab leadership.
      </p>

      <div className="flex justify-end pt-5">
        <button type="button" onClick={onClose} className={buttonClasses("primary", "sm")}>
          Done
        </button>
      </div>
    </Modal>
  );
}
