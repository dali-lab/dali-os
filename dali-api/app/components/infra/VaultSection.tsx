// A project's Vaultwarden group: who's in it and in what state, how it compares
// with staffing, and which collections it opens. Read-only in the project hub;
// the Admin console passes `actions` for sync, removal, and member fixes.

import type { ReactNode } from "react";
import { ExternalLink } from "lucide-react";
import { cn } from "~/lib/cn";
import {
  collectionLabel,
  VAULT_STATUS_LABEL,
  type ProjectVault,
  type VaultMemberRow,
} from "~/lib/infra/vault-scope";
import { ColWidths, consoleUrl, ExternalIconLink, plural } from "./format";

export type VaultActions = {
  busy: boolean;
  sync: () => void;
  remove: (email: string) => void;
  member: (memberId: string, action: "revoke" | "restore" | "reinvite") => void;
};

const STATUS_TONE: Record<number, string> = {
  [-1]: "bg-muted text-muted-foreground",
  0: "bg-muted text-muted-foreground",
  1: "bg-os-amber/15 text-os-amber",
  2: "bg-os-green/15 text-os-green",
};

const COLS = [null, "8rem", "5rem", "11rem"];

export function VaultSection({
  vault,
  orgUrl,
  actions,
}: {
  vault: ProjectVault;
  orgUrl: string | null;
  actions?: VaultActions;
}) {
  const notStaffed = vault.members.filter((m) => !m.staffed);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Vaultwarden · {vault.group.name}
          </h4>
          {orgUrl && <ExternalIconLink href={consoleUrl.vaultGroups(orgUrl)} label="Open groups in Vaultwarden" />}
        </span>
        {actions && (
          <button
            type="button"
            disabled={actions.busy || vault.missing.length === 0}
            onClick={actions.sync}
            className="os-btn-ghost text-xs disabled:opacity-50"
          >
            Add {plural(vault.missing.length, "staffed person", "staffed people")}
          </button>
        )}
      </div>

      <VaultNotes vault={vault} notStaffed={notStaffed.length} orgUrl={orgUrl} />

      {vault.members.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nobody is in this group yet.</p>
      ) : (
        <div className="rounded-md border border-border">
          <table className="w-full table-fixed text-left text-xs">
            <ColWidths widths={COLS} />
            <thead className="text-muted-foreground">
              <tr>
                <th className="px-3 py-1 font-medium">Member</th>
                <th className="px-3 py-1 font-medium">Status</th>
                <th className="px-3 py-1 font-medium">2FA</th>
                <th className="px-3 py-1 font-medium" />
              </tr>
            </thead>
            <tbody>
              {vault.members.map((m) => (
                <MemberRow key={m.id} m={m} actions={actions} />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {vault.collections.length > 0 && (
        <div className="rounded-md border border-border">
          <table className="w-full table-fixed text-left text-xs">
            <ColWidths widths={[null, "6rem", "9rem"]} />
            <thead className="text-muted-foreground">
              <tr>
                <th className="px-3 py-1 font-medium">Collection</th>
                <th className="px-3 py-1 font-medium">Items</th>
                <th className="px-3 py-1 font-medium">Opened (30 days)</th>
              </tr>
            </thead>
            <tbody>
              {vault.collections.map((c) => (
                <tr key={c.id} className="border-t border-border">
                  <td className="px-3 py-1.5 text-foreground">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span className="truncate">{collectionLabel(c)}</span>
                      {orgUrl && (
                        <ExternalIconLink href={consoleUrl.vaultCollection(orgUrl, c.id)} label="Open collection in Vaultwarden" />
                      )}
                    </span>
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground">{c.itemCount}</td>
                  <td className="px-3 py-1.5 text-muted-foreground">{c.recentUses ?? "Events off"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function VaultNotes({ vault, notStaffed, orgUrl }: { vault: ProjectVault; notStaffed: number; orgUrl: string | null }) {
  const notes: ReactNode[] = [];
  if (vault.missing.length > 0) {
    notes.push(`Staffed but not in the group: ${vault.missing.map((p) => p.name).join(", ")}.`);
  }
  if (notStaffed > 0) notes.push(`${plural(notStaffed, "member is", "members are")} no longer staffed.`);
  if (vault.noEmail.length > 0) {
    notes.push(`No DALI email, so not synced: ${vault.noEmail.map((p) => p.name).join(", ")}.`);
  }
  if (vault.awaitingConfirm > 0) {
    notes.push(
      <span key="confirm">
        {plural(vault.awaitingConfirm, "person is", "people are")} waiting to be confirmed
        {orgUrl && (
          <>
            {" "}
            <a href={consoleUrl.vaultMembers(orgUrl)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-os-accent hover:underline">
              in Vaultwarden <ExternalLink className="h-3 w-3" />
            </a>
          </>
        )}
        .
      </span>,
    );
  }
  if (notes.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5 rounded-md bg-os-amber/10 px-3 py-2 text-xs text-os-amber">
      {notes.map((n, i) => (
        <li key={i}>{n}</li>
      ))}
    </ul>
  );
}

function MemberRow({ m, actions }: { m: VaultMemberRow; actions?: VaultActions }) {
  return (
    <tr className="border-t border-border">
      <td className="truncate px-3 py-1.5 text-foreground">
        {m.name ? `${m.name} · ` : ""}
        <span className="text-muted-foreground">{m.email}</span>
        {!m.staffed && (
          <span className="ml-1.5 rounded-full bg-os-amber/15 px-1.5 py-0.5 text-[10px] font-semibold text-os-amber">
            not staffed
          </span>
        )}
      </td>
      <td className="px-3 py-1.5">
        <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-semibold", STATUS_TONE[m.status])}>
          {VAULT_STATUS_LABEL[m.status]}
        </span>
      </td>
      <td className={cn("px-3 py-1.5", m.twoFactorEnabled ? "text-muted-foreground" : "text-os-amber")}>
        {m.twoFactorEnabled ? "on" : "off"}
      </td>
      <td className="px-3 py-1.5 text-right">
        {actions && (
          <span className="inline-flex justify-end gap-2">
            {m.status === 0 && (
              <MemberButton label="Re-invite" onClick={() => actions.member(m.id, "reinvite")} busy={actions.busy} />
            )}
            {m.status === -1 ? (
              <MemberButton label="Restore" onClick={() => actions.member(m.id, "restore")} busy={actions.busy} />
            ) : (
              <MemberButton label="Revoke" onClick={() => actions.member(m.id, "revoke")} busy={actions.busy} />
            )}
            <MemberButton label="Remove" onClick={() => actions.remove(m.email)} busy={actions.busy} danger />
          </span>
        )}
      </td>
    </tr>
  );
}

function MemberButton({ label, onClick, busy, danger }: { label: string; onClick: () => void; busy: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onClick}
      className={cn("text-xs hover:underline disabled:opacity-50", danger ? "text-destructive" : "text-os-accent")}
    >
      {label}
    </button>
  );
}
