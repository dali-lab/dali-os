import { useEffect, useRef, useState } from "react";
import { Link2, User, Users, X } from "lucide-react";
import { Checkbox } from "~/components/ui/Checkbox";
import { Modal, ModalHeader } from "~/components/Modal";
import { buttonClasses } from "~/components/ui/Button";
import { Select, type SelectOption, InfoTip } from "~/components/ui/floating";
import { useDialog } from "~/components/ui/dialog";

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
  memberCount?: number;
};
type Context = {
  linkAccess: LinkAccess;
  linkPermission: Permission;
  workspaceType: string;
  owner: { id: string; name: string; isYou: boolean } | null;
  partnerVisible: boolean;
  hasActivePartner: boolean;
};

// Full tiers for the per-person dropdown; general access never offers Full.
const PERMISSION_OPTIONS: SelectOption<Permission>[] = [
  { value: "View", label: "Can view", description: "Read only" },
  { value: "Comment", label: "Can comment", description: "Read and comment" },
  { value: "Edit", label: "Can edit", description: "Edit the document" },
  { value: "FullAccess", label: "Full access", description: "Edit and manage sharing" },
];
const LINK_PERMISSION_OPTIONS = PERMISSION_OPTIONS.filter((p) => p.value !== "FullAccess");

const AUDIENCE_OPTIONS: SelectOption<LinkAccess>[] = [
  { value: "Restricted", label: "Restricted", description: "Only the people and groups above." },
  { value: "LabMembers", label: "Anyone in the lab", description: "Any lab member with the link — not partners or applicants." },
  { value: "Public", label: "Anyone with the link", description: "Anyone on the internet — read-only, no account." },
];

// Lab docs live on the lab's shared shelf, so the audience wording is the doc's
// primary access control — not a "with the link" caveat. Same LinkAccess values,
// plain-language labels, and a permission tier ("Everyone in the lab" can be set
// to Can view / comment / edit just like a named person).
const LAB_AUDIENCE_OPTIONS: SelectOption<LinkAccess>[] = [
  { value: "Restricted", label: "Only people you add", description: "Only you and the people and groups above." },
  { value: "LabMembers", label: "Everyone in the lab", description: "Any lab member can open it." },
  { value: "Public", label: "Anyone with the link", description: "Anyone on the internet — read-only, no account." },
];

