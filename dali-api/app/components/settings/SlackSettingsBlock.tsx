import { useEffect } from "react";
import { useFetcher } from "react-router";
import { Hash } from "lucide-react";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import { useOsChrome } from "~/components/os-chrome";
import { SettingsIconTile, settingsDangerBtn } from "~/components/settings/SettingsSection";

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
  const { actionBtnPrimary } = useOsChrome();
  const fetcher = useFetcher<{ ok?: boolean; slackUserId?: string | null; error?: string | null }>();
  const toast = useToast();
  const confirmSubmit = useConfirmSubmit();
  const busy = fetcher.state !== "idle";
  const connectedId =
    fetcher.data && "slackUserId" in fetcher.data ? fetcher.data.slackUserId : slackUserId;

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data) return;
    if (fetcher.data.error) toast.error(fetcher.data.error);
    else if (fetcher.data.ok) toast.success(fetcher.data.slackUserId ? "Slack connected" : "Slack disconnected");
  }, [fetcher.state, fetcher.data, toast]);

  return (
    <div className="flex flex-wrap items-center gap-4 rounded-os-card bg-os-card px-6 py-5">
      <SettingsIconTile>
        <Hash className="h-4 w-4" />
      </SettingsIconTile>
      <div className="min-w-0 flex-1">
        {connectedId ? (
          <>
            <p className="font-semibold text-foreground">Connected</p>
            <p className="font-mono text-xs text-os-muted">Member ID {connectedId}</p>
          </>
        ) : (
          <>
            <p className="font-semibold text-foreground">Not connected</p>
            <p className="text-sm text-os-grey">
              {configured
                ? "Slack DMs are paused until you connect."
                : "Slack isn't set up on this server yet."}
            </p>
            {configured && emails.length > 0 && (
              <p className="mt-0.5 text-xs text-os-muted">We look you up by {emails.join(", ")}.</p>
            )}
          </>
        )}
      </div>
      {connectedId ? (
        <fetcher.Form
          method="post"
          action={SLACK_ACTION}
          onSubmit={confirmSubmit({
            title: "Disconnect Slack?",
            description:
              "You'll stop getting Slack DMs from DALI OS and won't be added to new project channels. Your notification choices are kept.",
            confirmLabel: "Disconnect",
            tone: "destructive",
          })}
        >
          <input type="hidden" name="intent" value="disconnect" />
          <button type="submit" disabled={busy} className={settingsDangerBtn}>
            Disconnect
          </button>
        </fetcher.Form>
      ) : (
        <fetcher.Form method="post" action={SLACK_ACTION}>
          <input type="hidden" name="intent" value="connect" />
          <button type="submit" disabled={busy || !configured} className={actionBtnPrimary}>
            {busy ? "Connecting…" : "Connect Slack"}
          </button>
        </fetcher.Form>
      )}
    </div>
  );
}
