import { AlertTriangle, CheckCircle2, Trash2 } from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";
import { Checkbox } from "~/components/ui/Checkbox";
import { hasLab, journeyTitle } from "~/journeys/lib/journey";
import type { JourneyIssue } from "~/journeys/lib/journey-validation";
import type { Journey } from "~/journeys/lib/types";
import { FormField } from "~/components/ui/FormField";

const TIPS = [
  "Click a module to edit its details, pages, slides, lab and quiz.",
  "Drag from a module's right dot onto another module to make it a prerequisite.",
  "Click a connection and press Delete to remove it.",
  "Changes save as a draft. Learners only see them after you publish.",
];

export function JourneyOverviewPanel({
  journey,
  issues,
  isPublished,
  isOwner,
  onChange,
  onSelectModule,
  onDelete,
}: {
  journey: Journey;
  issues: JourneyIssue[];
  isPublished: boolean;
  isOwner: boolean;
  onChange: (fn: (j: Journey) => Journey) => void;
  onSelectModule: (moduleId: string) => void;
  onDelete: () => void;
}) {
  const labs = journey.modules.filter(hasLab).length;
  const starts = journey.modules.filter((m) => m.dependsOn.length === 0).length;

  return (
    <>
      <div className="shrink-0 border-b border-os-container px-6 py-5">
        <p className="text-xs text-os-muted">Journey settings</p>
        <h2 className="mt-0.5 truncate font-heading text-lg font-semibold">{journeyTitle(journey)}</h2>
        <p className="mt-1 text-sm text-os-grey">
          {journey.modules.length} modules · {labs} labs · {starts} {starts === 1 ? "starting point" : "starting points"}
        </p>
      </div>

      <div className="os-form min-h-0 flex-1 overflow-y-auto p-6">
        <div className="space-y-5">
          <FormField label="Title" value={journey.title} onChange={(title) => onChange((j) => ({ ...j, title }))} />
          <FormField
            label="Description"
            multiline
            rows={3}
            value={journey.description}
            placeholder="Who is this journey for, and where does it get them?"
            onChange={(description) => onChange((j) => ({ ...j, description }))}
          />
          <Checkbox
            checked={Boolean(journey.recommended)}
            onChange={(e) => {
              const recommended = e.currentTarget.checked || undefined;
              onChange((j) => ({ ...j, recommended }));
            }}
            label="Recommended for new members"
            description="Featured at the top of the domain's journeys."
          />
        </div>

        <section className="mt-6 border-t border-os-container pt-5">
          {issues.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-os-green">
              <CheckCircle2 className="h-4 w-4" aria-hidden />
              No issues. Ready to publish.
            </p>
          ) : (
            <>
              <h3 className="flex items-center gap-2 text-sm font-medium text-os-amber">
                <AlertTriangle className="h-4 w-4" aria-hidden />
                {issues.length} {issues.length === 1 ? "issue" : "issues"} to fix before publishing
              </h3>
              <ul className="-mx-3 mt-2 space-y-0.5">
                {issues.map((issue) => (
                  <li key={`${issue.moduleId}-${issue.message}`}>
                    {issue.moduleId ? (
                      <button
                        type="button"
                        onClick={() => onSelectModule(issue.moduleId as string)}
                        className="w-full rounded-os-item px-3 py-2 text-left text-sm text-foreground/85 transition-colors hover:bg-os-hover"
                      >
                        {issue.message}
                      </button>
                    ) : (
                      <p className="px-3 py-2 text-sm text-foreground/85">{issue.message}</p>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="mt-6 border-t border-os-container pt-5">
          <h3 className="os-field-label">How editing works</h3>
          <ul className="mt-2 list-disc space-y-1.5 pl-5 text-sm leading-6 text-os-grey marker:text-os-muted">
            {TIPS.map((tip) => (
              <li key={tip}>{tip}</li>
            ))}
          </ul>
        </section>

        <section className="mt-6 border-t border-os-container pt-5">
          {isOwner ? (
            <>
              <button type="button" onClick={onDelete} className={buttonClasses("ghost", "sm", "hover:text-destructive")}>
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                Delete journey
              </button>
              {isPublished && (
                <p className="mt-2 text-xs text-os-muted">Deleting removes it for learners right away, along with their progress.</p>
              )}
            </>
          ) : (
            <p className="text-xs text-os-muted">Only owners can delete this journey or change who has access.</p>
          )}
        </section>
      </div>
    </>
  );
}
