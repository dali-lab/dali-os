import { Link, useFetcher } from "react-router";
import { Settings2, Unplug } from "lucide-react";
import { Modal, ModalHeader } from "~/components/Modal";
import { modalCardClass } from "~/components/os-chrome";
import { buttonClasses } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { Toggle } from "~/components/ui/Toggle";
import { useDialog } from "~/components/ui/dialog";
import type { EmailPageData } from "~/email/lib/email.server";

export function connectHref(target: string) {
  return `/oauth/mail/google/start?target=${encodeURIComponent(target)}`;
}

// Only flags a broken sign-in; connected and not-yet-connected inboxes say
// so through their Disconnect / Sign in button.
function StatusDot({ error }: { error?: string | null }) {
  if (!error) return null;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-os-container px-2 py-0.5 text-xs text-foreground">
      <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
      Needs reconnect
    </span>
  );
}

function Row({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{title}</p>
        {subtitle && <p className="truncate text-xs text-os-muted">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

export function AccountsModal({ data, onClose }: { data: EmailPageData; onClose: () => void }) {
  const fetcher = useFetcher<{ error?: string }>();
  const dialog = useDialog();
  const byProject = (projectId: string) =>
    data.accounts.find((a) => a.kind === "Project" && a.projectId === projectId);

  const disconnect = async (accountId: string, label: string) => {
    const ok = await dialog.confirm({
      title: `Disconnect ${label}?`,
      description: "Mail stays in Gmail. You can connect it again anytime.",
      confirmLabel: "Disconnect",
      tone: "destructive",
    });
    if (ok) fetcher.submit({ intent: "disconnect", accountId }, { method: "post" });
  };

  const section = "flex flex-col divide-y divide-os-container";
  const heading = "mb-1 text-xs font-semibold uppercase tracking-wide text-os-muted";
  const note = "mt-1 text-xs text-os-muted";
  // Optimistic: flip the switch before the loader catches up.
  const pendingSubscribe = (categoryId: string) =>
    fetcher.formData?.get("categoryId") === categoryId ? fetcher.formData.get("intent") === "subscribe" : null;
  const connectBtn = buttonClasses("secondary", "sm");

  return (
    <Modal open onClose={onClose} labelledBy="mail-accounts-title" containerClassName={modalCardClass("max-w-lg")}>
      <ModalHeader titleId="mail-accounts-title" title="Inboxes" onClose={onClose} />
      <div className="flex flex-col gap-6">
        {data.projects.length > 0 && (
          <div>
            <p className={heading}>Project team</p>
            <div className={section}>
              {data.projects.map((p) => {
                const account = byProject(p.id);
                return (
                  <Row key={p.id} title={p.name} subtitle={p.address}>
                    <StatusDot error={account?.syncError} />
                    {p.connected && account && !account.syncError ? (
                      <IconButton label="Disconnect" icon={Unplug} onClick={() => disconnect(account.id, p.name)} />
                    ) : (
                      <a className={connectBtn} href={connectHref(`project:${p.id}`)}>Connect</a>
                    )}
                  </Row>
                );
              })}
            </div>
            <p className={note}>
              Added automatically while you&apos;re staffed on the project this term. Sign in as the project account once
              and your whole team sees it.
            </p>
          </div>
        )}

        <div>
          <div className="mb-1 flex items-center gap-2">
            <p className={heading}>Shared inboxes</p>
            {data.isAdmin && (
              <Link
                to="/admin/email-senders#inbox-categories"
                className="ml-auto inline-flex items-center gap-1 text-xs text-os-muted hover:text-foreground"
              >
                <Settings2 className="h-3.5 w-3.5" />
                Manage categories
              </Link>
            )}
          </div>
          {data.categories.length === 0 ? (
            <p className="py-2 text-sm text-os-muted">No shared inboxes are open to you yet.</p>
          ) : (
            <div className={section}>
              {data.categories.map((c) => {
                const subscribed = pendingSubscribe(c.id) ?? c.subscribed;
                return (
                  <div key={c.id} className="py-2">
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">{c.name}</p>
                        {c.description && <p className="truncate text-xs text-os-muted">{c.description}</p>}
                      </div>
                      <Toggle
                        tone="os"
                        aria-label={`Subscribe to ${c.name}`}
                        checked={subscribed}
                        onChange={(e) =>
                          fetcher.submit(
                            { intent: e.target.checked ? "subscribe" : "unsubscribe", categoryId: c.id },
                            { method: "post" },
                          )
                        }
                      />
                    </div>
                    {subscribed && (
                      <div className="mt-1 flex flex-col pl-3">
                        {c.inboxes.map((inbox) => (
                          <Row key={inbox.id} title={inbox.label} subtitle={inbox.label === inbox.address ? undefined : inbox.address}>
                            <StatusDot error={inbox.syncError} />
                            {inbox.connected && !inbox.syncError ? (
                              <IconButton label="Disconnect" icon={Unplug} onClick={() => disconnect(inbox.id, inbox.address)} />
                            ) : (
                              <a className={connectBtn} href={connectHref(`shared:${inbox.id}`)}>
                                {inbox.syncError ? "Reconnect" : "Sign in"}
                              </a>
                            )}
                          </Row>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          <p className={note}>Subscribe to see a category&apos;s inboxes, then sign in to each one yourself.</p>
          {fetcher.data?.error && <p className="mt-1 text-xs text-destructive">{fetcher.data.error}</p>}
        </div>
      </div>
    </Modal>
  );
}
