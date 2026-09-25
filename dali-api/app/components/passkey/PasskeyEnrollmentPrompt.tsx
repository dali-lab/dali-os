import { useEffect, useId, useRef, useState } from "react";
import { useFetcher, useLocation } from "react-router";
import { Modal } from "~/components/Modal";

// Auth surfaces that either aren't signed-in yet or already show the passkey
// offer (the /welcome first-login step) — don't double-prompt there.
const SKIP_PREFIXES = ["/login", "/signup", "/welcome", "/partner/login"];

// In-app, one-time passkey enrollment prompt. Mounted once at the app root; it
// asks the server (once per page load, on an authenticated non-skip surface)
// whether the user is eligible — no passkey yet, not dismissed on this device,
// passwordless auth live — and only when the browser supports WebAuthn. This
// reaches users the post-login offer can't (e.g. members carried over by the
// silent session upgrade). See app/routes/api.passkey-prompt.ts.
export function PasskeyEnrollmentPrompt() {
  const fetcher = useFetcher<{ offer?: boolean }>();
  const location = useLocation();
  const askedRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const headingId = useId();
  const setUpRef = useRef<HTMLButtonElement>(null);

  // Ask once, after landing on an authenticated non-skip page, and only where
  // WebAuthn exists — never a dead-end prompt on an unsupported browser.
  useEffect(() => {
    if (askedRef.current) return;
    if (typeof window === "undefined") return;
    if (typeof PublicKeyCredential === "undefined") return;
    if (SKIP_PREFIXES.some((p) => location.pathname.startsWith(p))) return;
    askedRef.current = true;
    fetcher.load("/api/passkey-prompt");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.pathname]);

  useEffect(() => {
    if (fetcher.data?.offer) setOpen(true);
  }, [fetcher.data]);

  function post(intent: "dismiss" | "enrolled") {
    fetcher.submit(
      { intent },
      { method: "post", action: "/api/passkey-prompt" },
    );
  }

  function dismiss() {
    setOpen(false);
    post("dismiss");
  }

  async function setUpPasskey() {
    setBusy(true);
    setError(null);
    try {
      const { authClient } = await import("~/lib/auth-client");
      const { error: err } = await authClient.passkey.addPasskey();
      if (err) {
        setError("Couldn't set up a passkey. You can try again anytime.");
        return;
      }
      // Record + suppress on the server (sets the dismissal cookie, audit-logs).
      post("enrolled");
      setOpen(false);
    } catch {
      setError("Couldn't set up a passkey. You can try again anytime.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;

  return (
    <Modal open onClose={dismiss} labelledBy={headingId} initialFocusRef={setUpRef}>
      <h2
        id={headingId}
        className="font-heading text-lg font-bold text-foreground"
      >
        Sign in faster next time
      </h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Set up a passkey. Next time you can sign in with Face ID, Touch ID, or
        your device, no code to type.
      </p>
      {error && (
        <p className="mt-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      <div className="mt-5 flex flex-col gap-2">
        <button
          ref={setUpRef}
          type="button"
          onClick={() => void setUpPasskey()}
          disabled={busy}
          className="w-full rounded-xl bg-dark-blue text-white font-heading font-semibold py-3 hover:opacity-90 transition disabled:opacity-50"
        >
          {busy ? "Waiting for passkey…" : "Set up a passkey"}
        </button>
        <button
          type="button"
          onClick={dismiss}
          disabled={busy}
          className="w-full rounded-xl border border-border bg-card text-dark-blue font-heading font-semibold py-3 hover:border-accent-coral transition disabled:opacity-50"
        >
          Not now
        </button>
      </div>
    </Modal>
  );
}
