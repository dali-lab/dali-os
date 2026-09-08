import { useState } from "react";
import { Form } from "react-router";
import { Select } from "~/components/ui/floating";
import { Button } from "~/components/ui/Button";
import { renderEmail } from "~/lib/email";

// One row of the Decision emails table: bind a template (or fall back to the
// built-in copy) for a status, with a live preview of exactly what sends —
// rendered with a sample recipient so the built-in fallback isn't invisible.
export function DecisionEmailRow({
  status,
  boundVersionId,
  emailTemplates,
  builtinCopy,
  offeringTitle,
}: {
  status: "Approved" | "Waitlisted" | "Rejected";
  boundVersionId: string;
  emailTemplates: { name: string; versionId: string; subject: string; body: string }[];
  builtinCopy: { subject: string; body: string };
  offeringTitle: string;
}) {
  const [selected, setSelected] = useState(boundVersionId);
  const [showPreview, setShowPreview] = useState(false);

  const source = selected
    ? emailTemplates.find((t) => t.versionId === selected) ?? builtinCopy
    : builtinCopy;
  // Sample render: {{firstName}} → a placeholder name, {{domain}} → the offering
  // title (education templates carry the title in {{domain}}), matching the send.
  const preview = renderEmail(source, { firstName: "Alex", domain: offeringTitle });

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border/60 p-2">
      <Form method="post" className="flex items-center gap-3">
        <input type="hidden" name="intent" value="set-decision-email" />
        <input type="hidden" name="status" value={status} />
        <span className="text-sm text-foreground w-24">{status}</span>
        <Select
          name="emailTemplateVersionId"
          value={selected}
          onChange={setSelected}
          placeholder="Built-in message (no template)"
          options={[
            { value: "", label: "Built-in message (no template)" },
            ...emailTemplates.map((t) => ({ value: t.versionId, label: t.name })),
          ]}
          buttonClassName="flex-1 rounded-md border border-border bg-card px-2 py-1.5 text-sm inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
        />
        <button
          type="button"
          onClick={() => setShowPreview((v) => !v)}
          className="text-xs text-muted-foreground hover:text-foreground px-2 py-1.5 rounded-md hover:bg-muted/40 transition-colors shrink-0"
        >
          {showPreview ? "Hide" : "Preview"}
        </button>
        <Button type="submit" variant="secondary" size="sm">
          Save
        </Button>
      </Form>
      {showPreview && (
        <div className="rounded-md bg-muted/40 px-3 py-2 text-xs">
          <p className="text-muted-foreground">
            {selected ? "Bound template" : "Built-in message"} — sample for "Alex":
          </p>
          <p className="mt-1 font-medium text-foreground">{preview.subject}</p>
          <div
            className="mt-1 text-foreground [&_p]:my-1"
            dangerouslySetInnerHTML={{ __html: preview.html }}
          />
        </div>
      )}
    </div>
  );
}
