import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Link } from "react-router";
import {
  AlertCircle,
  ArrowRight,
  ArrowUp,
  AudioLines,
  BookOpen,
  Calendar,
  Check,
  ClipboardList,
  Clock,
  FileText,
  FolderKanban,
  GraduationCap,
  LifeBuoy,
  ListTodo,
  Loader2,
  Sparkles,
  Square,
  UserRound,
  Users2,
  type LucideIcon,
} from "lucide-react";
import { PanelFrame } from "~/components/side-panel/PanelFrame";
import { PageBarPortal } from "~/components/shell/page-bar-slot";
import { Button } from "~/components/ui/Button";
import { cn } from "~/lib/cn";
import type { SidePanel } from "~/lib/side-panel";
import { NEAR_LIMIT, sharedAskThread, type AskThread, type AskTurn } from "../thread";
import type { AskSourceKind, CitedSource } from "../sources";
import { AskAnswer } from "./AskAnswer";
import { useAskThread } from "./use-ask";

export const ASK_EXAMPLES = [
  "What am I on the hook for this week?",
  "What did we decide in my last meeting?",
  "How do I request a room for an event?",
];

const KIND: Record<AskSourceKind, { icon: LucideIcon; label: string }> = {
  document: { icon: FileText, label: "Document" },
  meeting: { icon: Calendar, label: "Meeting" },
  transcript: { icon: AudioLines, label: "Transcript" },
  task: { icon: ListTodo, label: "Task" },
  project: { icon: FolderKanban, label: "Project" },
  person: { icon: UserRound, label: "Person" },
  group: { icon: Users2, label: "Group" },
  education: { icon: GraduationCap, label: "Education" },
  form: { icon: ClipboardList, label: "Form" },
  guide: { icon: BookOpen, label: "Guide" },
  helpArticle: { icon: LifeBuoy, label: "Help" },
};

const shortDate = (iso: string) =>
  new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(iso));

export function sourceMeta(source: Pick<CitedSource, "kind" | "date">): string {
  const label = KIND[source.kind]?.label ?? "Source";
  if (!source.date) return label;
  return `${label} · ${source.kind === "task" ? "due " : ""}${shortDate(source.date)}`;
}

export function resetTime(retryAt: number): string {
  return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" })
    .format(new Date(retryAt))
    .replace(":00", "");
}

export function footerNote(remaining: number | null): { count: string | null; note: string } {
  const note = "Written by AI from DALI docs, meetings and tasks.";
  if (remaining === null || remaining > NEAR_LIMIT || remaining <= 0) return { count: null, note };
  return { count: `${remaining} ${remaining === 1 ? "question" : "questions"} left today.`, note };
}

export default function AskPanel({
  panel,
  onClose,
  thread = sharedAskThread(),
}: {
  panel: SidePanel;
  onClose: () => void;
  thread?: AskThread;
}) {
  const { turns, remaining } = useAskThread(thread);
  const busy = turns.some((t) => t.status === "running");
  const last = turns.at(-1);
  const limitedUntil = last?.status === "limited" && last.retryAt && last.retryAt > Date.now() ? last.retryAt : null;
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: "end" });
  }, [turns.length, last?.status]);

  return (
    <PanelFrame panel={panel} title="Ask DALI" onClose={onClose}>
      {turns.length > 0 && (
        <PageBarPortal slot="actions">
          <Button variant="secondary" size="sm" onClick={() => thread.reset()}>
            Start over
          </Button>
        </PageBarPortal>
      )}
      <div className="flex min-h-full flex-col">
        {turns.length === 0 ? (
          <EmptyState onAsk={(q) => void thread.ask(q)} />
        ) : (
          <div className="flex flex-col gap-10 pt-6 md:px-4">
            {turns.map((turn) => (
              <Turn key={turn.id} turn={turn} onRetry={() => void thread.retry(turn.id)} />
            ))}
          </div>
        )}
        <div ref={endRef} />
        <Composer
          busy={busy}
          limitedUntil={limitedUntil}
          placeholder={turns.length ? "Ask a follow-up" : "Ask about docs, meetings or tasks"}
          remaining={remaining}
          onAsk={(q) => void thread.ask(q)}
          onStop={() => thread.stop()}
        />
      </div>
    </PanelFrame>
  );
}

function EmptyState({ onAsk }: { onAsk: (question: string) => void }) {
  return (
    <div className="flex flex-1 flex-col justify-end gap-7 pb-2 pt-10 md:px-4">
      <div className="flex flex-col gap-2">
        <span className="flex h-10 w-10 items-center justify-center rounded-[10px] bg-os-accent/15 text-os-accent">
          <Sparkles className="h-[22px] w-[22px]" aria-hidden />
        </span>
        <h2 className="pt-2 text-[26px] font-bold leading-[34px] tracking-[-0.015em] text-foreground">
          What do you want to know?
        </h2>
        <p className="text-[15px] leading-[23px] text-os-grey">
          Get a short answer from DALI docs, meetings and tasks, with a link to each source.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <p className="pb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-os-muted">Try asking</p>
        {ASK_EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => onAsk(example)}
            className="flex items-center gap-3 rounded-os-item bg-os-card px-3.5 py-[11px] text-left text-sm text-foreground transition-colors hover:bg-os-card-hover"
          >
            <span className="flex-1">{example}</span>
            <ArrowRight className="h-3.5 w-3.5 text-os-muted" aria-hidden />
          </button>
        ))}
      </div>
    </div>
  );
}

