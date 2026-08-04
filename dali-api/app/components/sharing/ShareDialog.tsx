import { useEffect, useRef, useState } from "react";
import { Check, Globe, Link2, Lock, Users, X } from "lucide-react";
import { Modal, ModalHeader } from "~/components/Modal";
import { buttonClasses } from "~/components/ui/Button";
import { SelectMenu, type SelectMenuOption } from "~/components/ui/SelectMenu";

// One Share dialog for every document — Project, Lab, EducationOffering and
// personal notes. Google Docs' shape: add people, a "People with access" list
// with a per-row role, then a single "General access" row. All requests go to
// /api/pages/:id/share; the link people copy is just the doc URL.

type Permission = "View" | "Comment" | "Edit" | "FullAccess";
type LinkAccess = "Restricted" | "LabMembers" | "Public";
type Option = { id: string; label: string };
type Share = {
  id: string;
  principalType: string;
  principalId: string;
  permission: Permission;
  label: string;
};
type Context = {
  linkAccess: LinkAccess;
  linkPermission: Permission;
  labRestricted: boolean;
  workspaceType: string;
  owner: { id: string; name: string; isYou: boolean } | null;
  partnerVisible: boolean;
  hasActivePartner: boolean;
};

// Full tiers for the per-person dropdown; general access never offers Full.
const PERMISSION_OPTIONS: SelectMenuOption<Permission>[] = [
  { value: "View", label: "Can view", description: "Read only" },
  { value: "Comment", label: "Can comment", description: "Read and comment" },
  { value: "Edit", label: "Can edit", description: "Edit the document" },
  { value: "FullAccess", label: "Full access", description: "Edit and manage sharing" },
];
const LINK_PERMISSION_OPTIONS = PERMISSION_OPTIONS.filter((p) => p.value !== "FullAccess");

const AUDIENCE_OPTIONS: SelectMenuOption<LinkAccess>[] = [
  { value: "Restricted", label: "Restricted", description: "Only the people and groups above." },
  { value: "LabMembers", label: "Anyone in the lab", description: "Any lab member with the link — not partners or applicants." },
  { value: "Public", label: "Anyone with the link", description: "Anyone on the internet — read-only, no account." },
];

function baseAccessLine(ctx: Context): string {
  switch (ctx.workspaceType) {
    case "Lab":
      return ctx.labRestricted
        ? "Only you and the people below can open it."
        : "Everyone in the lab can view and edit.";
    case "Project":
      return "Project staff can edit · lab members can view.";
    case "EducationOffering":
      return "Instructors can edit · lab members can view.";
    case "Member":
      return "Only you, unless you share it or turn on general access.";
    default:
      return "";
  }
}

