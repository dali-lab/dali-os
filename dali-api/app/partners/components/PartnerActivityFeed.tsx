import { useState, type ReactNode } from "react";
import { Form, Link } from "react-router";
import {
  Calendar,
  ClipboardCheck,
  ClipboardList,
  FilePlus2,
  Mail,
  MessageSquarePlus,
  Plus,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { buttonClasses } from "~/components/ui/Button";
import { relativeTime } from "~/lib/relative-time";
import { PARTNER_APPLICATION_STATUS_LABELS } from "../lib/partner-application";

export type PartnerActivity = {
  id: string;
  createdAt: string;
  actorUserId: string | null;
  type: string;
  body: string | null;
  metadata: Record<string, unknown> | null;
};

const EMAIL_KIND_LABEL: Record<string, string> = {
  "meeting-invite": "meeting invite",
  "next-steps": "next-steps",
  "learn-more": "learn-more",
  accepted: "acceptance",
  rejected: "rejection",
};

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" ? v : null;
}
function statusLabel(v: unknown): string {
  const s = str(v);
  return (s && PARTNER_APPLICATION_STATUS_LABELS[s as never]) || s || "—";
}

type Rendered = { icon: LucideIcon; title: ReactNode; detail?: ReactNode };

function render(a: PartnerActivity): Rendered {
  const m = a.metadata ?? {};
  switch (a.type) {
    case "Created":
      return {
        icon: FilePlus2,
        title:
          str(m.source) === "Form"
            ? "Application submitted"
            : "Opportunity created",
      };
    case "StatusChanged": {
      const projectId = str(m.projectId);
      const reason = str(m.reason);
      return {
        icon: ArrowRight,
        title: (
          <>
            Moved to <strong>{statusLabel(m.to)}</strong>
            <span className="text-muted-foreground">
              {" "}
              from {statusLabel(m.from)}
            </span>
          </>
        ),
        detail: projectId ? (
          <Link
            to={`/projects/${projectId}`}
            className="text-accent-coral hover:underline"
          >
            View the project →
          </Link>
        ) : reason ? (
          <span className="text-muted-foreground">“{reason}”</span>
        ) : undefined,
      };
    }
    case "Note":
      return {
        icon: MessageSquarePlus,
        title: "Note",
        detail: (
          <span className="whitespace-pre-wrap text-foreground">{a.body}</span>
        ),
      };
    case "EmailSent": {
      const kind = str(m.kind);
      const label = (kind && EMAIL_KIND_LABEL[kind]) || "an";
      return { icon: Mail, title: `Sent ${label} email to the partner` };
    }
    case "MeetingScheduled": {
      const at = str(m.scheduledAt);
      return {
        icon: Calendar,
        title: "Meeting scheduled",
        detail: at ? (
          <span className="text-muted-foreground">
            {new Date(at).toLocaleString("en-US", {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </span>
        ) : undefined,
      };
    }
    case "MeetingDebriefed": {
      const outcome = str(m.outcome);
      return {
        icon: ClipboardCheck,
        title: "Meeting debriefed",
        detail: outcome ? (
          <span className="text-muted-foreground">Outcome: {outcome}</span>
        ) : undefined,
      };
    }
    case "Evaluated": {
      const rating = num(m.interviewRating);
      return {
        icon: ClipboardList,
        title: "Evaluation saved",
        detail: rating ? (
          <span className="text-muted-foreground">Interview {rating}/5</span>
        ) : undefined,
      };
    }
    default:
      return { icon: ArrowRight, title: a.type };
  }
}

function actorLabel(a: PartnerActivity, names: Record<string, string>): string {
  if (a.actorUserId) return names[a.actorUserId] ?? "A team member";
  // No actor = partner-originated (form submit) or a system event.
  return str((a.metadata ?? {}).source) === "Form" ? "Partner" : "System";
}

export function PartnerActivityFeed({
  activities,
  actorNames,
  canEdit,
  headerActions,
}: {
  activities: PartnerActivity[];
  actorNames: Record<string, string>;
  canEdit: boolean;
  /** Extra affordances for the pinned header (e.g. a "Log meeting" button). */
  headerActions?: ReactNode;
}) {
  const [composing, setComposing] = useState(false);
  const [note, setNote] = useState("");

  return (
    <section className="bg-card border border-border rounded-2xl">
      <header className="flex items-center justify-between gap-2 px-4 py-3 border-b border-border">
        <h2 className="text-sm font-semibold text-foreground">Activity</h2>
        {canEdit && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setComposing((v) => !v)}
              className={buttonClasses("ghost", "sm")}
            >
              <Plus className="w-3.5 h-3.5" /> Add note
            </button>
            {headerActions}
          </div>
        )}
      </header>

      {canEdit && composing && (
        <Form
          method="post"
          onSubmit={() => {
            setComposing(false);
            setNote("");
          }}
          className="flex flex-col gap-2 px-4 py-3 border-b border-border"
        >
          <input type="hidden" name="intent" value="note" />
          <textarea
            name="body"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            autoFocus
            rows={3}
            placeholder="Add an internal note…"
            className="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-accent-coral/30"
          />
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => {
                setComposing(false);
                setNote("");
              }}
              className={buttonClasses("ghost", "sm")}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!note.trim()}
              className={buttonClasses("primary", "sm")}
            >
              Add note
            </button>
          </div>
        </Form>
      )}

      {activities.length === 0 ? (
        <p className="px-4 py-8 text-center text-sm text-muted-foreground">
          No activity yet.
        </p>
      ) : (
        <ul className="divide-y divide-border">
          {activities.map((a) => {
            const { icon: Icon, title, detail } = render(a);
            return (
              <li key={a.id} className="flex gap-3 px-4 py-3">
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted/50 text-muted-foreground">
                  <Icon className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">{title}</p>
                  {detail && <div className="mt-0.5 text-sm">{detail}</div>}
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {actorLabel(a, actorNames)} · {relativeTime(a.createdAt)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
