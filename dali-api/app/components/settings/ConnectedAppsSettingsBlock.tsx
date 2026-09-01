import { Form } from "react-router";
import { Link } from "react-router";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { Tooltip } from "~/components/ui/floating";
import type { GrantRowDTO } from "~/lib/settings-page.server";

const CONNECTED_APPS_ACTION = "/settings/connected-apps";

export function ConnectedAppsSettingsBlock({ grants }: { grants: GrantRowDTO[] }) {
  const confirmSubmit = useConfirmSubmit();
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-muted-foreground">
        Apps you've authorized to access DALI OS on your behalf.{" "}
        <Link to="/help/mcp" className="text-accent-teal hover:underline">
          How to connect Claude to DALI OS
        </Link>
        .
      </p>
      {grants.length === 0 ? (
        <p className="text-sm text-muted-foreground">No connected apps.</p>
      ) : (
        <ul className="space-y-3">
          {grants.map((g) => (
            <li key={g.id} className="rounded border border-border bg-card p-4">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h4 className="font-medium">{g.clientName}</h4>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {g.scopes.map((s) => (
                      <span
                        key={s}
                        className="rounded bg-muted px-2 py-0.5 font-mono text-xs text-foreground"
                      >
                        {s}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Authorized {new Date(g.createdAt).toLocaleDateString()}
                    {g.lastUsedAt ? (
                      <> · Last used {new Date(g.lastUsedAt).toLocaleDateString()}</>
                    ) : null}
                  </p>
                </div>
                <Form
                  method="post"
                  action={CONNECTED_APPS_ACTION}
                  onSubmit={confirmSubmit({
                    title: `Revoke access for ${g.clientName}?`,
                    description: `${g.clientName} will immediately lose access to your DALI OS account. You can re-authorize it at any time.`,
                    confirmLabel: "Revoke",
                    tone: "destructive",
                  })}
                >
                  <input type="hidden" name="grantId" value={g.id} />
                  <Tooltip content={`Revoke ${g.clientName}'s access to your account`}>
                    <button
                      type="submit"
                      className="rounded border border-red-300 px-3 py-1 text-sm text-red-700 hover:bg-red-50"
                    >
                      Revoke
                    </button>
                  </Tooltip>
                </Form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
