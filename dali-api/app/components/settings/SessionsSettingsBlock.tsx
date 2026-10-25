import { Form, useNavigation } from "react-router";
import { Bot, Laptop, Monitor, Smartphone } from "lucide-react";
import { cn } from "~/lib/cn";
import { relativeTime } from "~/lib/relative-time";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { useOsChrome } from "~/components/os-chrome";
import { Pill } from "~/hiring/components/cycle-setup/SetupCard";
import type { SessionRowDTO } from "~/lib/settings-page.server";
import {
  SettingsEmptyRow,
  SettingsIconTile,
  settingsDangerBtn,
  settingsList,
} from "~/components/settings/SettingsSection";

const SESSIONS_ACTION = "/settings/sessions";
const ACTIVE_NOW_MS = 5 * 60_000;

export function sessionKind(s: SessionRowDTO): "mcp" | "desktop-app" | "phone" | "laptop" {
  if (s.kind.type === "oauth") return "mcp";
  if (s.isDesktop) return "desktop-app";
  if (/iPhone|Android|Mobile/i.test(s.userAgent ?? "")) return "phone";
  return "laptop";
}

const KIND_ICON = { mcp: Bot, "desktop-app": Monitor, phone: Smartphone, laptop: Laptop };

export function SignOutOthersButton({
  sessions,
  currentSessionId,
}: {
  sessions: SessionRowDTO[];
  currentSessionId: string;
}) {
  const confirmSubmit = useConfirmSubmit();
  const submitting = useNavigation().state !== "idle";
  const others = sessions.filter((s) => s.id !== currentSessionId).length;
  if (others === 0) return null;
  return (
    <Form
      method="post"
      action={SESSIONS_ACTION}
      onSubmit={confirmSubmit({
        title: `Sign out ${others} other ${others === 1 ? "session" : "sessions"}?`,
        description:
          "Every device except this one will need to sign in again, including the desktop app and connected apps.",
        confirmLabel: "Sign out others",
        tone: "destructive",
      })}
    >
      <input type="hidden" name="intent" value="revoke-others" />
      <button type="submit" disabled={submitting} className={settingsDangerBtn}>
        Sign out others ({others})
      </button>
    </Form>
  );
}

export function SessionsSettingsBlock({
  sessions,
  currentSessionId,
}: {
  sessions: SessionRowDTO[];
  currentSessionId: string;
}) {
  const { actionBtn } = useOsChrome();
  const confirmSubmit = useConfirmSubmit();
  const submitting = useNavigation().state !== "idle";

  return (
    <ul className={settingsList}>
      {sessions.map((s) => {
        const isCurrent = s.id === currentSessionId;
        const kind = sessionKind(s);
        const Icon = KIND_ICON[kind];
        const label = s.kind.type === "oauth" ? `${s.kind.clientName} (MCP)` : s.device;
        const activeNow = Date.now() - new Date(s.lastUsedAt).getTime() < ACTIVE_NOW_MS;
        return (
          <li key={s.id} className="flex items-center gap-4 px-6 py-4">
            <SettingsIconTile>
              <Icon className="h-4 w-4" />
            </SettingsIconTile>
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-center gap-2 font-semibold text-foreground">
                {label}
                {isCurrent && <Pill dot="accent">This device</Pill>}
              </p>
              <p className="truncate text-sm text-os-grey" title={s.userAgent ?? undefined}>
                {s.kind.type === "oauth" && s.device !== "Unknown device" && <>{s.device} · </>}
                Signed in {new Date(s.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                {s.ip && (
                  <>
                    {" · "}
                    <span className="font-mono text-xs">{s.ip}</span>
                  </>
                )}
              </p>
            </div>
            <span
              className={cn("hidden text-sm sm:block", activeNow ? "text-os-green" : "text-os-muted")}
            >
              {activeNow ? "Active now" : relativeTime(s.lastUsedAt)}
            </span>
            {!isCurrent && (
              <Form
                method="post"
                action={SESSIONS_ACTION}
                onSubmit={confirmSubmit({
                  title: kind === "mcp" ? `Revoke ${label}?` : `Sign out ${label}?`,
                  description:
                    kind === "mcp"
                      ? "The app loses access until you authorize it again."
                      : kind === "desktop-app"
                        ? "The desktop app will need to sign in again."
                        : "That device will need to sign in again.",
                  confirmLabel: kind === "mcp" ? "Revoke" : "Sign out",
                  tone: "destructive",
                })}
              >
                <input type="hidden" name="intent" value="revoke-one" />
                <input type="hidden" name="sessionId" value={s.id} />
                <button type="submit" disabled={submitting} className={actionBtn()}>
                  {kind === "mcp" ? "Revoke" : "Sign out"}
                </button>
              </Form>
            )}
          </li>
        );
      })}
      {sessions.length === 0 && <SettingsEmptyRow>No active sessions.</SettingsEmptyRow>}
    </ul>
  );
}
