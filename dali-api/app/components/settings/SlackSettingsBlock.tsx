import { useFetcher } from "react-router";
import { CheckCircle2, Slack, Trash2 } from "lucide-react";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { Tooltip } from "~/components/ui/floating";

const SLACK_ACTION = "/settings/slack";

export function SlackSettingsBlock({
  slackUserId,
  configured,
  emails,
}: {
  slackUserId: string | null;
  configured: boolean;
  emails: string[];
}) {
  const fetcher = useFetcher<{ slackUserId?: string | null; error?: string | null }>();
  const connectedId =
    fetcher.data && "slackUserId" in fetcher.data ? fetcher.data.slackUserId : slackUserId;
  const error = fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;
  const busy = fetcher.state !== "idle";
  const confirmSubmit = useConfirmSubmit();

  return (
    <div className="flex flex-col gap-3">
      {!configured && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
          Slack isn't configured on the server, so connecting is unavailable right now.
        </div>
      )}

      {connectedId ? (
        <div className="overflow-hidden rounded-md border border-border border-l-4 border-l-[#4A154B] bg-card">
          <div className="flex items-center justify-between bg-[#4A154B]/5 px-3 py-2">
            <div className="flex min-w-0 items-center gap-2">
              <Slack className="h-4 w-4 flex-shrink-0 text-[#4A154B]" />
              <span className="truncate text-sm font-semibold text-foreground">
                Slack connected
              </span>
              <CheckCircle2 className="h-4 w-4 flex-shrink-0 text-green-600" />
            </div>
            <fetcher.Form
              method="post"
              action={SLACK_ACTION}
              onSubmit={confirmSubmit({
                title: "Disconnect Slack?",
                description:
                  "You'll stop receiving Slack DM notifications from DALI OS and won't be auto-joined to new channels.",
                confirmLabel: "Disconnect",
                tone: "destructive",
              })}
            >
              <input type="hidden" name="intent" value="disconnect" />
              <Tooltip content="Disconnect Slack">
                <button
                  type="submit"
                  disabled={busy}
                  aria-label="Disconnect Slack"
                  className="rounded-md p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600 disabled:opacity-50"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </Tooltip>
            </fetcher.Form>
          </div>
          <div className="px-3 py-3">
            <p className="text-xs text-muted-foreground">
              Slack member ID:{" "}
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-foreground">
                {connectedId}
              </code>
            </p>
          </div>
        </div>
      ) : (
        <div className="rounded-md border border-border bg-card p-4">
          <p className="text-sm text-muted-foreground">Your Slack account isn't connected yet.</p>
          {emails.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              We'll look you up by: {emails.join(", ")}.
            </p>
          )}
          <fetcher.Form method="post" action={SLACK_ACTION} className="mt-3">
            <input type="hidden" name="intent" value="connect" />
            <button
              type="submit"
              disabled={busy || !configured}
              className="inline-flex items-center gap-2 rounded-md bg-[#4A154B] px-3 py-1.5 text-sm font-semibold text-white hover:bg-[#611f69] disabled:opacity-50"
            >
              <Slack className="h-4 w-4" />
              {busy ? "Connecting…" : "Connect Slack"}
            </button>
          </fetcher.Form>
        </div>
      )}

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}
    </div>
  );
}
