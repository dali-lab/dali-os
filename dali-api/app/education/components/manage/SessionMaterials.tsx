import { useRef, useState } from "react";
import { useFetcher, useRevalidator } from "react-router";
import { Select } from "~/components/ui/floating";
import { Upload, X } from "lucide-react";
import { uploadFileToS3 } from "~/lib/upload-client";


// What a session's materials are, and the place to change them. The Sessions
// tab used to state them read-only, which meant filing week 3's slides under
// week 3 was a trip to the Materials tab and back for every session. Pages and
// uploaded files are one list here; only the intent they post differs.
export function SessionMaterials({
  offeringId,
  sessionId,
  materials,
}: {
  offeringId: string;
  sessionId: string;
  materials: {
    id: string;
    title: string;
    kind: "page" | "file";
    sessionId: string | null;
    href: string;
  }[];
}) {
  const fetcher = useFetcher();
  const revalidator = useRevalidator();
  // Upload straight onto the session. Going via the Materials tab to upload and
  // then back here to file it was the long way round to "here are week 3's
  // slides", which is the one thing this row is for.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const meta = await uploadFileToS3(file, `offering/${offeringId}/materials`);
      const res = await fetch(`/api/education/${offeringId}/files`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: file.name, sessionId, ...meta }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? "Failed to register file");
      }
      revalidator.revalidate();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }
  const attached = materials.filter((m) => m.sessionId === sessionId);
  // Anything not already on this session, including material attached to
  // another one — moving it here is the same edit as attaching a loose file.
  const available = materials.filter((m) => m.sessionId !== sessionId);

  const setSession = (m: { id: string; kind: "page" | "file" }, to: string) =>
    fetcher.submit(
      {
        intent: m.kind === "page" ? "set-material-session" : "set-file-session",
        [m.kind === "page" ? "pageId" : "fileId"]: m.id,
        sessionId: to,
      },
      { method: "post" },
    );

  const uploadButton = (
    <>
      <input
        ref={fileInputRef}
        type="file"
        onChange={upload}
        className="hidden"
        aria-hidden
        tabIndex={-1}
      />
      <button
        type="button"
        disabled={uploading}
        onClick={() => fileInputRef.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-full bg-os-container px-3 py-1 text-sm text-os-grey transition-colors hover:text-foreground disabled:opacity-60"
      >
        <Upload className="h-3.5 w-3.5" aria-hidden />
        {uploading ? "Uploading…" : "Upload"}
      </button>
    </>
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-os-grey">Materials:</span>
      {attached.map((m) => (
        <span
          key={m.id}
          className="inline-flex items-center gap-1.5 rounded-full bg-os-container px-3 py-1"
        >
          <a href={m.href} className="text-foreground hover:text-os-accent hover:underline">
            {m.title}
          </a>
          <button
            type="button"
            onClick={() => setSession(m, "")}
            aria-label={`Remove ${m.title} from this session`}
            className="text-os-grey transition-colors hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}
      {attached.length === 0 && <span className="text-os-grey">None yet.</span>}
      {available.length > 0 && (
        <Select
          value=""
          onChange={(id) => {
            const m = available.find((x) => x.id === id);
            if (m) setSession(m, sessionId);
          }}
          placeholder="Attach existing"
          options={available.map((m) => ({
            value: m.id,
            label: m.sessionId ? `${m.title} (move here)` : m.title,
          }))}
          buttonClassName="inline-flex items-center gap-1 rounded-full bg-os-container px-3 py-1 text-sm text-os-grey transition-colors hover:text-foreground"
        />
      )}
      {uploadButton}
      {uploadError && <span className="text-destructive">{uploadError}</span>}
    </div>
  );
}
