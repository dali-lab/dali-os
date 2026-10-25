import { useCallback, useEffect, useState } from "react";
import { KeyRound, Pencil, Plus } from "lucide-react";
import { useDialog } from "~/components/ui/dialog";
import { IconButton } from "~/components/ui/IconButton";
import { useOsChrome } from "~/components/os-chrome";
import { getAuthenticatorLabel } from "~/lib/passkey-authenticators";
import {
  SettingsEmptyRow,
  SettingsIconTile,
  settingsDangerBtn,
  settingsList,
} from "~/components/settings/SettingsSection";

// Passkey management, entirely client-side: the WebAuthn ceremonies and the
// list/add/rename/delete calls go through the browser BetterAuth client
// (~/lib/auth-client), dynamically imported so the WebAuthn bundle never loads
// on the server.
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
  return Number.isNaN(d.getTime())
    ? null
    : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function usePasskeys() {
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
        "You won't be able to sign in with this passkey anymore.",
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

  return {
    passkeys,
    busy,
    error,
    editingId,
    editValue,
    setEditValue,
    savingRename,
    addPasskey,
    startRename,
    cancelRename,
    saveRename,
    removePasskey,
  };
}

export type PasskeysState = ReturnType<typeof usePasskeys>;

export function AddPasskeyButton({ state }: { state: PasskeysState }) {
  return (
    <button
      type="button"
      className="os-add-btn"
      onClick={() => void state.addPasskey()}
      disabled={state.busy}
    >
      <Plus className="h-4 w-4" strokeWidth={3} aria-hidden />
      {state.busy ? "Waiting for device…" : "Passkey"}
    </button>
  );
}

export function PasskeysList({ state }: { state: PasskeysState }) {
  const { actionBtn, actionBtnPrimary, compactField } = useOsChrome();
  const { passkeys, error, editingId, editValue, setEditValue, savingRename } = state;

  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p className="rounded-os-item bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>
      )}
      <ul className={settingsList}>
        {passkeys === null && <SettingsEmptyRow>Loading…</SettingsEmptyRow>}
        {passkeys?.length === 0 && (
          <SettingsEmptyRow>No passkeys yet. You sign in with Dartmouth SSO or an email link.</SettingsEmptyRow>
        )}
        {passkeys?.map((pk) => {
          const added = formatAdded(pk.createdAt);
          const editing = editingId === pk.id;
          return (
            <li key={pk.id} className="flex items-center gap-4 px-6 py-4">
              <SettingsIconTile>
                <KeyRound className="h-4 w-4" />
              </SettingsIconTile>
              <div className="min-w-0 flex-1">
                {editing ? (
                  <form
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void state.saveRename(pk.id);
                    }}
                  >
                    <input
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => e.key === "Escape" && state.cancelRename()}
                      placeholder={autoLabel(pk)}
                      maxLength={64}
                      aria-label="Passkey name"
                      className={`${compactField} min-w-0 border border-os-container px-3 py-1.5 text-sm outline-none`}
                    />
                    <button type="submit" className={actionBtnPrimary} disabled={savingRename}>
                      Save
                    </button>
                    <button type="button" className={actionBtn()} onClick={state.cancelRename}>
                      Cancel
                    </button>
                  </form>
                ) : (
                  <>
                    <p className="flex items-center gap-1.5 font-semibold text-foreground">
                      <span className="truncate">{labelFor(pk)}</span>
                      <IconButton
                        icon={Pencil}
                        label={`Rename ${labelFor(pk)}`}
                        iconClassName="h-3.5 w-3.5"
                        onClick={() => state.startRename(pk)}
                      />
                    </p>
                    {added && <p className="text-xs text-os-muted">Added {added}</p>}
                  </>
                )}
              </div>
              {!editing && (
                <button
                  type="button"
                  className={settingsDangerBtn}
                  onClick={() => void state.removePasskey(pk.id, labelFor(pk))}
                >
                  Remove
                </button>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The list with its add button underneath, for pages without a section action
 *  slot (the applicant portal and partner settings). */
export function PasskeysSettingsBlock() {
  const state = usePasskeys();
  return (
    <div className="flex flex-col gap-3">
      <PasskeysList state={state} />
      <div>
        <AddPasskeyButton state={state} />
      </div>
    </div>
  );
}
