import { useEffect, useState } from "react";
import { useFetcher } from "react-router";
import { RotateCcw, Wallet } from "lucide-react";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import { useOsChrome } from "~/components/os-chrome";
import { SettingsIconTile, settingsDangerBtn } from "~/components/settings/SettingsSection";

export const WALLET_ACTION = "/settings/general";

export function WalletSettingsBlock({
  wallet,
}: {
  wallet: { apple: boolean; google: boolean };
}) {
  const { actionBtn, actionBtnPrimary } = useOsChrome();
  const revokeFetcher = useFetcher<{ error?: string } | null>();
  const [googleBusy, setGoogleBusy] = useState(false);
  const confirmSubmit = useConfirmSubmit();
  const toast = useToast();
  const revoking = revokeFetcher.state !== "idle";

  useEffect(() => {
    if (revokeFetcher.state !== "idle" || revokeFetcher.data === undefined) return;
    if (revokeFetcher.data?.error) toast.error(revokeFetcher.data.error);
    else toast.success("Pass reset. Add it to your wallet again.");
  }, [revokeFetcher.state, revokeFetcher.data, toast]);

  async function addToGoogle() {
    setGoogleBusy(true);
    try {
      const res = await fetch("/api/wallet/google/save-url", { credentials: "include" });
      const body = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (res.ok && body?.url) window.open(body.url, "_blank", "noopener");
      else toast.error(body?.error ?? "Couldn't build the Google Wallet link.");
    } catch {
      toast.error("Network error. Try again.");
    } finally {
      setGoogleBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-5 rounded-os-card bg-os-card p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <SettingsIconTile accent>
            <Wallet className="h-5 w-5" />
          </SettingsIconTile>
          <div>
            <p className="font-semibold text-foreground">DALI membership pass</p>
            <p className="text-sm text-os-grey">
              {wallet.apple || wallet.google
                ? "Show it at a meeting to check in without signing in."
                : "Wallet passes aren't set up on this server yet."}
            </p>
          </div>
        </div>
        {(wallet.apple || wallet.google) && (
          <div className="flex flex-wrap gap-2">
            {wallet.apple && (
              <a href="/api/wallet/apple/pass" className={actionBtnPrimary}>
                Add to Apple Wallet
              </a>
            )}
            {wallet.google && (
              <button
                type="button"
                className={actionBtn()}
                onClick={() => void addToGoogle()}
                disabled={googleBusy}
              >
                {googleBusy ? "Opening…" : "Add to Google Wallet"}
              </button>
            )}
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-4 px-2">
        <p className="text-sm text-os-muted">
          Lost your phone? Resetting stops every copy of the pass from working.
        </p>
        <revokeFetcher.Form
          method="post"
          action={WALLET_ACTION}
          onSubmit={confirmSubmit({
            title: "Reset your membership pass?",
            description:
              "Every copy of your current pass stops working right away. You'll need to add the new pass to your wallet again.",
            confirmLabel: "Reset pass",
            tone: "destructive",
          })}
        >
          <input type="hidden" name="intent" value="revoke-wallet-pass" />
          <button type="submit" disabled={revoking} className={settingsDangerBtn}>
            <RotateCcw className="h-4 w-4" aria-hidden /> {revoking ? "Resetting…" : "Reset pass"}
          </button>
        </revokeFetcher.Form>
      </div>
    </div>
  );
}
