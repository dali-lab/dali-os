import { Form } from "react-router";
import { Sparkles } from "lucide-react";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { Pill } from "~/hiring/components/cycle-setup/SetupCard";
import type { GrantRowDTO } from "~/lib/settings-page.server";
import {
  SettingsEmptyRow,
  SettingsIconTile,
  settingsDangerBtn,
  settingsList,
} from "~/components/settings/SettingsSection";

const CONNECTED_APPS_ACTION = "/settings/connected-apps";

function day(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function ConnectedAppsSettingsBlock({ grants }: { grants: GrantRowDTO[] }) {
  const confirmSubmit = useConfirmSubmit();
  return (
    <ul className={settingsList}>
      {grants.map((g) => (
        <li key={g.id} className="flex items-start gap-4 px-6 py-4">
          <SettingsIconTile accent>
            <Sparkles className="h-4 w-4" />
          </SettingsIconTile>
          <div className="min-w-0 flex-1">
            <p className="font-semibold text-foreground">{g.clientName}</p>
            {g.scopes.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {g.scopes.map((s) => (
                  <Pill key={s}>{s}</Pill>
                ))}
              </div>
            )}
            <p className="mt-2 text-xs text-os-muted">
              Authorized {day(g.createdAt)}
              {g.lastUsedAt && <> · Last used {day(g.lastUsedAt)}</>}
            </p>
          </div>
          <Form
            method="post"
            action={CONNECTED_APPS_ACTION}
            onSubmit={confirmSubmit({
              title: `Revoke ${g.clientName}?`,
              description: `${g.clientName} loses access to DALI OS right away and is signed out. You can authorize it again any time.`,
              confirmLabel: "Revoke access",
              tone: "destructive",
            })}
          >
            <input type="hidden" name="grantId" value={g.id} />
            <button type="submit" className={settingsDangerBtn}>
              Revoke
            </button>
          </Form>
        </li>
      ))}
      {grants.length === 0 && <SettingsEmptyRow>No apps have access.</SettingsEmptyRow>}
    </ul>
  );
}
