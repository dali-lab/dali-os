import { useMemo, useState } from "react";
import { Link, redirect, useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/members.groups";
import { prisma } from "~/lib/db";
import { listAllGroups } from "~/lib/groups";
import { requireAuth, forbidden } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { canViewForms, currentTermMemberWhere } from "~/lib/roles";
import { MEMBER_LIST_ORDER_BY } from "~/lib/prisma-shapes";
import { resolvePhotoUrl } from "~/lib/photo";
import { Avatar } from "~/components/ui/Avatar";
import { RolePills } from "~/components/ui/RolePills";
import { deriveCoreTitles } from "~/lib/core-titles";
import { Modal, ModalHeader } from "~/components/Modal";
import { useConfirmSubmit } from "~/components/ui/dialog";
import {
  Users,
  Plus,
  Trash2,
  X,
  ChevronRight,
  ChevronDown,
  Archive,
  ArchiveRestore,
  LayoutGrid,
} from "lucide-react";
import { Radio } from "~/components/ui/Radio";


export const meta: Route.MetaFunction = () => [{ title: "Groups · Members · DALI OS" }];

type GroupRow = {
  id: string;
  name: string;
  type: "Static" | "Dynamic";
  systemKey: string | null;
  memberIds: string[];
  archived: boolean;
  // True when archived because someone clicked Archive (vs. term auto-archive).
  manuallyArchived: boolean;
  boundTermCodes: string[];
};

// A member as shown on an expanded group card: enough to render a profile-style
// card (photo, name, role pills) and link to the member's page. `isCurrentMember`
// distinguishes pickable users (current-term lab members) from alumni who only
// appear here because they're still listed in an existing group.
type MemberCardData = {
  id: string;
  firstName: string;
  lastName: string;
  daliEmail: string | null;
  photoUrl: string | null;
  coreTitles: string[];
  domainRoles: { domainName: string; level: string }[];
  isCurrentMember: boolean;
};

type TermOption = { id: string; code: string };

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await canViewForms(auth.user.sub))) return redirect("/members");

  // Picker pool is current-term lab members only (no applicants, no alumni).
  // We still need to render alumni who already exist in a group's memberIds,
  // so the display pool is (current-term ∪ users referenced by any group).
  const memberWhere = await currentTermMemberWhere();
  const [visible, currentMemberRows, terms] = await Promise.all([
    listAllGroups(),
    prisma.user.findMany({ where: memberWhere, select: { id: true } }),
    prisma.term.findMany({
      orderBy: { sortKey: "desc" },
      select: { id: true, code: true },
    }),
  ]);

  const currentIds = new Set(currentMemberRows.map((u) => u.id));
  const referencedIds = new Set<string>();
  for (const g of visible) for (const id of g.memberIds) referencedIds.add(id);
  const displayIds = Array.from(new Set([...currentIds, ...referencedIds]));

  const users = await prisma.user.findMany({
    where: { id: { in: displayIds } },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      daliEmail: true,
      photoUrl: true,
      coreAssignments: { select: { leadTitle: true } },
      domainEligibilities: {
        select: { level: true, domain: { select: { displayName: true } } },
      },
    },
    orderBy: MEMBER_LIST_ORDER_BY,
  });

  const termCodeById = new Map(terms.map((t) => [t.id, t.code]));

  const members: MemberCardData[] = await Promise.all(
    users.map(async (u) => ({
      id: u.id,
      firstName: u.firstName,
      lastName: u.lastName,
      daliEmail: u.daliEmail,
      photoUrl: await resolvePhotoUrl(u.photoUrl),
      coreTitles: deriveCoreTitles(u.coreAssignments),
      domainRoles: u.domainEligibilities.map((e) => ({
        domainName: e.domain.displayName,
        level: e.level,
      })),
      isCurrentMember: currentIds.has(u.id),
    })),
  );

  const groups: GroupRow[] = visible.map((g) => ({
    id: g.id,
    name: g.name,
    type: g.type,
    systemKey: g.systemKey,
    memberIds: g.memberIds,
    archived: g.archived,
    manuallyArchived: g.archivedAt !== null,
    boundTermCodes: g.boundTermIds
      .map((id) => termCodeById.get(id))
      .filter((c): c is string => !!c),
  }));

  return { groups, members, terms };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await canViewForms(auth.user.sub)))
    return forbidden(request);

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "create-group") {
    const name = String(formData.get("name") ?? "").trim();
    const memberIds = parseIdList(formData.get("memberIds"));
    const boundTermIds = parseIdList(formData.get("boundTermIds"));
    if (!name) return Response.json({ error: "Name is required" }, { status: 400 });
    if (memberIds.length === 0)
      return Response.json({ error: "At least one member is required" }, { status: 400 });
    // Only keep term ids that actually exist, so a stale form can't bind a
    // group to a deleted term (which would make its archive state undefined).
    const validTermIds =
      boundTermIds.length === 0
        ? []
        : (
            await prisma.term.findMany({
              where: { id: { in: boundTermIds } },
              select: { id: true },
            })
          ).map((t) => t.id);
    await prisma.groupDefinition.create({
      data: {
        name,
        type: "Static",
        staticMemberIds: memberIds,
        boundTermIds: validTermIds,
      },
    });
    return null;
  }

  if (intent === "delete-group") {
    const groupId = String(formData.get("groupId") ?? "");
    if (!groupId) return Response.json({ error: "groupId is required" }, { status: 400 });
    const group = await prisma.groupDefinition.findUnique({
      where: { id: groupId },
      select: { systemKey: true },
    });
    if (!group) return Response.json({ error: "Group not found" }, { status: 404 });
    if (group.systemKey)
      return Response.json({ error: "System-managed groups cannot be deleted" }, { status: 400 });
    await prisma.groupDefinition.delete({ where: { id: groupId } });
    return null;
  }

  if (intent === "archive-group" || intent === "unarchive-group") {
    const groupId = String(formData.get("groupId") ?? "");
    const group = await prisma.groupDefinition.findUnique({
      where: { id: groupId },
      select: { systemKey: true },
    });
    if (!group) return Response.json({ error: "Group not found" }, { status: 404 });
    if (group.systemKey)
      return Response.json({ error: "System-managed groups cannot be archived" }, { status: 400 });
    await prisma.groupDefinition.update({
      where: { id: groupId },
      data: { archivedAt: intent === "archive-group" ? new Date() : null },
    });
    return null;
  }

  if (intent === "remove-member") {
    const groupId = String(formData.get("groupId") ?? "");
    const userId = String(formData.get("userId") ?? "");
    const group = await prisma.groupDefinition.findUnique({ where: { id: groupId } });
    if (!group) return Response.json({ error: "Group not found" }, { status: 404 });
    if (group.type !== "Static")
      return Response.json({ error: "Dynamic groups update automatically from assignments" }, { status: 400 });
    const next = group.staticMemberIds.filter((id) => id !== userId);
    if (next.length === 0)
      return Response.json({ error: "Cannot remove last member; delete the group instead" }, { status: 400 });
    await prisma.groupDefinition.update({ where: { id: groupId }, data: { staticMemberIds: next } });
    return null;
  }

  if (intent === "add-member") {
    const groupId = String(formData.get("groupId") ?? "");
    const userId = String(formData.get("userId") ?? "");
    const group = await prisma.groupDefinition.findUnique({ where: { id: groupId } });
    if (!group) return Response.json({ error: "Group not found" }, { status: 404 });
    if (group.type !== "Static")
      return Response.json({ error: "Dynamic groups update automatically from assignments" }, { status: 400 });
    if (group.staticMemberIds.includes(userId)) return null;
    await prisma.groupDefinition.update({
      where: { id: groupId },
      data: { staticMemberIds: [...group.staticMemberIds, userId] },
    });
    return null;
  }

  return Response.json({ error: "Unknown intent" }, { status: 400 });
}

