import { useState } from "react";
import { redirect, useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/members.groups";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { isAdmin } from "~/lib/roles";
import { Users, Plus, Trash2, X } from "lucide-react";

export const meta: Route.MetaFunction = () => [{ title: "Groups · Members · DALI OS" }];

type GroupRow = {
  id: string;
  name: string;
  staticMemberIds: string[];
};

type UserOption = {
  id: string;
  firstName: string;
  lastName: string;
  daliEmail: string | null;
};

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  if (!(await isAdmin(auth.user.sub))) return redirect("/members");

  const [groups, users] = await Promise.all([
    prisma.groupDefinition.findMany({ orderBy: { name: "asc" } }),
    prisma.user.findMany({
      select: { id: true, firstName: true, lastName: true, daliEmail: true },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
    }),
  ]);

  return { groups, users };
}

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isAdmin(auth.user.sub)))
    return Response.json({ error: "Forbidden" }, { status: 403 });

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "create-group") {
    const name = String(formData.get("name") ?? "").trim();
    const memberIds = String(formData.get("memberIds") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (!name) return Response.json({ error: "Name is required" }, { status: 400 });
    if (memberIds.length === 0)
      return Response.json({ error: "At least one member is required" }, { status: 400 });
    await prisma.groupDefinition.create({ data: { name, type: "Static", staticMemberIds: memberIds } });
    return null;
  }

  if (intent === "delete-group") {
    const groupId = String(formData.get("groupId") ?? "");
    if (!groupId) return Response.json({ error: "groupId is required" }, { status: 400 });
    await prisma.groupDefinition.delete({ where: { id: groupId } });
    return null;
  }

  if (intent === "remove-member") {
    const groupId = String(formData.get("groupId") ?? "");
    const userId = String(formData.get("userId") ?? "");
    const group = await prisma.groupDefinition.findUnique({ where: { id: groupId } });
    if (!group) return Response.json({ error: "Group not found" }, { status: 404 });
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
    if (group.staticMemberIds.includes(userId)) return null;
    await prisma.groupDefinition.update({
      where: { id: groupId },
      data: { staticMemberIds: [...group.staticMemberIds, userId] },
    });
    return null;
  }

  return Response.json({ error: "Unknown intent" }, { status: 400 });
}

function userLabel(u: UserOption) {
  const name = `${u.firstName} ${u.lastName}`.trim();
  return name || u.daliEmail || u.id;
}

export default function AdminConsoleGroups() {
  const { groups, users } = useLoaderData<typeof loader>();
  const usersById = new Map(users.map((u) => [u.id, u]));
  const [creating, setCreating] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Users className="w-6 h-6 text-foreground/80" />
          <h1 className="text-2xl font-bold text-foreground">User Groups</h1>
          <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground">
            {groups.length}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-gray-900 text-white text-sm hover:bg-gray-700"
        >
          <Plus className="w-4 h-4" /> New group
        </button>
      </div>

      {creating && (
        <CreateGroupForm users={users} onDone={() => setCreating(false)} />
      )}

      <div className="space-y-3">
        {groups.length === 0 && !creating && (
          <div className="text-sm text-muted-foreground/70 px-4 py-8 text-center bg-card border border-border rounded-lg">
            No groups yet. Click "New group" to create one.
          </div>
        )}
        {groups.map((g: GroupRow) => (
          <GroupCard key={g.id} group={g} users={users} usersById={usersById} />
        ))}
      </div>
    </div>
  );
}

