import { useState } from "react";
import { Link, Form } from "react-router";
import { ChevronDown, FileText, Trash2, ArrowUpRight } from "lucide-react";
import type { Question } from "~/types";
import { ChallengePreview } from "~/hiring/components/ChallengePreview";

export interface HiringFormEmbedProps {
  /** The bound Drive Form id — links to the Forms builder. */
  formId: string;
  name: string;
  questions: Question[];
  description?: unknown;
  /** Open the inline preview on first render (used when it's the only form). */
  defaultOpen?: boolean;
  /** When set, renders a remove control that posts this intent + fields. */
  remove?: { intent: string; fields: Record<string, string> };
}

/**
 * Inline "Drive embed" of a bound hiring Form — the same read-only render an
 * applicant sees (via ChallengePreview → FormFieldList), tucked into a
 * collapsible card. Mirrors the project-hub Drive embed: a compact header with
 * an Open-in-Drive link, expandable to show the contents in place. Replaces the
 * old "Edit in Drive →" bare link so leads can see the questions without
 * leaving the page.
 */
export function HiringFormEmbed({
  formId,
  name,
  questions,
  description,
  defaultOpen = false,
  remove,
}: HiringFormEmbedProps) {
  const [open, setOpen] = useState(defaultOpen);
  const qCount = questions.filter((q) => q.type !== "info").length;

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="group flex flex-1 items-center gap-3 min-w-0 text-left"
        >
          <div className="p-1.5 rounded-md bg-blue-100 text-blue-600 shrink-0">
            <FileText className="w-4 h-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-foreground truncate">{name}</div>
            <div className="text-xs text-muted-foreground">
              {qCount} question{qCount !== 1 ? "s" : ""} · Drive form
            </div>
          </div>
          <ChevronDown
            className={`w-4 h-4 text-muted-foreground/70 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
        <div className="flex items-center gap-1.5 shrink-0">
          <Link
            to={`/forms/edit/${formId}`}
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 hover:text-blue-800 hover:underline"
          >
            Open in Drive
            <ArrowUpRight className="w-3.5 h-3.5" />
          </Link>
          {remove && (
            <Form method="post" preventScrollReset>
              <input type="hidden" name="intent" value={remove.intent} />
              {Object.entries(remove.fields).map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              <button
                type="submit"
                aria-label={`Remove ${name}`}
                className="text-muted-foreground hover:text-red-600 transition p-1"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </Form>
          )}
        </div>
      </div>
      {open && (
        <div className="border-t border-border px-4 py-4 bg-muted/20">
          <ChallengePreview questions={questions} description={description} />
        </div>
      )}
    </div>
  );
}
