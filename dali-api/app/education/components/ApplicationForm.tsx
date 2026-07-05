import { useState } from "react";
import { useNavigate } from "react-router";
import { Button } from "~/components/ui/Button";
import { uploadFileToS3 } from "~/lib/upload-client";

export interface ApplicationFormProps {
  offeringId: string;
  offeringTitle: string;
  questions: { id: string; prompt: string; required: boolean; type: "Text" | "Url" | "File" }[];
  initialAnswers?: Record<string, string>;
  submitTo: string; // API endpoint
  redirectAfter: string; // where to send the user after successful submit
  submitLabel?: string;
}

export function ApplicationForm(props: ApplicationFormProps) {
  const [answers, setAnswers] = useState<Record<string, string>>(
    () => props.initialAnswers ?? {},
  );
  const [urlErrors, setUrlErrors] = useState<Record<string, string>>({});
  const [uploadingIds, setUploadingIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  function setUploading(qId: string, on: boolean) {
    setUploadingIds((prev) => {
      const next = new Set(prev);
      if (on) next.add(qId);
      else next.delete(qId);
      return next;
    });
  }

  async function handleFileChange(qId: string, file: File) {
    setUploading(qId, true);
    setError(null);
    try {
      const meta = await uploadFileToS3(file, `education/applications/${props.offeringId}`);
      setAnswers((prev) => ({ ...prev, [qId]: meta.s3Key }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "File upload failed");
    } finally {
      setUploading(qId, false);
    }
  }

  function validateUrl(qId: string, value: string) {
    if (!value) {
      setUrlErrors((prev) => ({ ...prev, [qId]: "" }));
      return;
    }
    try {
      new URL(value);
      setUrlErrors((prev) => ({ ...prev, [qId]: "" }));
    } catch {
      setUrlErrors((prev) => ({ ...prev, [qId]: "Please enter a valid URL (must start with https://)" }));
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const res = await fetch(props.submitTo, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          answers: props.questions.map((q) => ({
            questionId: q.id,
            content: answers[q.id] ?? "",
          })),
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Unable to submit");
        return;
      }
      navigate(props.redirectAfter);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-2xl mx-auto space-y-5">
      <h1 className="font-heading text-2xl font-bold text-dark-blue mb-2">
        Apply to {props.offeringTitle}
      </h1>
      {props.questions.length === 0 && (
        <p className="text-sm text-muted-foreground">
          No questions — just confirm your spot by submitting below.
        </p>
      )}
      {props.questions.map((q) => (
        <div key={q.id} className="block">
          <label className="block">
            <span className="block text-sm font-semibold text-dark-blue mb-1">
              {q.prompt} {q.required && <span className="text-accent-coral">*</span>}
            </span>
            {q.type === "Url" ? (
              <>
                <input
                  type="url"
                  value={answers[q.id] ?? ""}
                  onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                  onBlur={(e) => validateUrl(q.id, e.target.value)}
                  required={q.required}
                  placeholder="https://"
                  className="w-full rounded-lg border border-border bg-card px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-teal"
                />
                {urlErrors[q.id] && (
                  <p className="mt-1 text-xs text-red-600">{urlErrors[q.id]}</p>
                )}
              </>
            ) : q.type === "File" ? (
              <div className="space-y-2">
                <input
                  type="file"
                  disabled={uploadingIds.has(q.id)}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      handleFileChange(q.id, file);
                      e.target.value = "";
                    }
                  }}
                  className="text-sm"
                />
                {uploadingIds.has(q.id) && (
                  <p className="text-xs text-muted-foreground">Uploading...</p>
                )}
                {answers[q.id] && !uploadingIds.has(q.id) && (
                  <p className="text-xs text-green-700">
                    File uploaded: {answers[q.id].split("/").pop()}
                  </p>
                )}
              </div>
            ) : (
              <textarea
                value={answers[q.id] ?? ""}
                onChange={(e) => setAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))}
                required={q.required}
                rows={4}
                className="w-full rounded-lg border border-border bg-card p-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent-teal"
              />
            )}
          </label>
        </div>
      ))}
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          {error}
        </div>
      )}
      <Button type="submit" variant="primary" disabled={submitting || uploadingIds.size > 0}>
        {submitting ? "Submitting..." : uploadingIds.size > 0 ? "Uploading..." : (props.submitLabel ?? "Submit")}
      </Button>
    </form>
  );
}
