import { useState } from "react";
import { Form, useFetcher, useLoaderData } from "react-router";
import {
  Plus,
  Clock,
  UserIcon,
  Trash2,
  Pencil,
  Globe,
  Lock,
  Undo2,
  Redo2,
  Check,
  X,
} from "lucide-react";
import { Tooltip } from "~/components/ui/IconButton";
import type { loader } from "~/core/routes/core.milestones.$id";
import { formatDateTime } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { useSharedArray } from "~/components/collab/useSharedCollection";
import { milestoneDraftName } from "~/collab/roomName";
import {
  ManagedEditorShell,
  RestoreVersionButton,
} from "~/components/editor/ManagedEditorShell";
import {
  type MilestoneEntry,
  weekCountFor,
  entriesForWeek,
} from "~/lib/milestones";

const newEntryId = () => `m-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

export function MilestoneSetEditor() {
  const { set, collabToken } = useLoaderData<typeof loader>();
  const tz = useUserTimeZone();
  const draftFetcher = useFetcher();

  const latestVersion = set.versions.length ? set.versions[set.versions.length - 1] : null;

  const [selectedVersionId, setSelectedVersionId] = useState<string | null>(
    latestVersion?.id ?? null,
  );
  // A brand-new set (no versions) opens straight into drafting.
  const [isDrafting, setIsDrafting] = useState(set.versions.length === 0);

  // Seed the room from the working draft if present, else the latest version.
  const seedEntries: MilestoneEntry[] = set.draftEntries.length
    ? set.draftEntries
    : (latestVersion?.entries ?? []);

  const collabActive = isDrafting && !!collabToken;
  const {
    items: entries,
    push: collabPush,
    remove: collabRemove,
    setItems: collabSetItems,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useSharedArray<MilestoneEntry>(
    milestoneDraftName(set.id),
    collabActive ? collabToken : null,
    "items",
    seedEntries,
  );

  // ── Add-milestone state (which week's inline form is open) ─────────────────
  const [addingWeek, setAddingWeek] = useState<number | null>(null);
  const [newName, setNewName] = useState("");
  const [newDetail, setNewDetail] = useState("");
  const [newLabWide, setNewLabWide] = useState(false);

  // ── Inline edit state ──────────────────────────────────────────────────────
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editDetail, setEditDetail] = useState("");
  const [editLabWide, setEditLabWide] = useState(false);

  const selectedVersion = set.versions.find((v) => v.id === selectedVersionId) ?? null;
  const nextVersionNumber =
    set.versions.length > 0
      ? Math.max(...set.versions.map((v) => v.versionNumber)) + 1
      : 1;

  const viewedEntries = isDrafting ? entries : (selectedVersion?.entries ?? []);
  const weekCount = weekCountFor(viewedEntries);

  // ── Mutators (draft mode) ──────────────────────────────────────────────────

  const openAdd = (weekIndex: number) => {
    setAddingWeek(weekIndex);
    setNewName("");
    setNewDetail("");
    setNewLabWide(false);
  };

  const handleAdd = (weekIndex: number) => {
    if (!newName.trim()) return;
    collabPush({
      id: newEntryId(),
      weekIndex,
      name: newName.trim(),
      detail: newDetail.trim(),
      labWide: newLabWide,
    });
    setAddingWeek(null);
    setNewName("");
    setNewDetail("");
    setNewLabWide(false);
  };

  const handleRemove = (id: string) => {
    const idx = entries.findIndex((e) => e.id === id);
    if (idx !== -1) collabRemove(idx);
    if (editingId === id) setEditingId(null);
  };

  const startEditing = (e: MilestoneEntry) => {
    setEditingId(e.id);
    setEditName(e.name);
    setEditDetail(e.detail);
    setEditLabWide(e.labWide);
  };

  const commitEdit = () => {
    if (!editingId) return;
    collabSetItems(
      entries.map((e) =>
        e.id === editingId
          ? { ...e, name: editName.trim() || e.name, detail: editDetail.trim(), labWide: editLabWide }
          : e,
      ),
    );
    setEditingId(null);
  };

  const handleRestore = (versionEntries: MilestoneEntry[]) => {
    collabSetItems(versionEntries);
    setIsDrafting(true);
  };

  const entriesJson = JSON.stringify(entries);
  const draftState = draftFetcher.state !== "idle";
  const draftSaved = (draftFetcher.data as { ok?: boolean } | undefined)?.ok;

  // ── Version sidebar ────────────────────────────────────────────────────────

  const versionSidebar = (
    <>
      <h2 className="text-sm font-semibold uppercase tracking-wide text-foreground/80">
        Version History
      </h2>
      {isDrafting && (
        <button className="w-full rounded-lg border border-accent-coral bg-accent-coral/5 px-3 py-2 text-left">
          <span className="font-medium text-foreground">v{nextVersionNumber}</span>
          <span className="mt-0.5 block text-xs text-accent-coral">Unsaved draft</span>
        </button>
      )}
      {set.versions
        .slice()
        .reverse()
        .map((version) => {
          const active = !isDrafting && selectedVersionId === version.id;
          return (
            <div key={version.id} className="group">
              <button
                onClick={() => {
                  setSelectedVersionId(version.id);
                  setIsDrafting(false);
                  setEditingId(null);
                }}
                className={`w-full rounded-lg border px-3 py-2 text-left transition ${
                  active
                    ? "border-accent-coral bg-accent-coral/5 text-foreground"
                    : "border-border bg-card text-foreground hover:bg-muted/40"
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">Version {version.versionNumber}</span>
                  {version.locked && (
                    <Tooltip label="In use by a project — frozen">
                      <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                    </Tooltip>
                  )}
                </div>
                <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  {formatDateTime(version.createdAt, tz)}
                </div>
                {version.createdBy && (
                  <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                    <UserIcon className="h-3 w-3" />
                    {version.createdBy}
                  </div>
                )}
              </button>
              {isDrafting && (
                <div className="px-3 pb-1 opacity-0 transition-opacity group-hover:opacity-100">
                  <RestoreVersionButton onRestore={() => handleRestore(version.entries)} />
                </div>
              )}
            </div>
          );
        })}
      {set.versions.length === 0 && !isDrafting && (
        <p className="text-sm italic text-muted-foreground">No versions yet.</p>
      )}
    </>
  );

  // ── Week rows ───────────────────────────────────────────────────────────────

  const weekRow = (weekIndex: number) => {
    const weekEntries = entriesForWeek(viewedEntries, weekIndex);
    return (
      <div key={weekIndex} className="flex gap-3 border-b border-border/60 py-3 last:border-b-0">
        <div className="w-16 flex-shrink-0 pt-1">
          <div className="text-sm font-bold text-foreground">W{weekIndex}</div>
        </div>
        <div className="flex-1 space-y-2">
          {weekEntries.length === 0 && !(isDrafting && addingWeek === weekIndex) && (
            <p className="py-1 text-sm text-muted-foreground/70">
              {isDrafting ? "No milestones." : "—"}
            </p>
          )}

          {weekEntries.map((e) =>
            isDrafting && editingId === e.id ? (
              <div
                key={e.id}
                className="space-y-2 rounded-lg border border-accent-coral/30 bg-accent-coral/5 p-3"
              >
                <input
                  type="text"
                  value={editName}
                  onChange={(ev) => setEditName(ev.target.value)}
                  placeholder="Milestone"
                  autoFocus
                  className="w-full rounded-md border border-border bg-card p-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                />
                <input
                  type="text"
                  value={editDetail}
                  onChange={(ev) => setEditDetail(ev.target.value)}
                  placeholder="Detail (optional)"
                  className="w-full rounded-md border border-border bg-card p-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                />
                <div className="flex items-center justify-between">
                  <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-foreground/80">
                    <input
                      type="checkbox"
                      checked={editLabWide}
                      onChange={(ev) => setEditLabWide(ev.target.checked)}
                    />
                    <Globe className="h-3.5 w-3.5" /> Lab-wide event
                  </label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleRemove(e.id)}
                      className="rounded-md p-1.5 text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={commitEdit}
                      className="inline-flex items-center gap-1 rounded-md bg-accent-coral px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-coral/90"
                    >
                      <Check className="h-4 w-4" /> Done
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div
                key={e.id}
                className={`group flex items-start gap-2 rounded-lg border p-3 ${
                  e.labWide
                    ? "border-accent-coral/30 bg-accent-coral/10"
                    : "border-border bg-card"
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {e.labWide && (
                      <Globe className="h-3.5 w-3.5 flex-shrink-0 text-accent-coral" aria-hidden />
                    )}
                    <span className="font-medium text-foreground">{e.name || "Untitled"}</span>
                  </div>
                  {e.detail && (
                    <p className="mt-0.5 text-sm text-muted-foreground">{e.detail}</p>
                  )}
                </div>
                {isDrafting && (
                  <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => startEditing(e)}
                      className="rounded-md p-1.5 text-muted-foreground/70 hover:bg-muted hover:text-foreground"
                    >
                      <Pencil className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemove(e.id)}
                      className="rounded-md p-1.5 text-muted-foreground/70 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                )}
              </div>
            ),
          )}

          {isDrafting &&
            (addingWeek === weekIndex ? (
              <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3">
                <input
                  type="text"
                  value={newName}
                  onChange={(ev) => setNewName(ev.target.value)}
                  placeholder="Milestone (e.g. Feature-complete target)"
                  autoFocus
                  onKeyDown={(ev) => ev.key === "Enter" && handleAdd(weekIndex)}
                  className="w-full rounded-md border border-border bg-card p-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                />
                <input
                  type="text"
                  value={newDetail}
                  onChange={(ev) => setNewDetail(ev.target.value)}
                  placeholder="Detail (optional)"
                  className="w-full rounded-md border border-border bg-card p-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
                />
                <div className="flex items-center justify-between">
                  <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-foreground/80">
                    <input
                      type="checkbox"
                      checked={newLabWide}
                      onChange={(ev) => setNewLabWide(ev.target.checked)}
                    />
                    <Globe className="h-3.5 w-3.5" /> Lab-wide event
                  </label>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setAddingWeek(null)}
                      className="rounded-md p-1.5 text-muted-foreground/70 hover:bg-muted"
                    >
                      <X className="h-4 w-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAdd(weekIndex)}
                      disabled={!newName.trim()}
                      className="rounded-md bg-accent-coral px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-coral/90 disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => openAdd(weekIndex)}
                className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <Plus className="h-3.5 w-3.5" /> Add milestone
              </button>
            ))}
        </div>
      </div>
    );
  };

  return (
    <ManagedEditorShell
      name={set.name}
      isDrafting={isDrafting}
      headerActions={
        !isDrafting ? (
          <button
            onClick={() => setIsDrafting(true)}
            className="inline-flex items-center rounded-lg bg-accent-coral px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-accent-coral/90"
          >
            <Pencil className="mr-2 h-4 w-4" />
            Edit
          </button>
        ) : null
      }
      versionSidebar={versionSidebar}
    >
      {isDrafting ? (
        <div className="flex min-h-[500px] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-muted/50 p-4">
            <div className="flex items-center gap-3">
              <h2 className="font-bold text-foreground">Editing draft (v{nextVersionNumber})</h2>
              {collabToken && (
                <div className="flex items-center gap-1">
                  <Tooltip label="Undo (⌘Z)">
                    <button
                      type="button"
                      onClick={undo}
                      disabled={!canUndo}
                      aria-label="Undo"
                      className="inline-flex items-center justify-center rounded-md p-1.5 text-foreground/70 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Undo2 className="h-4 w-4" />
                    </button>
                  </Tooltip>
                  <Tooltip label="Redo (⌘⇧Z)">
                    <button
                      type="button"
                      onClick={redo}
                      disabled={!canRedo}
                      aria-label="Redo"
                      className="inline-flex items-center justify-center rounded-md p-1.5 text-foreground/70 hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <Redo2 className="h-4 w-4" />
                    </button>
                  </Tooltip>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              {draftState ? (
                <span className="text-xs text-muted-foreground">Saving…</span>
              ) : draftSaved ? (
                <span className="text-xs text-muted-foreground">Draft saved</span>
              ) : null}
              <draftFetcher.Form method="post">
                <input type="hidden" name="intent" value="save-draft" />
                <input type="hidden" name="entries" value={entriesJson} />
                <button
                  type="submit"
                  className="rounded-md px-3 py-1.5 text-sm font-medium text-foreground/80 hover:bg-muted"
                >
                  Save draft
                </button>
              </draftFetcher.Form>
              {set.versions.length > 0 && (
                <button
                  onClick={() => {
                    setIsDrafting(false);
                    setEditingId(null);
                  }}
                  className="rounded-md px-3 py-1.5 text-sm font-medium text-foreground/80 hover:bg-muted"
                >
                  Cancel
                </button>
              )}
              <Form method="post">
                <input type="hidden" name="intent" value="create-version" />
                <input type="hidden" name="entries" value={entriesJson} />
                <button
                  type="submit"
                  className="rounded-md bg-accent-coral px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-coral/90"
                >
                  Save version
                </button>
              </Form>
            </div>
          </div>

          <div className="flex-1 bg-muted/30 p-6">
            <div className="mx-auto max-w-3xl">
              {Array.from({ length: weekCount }, (_, i) => weekRow(i))}
            </div>
          </div>
        </div>
      ) : selectedVersion ? (
        <div className="min-h-[500px] overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="flex items-start justify-between border-b border-border p-6">
            <div>
              <h2 className="mb-2 flex items-center gap-2 text-xl font-bold text-foreground">
                Version {selectedVersion.versionNumber}
                {selectedVersion.locked && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                    <Lock className="h-3 w-3" /> In use
                  </span>
                )}
              </h2>
              <div className="flex items-center gap-4 text-sm text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Clock className="h-4 w-4" />
                  {formatDateTime(selectedVersion.createdAt, tz)}
                </span>
                {selectedVersion.createdBy && (
                  <span className="flex items-center gap-1">
                    <UserIcon className="h-4 w-4" />
                    {selectedVersion.createdBy}
                  </span>
                )}
              </div>
            </div>
            <div className="rounded-lg border border-border bg-muted/50 px-4 py-2 text-center">
              <span className="block text-2xl font-bold text-foreground">
                {selectedVersion.entries.length}
              </span>
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Milestones
              </span>
            </div>
          </div>
          <div className="bg-muted/30 p-6">
            <div className="mx-auto max-w-3xl">
              {Array.from({ length: weekCount }, (_, i) => weekRow(i))}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex min-h-[500px] items-center justify-center rounded-xl border border-border bg-card text-muted-foreground shadow-sm">
          Select a version to view details
        </div>
      )}
    </ManagedEditorShell>
  );
}
