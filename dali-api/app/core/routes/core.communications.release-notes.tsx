import { useEffect, useRef, useState } from "react";
import { Link, useFetcher, useLoaderData } from "react-router";
import { AlertTriangle, Film, Plus, Upload } from "lucide-react";
import type { Route } from "./+types/core.communications.release-notes";
import { coreHandle } from "~/core/coreNav";
import { prisma } from "~/lib/db.server";
import { formatDateShort } from "~/lib/display";
import {
  createReleaseNoteDraft,
  dismissReleaseNotes,
  listReleaseNotesForCore,
  releaseNoteSlackStatuses,
  publishReleaseNotes,
  releaseNoteVideoUrl,
  requireReleaseNoteEditor,
  updateReleaseNote,
} from "~/lib/release-notes.server";
import {
  RELEASE_NOTE_AREAS,
  RELEASE_NOTE_VIDEO_ACCEPT,
  RELEASE_NOTE_VIDEO_KEY_PREFIX,
  parsePrNumbers,
  releaseNoteAreaLabel,
  type SlackStatus,
} from "~/lib/release-notes";
import { uploadFileToS3 } from "~/lib/upload-client";
import { DocEditor } from "~/components/doc";
import { Modal, ModalFooter, ModalHeader } from "~/components/Modal";
import { modalCardClass, useOsChrome } from "~/components/os-chrome";
import { Button } from "~/components/ui/Button";
import { Checkbox } from "~/components/ui/Checkbox";
import { Toggle } from "~/components/ui/Toggle";
import { Field } from "~/components/ui/modal-fields";
import { Select } from "~/components/ui/floating";
import { PagerLinks } from "~/components/ui/Pager";
import { parsePageParam } from "~/lib/pagination";
import { MultiSelect } from "~/components/ui/floating/MultiSelect";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import { cn } from "~/lib/cn";

export const handle = coreHandle("communications");

export const meta: Route.MetaFunction = () => [
  { title: "Release notes · Core · DALI OS" },
];

const TITLE_MAX = 200;
const SUMMARY_MAX = 200;

