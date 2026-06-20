import { useState } from "react";
import { useRevalidator } from "react-router";
import { Button } from "~/components/ui/Button";

interface Attachment {
  key: string;
  name: string;
  contentType: string;
  size: number;
}

export interface SubmissionFormProps {
  assignmentId: string;
  submissionType: "Text" | "File" | "Mixed";
  initialBody: string;
  initialAttachments: Attachment[];
  alreadySubmittedAt: string | null;
  gradedAt?: string | null;
  feedback?: { body: string; at: string } | null;
}

export function SubmissionForm(props: SubmissionFormProps) {
  const { revalidate } = useRevalidator();
  const [body, setBody] = useState(props.initialBody);
  const [attachments, setAttachments] = useState<Attachment[]>(props.initialAttachments);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(props.alreadySubmittedAt);

  const allowText = props.submissionType !== "File";
  const allowFile = props.submissionType !== "Text";

  async function uploadFile(file: File) {
    setUploading(true);
    setError(null);
    try {
      const presign = await fetch("/api/upload/presign", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: `education/${props.assignmentId}/${Date.now()}-${file.name}`,
          contentType: file.type || "application/octet-stream",
          contentLength: file.size,
        }),
      });
      if (!presign.ok) {
        const body = await presign.json().catch(() => ({}));
        setError(body.error ?? "Presign failed");
        return;
      }
      const { url, fields, key } = await presign.json();
      const form = new FormData();
      for (const [k, v] of Object.entries(fields)) form.append(k, v as string);
      form.append("file", file);
      const upload = await fetch(url, { method: "POST", body: form });
      if (!upload.ok) {
        setError("File upload failed");
        return;
      }
      setAttachments((prev) => [
        ...prev,
        { key, name: file.name, contentType: file.type || "application/octet-stream", size: file.size },
      ]);
    } finally {
      setUploading(false);
    }
  }

  async function submit() {
    setSubmitting(true);
    setError(null);
    const res = await fetch(`/api/education/assignments/${props.assignmentId}/submission`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, attachments }),
    });
    setSubmitting(false);
    if (res.ok) {
      const row = await res.json();
      setSavedAt(row.submittedAt ?? new Date().toISOString());
      revalidate();
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Submit failed");
    }
  }

  return (
    <div className="space-y-4">
      {props.gradedAt && props.feedback && (
        <div className="rounded-2xl border border-accent-teal/40 bg-accent-teal/5 p-4">
          <p className="text-xs font-semibold uppercase tracking-wider text-accent-teal mb-2">
            Instructor feedback · graded {new Date(props.gradedAt).toLocaleString()}
          </p>
          <p className="text-sm text-dark-blue whitespace-pre-wrap">{props.feedback.body}</p>
        </div>
      )}
      {savedAt && (
        <div className="text-xs text-green-700">
          Submitted {new Date(savedAt).toLocaleString()} — submitting again will overwrite.
        </div>
      )}
      {allowText && (
        <label className="block">
          <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Response
          </span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={6}
            className="w-full rounded-lg border border-border bg-card p-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-teal"
          />
        </label>
      )}
      {allowFile && (
        <div>
          <span className="block text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            Files
          </span>
          <input
            type="file"
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                uploadFile(file);
                e.target.value = "";
              }
            }}
            className="text-sm"
          />
          {attachments.length > 0 && (
            <ul className="mt-2 space-y-1">
              {attachments.map((a, i) => (
                <li key={i} className="text-sm flex items-center gap-2">
                  <a href={`/api/upload/url?key=${encodeURIComponent(a.key)}`} className="text-accent-coral hover:underline" target="_blank" rel="noopener noreferrer">
                    {a.name}
                  </a>
                  <span className="text-xs text-muted-foreground">({Math.round(a.size / 1024)} KB)</span>
                  <button
                    onClick={() => setAttachments((prev) => prev.filter((_, idx) => idx !== i))}
                    className="text-xs text-red-600 hover:underline"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {error && <div className="text-sm text-red-700">{error}</div>}
      <Button variant="primary" disabled={submitting || uploading} onClick={submit}>
        {submitting ? "Submitting..." : savedAt ? "Update submission" : "Submit"}
      </Button>
    </div>
  );
}
