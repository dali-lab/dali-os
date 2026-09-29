import { useCallback, useEffect, useState } from "react";
import { KeyRound, Plus, Trash2 } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";

// Passkey management, entirely client-side: the WebAuthn ceremonies and the
// list/add/delete calls all go through the browser BetterAuth client
// (~/lib/auth-client), dynamically imported so the WebAuthn bundle never loads
// on the server. No loader wiring needed — the block fetches its own data.
type PasskeyRow = {
  id: string;
  name?: string | null;
  createdAt?: string | Date | null;
};

export function PasskeysSettingsBlock() {
  const [passkeys, setPasskeys] = useState<PasskeyRow[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const { authClient } = await import("~/lib/auth-client");
      const { data, error: err } = await authClient.passkey.listUserPasskeys();
      if (err) {
        setError("Couldn't load your passkeys.");
        return;
      }
      setPasskeys((data as PasskeyRow[]) ?? []);
    } catch {
      setError("Couldn't load your passkeys.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function addPasskey() {
    setError(null);
    setBusy(true);
    try {
      const { authClient } = await import("~/lib/auth-client");
      const { error: err } = await authClient.passkey.addPasskey();
      if (err) {
        setError(
          "Couldn't add a passkey. It may already be registered on this device, or the request was cancelled.",
        );
        return;
      }
      await load();
    } catch {
      setError("Couldn't add a passkey.");
    } finally {
      setBusy(false);
    }
  }

  async function removePasskey(id: string) {
    setError(null);
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
        password or emailed link. Add one on each device you use.
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
          {passkeys.map((pk) => (
            <li key={pk.id} className="flex items-center gap-3 px-4 py-3">
              <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                {pk.name || "Passkey"}
              </span>
              <button
                type="button"
                onClick={() => void removePasskey(pk.id)}
                className="p-1 text-muted-foreground transition hover:text-red-600"
                aria-label="Remove passkey"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </li>
          ))}
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