export async function loader({ request }: Route.LoaderArgs) {
  await requireReleaseNoteEditor(request);
  const page = parsePageParam(new URL(request.url).searchParams.get("page"));
  const [{ drafts, published, hasNext, publishedTotal }, groups] = await Promise.all([
    listReleaseNotesForCore(page),
    prisma.groupDefinition.findMany({
      where: { archivedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);
  const slack = await releaseNoteSlackStatuses(published);
  const serialize = async (n: (typeof drafts)[number]) => ({
    id: n.id,
    title: n.title,
    summary: n.summary,
    area: n.area,
    prNumbers: n.prNumbers,
    draftNote: n.draftNote,
    highlight: n.highlight,
    allMembers: n.allMembers,
    groupIds: n.groupIds,
    contentJson: n.contentJson as unknown,
    videoKey: n.videoKey,
    videoUrl: await releaseNoteVideoUrl(n.videoKey).catch(() => null),
    publishedAt: n.publishedAt?.toISOString() ?? null,
    draftedAt: n.draftedAt.toISOString(),
    slack: slack[n.id] ?? null,
  });
  return {
    drafts: await Promise.all(drafts.map(serialize)),
    published: await Promise.all(published.map(serialize)),
    page,
    hasNext,
    publishedTotal,
    groups,
  };
}

export async function action({ request }: Route.ActionArgs) {
  const viewer = await requireReleaseNoteEditor(request);
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");

  if (intent === "create") {
    const draft = await createReleaseNoteDraft();
    return { created: draft.id };
  }

  if (intent === "publish" || intent === "dismiss") {
    const ids = form.getAll("id").map(String);
    if (intent === "dismiss") {
      return { dismissed: await dismissReleaseNotes(ids, viewer.userId, request) };
    }
    return { ...(await publishReleaseNotes(ids, viewer.userId, request)) };
  }

  if (intent === "save" || intent === "save-publish") {
    const id = String(form.get("id") ?? "");
    const title = String(form.get("title") ?? "").trim();
    const summary = String(form.get("summary") ?? "").trim();
    const area = String(form.get("area") ?? "") || null;
    const allMembers = form.get("allMembers") === "1";
    const groupIds = form.getAll("groupId").map(String);
    if (!title || title.length > TITLE_MAX) {
      return { error: "Add a title of 200 characters or fewer." };
    }
    if (summary.length > SUMMARY_MAX) {
      return { error: "Keep the summary to one line, 200 characters or fewer." };
    }
    if (area && !RELEASE_NOTE_AREAS.some((a) => a.key === area)) {
      return { error: "Unknown area." };
    }
    if (!allMembers && groupIds.length === 0) {
      return { error: "Pick all members or at least one group." };
    }
    const rawContent = String(form.get("contentJson") ?? "");
    let contentJson: unknown;
    if (rawContent) {
      try {
        contentJson = JSON.parse(rawContent);
      } catch {
        return { error: "The body could not be read. Reload and try again." };
      }
    }
    try {
      await updateReleaseNote(id, {
        title,
        summary,
        area,
        prNumbers: parsePrNumbers(String(form.get("prNumbers") ?? "")),
        highlight: form.get("highlight") === "1",
        allMembers,
        groupIds: allMembers ? [] : groupIds,
        contentJson: contentJson as never,
        videoKey: String(form.get("videoKey") ?? "") || null,
      });
    } catch (err) {
      return { error: err instanceof Error ? err.message : "Could not save." };
    }
    if (intent === "save-publish") {
      const result = await publishReleaseNotes([id], viewer.userId, request);
      if (result.skipped > 0) return { saved: true, error: "Add a summary before publishing." };
      return { saved: true, ...result };
    }
    return { saved: true };
  }

  return Response.json({ error: "Unknown intent" }, { status: 400 });
}

type Note = Route.ComponentProps["loaderData"]["drafts"][number];
type GroupOption = Route.ComponentProps["loaderData"]["groups"][number];
type ActionResult = {
  created?: string;
  saved?: boolean;
  published?: number;
  skipped?: number;
  dismissed?: number;
  error?: string;
};

function audienceLabel(n: Pick<Note, "allMembers" | "groupIds">, groups: GroupOption[]) {
  if (n.allMembers) return "All members";
  const names = n.groupIds.map((id) => groups.find((g) => g.id === id)?.name ?? "Removed group");
  return names.join(", ") || "No audience";
}

export default function CoreReleaseNotesPage({ loaderData }: Route.ComponentProps) {
  const { drafts, published, groups, page, hasNext, publishedTotal } = loaderData;
  const { pageTitle, card, cardPad } = useOsChrome();
  const fetcher = useFetcher<ActionResult>();
  const toast = useToast();
  const dialog = useDialog();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const handled = useRef<ActionResult | undefined>(undefined);

  const editing = [...drafts, ...published].find((n) => n.id === editingId) ?? null;
  const busy = fetcher.state !== "idle";

  useEffect(() => {
    const data = fetcher.data;
    if (fetcher.state !== "idle" || !data || handled.current === data) return;
    handled.current = data;
    if (data.error) toast.error(data.error);
    if (data.created) setEditingId(data.created);
    if (data.published) {
      toast.success(`Published ${data.published}.`);
      setEditingId(null);
    }
    if (data.skipped) toast.error(`${data.skipped} skipped: add a summary first.`);
    if (data.dismissed) toast.success(`Dismissed ${data.dismissed}.`);
    if (data.saved && !data.error && !data.published) {
      toast.success("Saved.");
      setEditingId(null);
    }
    if (data.published || data.dismissed) setPicked(new Set());
  }, [fetcher.state, fetcher.data, toast]);

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function bulk(intent: "publish" | "dismiss") {
    const n = picked.size;
    const ok = await dialog.confirm({
      title: `${intent === "publish" ? "Publish" : "Dismiss"} ${n} ${n === 1 ? "entry" : "entries"}?`,
      description:
        intent === "publish"
          ? "Members in each entry's audience will see it on the Release notes page."
          : "Dismissed entries leave the queue and are not shown to members.",
      confirmLabel: intent === "publish" ? "Publish" : "Dismiss",
      tone: intent === "dismiss" ? "destructive" : undefined,
    });
    if (!ok) return;
    const data = new FormData();
    data.set("intent", intent);
    for (const id of picked) data.append("id", id);
    fetcher.submit(data, { method: "post" });
  }

  return (
    <div className="flex max-w-3xl flex-col gap-5">
      <header className="flex items-center justify-between gap-3">
        <h1 className={pageTitle}>Release notes</h1>
        <Button
          disabled={busy}
          onClick={() => fetcher.submit({ intent: "create" }, { method: "post" })}
        >
          <Plus className="h-4 w-4" />
          New draft
        </Button>
      </header>

      <section className={cn(card, cardPad, "flex flex-col gap-3")}>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-foreground">Drafts</h2>
          {picked.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{picked.size} selected</span>
              <Button size="sm" disabled={busy} onClick={() => bulk("publish")}>
                Publish selected
              </Button>
              <Button size="sm" variant="secondary" disabled={busy} onClick={() => bulk("dismiss")}>
                Dismiss selected
              </Button>
            </div>
          )}
        </div>
        {drafts.length === 0 ? (
          <p className="text-sm text-muted-foreground">No drafts. Use New draft to write one.</p>
        ) : (
          <ul className="divide-y divide-border">
            {drafts.map((n) => (
              <li key={n.id} className="flex items-start gap-3 py-3">
                <Checkbox
                  checked={picked.has(n.id)}
                  onChange={() => toggle(n.id)}
                  aria-label={`Select ${n.title}`}
                />
                <div className="min-w-0 flex-1">
                  <button
                    type="button"
                    onClick={() => setEditingId(n.id)}
                    className="text-left text-sm font-medium text-foreground hover:underline"
                  >
                    {n.title}
                  </button>
                  <p className="text-sm text-muted-foreground">
                    {n.summary || "No summary yet."}
                  </p>
                  <NoteMeta note={n} groups={groups} />
                </div>
                <Button size="sm" variant="secondary" onClick={() => setEditingId(n.id)}>
                  Edit
                </Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={cn(card, cardPad, "flex flex-col gap-3")}>
        <h2 className="text-sm font-semibold text-foreground">
          Published
          {publishedTotal > 0 && (
            <span className="ml-2 font-normal text-muted-foreground">{publishedTotal.toLocaleString()}</span>
          )}
        </h2>
        {published.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {page > 1 ? "No entries on this page." : "Nothing published yet."}
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {published.map((n) => (
              <li key={n.id} className="flex items-start gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/release-notes/${n.id}`}
                    className="text-sm font-medium text-foreground hover:underline"
                  >
                    {n.title}
                  </Link>
                  <p className="text-sm text-muted-foreground">{n.summary}</p>
                  <NoteMeta note={n} groups={groups} />
                </div>
                <Button size="sm" variant="secondary" onClick={() => setEditingId(n.id)}>
                  Edit
                </Button>
              </li>
            ))}
          </ul>
        )}
        {(page > 1 || hasNext) && (
          <PagerLinks
            page={page}
            hasNext={hasNext}
            hrefFor={(next) => (next > 1 ? `?page=${next}` : "?")}
            label="Published entries pagination"
            endLabel="End of published entries"
          />
        )}
      </section>

      {editing && (
        <EditModal
          key={editing.id}
          note={editing}
          isDraft={editing.publishedAt === null}
          groups={groups}
          saving={busy}
          onClose={() => setEditingId(null)}
          onSubmit={(data) => fetcher.submit(data, { method: "post" })}
        />
      )}
    </div>
  );
}

const SLACK_STATUS_LABEL: Record<SlackStatus, string> = {
  posted: "Posted to Slack",
  sending: "Sending to Slack",
  failed: "Slack post failed",
  "app-only": "In app only",
};

function NoteMeta({ note, groups }: { note: Note; groups: GroupOption[] }) {
  const parts = [
    releaseNoteAreaLabel(note.area),
    audienceLabel(note, groups),
    note.highlight ? "Highlight" : null,
    note.slack ? SLACK_STATUS_LABEL[note.slack] : null,
    note.publishedAt
      ? `Published ${formatDateShort(note.publishedAt)}`
      : `Drafted ${formatDateShort(note.draftedAt)}`,
  ].filter(Boolean);
  return (
    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
      {parts.join(" · ")}
      {note.videoKey && (
        <span className="inline-flex items-center gap-1">
          <Film className="h-3 w-3" /> Video
        </span>
      )}
      {!note.publishedAt && note.draftNote && (
        <span className="inline-flex items-center gap-1 rounded-full bg-os-amber/15 px-2 py-0.5 text-os-amber">
          <AlertTriangle className="h-3 w-3" /> Check: {note.draftNote}
        </span>
      )}
      {note.prNumbers.map((pr) => (
        <a
          key={pr}
          href={`https://github.com/dali-lab/dali-os/pull/${pr}`}
          target="_blank"
          rel="noreferrer"
          className="hover:underline"
        >
          #{pr}
        </a>
      ))}
    </p>
  );
}

function EditModal({
  note,
  isDraft,
  groups,
  saving,
  onClose,
  onSubmit,
}: {
  note: Note;
  isDraft: boolean;
  groups: GroupOption[];
  saving: boolean;
  onClose: () => void;
  onSubmit: (data: FormData) => void;
}) {
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(note.title === "Untitled" ? "" : note.title);
  const [summary, setSummary] = useState(note.summary);
  const [area, setArea] = useState(note.area ?? "");
  const [prs, setPrs] = useState(note.prNumbers.join(", "));
  const [highlight, setHighlight] = useState(note.highlight);
  const [allMembers, setAllMembers] = useState(note.allMembers);
  const [groupIds, setGroupIds] = useState<string[]>(note.groupIds);
  const [body, setBody] = useState<unknown>(note.contentJson);
  const [videoKey, setVideoKey] = useState<string | null>(note.videoKey);
  const [pendingVideoName, setPendingVideoName] = useState<string | null>(null);
  const savedVideoUrl = videoKey && videoKey === note.videoKey ? note.videoUrl : null;
  const [uploading, setUploading] = useState(false);

  async function pickVideo(file: File) {
    setUploading(true);
    try {
      const uploaded = await uploadFileToS3(
        file,
        RELEASE_NOTE_VIDEO_KEY_PREFIX,
        RELEASE_NOTE_VIDEO_ACCEPT,
      );
      setVideoKey(uploaded.s3Key);
      setPendingVideoName(file.name);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  function submit(intent: "save" | "save-publish") {
    const data = new FormData();
    data.set("intent", intent);
    data.set("id", note.id);
    data.set("title", title);
    data.set("summary", summary);
    data.set("area", area);
    data.set("prNumbers", prs);
    if (highlight) data.set("highlight", "1");
    if (allMembers) data.set("allMembers", "1");
    for (const id of groupIds) data.append("groupId", id);
    if (body !== null && body !== undefined) data.set("contentJson", JSON.stringify(body));
    data.set("videoKey", videoKey ?? "");
    onSubmit(data);
  }

  const inputClass =
    "px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground";

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy="release-note-edit-title"
      containerClassName={modalCardClass("max-w-3xl")}
    >
      <ModalHeader
        titleId="release-note-edit-title"
        title={isDraft ? "Edit draft" : "Edit entry"}
        onClose={onClose}
      />
      <Field label="Title">
        <input
          type="text"
          value={title}
          maxLength={TITLE_MAX}
          onChange={(e) => setTitle(e.target.value)}
          className={inputClass}
        />
      </Field>
      <Field label="Summary" hint="One line. Shown in the list.">
        <input
          type="text"
          value={summary}
          maxLength={SUMMARY_MAX}
          onChange={(e) => setSummary(e.target.value)}
          className={inputClass}
        />
      </Field>
      <div className="os-field-row">
        <div className="os-field-group">
          <span className="os-field-label">Area</span>
          <Select
            value={area}
            onChange={setArea}
            ariaLabel="Area"
            placeholder="None"
            options={[
              { value: "", label: "None" },
              ...RELEASE_NOTE_AREAS.map((a) => ({ value: a.key, label: a.label })),
            ]}
          />
        </div>
        <Field label="Pull requests" hint="Numbers separated by commas.">
          <input
            type="text"
            value={prs}
            onChange={(e) => setPrs(e.target.value)}
            className={inputClass}
          />
        </Field>
      </div>
      <div className="os-field-group">
        <span className="os-field-label">Audience</span>
        <Toggle
          checked={allMembers}
          onChange={(e) => setAllMembers(e.target.checked)}
          label="All members"
        />
        {!allMembers && (
          <MultiSelect
            values={groupIds}
            onChange={setGroupIds}
            ariaLabel="Groups"
            placeholder="Choose groups"
            options={groups.map((g) => ({ value: g.id, label: g.name }))}
          />
        )}
      </div>
      <div className="os-field-group">
        <Toggle
          checked={highlight}
          onChange={(e) => setHighlight(e.target.checked)}
          label="Highlight"
          description="Marks the entry as a headline change."
        />
      </div>
      <div className="os-field-group">
        <span className="os-field-label">Body</span>
        <DocEditor
          features="resource"
          editable
          density="compact"
          initialContent={note.contentJson ?? []}
          onChange={setBody}
          placeholder="Describe the change for members"
          className="min-h-[10rem] rounded-md border border-border bg-background px-1 py-1.5 text-sm text-foreground focus-within:border-os-accent/50"
        />
      </div>
      <div className="os-field-group">
        <span className="os-field-label">Video</span>
        {savedVideoUrl && (
          <video src={savedVideoUrl} controls preload="metadata" className="max-h-64 w-full rounded-md bg-black" />
        )}
        <div className="flex items-center gap-2">
          <input
            ref={fileRef}
            type="file"
            accept={RELEASE_NOTE_VIDEO_ACCEPT}
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void pickVideo(file);
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="h-4 w-4" />
            {uploading ? "Uploading" : videoKey ? "Replace video" : "Upload video"}
          </Button>
          {videoKey && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setVideoKey(null);
                setPendingVideoName(null);
              }}
            >
              Remove
            </Button>
          )}
          <span className="text-xs text-muted-foreground">
            {pendingVideoName && videoKey
              ? `${pendingVideoName} uploaded. Saves with the entry.`
              : "mp4, webm or mov, up to 50 MB"}
          </span>
        </div>
      </div>
      <ModalFooter onCancel={onClose}>
        <Button variant="secondary" disabled={saving || uploading} onClick={() => submit("save")}>
          Save
        </Button>
        {isDraft && (
          <Button disabled={saving || uploading} onClick={() => submit("save-publish")}>
            Save and publish
          </Button>
        )}
      </ModalFooter>
    </Modal>
  );
}
