import { Form, useNavigation } from "react-router";
import { KeyRound } from "lucide-react";
import { useConfirmSubmit } from "~/components/ui/dialog";
import type { SessionRowDTO } from "~/lib/settings-page.server";

const SESSIONS_ACTION = "/settings/sessions";

export function SessionsSettingsBlock({
  sessions,
  currentSessionId,
}: {
  sessions: SessionRowDTO[];
  currentSessionId: string;
}) {
  const nav = useNavigation();
  const submitting = nav.state !== "idle";
  const otherCount = sessions.filter((s) => s.id !== currentSessionId).length;
  const confirmSubmit = useConfirmSubmit();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="text-sm text-muted-foreground max-w-xl">
          Browsers, the desktop app, and connected tools currently signed in to your account.
        </p>
        {otherCount > 0 && (
          <Form
            method="post"
            action={SESSIONS_ACTION}
            onSubmit={confirmSubmit({
              title: `Sign out ${otherCount} other ${otherCount === 1 ? "session" : "sessions"}?`,
              description:
                "The desktop app and any connected tools (e.g. Claude MCP) will need to sign in again.",
              confirmLabel: "Sign out others",
              tone: "destructive",
            })}
          >
            <input type="hidden" name="intent" value="revoke-others" />
            <button
              type="submit"
              disabled={submitting}
              className="inline-flex flex-shrink-0 items-center gap-1 rounded-md border border-border px-2.5 py-1.5 text-xs font-semibold hover:bg-muted disabled:opacity-50"
            >
              Sign out others ({otherCount})
            </button>
          </Form>
        )}
      </div>
      <h3 className="inline-flex items-center gap-2 text-sm font-semibold text-foreground">
        <KeyRound className="h-4 w-4" /> Active sessions
      </h3>
      {sessions.length === 0 ? (
        <p className="text-sm text-muted-foreground">No active sessions.</p>
      ) : (
        <ul className="space-y-3">
          {sessions.map((s) => {
            const isCurrent = s.id === currentSessionId;
            return (
              <li key={s.id} className="rounded border border-border bg-card p-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="font-medium">{s.device}</h4>
                      {isCurrent && (
                        <span className="rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium text-teal-800">
                          This device
                        </span>
                      )}
                      {s.kind.type === "oauth" && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
                          {s.kind.clientName} (MCP)
                        </span>
                      )}
                      {s.isDesktop && (
                        <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-800">
                          Desktop app
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {s.ip ? <>IP {s.ip} · </> : null}
                      Last used {new Date(s.lastUsedAt).toLocaleString()} · signed in{" "}
                      {new Date(s.createdAt).toLocaleDateString()}
                    </p>
                    {s.userAgent && s.userAgent !== s.device && (
                      <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground/80">
                        {s.userAgent}
                      </p>
                    )}
                  </div>
                  <Form
                    method="post"
                    action={SESSIONS_ACTION}
                    onSubmit={confirmSubmit(
                      isCurrent
                        ? {
                            title: "Sign out of this device?",
                            description: "You'll be redirected to the login page.",
                            confirmLabel: "Sign out",
                            tone: "destructive",
                          }
                        : {
                            title: `Revoke session on ${s.device}?`,
                            description:
                              s.isDesktop
                                ? "The desktop app will need to sign in again."
                                : s.kind.type === "oauth"
                                  ? `${s.kind.clientName} will lose access until it re-authenticates.`
                                  : "That browser or device will be signed out.",
                            confirmLabel: "Revoke",
                            tone: "destructive",
                          },
                    )}
                  >
                    <input type="hidden" name="intent" value="revoke-one" />
                    <input type="hidden" name="sessionId" value={s.id} />
                    <button
                      type="submit"
                      disabled={submitting}
                      className="rounded border border-red-300 px-3 py-1 text-sm text-red-700 hover:bg-red-50 disabled:opacity-50"
                    >
                      {isCurrent ? "Sign out" : "Revoke"}
                    </button>
                  </Form>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
