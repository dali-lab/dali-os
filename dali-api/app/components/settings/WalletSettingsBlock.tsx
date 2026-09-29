import { useState } from "react";
import { useFetcher } from "react-router";
import { Smartphone, Wallet } from "lucide-react";

export function WalletSettingsBlock({
  wallet,
}: {
  wallet: { apple: boolean; google: boolean };
}) {
  const revokeFetcher = useFetcher<{ error?: string } | null>();
  const [googleBusy, setGoogleBusy] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const revoking = revokeFetcher.state !== "idle";

  async function addToGoogle() {
    setGoogleBusy(true);
    setGoogleError(null);
    try {
      const res = await fetch("/api/wallet/google/save-url", {
        credentials: "include",
      });
      const body = (await res.json().catch(() => null)) as
        | { url?: string; error?: string }
        | null;
      if (res.ok && body?.url) {
        window.open(body.url, "_blank", "noopener");
      } else {
        setGoogleError(body?.error ?? "Couldn't build the Google Wallet link.");
      }
    } catch {
      setGoogleError("Network error — try again.");
    } finally {
      setGoogleBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Add your DALI pass to your phone's wallet, then show it at a meeting to
        check in — no sign-in needed.
      </p>

      {wallet.apple || wallet.google ? (
        <div className="flex flex-wrap gap-2">
          {wallet.apple && (
            <a
              href="/api/wallet/apple/pass"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-os-item bg-black text-white text-sm font-medium hover:bg-black/85 transition-colors"
            >
              <Wallet className="w-4 h-4" aria-hidden />
              Add to Apple Wallet
            </a>
          )}
          {wallet.google && (
            <button
              type="button"
              onClick={() => void addToGoogle()}
              disabled={googleBusy}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-os-item bg-black text-white text-sm font-medium hover:bg-black/85 transition-colors disabled:opacity-50"
            >
              <Smartphone className="w-4 h-4" aria-hidden />
              {googleBusy ? "Opening…" : "Add to Google Wallet"}
            </button>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Wallet passes aren't configured on this server yet.
        </p>
      )}

      {googleError && (
        <p className="text-xs text-destructive">{googleError}</p>
      )}

      <div className="border-t border-border pt-4">
        {confirmRevoke ? (
          <revokeFetcher.Form
            method="post"
            onSubmit={() => setConfirmRevoke(false)}
            className="flex items-center gap-2 flex-wrap"
          >
            <input type="hidden" name="intent" value="revoke-wallet-pass" />
            <span className="text-sm text-foreground">
              Reset your pass? Your current one stops working until you re-add
              it.
            </span>
            <button
              type="submit"
              disabled={revoking}
              className="px-3 py-1.5 rounded-full bg-destructive text-white text-[13px] font-semibold hover:brightness-95 disabled:opacity-50"
            >
              {revoking ? "Resetting…" : "Reset pass"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmRevoke(false)}
              className="px-3.5 py-1.5 rounded-full text-[13px] font-semibold text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              Cancel
            </button>
          </revokeFetcher.Form>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmRevoke(true)}
            className="text-sm text-destructive hover:underline"
          >
            Reset my wallet pass
          </button>
        )}
        {revokeFetcher.data?.error && (
          <p className="text-xs text-destructive mt-2">
            {revokeFetcher.data.error}
          </p>
        )}
      </div>
    </div>
  );
}
