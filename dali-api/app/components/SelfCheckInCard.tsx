import { useState, type ReactNode } from "react";
import { CheckCircle2 } from "lucide-react";
import { Button } from "~/components/ui/Button";

export function SelfCheckInCard({
  eyebrow,
  title,
  when,
  blocked,
  open,
  alreadyPresent,
  closedText,
  postUrl,
  extra,
}: {
  eyebrow: string;
  title: string;
  when: string;
  blocked?: string | null;
  open: boolean;
  alreadyPresent: boolean;
  closedText: string;
  postUrl: string;
  extra?: (present: boolean) => ReactNode;
}) {
  const [present, setPresent] = useState(alreadyPresent);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function checkIn() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(postUrl, { method: "POST", credentials: "include" });
      if (!res.ok) {
        const j = await res.json().catch(() => null);
        setError(j?.error ?? "Check-in failed");
        return;
      }
      setPresent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="os-shell min-h-screen flex items-center justify-center bg-os-bg text-foreground p-4">
      <div className="w-full max-w-sm rounded-os-card bg-os-card p-5 text-center">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{eyebrow}</p>
        <h1 className="mt-1 font-heading text-xl font-bold text-foreground">{title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{when}</p>

        <div className="mt-6">
          {blocked ? (
            <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{blocked}</p>
          ) : present ? (
            <div className="flex flex-col items-center gap-2 text-os-green">
              <CheckCircle2 className="w-12 h-12" aria-hidden />
              <p className="text-base font-semibold text-foreground">You're checked in.</p>
            </div>
          ) : !open ? (
            <p className="text-sm text-muted-foreground bg-muted rounded-md px-3 py-2">{closedText}</p>
          ) : (
            <>
              <Button type="button" onClick={checkIn} disabled={submitting} className="w-full">
                {submitting ? "Checking in…" : "Check in"}
              </Button>
              {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
            </>
          )}
        </div>

        {extra?.(present)}
      </div>
    </div>
  );
}
