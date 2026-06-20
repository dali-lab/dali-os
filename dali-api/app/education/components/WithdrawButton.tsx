import { useState } from "react";
import { useNavigate } from "react-router";

export function WithdrawButton({
  applicationId,
  catalogHref,
}: {
  applicationId: string;
  catalogHref: string;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function withdraw() {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/education/applications/${applicationId}/decision`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "Withdrawn" }),
    });
    setBusy(false);
    if (res.ok) {
      navigate(catalogHref);
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed to withdraw");
    }
  }

  if (!confirming) {
    return (
      <button
        onClick={() => setConfirming(true)}
        className="text-xs text-muted-foreground hover:text-red-600 transition"
      >
        Withdraw from this offering
      </button>
    );
  }

  return (
    <div className="rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3 text-left space-y-2 max-w-md">
      <p className="text-sm font-semibold text-red-700">Withdraw from this offering?</p>
      <p className="text-xs text-red-600/80">
        Your spot will open up for the next person on the waitlist. You'll need to re-apply if you change your mind.
      </p>
      {error && <p className="text-xs text-red-700">{error}</p>}
      <div className="flex items-center gap-3 pt-1">
        <button
          onClick={withdraw}
          disabled={busy}
          className="px-4 py-1.5 rounded-full bg-red-600 text-white text-xs font-semibold hover:bg-red-700 transition disabled:opacity-50"
        >
          {busy ? "Withdrawing..." : "Yes, withdraw"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="text-xs font-semibold text-muted-foreground hover:underline"
        >
          Go back
        </button>
      </div>
    </div>
  );
}