function parseIdList(value: FormDataEntryValue | null): string[] {
  return String(value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function memberLabel(m: MemberCardData) {
  const name = `${m.firstName} ${m.lastName}`.trim();
  return name || m.daliEmail || m.id;
}

type StatusFilter = "active" | "archived" | "all";

export default function AdminConsoleGroups() {
  const { groups, members, terms } = useLoaderData<typeof loader>();
  const membersById = useMemo(
    () => new Map(members.map((m) => [m.id, m])),
    [members],
  );
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("active");

  const q = query.trim().toLowerCase();
  const visibleGroups = groups.filter((g: GroupRow) => {
    if (status === "active" && g.archived) return false;
    if (status === "archived" && !g.archived) return false;
    if (q && !g.name.toLowerCase().includes(q)) return false;
    return true;
  });

  const activeCount = groups.filter((g: GroupRow) => !g.archived).length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-foreground/80" />
          <h1 className="text-2xl font-bold text-foreground">User Groups</h1>
          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
            {activeCount}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-accent-coral text-white text-sm font-medium hover:bg-accent-coral/90 transition-colors"
        >
          <Plus className="w-4 h-4" /> New group
        </button>
      </div>

      {groups.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search groups by name"
            className="flex-1 min-w-[12rem] max-w-sm px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
          />
          <StatusTabs status={status} onChange={setStatus} />
        </div>
      )}

      <div className="space-y-3">
        {groups.length === 0 && (
          <div className="text-sm text-muted-foreground/70 px-4 py-8 text-center bg-card border border-border rounded-lg">
            No groups yet. Click "New group" to create one.
          </div>
        )}
        {groups.length > 0 && visibleGroups.length === 0 && (
          <div className="text-sm text-muted-foreground/70 px-4 py-8 text-center bg-card border border-border rounded-lg">
            {q
              ? `No ${status === "all" ? "" : status + " "}groups match "${query.trim()}".`
              : `No ${status} groups.`}
          </div>
        )}
        {visibleGroups.map((g: GroupRow) => (
          <GroupCard key={g.id} group={g} members={members} membersById={membersById} />
        ))}
      </div>

      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        labelledBy="create-group-title"
        containerClassName="bg-card rounded-2xl shadow-brand-2 max-w-lg w-full p-5 sm:p-6 my-auto"
      >
        <CreateGroupForm
          members={members}
          terms={terms}
          onDone={() => setCreating(false)}
        />
      </Modal>
    </div>
  );
}