function baseAccessLine(ctx: Context): string {
  switch (ctx.workspaceType) {
    case "Lab":
      return ctx.linkAccess === "Restricted"
        ? "Only you and the people below can open it."
        : ctx.linkAccess === "Public"
          ? "Anyone with the link can view it."
          : "Everyone in the lab can access it.";
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
  const dialog = useDialog();

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
  // Lab docs get plain-language audience labels ("Everyone in the lab" / "Only
  // people you add"); every other workspace keeps the link-centric wording.
  const audienceOptions = isLab ? LAB_AUDIENCE_OPTIONS : AUDIENCE_OPTIONS;

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
      <div className="flex flex-col gap-2.5 mb-6">
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
          <label className="flex flex-col gap-1.5 text-xs">
            <span className="text-muted-foreground">Or add a group</span>
            <Select
              key={shares.length}
              disabled={busy}
              placeholder="Pick a group…"
              options={groups
                .filter((g) => !alreadyShared.has(`Group:${g.id}`))
                .map((g) => ({ value: g.id, label: g.label }))}
              onChange={(id) => {
                void run(
                  { intent: "share-add", principalType: "Group", principalId: id, permission: "View" },
                  refresh,
                );
              }}
              buttonClassName="px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
            />
          </label>
        )}
      </div>

      {/* People with access */}
      <div className="flex flex-col gap-2.5 mb-6">
        <h3 className="text-xs font-semibold text-muted-foreground inline-flex items-center gap-1">
          People with access
          <InfoTip content="Individual people or groups who can access this document. View = read-only; Comment = read and add comments; Edit = make changes; Full access = edit and manage sharing." />
        </h3>
        <p className="text-xs text-muted-foreground -mt-1.5">{ctx ? baseAccessLine(ctx) : "…"}</p>
        <ul className="flex flex-col gap-1.5">
          {ctx?.owner && (
            <li className="flex items-center gap-2.5 text-sm px-3 py-2.5 rounded-md border border-border bg-muted">
              <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
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
                className="flex items-center gap-2.5 text-sm px-3 py-2.5 rounded-md border border-border bg-muted"
              >
                {/* A person and a group are different kinds of grant, so they
                    get different marks — one icon for both made a 500-person
                    group read like a single colleague. */}
                {s.principalType === "Group" ? (
                  <Users className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                ) : (
                  <User className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                )}
                <span className="flex-1 min-w-0">
                  <span className="block truncate text-foreground">{s.label}</span>
                  {s.principalType === "Group" && s.memberCount !== undefined && (
                    <span className="block truncate text-xs text-muted-foreground">
                      {s.memberCount === 1 ? "1 person" : `${s.memberCount} people`}
                    </span>
                  )}
                </span>
                <Select
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

      {/* General access (Google's row): audience + role, plus copy link */}
      <div className="flex flex-col gap-2.5 mb-6 border-t border-border pt-5">
        <h3 className="text-xs font-semibold text-muted-foreground inline-flex items-center gap-1">
          General access
          <InfoTip content={isLab ? "Controls who can open this document by default. 'Everyone in the lab' makes it accessible to any lab member. 'Only people you add' restricts it to explicit shares above." : "Controls who can open this document via the link. 'Anyone in the lab' means any lab member with the link; 'Anyone with the link' is public read-only."} />
        </h3>
        <div className="flex items-start gap-3 rounded-md border border-border px-3 py-3">
          <Link2 className="w-4 h-4 mt-1 shrink-0 text-muted-foreground" />
          <div className="flex-1 min-w-0 flex flex-col gap-1">
            <Select
              value={ctx?.linkAccess ?? "Restricted"}
              options={audienceOptions}
              disabled={busy || !ctx}
              ariaLabel="General access audience"
              buttonClassName="inline-flex items-center gap-1 self-start rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground transition-colors hover:bg-muted/40 disabled:opacity-60"
              onChange={async (linkAccess) => {
                // Only confirm when moving to a broader audience; downgrades to
                // Restricted need no confirmation.
                if (linkAccess === "Public") {
                  const ok = await dialog.confirm({
                    title: "Make this document public?",
                    description:
                      "Anyone on the internet will be able to read it — no account required. They won't be able to edit or comment.",
                    confirmLabel: "Make public",
                    tone: "destructive",
                  });
                  if (!ok) return;
                } else if (
                  linkAccess === "LabMembers" &&
                  (ctx?.workspaceType === "Member" || ctx?.workspaceType === "Project")
                ) {
                  const label = isLab ? "Everyone in the lab" : "Anyone in the lab";
                  const ok = await dialog.confirm({
                    title: `Share with ${label}?`,
                    description: isLab
                      ? "Every lab member will be able to open this document."
                      : "Any lab member with the link will be able to view this document.",
                    confirmLabel: "Share",
                    tone: "destructive",
                  });
                  if (!ok) return;
                }
                // Public can only be view-only (no identity to attribute writes).
                // "Everyone in the lab" defaults to edit — the historical lab-wide
                // default — but stays adjustable via the role dropdown.
                const linkPermission =
                  linkAccess === "Public"
                    ? "View"
                    : linkAccess === "LabMembers" && isLab
                      ? "Edit"
                      : (ctx?.linkPermission ?? "View");
                void run({ intent: "general-access", linkAccess, linkPermission }, refresh);
              }}
            />
            <span className="text-xs text-muted-foreground">
              {audienceOptions.find((a) => a.value === (ctx?.linkAccess ?? "Restricted"))?.description}
            </span>
          </div>
          {ctx && ctx.linkAccess !== "Restricted" && (
            <div className="self-center">
              <Select
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
        <div className="flex flex-col gap-2.5 mb-6 border-t border-border pt-5">
          <h3 className="text-xs font-semibold text-muted-foreground inline-flex items-center gap-1">
            Partners
            <InfoTip content="When enabled, partner accounts on this project can view and comment on this document in the partner portal. Lab-internal edits remain invisible to partners." />
          </h3>
          <Checkbox
            className="items-start rounded-md border border-border px-3 py-2"
            checked={ctx.partnerVisible}
            disabled={busy}
            onChange={(e) => void setPartnerVisible(e.target.checked)}
            label="Visible to partners on this project"
            description="Partner accounts on this project can open and comment on it in the partner portal."
          />
        </div>
      )}

      <div className="flex items-center justify-between border-t border-border pt-4">
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