function CreateGroupForm({ users, onDone }: { users: UserOption[]; onDone: () => void }) {
  const fetcher = useFetcher();
  const [name, setName] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [query, setQuery] = useState("");

  const filtered = users.filter((u) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
      (u.daliEmail ?? "").toLowerCase().includes(q)
    );
  });

  const submitting = fetcher.state !== "idle";
  const canSubmit = name.trim().length > 0 && selected.length > 0 && !submitting;

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-medium text-foreground">New group</h2>
        <button type="button" onClick={onDone} className="text-muted-foreground hover:text-foreground" aria-label="Cancel">
          <X className="w-4 h-4" />
        </button>
      </div>
      <fetcher.Form
        method="post"
        onSubmit={(e) => {
          // memberIds is stored as a hidden comma-joined string
          const fd = new FormData(e.currentTarget);
          fd.set("memberIds", selected.join(","));
          fetcher.submit(fd, { method: "post" });
          e.preventDefault();
          onDone();
        }}
        className="space-y-3"
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
        <div>
          <label className="block text-sm font-medium text-foreground mb-1">Members ({selected.length})</label>
          {selected.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {selected.map((id) => {
                const u = users.find((x) => x.id === id);
                if (!u) return null;
                return (
                  <span
                    key={id}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800"
                  >
                    {userLabel(u)}
                    <button
                      type="button"
                      onClick={() => setSelected(selected.filter((s) => s !== id))}
                      aria-label={`Remove ${userLabel(u)}`}
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
            {filtered.slice(0, 50).map((u) => {
              const isSel = selected.includes(u.id);
              return (
                <button
                  key={u.id}
                  type="button"
                  onClick={() =>
                    setSelected(isSel ? selected.filter((s) => s !== u.id) : [...selected, u.id])
                  }
                  className={`w-full text-left px-3 py-1.5 text-sm hover:bg-muted/50 flex justify-between items-center ${
                    isSel ? "bg-muted/30" : ""
                  }`}
                >
                  <span>{userLabel(u)}</span>
                  {isSel && <span className="text-xs text-purple-700">Selected</span>}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex justify-end gap-2">
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
            className="px-3 py-1.5 text-sm rounded-md bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-50"
          >
            Create group
          </button>
        </div>
      </fetcher.Form>
    </div>
  );
}

function GroupCard({
  group,
  users,
  usersById,
}: {
  group: GroupRow;
  users: UserOption[];
  usersById: Map<string, UserOption>;
}) {
  const fetcher = useFetcher();
  const [addingMember, setAddingMember] = useState(false);
  const [query, setQuery] = useState("");

  const available = users.filter((u) => !group.staticMemberIds.includes(u.id));
  const filtered = available.filter((u) => {
    if (!query) return true;
    const q = query.toLowerCase();
    return (
      `${u.firstName} ${u.lastName}`.toLowerCase().includes(q) ||
      (u.daliEmail ?? "").toLowerCase().includes(q)
    );
  });

  return (
    <div className="bg-card border border-border rounded-lg p-4 space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="font-medium text-foreground">
          {group.name}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {group.staticMemberIds.length} member{group.staticMemberIds.length === 1 ? "" : "s"}
          </span>
        </h3>
        <fetcher.Form method="post" onSubmit={(e) => {
          if (!confirm(`Delete group "${group.name}"?`)) e.preventDefault();
        }}>
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
      <div className="flex flex-wrap gap-1.5">
        {group.staticMemberIds.map((uid) => {
          const u = usersById.get(uid);
          return (
            <span
              key={uid}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-purple-100 text-purple-800"
            >
              {u ? userLabel(u) : uid}
              <fetcher.Form method="post" className="inline">
                <input type="hidden" name="intent" value="remove-member" />
                <input type="hidden" name="groupId" value={group.id} />
                <input type="hidden" name="userId" value={uid} />
                <button
                  type="submit"
                  aria-label="Remove from group"
                  className="hover:text-purple-600"
                >
                  <X className="w-3 h-3" />
                </button>
              </fetcher.Form>
            </span>
          );
        })}
        {!addingMember && available.length > 0 && (
          <button
            type="button"
            onClick={() => setAddingMember(true)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-muted text-muted-foreground hover:bg-muted/80"
          >
            <Plus className="w-3 h-3" /> Add member
          </button>
        )}
      </div>
      {addingMember && (
        <div className="border border-border rounded-md bg-background p-2 space-y-2">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search…"
            className="w-full px-2 py-1 text-sm border border-border rounded bg-background text-foreground"
          />
          <div className="max-h-40 overflow-y-auto">
            {filtered.slice(0, 30).map((u) => (
              <fetcher.Form
                key={u.id}
                method="post"
                onSubmit={() => {
                  setAddingMember(false);
                  setQuery("");
                }}
              >
                <input type="hidden" name="intent" value="add-member" />
                <input type="hidden" name="groupId" value={group.id} />
                <input type="hidden" name="userId" value={u.id} />
                <button
                  type="submit"
                  className="w-full text-left px-2 py-1 text-sm hover:bg-muted/50 rounded"
                >
                  {userLabel(u)}
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
  );
}