export function ShareDialog({
  page,
  open,
  onClose,
  onChanged,
}: {
  page: { id: string; title: string; workspaceType: string };
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [ctx, setCtx] = useState<Context | null>(null);
  const [shares, setShares] = useState<Share[]>([]);
  const [query, setQuery] = useState("");
  const [members, setMembers] = useState<Option[]>([]);
  const [groups, setGroups] = useState<Option[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const searchRef = useRef<HTMLInputElement | null>(null);

  async function post(body: Record<string, string>): Promise<any> {
    const form = new FormData();
    for (const [k, v] of Object.entries(body)) form.append(k, v);
    const res = await fetch(`/api/pages/${page.id}/share`, {
      method: "POST",
      body: form,
      credentials: "include",
    });
    return res.json().catch(() => ({}));
  }

  useEffect(() => {
    if (!open) return;
    setError(null);
    setQuery("");
    setCopied(false);
    void post({ intent: "state" }).then((d) => {
      if (d?.error) {
        setError(d.error);
        return;
      }
      if (d.context) {
        setCtx({
          linkAccess: d.context.linkAccess,
          linkPermission: d.context.linkPermission,
          labRestricted: d.context.labRestricted,
          workspaceType: d.context.page?.workspaceType ?? page.workspaceType,
          owner: d.context.owner ?? null,
          partnerVisible: !!d.context.partnerVisible,
          hasActivePartner: !!d.context.hasActivePartner,
        });
      }
      setShares(d.shares ?? []);
    });
    void post({ intent: "share-options", q: "" }).then((d) => setGroups(d.groups ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, page.id]);

  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setMembers([]);
      return;
    }
    const t = setTimeout(() => {
      void post({ intent: "share-options", q }).then((d) => setMembers(d.members ?? []));
    }, 200);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, open]);

  async function run(body: Record<string, string>, after?: () => void) {
    setBusy(true);
    setError(null);
    const res = await post(body);
    setBusy(false);
    if (res?.error) {
      setError(res.error);
      return;
    }
    after?.();
    onChanged?.();
  }

  async function refresh() {
    const d = await post({ intent: "state" });
    if (d.context) {
      setCtx({
        linkAccess: d.context.linkAccess,
        linkPermission: d.context.linkPermission,
        labRestricted: d.context.labRestricted,
        workspaceType: d.context.page?.workspaceType ?? page.workspaceType,
        owner: d.context.owner ?? null,
        partnerVisible: !!d.context.partnerVisible,
        hasActivePartner: !!d.context.hasActivePartner,
      });
    }
    setShares(d.shares ?? []);
  }

  // Partner sharing is its own audience (the project's partner portal), not the
  // lab/link "General access" — it posts to the existing per-project endpoint.
  async function setPartnerVisible(next: boolean) {
    setBusy(true);
    setError(null);
    const res = await fetch(`/api/pages/${page.id}/partner-visible`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ partnerVisible: next }),
      credentials: "include",
    })
      .then((r) => r.json())
      .catch(() => ({}));
    setBusy(false);
    if (res?.error) {
      setError(res.error);
      return;
    }
    await refresh();
    onChanged?.();
  }

  async function copyLink() {
    const url = `${window.location.origin}/documents/${page.id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      setError("Couldn't copy the link — copy it from the address bar.");
    }
  }

  const alreadyShared = new Set(shares.map((s) => `${s.principalType}:${s.principalId}`));
  const isLab = (ctx?.workspaceType ?? page.workspaceType) === "Lab";

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="share-dialog-title"
      initialFocusRef={searchRef}
      containerClassName="bg-card rounded-2xl shadow-brand-2 max-w-lg w-full p-5 sm:p-6 my-auto max-h-[85vh] overflow-y-auto"
    >
      <ModalHeader titleId="share-dialog-title" title={`Share “${page.title}”`} onClose={onClose} />

      {error && (
        <p className="mb-3 text-sm text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">
          {error}
        </p>
      )}

      {/* Add people / groups */}
      <div className="flex flex-col gap-2 mb-2">
        <input
          ref={searchRef}
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Add people by name"
          className="px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
        />
        {members.length > 0 && (
          <ul className="flex flex-col gap-0.5 border border-border rounded-md p-1">
            {members.map((m) => {
              const shared = alreadyShared.has(`User:${m.id}`);
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    disabled={busy || shared}
                    onClick={() =>
                      void run(
                        {
                          intent: "share-add",
                          principalType: "User",
                          principalId: m.id,
                          permission: "View",
                        },
                        () => {
                          setQuery("");
                          void refresh();
                        },
                      )
                    }
                    className="w-full text-left px-2 py-1.5 text-sm rounded hover:bg-muted/40 disabled:opacity-50 disabled:hover:bg-transparent"
                  >
                    {m.label}
                    {shared && <span className="text-xs text-muted-foreground"> — already added</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {groups.length > 0 && (
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-muted-foreground">Or add a group</span>
            <select
              disabled={busy}
              defaultValue=""
              onChange={(e) => {
                if (!e.target.value) return;
                const id = e.target.value;
                e.target.value = "";
                void run(
                  { intent: "share-add", principalType: "Group", principalId: id, permission: "View" },
                  refresh,
                );
              }}
              className="px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground"
            >
              <option value="">Pick a group…</option>
              {groups
                .filter((g) => !alreadyShared.has(`Group:${g.id}`))
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.label}
                  </option>
                ))}
            </select>
          </label>
        )}
      </div>

      {/* People with access */}
      <div className="flex flex-col gap-2 mb-5">
        <h3 className="text-xs font-semibold text-muted-foreground">People with access</h3>
        <p className="text-xs text-muted-foreground -mt-1">{ctx ? baseAccessLine(ctx) : "…"}</p>
        <ul className="flex flex-col gap-1">
          {ctx?.owner && (
            <li className="flex items-center gap-2 text-sm px-2.5 py-1.5 rounded-md border border-border bg-muted">
              <Users className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="flex-1 min-w-0 truncate text-foreground">
                {ctx.owner.name}
                {ctx.owner.isYou && <span className="text-muted-foreground"> (you)</span>}
              </span>
              <span className="text-xs text-muted-foreground">Owner</span>
            </li>
          )}
          {shares
            .filter(
              (s) => !(ctx?.owner && s.principalType === "User" && s.principalId === ctx.owner.id),
            )
            .map((s) => (
              <li
                key={s.id}
                className="flex items-center gap-2 text-sm px-2.5 py-1.5 rounded-md border border-border bg-muted"
              >
                <Users className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <span className="flex-1 min-w-0 truncate text-foreground">{s.label}</span>
                <SelectMenu
                  value={s.permission}
                  options={PERMISSION_OPTIONS}
                  align="right"
                  disabled={busy}
                  ariaLabel={`Access level for ${s.label}`}
                  onChange={(permission) =>
                    void run(
                      {
                        intent: "share-change",
                        principalType: s.principalType,
                        principalId: s.principalId,
                        permission,
                      },
                      refresh,
                    )
                  }
                />
                <button
                  type="button"
                  disabled={busy}
                  aria-label={`Remove ${s.label}`}
                  onClick={() =>
                    void run({ intent: "share-remove", shareId: s.id }, refresh)
                  }
                  className="text-muted-foreground hover:text-destructive transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </li>
            ))}
        </ul>
      </div>

      {/* Lab base audience (everyone-in-lab vs restricted) */}
      {isLab && (
        <fieldset className="flex flex-col gap-2 mb-5">
          <legend className="text-xs font-semibold text-muted-foreground mb-1">Lab access</legend>
          {(
            [
              [false, Globe, "Everyone in the lab", "Any lab member can open and edit it."],
              [true, Lock, "Only people you add", "You and the people above."],
            ] as const
          ).map(([value, Icon, label, hint]) => {
            const active = (ctx?.labRestricted ?? false) === value;
            return (
              <label
                key={label}
                className={`flex items-start gap-3 rounded-md border px-3 py-2 cursor-pointer transition-colors ${
                  active ? "border-accent-coral bg-accent-coral/5" : "border-border hover:bg-muted/30"
                }`}
              >
                <input
                  type="radio"
                  name="lab-access"
                  className="sr-only"
                  checked={active}
                  disabled={busy}
                  onChange={() =>
                    void run({ intent: "restrict", restricted: String(value) }, refresh)
                  }
                />
                <Icon
                  className={`w-4 h-4 mt-0.5 shrink-0 ${active ? "text-accent-coral" : "text-muted-foreground"}`}
                />
                <span className="flex flex-col min-w-0">
                  <span className="text-sm font-medium text-foreground">{label}</span>
                  <span className="text-xs text-muted-foreground">{hint}</span>
                </span>
                {active && <Check className="w-4 h-4 text-accent-coral shrink-0" />}
              </label>
            );
          })}
        </fieldset>
      )}

      {/* General access (Google's row): audience + role, plus copy link */}
      <div className="flex flex-col gap-2 mb-4 border-t border-border pt-4">
        <h3 className="text-xs font-semibold text-muted-foreground">General access</h3>
        <div className="flex items-start gap-3 rounded-md border border-border px-3 py-2">
          <Link2 className="w-4 h-4 mt-1 shrink-0 text-muted-foreground" />
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <SelectMenu
              value={ctx?.linkAccess ?? "Restricted"}
              options={AUDIENCE_OPTIONS}
              disabled={busy || !ctx}
              ariaLabel="General access audience"
              buttonClassName="inline-flex items-center gap-1 self-start rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground transition-colors hover:bg-muted/40 disabled:opacity-60"
              onChange={(linkAccess) => {
                // Public can only be view-only (no identity to attribute writes).
                const linkPermission = linkAccess === "Public" ? "View" : (ctx?.linkPermission ?? "View");
                void run({ intent: "general-access", linkAccess, linkPermission }, refresh);
              }}
            />
            <span className="text-xs text-muted-foreground">
              {AUDIENCE_OPTIONS.find((a) => a.value === (ctx?.linkAccess ?? "Restricted"))?.description}
            </span>
          </div>
          {ctx && ctx.linkAccess !== "Restricted" && (
            <div className="self-center">
              <SelectMenu
                value={ctx.linkAccess === "Public" ? "View" : ctx.linkPermission}
                options={LINK_PERMISSION_OPTIONS}
                align="right"
                disabled={busy || ctx.linkAccess === "Public"}
                ariaLabel="General access role"
                onChange={(linkPermission) =>
                  void run(
                    { intent: "general-access", linkAccess: ctx.linkAccess, linkPermission },
                    refresh,
                  )
                }
              />
            </div>
          )}
        </div>
      </div>

      {/* Partners — a project's partner-portal audience, kept distinct from the
          lab "General access" above (share-with-people vs external org). */}
      {ctx?.workspaceType === "Project" && ctx.hasActivePartner && (
        <div className="flex flex-col gap-2 mb-4 border-t border-border pt-4">
          <h3 className="text-xs font-semibold text-muted-foreground">Partners</h3>
          <label className="flex items-start gap-3 rounded-md border border-border px-3 py-2 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5 accent-accent-coral"
              checked={ctx.partnerVisible}
              disabled={busy}
              onChange={(e) => void setPartnerVisible(e.target.checked)}
            />
            <span className="flex flex-col min-w-0">
              <span className="text-sm font-medium text-foreground">Visible to partners on this project</span>
              <span className="text-xs text-muted-foreground">
                Partner accounts on this project can open and comment on it in the partner portal.
              </span>
            </span>
          </label>
        </div>
      )}

      <div className="flex items-center justify-between pt-1">
        <button
          type="button"
          onClick={copyLink}
          className={buttonClasses("secondary", "sm")}
        >
          {copied ? "Copied!" : "Copy link"}
        </button>
        <button type="button" onClick={onClose} className={buttonClasses("primary", "sm")}>
          Done
        </button>
      </div>
    </Modal>
  );
}
