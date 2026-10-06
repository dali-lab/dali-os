import { useCallback, useEffect, useState } from "react";
import { Check, KeyRound, Pencil, Plus, Trash2, X } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";
import { useDialog } from "~/components/ui/dialog";
import { getAuthenticatorLabel } from "~/lib/passkey-authenticators";

// Passkey management, entirely client-side: the WebAuthn ceremonies and the
// list/add/rename/delete calls all go through the browser BetterAuth client
// (~/lib/auth-client), dynamically imported so the WebAuthn bundle never loads
// on the server. No loader wiring needed — the block fetches its own data.
type PasskeyRow = {
  id: string;
  name?: string | null;
  aaguid?: string | null;
  createdAt?: string | Date | null;
};

// Display label precedence: the user's own name, else the authenticator model
// from its AAGUID ("iCloud Keychain", "1Password"), else a generic fallback.
function autoLabel(pk: PasskeyRow): string {
  return getAuthenticatorLabel(pk.aaguid) ?? "Passkey";
}
function labelFor(pk: PasskeyRow): string {
  return pk.name?.trim() || autoLabel(pk);
}
function formatAdded(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString();
}

export function PasskeysSettingsBlock() {
  const [passkeys, setPasskeys] = useState<PasskeyRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useDialog();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [savingRename, setSavingRename] = useState(false);

  const load = useCallback(async (): Promise<PasskeyRow[] | null> => {
    try {
      const { authClient } = await import("~/lib/auth-client");
      const { data, error: err } = await authClient.passkey.listUserPasskeys();
      if (err) {
        setError("Couldn't load your passkeys.");
        return null;
      }
      const rows = (data as PasskeyRow[]) ?? [];
      setPasskeys(rows);
      return rows;
    } catch {
      setError("Couldn't load your passkeys.");
      return null;
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addPasskey() {
    setError(null);
    setBusy(true);
    // Remember existing ids so we can find the one just created and drop the
    // user straight into renaming it — the post-enrollment nudge to give it a
    // recognizable name while they still remember which device it is.
    const before = new Set((passkeys ?? []).map((p) => p.id));
    try {
      const { authClient } = await import("~/lib/auth-client");
      const { error: err } = await authClient.passkey.addPasskey();
      if (err) {
        setError(
          "Couldn't add a passkey. It may already be registered on this device, or the request was cancelled.",
        );
        return;
      }
      const rows = await load();
      const added = rows?.find((p) => !before.has(p.id));
      if (added) {
        setEditingId(added.id);
        setEditValue(added.name?.trim() ?? "");
      }
    } catch {
      setError("Couldn't add a passkey.");
    } finally {
      setBusy(false);
    }
  }

  function startRename(pk: PasskeyRow) {
    setError(null);
    setEditingId(pk.id);
    setEditValue(pk.name?.trim() ?? "");
  }

  function cancelRename() {
    setEditingId(null);
    setEditValue("");
  }

  async function saveRename(id: string) {
    const name = editValue.trim();
    // Empty name isn't a rename — the plugin requires a non-empty name, and the
    // auto-label already covers the "no custom name" case.
    if (!name) {
      cancelRename();
      return;
    }
    setSavingRename(true);
    setError(null);
    try {
      const { authClient } = await import("~/lib/auth-client");
      const { error: err } = await authClient.passkey.updatePasskey({ id, name });
      if (err) {
        setError("Couldn't rename that passkey.");
        return;
      }
      cancelRename();
      await load();
    } catch {
      setError("Couldn't rename that passkey.");
    } finally {
      setSavingRename(false);
    }
  }

  async function removePasskey(id: string, label: string) {
    const ok = await dialog.confirm({
      title: `Remove ${label}?`,
      description:
        "That device can no longer sign you in. You'll need to add a new passkey on it, or sign in another way.",
      confirmLabel: "Remove",
      tone: "destructive",
    });
    if (!ok) return;
    setError(null);
    if (editingId === id) cancelRename();
    try {
      const { authClient } = await import("~/lib/auth-client");
      const { error: err } = await authClient.passkey.deletePasskey({ id });
      if (err) {
        setError("Couldn't remove that passkey.");
        return;
      }
      setPasskeys((prev) => prev?.filter((p) => p.id !== id) ?? null);
    } catch {
      setError("Couldn't remove that passkey.");
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground">
        Passkeys let you sign in with Face ID, Touch ID, or a security key — no
        password or emailed link. Add one on each device you use, and give it a
        name so you can tell them apart.
      </p>

      {error && (
        <p className="text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">{error}</p>
      )}

      {passkeys === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : passkeys.length === 0 ? (
        <p className="text-sm text-muted-foreground">No passkeys yet.</p>
      ) : (
        <ul className="divide-y divide-border rounded-xl border border-border">
          {passkeys.map((pk) => {
            const added = formatAdded(pk.createdAt);
            return (
              <li key={pk.id} className="flex items-center gap-3 px-4 py-3">
                <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
                {editingId === pk.id ? (
                  <>
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void saveRename(pk.id);
                        if (e.key === "Escape") cancelRename();
                      }}
                      placeholder={autoLabel(pk)}
                      maxLength={64}
                      className="min-w-0 flex-1 rounded-lg border border-border bg-background px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral"
                    />
                    <button
                      type="button"
                      onClick={() => void saveRename(pk.id)}
                      disabled={savingRename}
                      className="p-1 text-muted-foreground transition hover:text-foreground disabled:opacity-50"
                      aria-label="Save name"
                    >
                      <Check className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={cancelRename}
                      className="p-1 text-muted-foreground transition hover:text-foreground"
                      aria-label="Cancel"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </>
                ) : (
                  <>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm text-foreground">{labelFor(pk)}</div>
                      {added && (
                        <div className="text-xs text-muted-foreground">Added {added}</div>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => startRename(pk)}
                      className="p-1 text-muted-foreground transition hover:text-foreground"
                      aria-label="Rename passkey"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => void removePasskey(pk.id, labelFor(pk))}
                      className="p-1 text-muted-foreground transition hover:text-destructive"
                      aria-label={`Remove ${labelFor(pk)}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div>
        <button
          type="button"
          onClick={() => void addPasskey()}
          disabled={busy}
          className={buttonClasses("secondary", "sm")}
        >
          <Plus className="h-3.5 w-3.5" />
          {busy ? "Waiting for passkey…" : "Add a passkey"}
        </button>
      </div>
    </div>
  );
}
