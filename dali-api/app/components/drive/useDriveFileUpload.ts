import { createElement, useRef, useState, type ReactNode } from "react";
import { useToast } from "~/components/ui/toast";
import { ACTION_TOAST_MS } from "~/components/drive/action-toast";
import {
  listNames,
  summarizeFailures,
  uploadAll,
  type UploadFailure,
  type UploadProgress,
} from "~/lib/upload-batch";

// Shared Drive upload hook: presign → PUT to S3 → register in the target drive.
// Used by both the main Drive hub and the project-embedded Drive so the two
// upload paths never drift. `target` names the destination drive + folder; the
// register endpoint (/api/drive/files) resolves the workspace from the scope.

export type UploadScope =
  | { kind: "Lab" }
  | { kind: "Member" }
  | { kind: "Project"; projectId: string }
  | { kind: "EducationOffering"; offeringId: string };

export type UploadTarget = { scope: UploadScope; folderPageId?: string | null };

/** Where the files landed, named for the final toast, and how to open it. */
export type UploadDestination = { label: string; onOpen: () => void };

/** Per-call overrides of the hook's target, plus how many OS folders the drop had to skip. */
export type UploadOptions = Partial<UploadTarget> & {
  skippedFolders?: number;
  /** Overrides the hook's destination for this call; null names none. */
  destination?: UploadDestination | null;
};

export const FOLDERS_UNSUPPORTED = "Folders can't be uploaded yet";

function plural(n: number) {
  return `${n} ${n === 1 ? "file" : "files"}`;
}

function finalToast(total: number, failed: UploadFailure[], skippedFolders: number, destination: string | null) {
  const details: string[] = [];
  let headline: string;
  if (failed.length === 0) {
    headline = `Uploaded ${plural(total)}${destination ? ` to ${destination}` : ""}`;
  } else if (total === 1) {
    headline = "Upload failed";
    details.push(`${failed[0].name}: ${failed[0].error}`);
  } else {
    headline = `Uploaded ${total - failed.length} of ${plural(total)} · ${failed.length} failed`;
    details.push(listNames(failed));
  }
  if (skippedFolders > 0) details.push(FOLDERS_UNSUPPORTED);
  const message: ReactNode =
    details.length === 0
      ? headline
      : createElement(
          "div",
          null,
          createElement("div", null, headline),
          ...details.map((d) =>
            createElement("div", { key: d, className: "mt-0.5 break-words text-xs text-muted-foreground" }, d),
          ),
        );
  return { message, failed: failed.length > 0 };
}

async function uploadOne(file: File, target: UploadTarget): Promise<void> {
  const key = `drive-files/${crypto.randomUUID()}-${file.name}`;
  const presignRes = await fetch("/api/upload/presign", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      key,
      contentType: file.type || "application/octet-stream",
      contentLength: file.size,
    }),
  });
  if (!presignRes.ok) {
    const body = (await presignRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to get upload URL");
  }
  const { url, fields, key: s3Key } = (await presignRes.json()) as {
    url: string;
    fields: Record<string, string>;
    key: string;
  };

  const formData = new FormData();
  for (const [name, value] of Object.entries(fields)) formData.append(name, value);
  formData.append("file", file);
  const uploadRes = await fetch(url, { method: "POST", body: formData });
  if (!uploadRes.ok) throw new Error("Upload to storage failed");

  const registerRes = await fetch("/api/drive/files", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      s3Key,
      title: file.name,
      fileName: file.name,
      contentType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      scope: target.scope,
      ...(target.folderPageId ? { folderPageId: target.folderPageId } : {}),
    }),
  });
  if (!registerRes.ok) {
    const body = (await registerRes.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Failed to register file");
  }
}

export function useDriveFileUpload(
  target: UploadTarget,
  onComplete: () => void,
  destination: UploadDestination | null = null,
) {
  const toast = useToast();
  const [activeBatches, setActiveBatches] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const batchSeq = useRef(0);
  const latest = useRef({ target, onComplete, destination });
  latest.current = { target, onComplete, destination };

  async function uploadFiles(files: File[], options: UploadOptions = {}): Promise<void> {
    const skippedFolders = options.skippedFolders ?? 0;
    if (files.length === 0) {
      if (skippedFolders > 0) toast.error(FOLDERS_UNSUPPORTED);
      return;
    }
    const base = latest.current.target;
    const dest: UploadTarget = {
      scope: options.scope ?? base.scope,
      folderPageId: options.folderPageId !== undefined ? options.folderPageId : base.folderPageId,
    };
    const landed = options.destination !== undefined ? options.destination : latest.current.destination;
    const toastId = `drive-upload-${++batchSeq.current}`;
    const total = files.length;

    function report(progress: UploadProgress) {
      setProgress(progress);
      toast.info(`Uploading ${progress.done} of ${progress.total}…`, { id: toastId, duration: 0 });
    }

    setActiveBatches((n) => n + 1);
    setUploadError(null);
    report({ done: 0, total, failed: [] });
    let failed: UploadFailure[] = [];
    try {
      failed = await uploadAll(files, (file) => uploadOne(file, dest), report);
      if (failed.length < total) latest.current.onComplete();
    } finally {
      setActiveBatches((n) => n - 1);
    }
    setUploadError(summarizeFailures(failed, total));
    const result = finalToast(total, failed, skippedFolders, failed.length === 0 ? (landed?.label ?? null) : null);
    if (result.failed) toast.error(result.message, { id: toastId, duration: 10_000 });
    else {
      toast.success(result.message, {
        id: toastId,
        ...(landed ? { duration: ACTION_TOAST_MS, actions: [{ label: "Open", onClick: landed.onOpen }] } : {}),
      });
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    // Reset the input so the same file can be re-selected after an error.
    e.target.value = "";
    await uploadFiles(files);
  }

  return { inputRef, uploading: activeBatches > 0, uploadError, progress, handleFileChange, uploadFiles };
}