function Turn({ turn, onRetry }: { turn: AskTurn; onRetry: () => void }) {
  const thinking = turn.status === "running" && !turn.text;
  return (
    <section className="flex flex-col gap-5" aria-busy={turn.status === "running"}>
      <h2 className="text-[22px] font-bold leading-[30px] tracking-[-0.01em] text-foreground">{turn.question}</h2>
      {turn.steps.length > 0 && (
        <ul className="flex flex-col gap-1.5" aria-label="Steps">
          {turn.steps.map((step, i) => (
            <li
              key={i}
              className={cn(
                "flex items-center gap-2 text-[13px] leading-[18px]",
                step.done ? "text-os-muted" : "font-semibold text-os-accent",
              )}
            >
              {step.done ? (
                <Check className="h-3.5 w-3.5 text-os-green" aria-hidden />
              ) : (
                <Loader2 className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
              )}
              {step.label}
            </li>
          ))}
        </ul>
      )}
      {thinking && (
        <div className="flex flex-col gap-2.5" aria-hidden>
          <div className="h-3 w-[92%] rounded-md bg-os-well" />
          <div className="h-3 w-[78%] rounded-md bg-os-well" />
          <div className="h-3 w-[54%] rounded-md bg-os-well" />
        </div>
      )}
      {turn.text && <AskAnswer text={turn.text} sources={turn.sources} />}
      {turn.status === "stopped" && <p className="text-[13px] text-os-muted">Stopped.</p>}
      {turn.status === "limited" && turn.retryAt && (
        <div className="flex gap-3 rounded-os-card bg-os-card px-4 py-3.5" role="status">
          <Clock className="mt-0.5 h-[18px] w-[18px] shrink-0 text-os-amber" aria-hidden />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-bold text-foreground">You've used today's questions</p>
            <p className="text-sm text-os-grey">
              You can ask again after {resetTime(turn.retryAt)}. Search still works as usual.
            </p>
          </div>
        </div>
      )}
      {turn.status === "error" && (
        <div
          className="flex flex-col gap-3 rounded-os-card border border-destructive/30 bg-destructive/5 px-4 py-3.5"
          role="alert"
        >
          <p className="flex items-center gap-2.5 text-sm font-bold text-foreground">
            <AlertCircle className="h-[18px] w-[18px] text-destructive" aria-hidden />
            {turn.error}
          </p>
          <div className="pl-7">
            <Button size="sm" onClick={onRetry}>
              Try again
            </Button>
          </div>
        </div>
      )}
      {turn.sources.length > 0 && <Sources sources={turn.sources} />}
    </section>
  );
}

function Sources({ sources }: { sources: CitedSource[] }) {
  return (
    <div className="flex flex-col gap-0.5 pt-1">
      <p className="pb-1.5 text-[11px] font-bold uppercase tracking-[0.08em] text-os-muted">Sources</p>
      <ol className="flex flex-col gap-0.5">
        {sources.map((source) => {
          const Icon = KIND[source.kind]?.icon ?? FileText;
          return (
            <li key={source.ref}>
              <Link
                to={source.url}
                className="flex items-center gap-3 rounded-os-item bg-os-card px-3 py-2.5 transition-colors hover:bg-os-card-hover"
              >
                <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md bg-os-bg text-[11px] font-extrabold text-os-accent">
                  {source.n}
                </span>
                <Icon className="h-4 w-4 shrink-0 text-os-grey" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{source.title}</span>
                <span className="shrink-0 text-[13px] text-os-muted">{sourceMeta(source)}</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Composer({
  busy,
  limitedUntil,
  placeholder,
  remaining,
  onAsk,
  onStop,
}: {
  busy: boolean;
  limitedUntil: number | null;
  placeholder: string;
  remaining: number | null;
  onAsk: (question: string) => void;
  onStop: () => void;
}) {
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const disabled = limitedUntil !== null;
  const canSend = !busy && !disabled && draft.trim().length > 0;
  const { count, note } = footerNote(remaining);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const send = () => {
    if (!canSend) return;
    onAsk(draft);
    setDraft("");
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="sticky bottom-0 mt-auto flex flex-col gap-2 bg-os-bg pb-1 pt-4 md:px-4">
      <div
        className={cn(
          "flex items-end gap-2.5 rounded-os-card border py-2.5 pl-4 pr-2.5 transition-colors",
          disabled ? "border-os-well bg-os-card" : "border-os-container bg-os-bg focus-within:border-os-accent",
        )}
      >
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          disabled={disabled}
          maxLength={2000}
          aria-label="Your question"
          placeholder={disabled && limitedUntil ? `You can ask again after ${resetTime(limitedUntil)}` : placeholder}
          className="max-h-40 min-h-[30px] flex-1 resize-none !bg-transparent py-1 text-sm leading-5 text-foreground [field-sizing:content] placeholder:text-os-muted focus:outline-none disabled:cursor-not-allowed"
        />
        {busy ? (
          <button
            type="button"
            onClick={onStop}
            className="flex h-[30px] shrink-0 items-center gap-1.5 rounded-os-item border border-os-container px-2.5 text-[13px] text-os-grey transition-colors hover:bg-os-hover"
          >
            <Square className="h-2.5 w-2.5 fill-current" aria-hidden />
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={send}
            disabled={!canSend}
            aria-label="Ask"
            className="flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-os-item bg-os-accent text-os-bg transition-colors hover:bg-os-accent-hover disabled:bg-os-well disabled:text-os-container-hi"
          >
            <ArrowUp className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
      <p className="text-center text-xs leading-4 text-os-muted">
        {count && <span className="font-bold text-os-amber">{count} </span>}
        {note}
      </p>
    </div>
  );
}
