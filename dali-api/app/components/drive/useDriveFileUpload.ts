import { useRef, useState } from "react";

// Shared Drive upload hook: presign → PUT to S3 → register in the target drive.
// Used by both the main Drive hub and the project-embedded Drive so the two
// upload paths never drift. `target` names the destination drive + folder; the
// register endpoint (/api/drive/files) resolves the workspace from the scope.

export type UploadScope =
  | { kind: "Lab" }
  | { kind: "Member" }
  | { kind: "Project"; projectId: string };

export type UploadTarget = { scope: UploadScope; folderPageId?: string | null };

export function useDriveFileUpload(target: UploadTarget, onComplete: () => void) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Upload a single file: presign → PUT S3 → register in the target drive.
  async function uploadOne(file: File): Promise<void> {
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

  // Upload one or many files (drag-drop can drop several). Sequential so an
  // early failure surfaces without racing the rest.
  async function uploadFiles(files: File[]): Promise<void> {
    if (files.length === 0) return;
    setUploading(true);
    setUploadError(null);
    try {
      for (const file of files) await uploadOne(file);
      onComplete();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files ? Array.from(e.target.files) : [];
    // Reset the input so the same file can be re-selected after an error.
    e.target.value = "";
    await uploadFiles(files);
  }

  return { inputRef, uploading, uploadError, handleFileChange, uploadFiles };
}
