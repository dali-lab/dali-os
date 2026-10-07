import { useEffect, useState } from "react";
import { Modal, ModalHeader } from "~/components/Modal";
import { MailBody } from "~/email/components/MailBody";
import { shortDate } from "~/email/lib/format";

type ThreadMessage = {
  id: string;
  from: string;
  to: string;
  cc: string;
  date: string;
  subject: string;
  html: string | null;
  text: string | null;
  attachments: { filename: string; size: number }[];
};

// Opens the full Gmail thread behind a SharedInboxPanel row, fetched
// server-side with the shared inbox's own connection — the viewer never
// needs their own inbox hooked up to read it. `url` is the caller's own
// thread-access resource route (hiring and the Partner CRM each gate theirs
// differently); this component only renders whatever it returns. Generalized
// from app/hiring/components/ApplicantEmailThreadModal.tsx.
export function SharedInboxThreadModal({ url, onClose }: { url: string; onClose: () => void }) {
  const [state, setState] = useState<
    { status: "loading" } | { status: "error"; message: string } | { status: "ready"; messages: ThreadMessage[] }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetch(url)
      .then(async (res) => {
        if (cancelled) return;
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          setState({ status: "error", message: body?.error ?? "Couldn't load this thread." });
          return;
        }
        setState({ status: "ready", messages: body.messages ?? [] });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error", message: "Couldn't load this thread." });
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const titleId = "shared-inbox-thread-title";

  return (
    <Modal open onClose={onClose} labelledBy={titleId} containerClassName="w-full max-w-3xl rounded-lg bg-card p-6 shadow-xl">
      <ModalHeader
        titleId={titleId}
        title={state.status === "ready" ? state.messages[0]?.subject || "(no subject)" : "Email thread"}
        onClose={onClose}
      />
      {state.status === "loading" && (
        <p className="text-sm text-muted-foreground py-6 text-center">Loading thread…</p>
      )}
      {state.status === "error" && (
        <p className="text-sm text-muted-foreground py-6 text-center">{state.message}</p>
      )}
      {state.status === "ready" && (
        <div className="flex flex-col gap-3 max-h-[70vh] overflow-y-auto">
          {state.messages.map((m) => (
            <article key={m.id} className="rounded-lg bg-muted/40 p-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground truncate">{m.from}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    To {m.to}
                    {m.cc ? `, cc ${m.cc}` : ""}
                  </p>
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{shortDate(m.date)}</span>
              </div>
              <MailBody html={m.html} text={m.text} />
              {m.attachments.length > 0 && (
                <p className="mt-2 text-xs text-muted-foreground">
                  {m.attachments.map((a) => a.filename).join(", ")}
                </p>
              )}
            </article>
          ))}
        </div>
      )}
    </Modal>
  );
}
