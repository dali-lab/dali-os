import { DocEditor, countWords } from "~/components/doc";
import { formatDateTime } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";

// Read-only renderer for a single submission's artifact, extracted from the
// old grading route (education.manage.assignments.$assignmentId.tsx) so the
// v2 grading pane can reuse it. The old route's copy stays untouched.

export type SubmissionArtifact = {
  textContent: string | null;
  files: { key: string; name: string }[];
  link?: string | null;
  docContent?: unknown; // readDocAsBlocks result; null = not a Doc type
  submittedAt: string | Date | null;
  submissionType: "Text" | "File" | "Mixed" | "Link" | "Complete" | "Doc";
};

export function SubmissionDisplay({
  submission,
}: {
  submission: SubmissionArtifact;
}) {
  const tz = useUserTimeZone();

  return (
    <div className="flex flex-col gap-2">
      {/* Text / Mixed */}
      {submission.textContent && (
        <p className="text-sm text-foreground whitespace-pre-wrap border-l-2 border-border pl-3">
          {submission.textContent}
        </p>
      )}

      {/* File / Mixed */}
      {submission.files.length > 0 && (
        <ul className="flex flex-col gap-1">
          {submission.files.map((f) => (
            <li key={f.key}>
              <a
                href={`/api/upload/raw?key=${encodeURIComponent(f.key)}`}
                target="_blank"
                rel="noreferrer"
                className="text-sm text-accent-coral hover:underline"
              >
                {f.name}
              </a>
            </li>
          ))}
        </ul>
      )}

      {/* Link */}
      {submission.link && (
        <p>
          <a
            href={submission.link}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-accent-coral hover:underline break-all"
          >
            {submission.link}
          </a>
        </p>
      )}

      {/* Complete */}
      {submission.submissionType === "Complete" && submission.submittedAt && (
        <p className="text-sm text-muted-foreground italic">
          Marked complete on {formatDateTime(submission.submittedAt, tz)}
        </p>
      )}

      {/* Doc — read-only server-rendered blocks */}
      {submission.docContent !== null && submission.docContent !== undefined && (
        <div className="border-l-2 border-border pl-3">
          {countWords(submission.docContent) > 0 ? (
            <DocEditor
              features="notes"
              editable={false}
              initialContent={submission.docContent}
            />
          ) : (
            <p className="text-sm text-muted-foreground italic">
              No content written yet.
            </p>
          )}
        </div>
      )}

      {/* No artifact yet */}
      {!submission.textContent &&
        submission.files.length === 0 &&
        !submission.link &&
        submission.submissionType !== "Complete" &&
        submission.submissionType !== "Doc" && (
          <p className="text-sm text-muted-foreground italic">
            Not submitted.
          </p>
        )}
    </div>
  );
}
