import { useState } from "react";
import { useSubmit, useActionData, useNavigation } from "react-router";
import { FileAttachment } from "~/components/FilePreview";
import { DocEditor, countWords } from "~/components/doc";
import { Button } from "~/components/ui/Button";
import { formatDateTime } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";

// Student-side assignment view: instructions (blocks read server-side, shown
// read-only), text/file submission with resubmit, and returned grade/feedback.
// Files go straight to S3 via the existing presign flow; the submit action
// receives S3 keys only.

export type AssignmentView = {
  id: string;
  title: string;
  dueAt: string | Date | null;
  submissionType: "Text" | "File" | "Mixed";
  instructionsContent: unknown;
};

export type SubmissionView = {
  textContent: string | null;
  files: { key: string; name: string }[];
  submittedAt: string | Date | null;
  gradedAt: string | Date | null;
  grade: string | null;
  feedbackText: string | null;
  // Released instructor feedback as BlockNote blocks (read server-side); falls
  // back to the feedbackText mirror for pre-migration submissions.
  feedbackContent?: unknown;
} | null;

export function AssignmentWorkArea({
  assignment,
  submission,
  canSubmit,
}: {
  assignment: AssignmentView;
  submission: SubmissionView;
  canSubmit: boolean;
}) {
  const tz = useUserTimeZone();
  const [text, setText] = useState(submission?.textContent ?? "");
  const [files, setFiles] = useState<{ key: string; name: string }[]>(
    submission?.files ?? [],
  );
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const actionData = useActionData<{ error?: string }>();
  const navigation = useNavigation();
  const submit = useSubmit();

  const pastDue = assignment.dueAt != null && new Date(assignment.dueAt) < new Date();
  const wantsText = assignment.submissionType !== "File";
  const wantsFiles = assignment.submissionType !== "Text";

  async function uploadFile(file: File) {
    setUploading(true);
    setUploadError(null);
    try {
      const presignRes = await fetch("/api/upload/presign", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: `education/submissions/${assignment.id}/${crypto.randomUUID()}-${file.name}`,
          contentType: file.type || "application/octet-stream",
          contentLength: file.size,
        }),
      });
      if (!presignRes.ok) {
        const text = await presignRes.text();
        let message = "Failed to get upload URL";
        try {
          message = (JSON.parse(text) as { error?: string }).error ?? message;
        } catch {
          // non-JSON error body
        }
        throw new Error(message);
      }
      const { url, fields, key } = (await presignRes.json()) as {
        url: string;
        fields: Record<string, string>;
        key: string;
      };
      const formData = new FormData();
      for (const [name, value] of Object.entries(fields)) formData.append(name, value);
      formData.append("file", file);
      const uploadRes = await fetch(url, { method: "POST", body: formData });
      if (!uploadRes.ok) throw new Error("Upload failed");
      setFiles((f) => [...f, { key, name: file.name }]);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData();
    fd.set("intent", "submit-assignment");
    fd.set("textContent", text);
    fd.set("files", JSON.stringify(files));
    submit(fd, { method: "post" });
  }

  return (
    <div className="flex flex-col gap-5 max-w-3xl">
      {/* instructionsContent is block JSON (loaders read via readDocAsBlocks). */}
      {countWords(assignment.instructionsContent) > 0 && (
        <section className="bg-card border border-border rounded-lg p-5">
          <DocEditor
            features="notes"
            editable={false}
            initialContent={assignment.instructionsContent}
          />
        </section>
      )}

      {submission?.gradedAt != null && (
        <section className="bg-accent-teal/5 border border-accent-teal/30 rounded-lg p-4">
          <p className="text-xs font-semibold text-accent-teal">
            {submission.grade ? `Grade · ${submission.grade}` : "Graded"}
            {` · ${formatDateTime(submission.gradedAt, tz)}`}
          </p>
          {countWords(submission.feedbackContent) > 0 ? (
            <div className="mt-1">
              <DocEditor
                features="notes"
                editable={false}
                initialContent={submission.feedbackContent}
              />
            </div>
          ) : submission.feedbackText ? (
            <p className="text-sm text-foreground whitespace-pre-wrap mt-1">
              {submission.feedbackText}
            </p>
          ) : (
            <p className="text-sm text-muted-foreground italic mt-1">No written feedback.</p>
          )}
        </section>
      )}

      <section className="bg-card border border-border rounded-lg p-5">
        <div className="flex items-center justify-between gap-4 mb-3">
          <h2 className="text-sm font-semibold text-foreground">
            {submission?.submittedAt ? "Your submission" : "Submit your work"}
          </h2>
          {submission?.submittedAt && (
            <span className="text-xs text-muted-foreground">
              Submitted {formatDateTime(submission.submittedAt, tz)}
            </span>
          )}
        </div>

        {!canSubmit ? (
          <p className="text-sm text-muted-foreground italic">
            Manager preview — submissions are for enrolled students.
          </p>
        ) : pastDue && !submission?.submittedAt ? (
          <p className="text-sm text-muted-foreground italic">
            This assignment is past due.
          </p>
        ) : (
          <form onSubmit={onSubmit} className="flex flex-col gap-3">
            {wantsText && (
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={6}
                placeholder="Write your answer…"
                className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm"
              />
            )}
            {wantsFiles && (
              <div className="flex flex-col gap-2">
                {files.map((f) => (
                  <FileAttachment
                    key={f.key}
                    url={`/api/upload/raw?key=${encodeURIComponent(f.key)}`}
                    fileName={f.name}
                    trailing={
                      <button
                        type="button"
                        onClick={() => setFiles((cur) => cur.filter((x) => x.key !== f.key))}
                        className="shrink-0 text-xs text-muted-foreground hover:text-destructive"
                      >
                        Remove
                      </button>
                    }
                  />
                ))}
                <label className="text-xs text-muted-foreground">
                  <input
                    type="file"
                    className="block text-xs"
                    disabled={uploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void uploadFile(file);
                      e.target.value = "";
                    }}
                  />
                  {uploading && "Uploading…"}
                </label>
                {uploadError && (
                  <p className="text-xs text-destructive">{uploadError}</p>
                )}
              </div>
            )}
            {actionData?.error && (
              <p className="text-sm text-destructive">{actionData.error}</p>
            )}
            {pastDue && (
              <p className="text-xs text-amber-700">
                Heads up: the due date has passed — resubmitting is closed.
              </p>
            )}
            <Button
              type="submit"
              size="sm"
              className="self-start"
              disabled={navigation.state !== "idle" || uploading || pastDue}
            >
              {submission?.submittedAt ? "Resubmit" : "Submit"}
            </Button>
          </form>
        )}
      </section>
    </div>
  );
}
