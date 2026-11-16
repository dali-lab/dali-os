import { useEffect, useRef } from "react";
import { useFetcher } from "react-router";
import { CoverStudio } from "~/components/cover/CoverStudio";
import { MAX_UPLOAD_BYTES, MAX_UPLOAD_LABEL, fileMatchesAccept } from "~/lib/file-validation";

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

export async function uploadProjectImage(projectId: string, file: File): Promise<string> {
  if (file.size > MAX_UPLOAD_BYTES) throw new Error(`Image too large (max ${MAX_UPLOAD_LABEL})`);
  if (!fileMatchesAccept(file.name, file.type, ACCEPT)) throw new Error("Please choose an image.");
  const ext = file.type === "image/png" ? "png" : file.type === "image/gif" ? "gif" : file.type === "image/webp" ? "webp" : "jpg";
  const presign = await fetch("/api/upload/presign", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      key: `project-images/${projectId}/${crypto.randomUUID()}.${ext}`,
      contentType: file.type,
      contentLength: file.size,
      accept: ACCEPT,
    }),
  });
  if (!presign.ok) throw new Error("Failed to get upload URL");
  const { url, fields, key } = await presign.json();
  const form = new FormData();
  for (const [n, v] of Object.entries(fields as Record<string, string>)) form.append(n, v);
  form.append("file", file, file.name);
  const res = await fetch(url, { method: "POST", body: form });
  if (!res.ok) throw new Error("Upload failed");
  return key as string;
}

export function ProjectCoverModal({
  projectId,
  initialCover,
  initialImageUrl,
  onClose,
}: {
  projectId: string;
  initialCover: string | null;
  initialImageUrl: string | null;
  onClose: () => void;
}) {
  const fetcher = useFetcher<{ error?: string }>();
  const previews = useRef(new Map<string, string>(initialCover && initialImageUrl ? [[initialCover, initialImageUrl]] : []));
  const saving = fetcher.state !== "idle";
  const error = fetcher.data && "error" in fetcher.data ? (fetcher.data.error ?? null) : null;
  const submitted = useRef(false);

  useEffect(() => {
    if (submitted.current && fetcher.state === "idle" && !error) onClose();
  }, [fetcher.state, error, onClose]);

  useEffect(() => {
    const map = previews.current;
    return () => map.forEach((u) => u.startsWith("blob:") && URL.revokeObjectURL(u));
  }, []);

  return (
    <CoverStudio
      busy={saving}
      heading="Project cover"
      submitLabel="Save cover"
      initialCover={initialCover}
      onClose={onClose}
      serverError={error}
      imageSrc={(value) => previews.current.get(value) ?? value}
      uploadImage={async (file) => {
        const key = await uploadProjectImage(projectId, file);
        previews.current.set(key, URL.createObjectURL(file));
        return key;
      }}
      onSubmit={(cover) => {
        submitted.current = true;
        fetcher.submit({ intent: "update-image", imageUrl: cover }, { method: "post" });
      }}
    />
  );
}
