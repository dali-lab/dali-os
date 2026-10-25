import { useState, type ChangeEvent } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronRight,
  Download,
  File,
  Image as ImageIcon,
  Paperclip,
  Type,
  Upload,
  X,
} from "lucide-react";
import { Avatar } from "~/components/ui/Avatar";
import { IconButton } from "~/components/ui/IconButton";
import { useToast } from "~/components/ui/toast";
import { useOsChrome } from "~/components/os-chrome";
import { Pill } from "~/hiring/components/cycle-setup/SetupCard";
import { uploadFileToS3, formatBytes } from "~/lib/upload-client";
import { rawUploadUrl } from "~/components/doc/upload";
import { cn } from "~/lib/cn";
import {
  MAX_ATTACHMENT_BYTES,
  STATUS_DOT,
  URGENCY_TEXT,
  imageCount,
  sendByLabel,
  statusLabel,
  urgency,
  type ListservAttachment,
  type ListservBlock,
} from "~/core/lib/listserv";
import type { ListservRow } from "~/core/lib/listserv.server";

const UPLOAD_PREFIX = "listserv";

export function newBlockId(): string {
  return `b-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function SubmissionList({
  submissions,
  isLead,
  viewerId,
  today,
  onOpen,
  showStatus = false,
}: {
  submissions: ListservRow[];
  isLead: boolean;
  viewerId: string;
  today: string;
  onOpen: (id: string) => void;
  showStatus?: boolean;
}) {
  const os = useOsChrome();
  return (
    <ul className={cn(os.panel, "overflow-hidden")}>
      {submissions.map((s, i) => {
        const images = imageCount(s.content);
        return (
          <li key={s.id} className={cn(i > 0 && "border-t border-os-container/70")}>
            <button
              type="button"
              onClick={() => onOpen(s.id)}
              className="flex w-full items-center gap-4 px-6 py-4 text-left transition-colors hover:bg-os-card-hover"
            >
              <Avatar name={s.submitter.name} userId={s.submitter.id} size="sm" />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <span className="truncate font-semibold text-foreground">{s.subject}</span>
                  {s.submitter.id === viewerId && <Pill tone="accent">Yours</Pill>}
                </span>
                <span className="mt-0.5 flex items-center gap-3 truncate text-sm text-os-grey">
                  <span className="truncate">{s.submitter.name}</span>
                  {images > 0 && (
                    <span className="flex shrink-0 items-center gap-1 text-xs text-os-muted" aria-label={`${images} images`}>
                      <ImageIcon className="h-3.5 w-3.5" /> {images}
                    </span>
                  )}
                  {s.attachments.length > 0 && (
                    <span
                      className="flex shrink-0 items-center gap-1 text-xs text-os-muted"
                      aria-label={`${s.attachments.length} attachments`}
                    >
                      <Paperclip className="h-3.5 w-3.5" /> {s.attachments.length}
                    </span>
                  )}
                </span>
              </span>
              {s.sendBy && s.status !== "Sent" && (
                <span className={cn("hidden shrink-0 text-sm sm:block", URGENCY_TEXT[urgency(s.sendBy, today)])}>
                  {sendByLabel(s.sendBy, today)}
                </span>
              )}
              {showStatus && <Pill dot={STATUS_DOT[s.status]}>{statusLabel(s.status, isLead)}</Pill>}
              <ChevronRight className="h-4 w-4 shrink-0 text-os-muted" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** How the email reads in an inbox: text and images in order, attachments at the foot. */
export function EmailBody({
  content,
  attachments,
}: {
  content: ListservBlock[];
  attachments: (ListservAttachment & { url?: string })[];
}) {
  return (
    <div className="flex flex-col gap-4 px-5 py-5">
      {content.map((b) =>
        b.type === "text" ? (
          b.text.trim() && (
            <p key={b.id} className="whitespace-pre-line text-[15px] leading-relaxed text-foreground">
              {b.text}
            </p>
          )
        ) : (
          <figure key={b.id} className="flex flex-col gap-1.5">
            <img src={b.url} alt={b.caption || "Email image"} className="w-full rounded-lg object-cover" />
            {b.caption && <figcaption className="text-xs text-os-muted">{b.caption}</figcaption>}
          </figure>
        ),
      )}
      {attachments.length > 0 && (
        <ul className="flex flex-col gap-1.5 border-t border-os-container pt-4" aria-label="Attachments">
          {attachments.map((a) => (
            <li key={a.key}>
              <a
                href={a.url ?? rawUploadUrl(a.key)}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-3 rounded-lg bg-os-card px-3 py-2 transition-colors hover:bg-os-card-hover"
              >
                <File className="h-4 w-4 shrink-0 text-os-accent" />
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">{a.name}</span>
                <span className="text-xs tabular-nums text-os-muted">{formatBytes(a.size)}</span>
                <Download className="h-4 w-4 text-os-grey" />
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The email body as a stack of text and image blocks, in inbox order. */
export function EmailBodyEditor({
  blocks,
  onChange,
  invalid = false,
}: {
  blocks: ListservBlock[];
  onChange: (blocks: ListservBlock[]) => void;
  invalid?: boolean;
}) {
  const os = useOsChrome();
  const toast = useToast();
  const [picking, setPicking] = useState(false);
  const [url, setUrl] = useState("");
  const [uploading, setUploading] = useState(false);

  const update = (id: string, patch: Partial<ListservBlock>) =>
    onChange(blocks.map((b) => (b.id === id ? ({ ...b, ...patch } as ListservBlock) : b)));
  const move = (index: number, dir: -1 | 1) => {
    const next = [...blocks];
    const [b] = next.splice(index, 1);
    next.splice(index + dir, 0, b!);
    onChange(next);
  };
  const addImage = (src: string) => {
    onChange([...blocks, { id: newBlockId(), type: "image", url: src, caption: "" }]);
    setPicking(false);
    setUrl("");
  };

  const onUpload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("That file isn't an image. Attach it below instead");
      return;
    }
    setUploading(true);
    try {
      const meta = await uploadFileToS3(file, UPLOAD_PREFIX, "image/*");
      addImage(rawUploadUrl(meta.s3Key));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div
      className={cn(
        "flex flex-col gap-3 rounded-os-item border bg-os-well p-3",
        invalid ? "border-destructive/60" : "border-os-container",
      )}
    >
      {blocks.map((b, i) => (
        <div key={b.id} className="group flex gap-2">
          <div className="min-w-0 flex-1">
            {b.type === "text" ? (
              <textarea
                value={b.text}
                onChange={(e) => update(b.id, { text: e.target.value })}
                rows={Math.max(3, b.text.split("\n").length + 1)}
                placeholder={i === 0 ? "Write it the way it should land in an inbox. Links are fine." : "Keep writing"}
                aria-label={`Text block ${i + 1}`}
                className="w-full resize-y rounded-lg border-0 bg-transparent px-2 py-1.5 text-[15px] leading-relaxed text-foreground placeholder:text-os-muted focus:bg-os-card focus:outline-none"
              />
            ) : (
              <figure className="flex flex-col gap-2 rounded-lg bg-os-card p-2">
                <img src={b.url} alt={b.caption || "Email image"} className="max-h-64 w-full rounded-md object-cover" />
                <input
                  value={b.caption}
                  onChange={(e) => update(b.id, { caption: e.target.value })}
                  placeholder="Caption (optional)"
                  aria-label="Image caption"
                  className="rounded-md border-0 bg-transparent px-2 py-1 text-sm text-os-grey placeholder:text-os-muted focus:bg-os-well focus:outline-none"
                />
              </figure>
            )}
          </div>
          <div className="flex shrink-0 flex-col gap-0.5 opacity-60 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
            <IconButton label="Move up" icon={ArrowUp} onClick={() => move(i, -1)} disabled={i === 0} />
            <IconButton label="Move down" icon={ArrowDown} onClick={() => move(i, 1)} disabled={i === blocks.length - 1} />
            {blocks.length > 1 && (
              <IconButton label="Remove block" icon={X} onClick={() => onChange(blocks.filter((x) => x.id !== b.id))} />
            )}
          </div>
        </div>
      ))}

      {picking && (
        <div className="flex flex-col gap-3 rounded-lg border border-os-container bg-os-card p-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-foreground">Add an image</p>
            <IconButton label="Close image picker" icon={X} onClick={() => setPicking(false)} />
          </div>
          <label className={cn(os.actionBtn(), "cursor-pointer self-start", uploading && "pointer-events-none opacity-50")}>
            <Upload className={os.actionIcon} /> {uploading ? "Uploading…" : "Upload from computer"}
            <input type="file" accept="image/*" className="sr-only" onChange={onUpload} />
          </label>
          <div className="flex gap-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && /^https:\/\//.test(url.trim())) {
                  e.preventDefault();
                  addImage(url.trim());
                }
              }}
              placeholder="Or paste an https:// image link"
              aria-label="Image link"
              className={cn(os.compactField, "min-w-0 flex-1 border border-os-container px-3 py-1.5 text-sm")}
            />
            <button
              type="button"
              className={os.actionBtn()}
              disabled={!/^https:\/\//.test(url.trim())}
              onClick={() => addImage(url.trim())}
            >
              Add
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2 border-t border-os-container/70 pt-3">
        <button
          type="button"
          className={os.actionBtn()}
          onClick={() => onChange([...blocks, { id: newBlockId(), type: "text", text: "" }])}
        >
          <Type className={os.actionIcon} /> Text
        </button>
        <button type="button" className={os.actionBtn(picking)} onClick={() => setPicking((p) => !p)}>
          <ImageIcon className={os.actionIcon} /> Image
        </button>
        <span className="ml-auto hidden items-center text-xs text-os-muted sm:flex">
          New blocks go at the end. Use the arrows to reorder
        </span>
      </div>
    </div>
  );
}

export function AttachmentsField({
  attachments,
  onChange,
}: {
  attachments: ListservAttachment[];
  onChange: (attachments: ListservAttachment[]) => void;
}) {
  const os = useOsChrome();
  const toast = useToast();
  const [uploading, setUploading] = useState(0);

  const onFiles = async (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    const tooBig = files.filter((f) => f.size > MAX_ATTACHMENT_BYTES);
    if (tooBig.length) {
      toast.error(`${tooBig.map((f) => f.name).join(", ")} ${tooBig.length === 1 ? "is" : "are"} over 10 MB`);
    }
    const ok = files.filter((f) => f.size <= MAX_ATTACHMENT_BYTES);
    setUploading((n) => n + ok.length);
    const added: ListservAttachment[] = [];
    for (const f of ok) {
      try {
        const meta = await uploadFileToS3(f, UPLOAD_PREFIX);
        added.push({ key: meta.s3Key, name: f.name, size: f.size });
      } catch (err) {
        toast.error(`${f.name}: ${err instanceof Error ? err.message : "upload failed"}`);
      } finally {
        setUploading((n) => n - 1);
      }
    }
    if (added.length) onChange([...attachments, ...added]);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between text-sm text-os-grey">
        <span>Attachments</span>
        <span className="text-xs text-os-muted">Up to 10 MB each</span>
      </div>
      {attachments.length > 0 && (
        <ul className="flex flex-col gap-1.5">
          {attachments.map((a) => (
            <li key={a.key} className="flex items-center gap-3 rounded-lg bg-os-well px-3 py-2">
              <File className="h-4 w-4 shrink-0 text-os-grey" />
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{a.name}</span>
              <span className="text-xs tabular-nums text-os-muted">{formatBytes(a.size)}</span>
              <IconButton
                label={`Remove ${a.name}`}
                icon={X}
                onClick={() => onChange(attachments.filter((x) => x.key !== a.key))}
              />
            </li>
          ))}
        </ul>
      )}
      <label className={cn(os.actionBtn(), "cursor-pointer self-start", uploading > 0 && "pointer-events-none opacity-50")}>
        <Paperclip className={os.actionIcon} /> {uploading > 0 ? "Uploading…" : "Attach files"}
        <input type="file" multiple className="sr-only" onChange={onFiles} />
      </label>
    </div>
  );
}