function StatusTabs({
  status,
  onChange,
}: {
  status: StatusFilter;
  onChange: (s: StatusFilter) => void;
}) {
  const tabs: { value: StatusFilter; label: string }[] = [
    { value: "active", label: "Active" },
    { value: "archived", label: "Archived" },
    { value: "all", label: "All" },
  ];
  return (
    <div className="inline-flex rounded-md border border-border bg-background p-0.5">
      {tabs.map((t) => (
        <button
          key={t.value}
          type="button"
          onClick={() => onChange(t.value)}
          className={`px-3 py-1 text-sm rounded transition-colors ${
            status === t.value
              ? "bg-accent-coral text-white"
              : "text-muted-foreground hover:text-foreground"
          }`}
          aria-pressed={status === t.value}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

function CreateGroupForm({
  members,
  terms,
  onDone,
}: {
  members: MemberCardData[];
  terms: TermOption[];
  onDone: () => void;
}) {
  const fetcher = useFetcher();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  // "always" = never term-bound; "terms" = archive after the chosen term(s) end.
  const [scope, setScope] = useState<"always" | "terms">("always");
  const [boundTerms, setBoundTerms] = useState<string[]>([]);

  const filtered = members.filter((m) => {
    if (!m.isCurrentMember) return false;
    if (!query) return true;
    const ql = query.toLowerCase();
    return (
      `${m.firstName} ${m.lastName}`.toLowerCase().includes(ql) ||
      (m.daliEmail ?? "").toLowerCase().includes(ql)
    );
  });

  const submitting = fetcher.state !== "idle";
  const termsOk = scope === "always" || boundTerms.length > 0;
  const canSubmit =
    name.trim().length > 0 && selected.length > 0 && termsOk && !submitting;

  return (
    <div className="space-y-3">
      <ModalHeader
        titleId="create-group-title"
        title="New group"
        onClose={onDone}
        closeLabel="Cancel"
        className="mb-0"
      />
      <fetcher.Form
        method="post"
        onSubmit={(e) => {
          const fd = new FormData(e.currentTarget);
          // memberIds and boundTermIds travel as hidden comma-joined strings.
          fd.set("memberIds", selected.join(","));
          fd.set("boundTermIds", scope === "terms" ? boundTerms.join(",") : "");
          fetcher.submit(fd, { method: "post" });
          e.preventDefault();
          onDone();
        }}
        className="space-y-4"
      >
        <input type="hidden" name="intent" value="create-group" />
        <div>
          <label htmlFor="group-name" className="block text-sm font-medium text-foreground mb-1">
            Name
          </label>
          <input
            id="group-name"
            name="name"
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Active this term"
            className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground"
            required
          />
        </div>

        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-foreground mb-1">Duration</legend>
          <Radio
            name="scope"
            checked={scope === "always"}
            onChange={() => setScope("always")}
            label="Ongoing"
            description="Stays active until you archive it manually."
          />
          <Radio
            name="scope"
            checked={scope === "terms"}
            onChange={() => setScope("terms")}
            label="For specific term(s)"
            description="Auto-archives once the selected term(s) have ended."
          />
          {scope === "terms" && (
            <div className="flex flex-wrap gap-1.5 pl-6 pt-1">
              {terms.length === 0 && (
                <span className="text-xs text-muted-foreground">No terms available.</span>
              )}
              {terms.map((t) => {
                const on = boundTerms.includes(t.id);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() =>
                      setBoundTerms(
                        on ? boundTerms.filter((x) => x !== t.id) : [...boundTerms, t.id],
                      )
                    }
                    aria-pressed={on}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                      on
                        ? "bg-accent-coral text-white border-accent-coral"
                        : "bg-background text-foreground border-border hover:bg-muted/50"
                    }`}
                  >
                    {t.code}
                  </button>
                );
              })}
            </div>
          )}
        </fieldset>

        <div>
          <label className="block text-sm font-medium text-foreground mb-1">
            Members ({selected.length})
          </label>
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {selected.map((id) => {
                const m = findMember(members, id);
                if (!m) return null;
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800"
                  >
                    {memberLabel(m)}
                    <button
                      type="button"
                      onClick={() => setSelected(selected.filter((s) => s !== id))}
                      aria-label={`Remove ${memberLabel(m)}`}
                      className="hover:text-purple-600"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                );
              })}
            </div>
          )}
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or email…"
            className="w-full px-3 py-2 text-sm border border-border rounded-md bg-background text-foreground"
          />
          <div className="mt-2 max-h-48 overflow-y-auto border border-border rounded-md bg-background">
            {filtered.slice(0, 50).map((m) => {
              const isSel = selected.includes(m.id);
              return (
                <button
                  key={m.id}
                  type="button"
                  onClick={() =>
                    setSelected(isSel ? selected.filter((s) => s !== m.id) : [...selected, m.id])
                  }
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-muted/50 flex justify-between items-center ${
                    isSel ? "bg-muted/30" : ""
                  }`}
                >
                  <span>{memberLabel(m)}</span>
                  {isSel && <span className="text-xs text-purple-700">Selected</span>}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 pt-1">
          {!canSubmit && !submitting && (
            <span className="mr-auto text-xs text-muted-foreground">
              {name.trim().length === 0
                ? "Add a name to continue."
                : selected.length === 0
                  ? "Select at least one member."
                  : !termsOk
                    ? "Pick at least one term."
                    : ""}
            </span>
          )}
          <button
            type="button"
            onClick={onDone}
            className="px-3 py-1.5 text-sm rounded-md border border-border text-foreground hover:bg-muted/50"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="px-3 py-1.5 text-sm font-medium rounded-md bg-accent-coral text-white hover:bg-accent-coral/90 transition-colors disabled:opacity-60"
          >
            Create group
          </button>
        </div>
      </fetcher.Form>
    </div>
  );
}

// Lookup helper used inside CreateGroupForm where we only have the array.
function findMember(members: MemberCardData[], id: string): MemberCardData | undefined {
  return members.find((m) => m.id === id);
}

function GroupCard({
  group,
  members,
  membersById,
}: {
  group: GroupRow;
  members: MemberCardData[];
  membersById: Map<string, MemberCardData>;
}) {
  const fetcher = useFetcher();
  const confirmSubmit = useConfirmSubmit();
  const [expanded, setExpanded] = useState(false);
  const [addingMember, setAddingMember] = useState(false);
  const [query, setQuery] = useState("");

  const isSystem = group.systemKey !== null;
  const available = members.filter(
    (m) => m.isCurrentMember && !group.memberIds.includes(m.id),
  );
  const filtered = available.filter((m) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      `${m.firstName} ${m.lastName}`.toLowerCase().includes(q) ||
      (m.daliEmail ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className={`bg-card border border-border rounded-lg ${group.archived ? "opacity-75" : ""}`}>
      {/* Collapsed header: metadata only. Clicking the row toggles expansion. */}
      <div className="flex items-center gap-3 p-4">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse group" : "Expand group"}
          className="text-muted-foreground hover:text-foreground flex-shrink-0"
        >
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </button>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex-1 min-w-0 flex items-center gap-2 flex-wrap text-left"
        >
          <span className="font-medium text-foreground">{group.name}</span>
          {isSystem && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200 uppercase tracking-wide">
              Auto
            </span>
          )}
          {group.archived && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-50 text-amber-700 border border-amber-200 uppercase tracking-wide">
              Archived
            </span>
          )}
          {group.boundTermCodes.length > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-muted text-muted-foreground">
              {group.boundTermCodes.join(", ")}
            </span>
          )}
          <span className="text-xs font-normal text-muted-foreground">
            {group.memberIds.length} member{group.memberIds.length === 1 ? "" : "s"}
          </span>
        </button>
        {!isSystem && (
          <div className="flex items-center gap-1 flex-shrink-0">
            {/* Term-archived groups can be reactivated by clearing the manual
                flag too; the Archive/Restore toggle keys off the effective
                state. A manual archive overrides term state either way. */}
            <fetcher.Form method="post">
              <input
                type="hidden"
                name="intent"
                value={group.archived ? "unarchive-group" : "archive-group"}
              />
              <input type="hidden" name="groupId" value={group.id} />
              <button
                type="submit"
                aria-label={group.archived ? "Restore group" : "Archive group"}
                title={group.archived ? "Restore group" : "Archive group"}
                className="text-muted-foreground hover:text-foreground p-1"
              >
                {group.archived ? (
                  <ArchiveRestore className="w-4 h-4" />
                ) : (
                  <Archive className="w-4 h-4" />
                )}
              </button>
            </fetcher.Form>
            <fetcher.Form
              method="post"
              onSubmit={confirmSubmit({
                title: `Delete group "${group.name}"?`,
                confirmLabel: "Delete",
                tone: "destructive",
              })}
            >
              <input type="hidden" name="intent" value="delete-group" />
              <input type="hidden" name="groupId" value={group.id} />
              <button
                type="submit"
                aria-label="Delete group"
                className="text-muted-foreground hover:text-red-600 p-1"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </fetcher.Form>
          </div>
        )}
      </div>

      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-border pt-3">
          {group.memberIds.length === 0 && (
            <p className="text-sm text-muted-foreground/70">No members.</p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {group.memberIds.map((uid) => {
              const m = membersById.get(uid);
              if (!m) {
                return (
                  <div
                    key={uid}
                    className="border border-border rounded-md p-2 bg-background text-xs text-muted-foreground"
                  >
                    Unknown member
                  </div>
                );
              }
              return (
                <ExpandedMemberCard
                  key={uid}
                  member={m}
                  removable={!isSystem}
                  groupId={group.id}
                />
              );
            })}
          </div>

          {!isSystem && !addingMember && available.length > 0 && (
            <button
              type="button"
              onClick={() => setAddingMember(true)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/80"
            >
              <Plus className="w-3 h-3" /> Add member
            </button>
          )}

          {!isSystem && addingMember && (
            <div className="border border-border rounded-md bg-background p-2 space-y-2">
              <input
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="w-full px-2 py-1 text-sm border border-border rounded bg-background text-foreground"
              />
              <div className="max-h-40 overflow-y-auto">
                {filtered.slice(0, 30).map((m) => (
                  <fetcher.Form
                    key={m.id}
                    method="post"
                    onSubmit={() => {
                      setAddingMember(false);
                      setQuery("");
                    }}
                  >
                    <input type="hidden" name="intent" value="add-member" />
                    <input type="hidden" name="groupId" value={group.id} />
                    <input type="hidden" name="userId" value={m.id} />
                    <button
                      type="submit"
                      className="w-full text-left px-2 py-1 text-sm hover:bg-muted/50 rounded"
                    >
                      {memberLabel(m)}
                    </button>
                  </fetcher.Form>
                ))}
              </div>
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setAddingMember(false);
                    setQuery("");
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ExpandedMemberCard({
  member,
  removable,
  groupId,
}: {
  member: MemberCardData;
  removable: boolean;
  groupId: string;
}) {
  const fetcher = useFetcher();
  const fullName = `${member.firstName} ${member.lastName}`.trim();
  return (
    <div className="relative border border-border rounded-md p-2 bg-background flex items-start gap-2 hover:bg-muted/10 transition-colors">
      <Link to={`/members/${member.id}`} className="flex items-start gap-2 min-w-0 flex-1">
        <Avatar photoUrl={member.photoUrl} name={fullName} size="sm" className="flex-shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-foreground truncate">{fullName}</div>
          <div className="mt-1">
            {member.coreTitles.length === 0 && member.domainRoles.length === 0 ? (
              <span className="text-muted-foreground text-xs">—</span>
            ) : (
              <RolePills
                coreTitles={member.coreTitles}
                domainRoles={member.domainRoles}
                size="sm"
                showLevel
              />
            )}
          </div>
        </div>
      </Link>
      {removable && (
        <fetcher.Form method="post" className="flex-shrink-0">
          <input type="hidden" name="intent" value="remove-member" />
          <input type="hidden" name="groupId" value={groupId} />
          <input type="hidden" name="userId" value={member.id} />
          <button
            type="submit"
            aria-label={`Remove ${fullName} from group`}
            className="text-muted-foreground hover:text-red-600 p-0.5"
          >
            <X className="w-3 h-3" />
          </button>
        </fetcher.Form>
      )}
    </div>
  );
}
