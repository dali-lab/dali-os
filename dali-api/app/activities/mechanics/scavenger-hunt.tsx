// Scavenger-hunt mechanic — client half (specs/activities.md §8): the Surface
// (submit + progress + leaderboard, shown in the shell's activity modal) and
// the admin config editor (the code list). Codes are submitted from the modal,
// which is reachable from any page, so the hunt renders no on-page overlay.
// Client-safe; no server imports.

import { useEffect, useState, type ReactNode } from "react";
import { useFetcher } from "react-router";
import { CheckCircle2, Circle, ExternalLink, Lightbulb, Lock, Plus, Trash2, Trophy } from "lucide-react";
import { cn } from "~/lib/cn";
import { buttonClasses } from "~/components/ui/Button";
import { DEFAULT_HINT_POLICY } from "~/lib/activities";
import type {
  HuntCode,
  HuntConfig,
  HuntHintMode,
  HuntHintPolicy,
  HuntLeaderboard,
} from "~/lib/activities";
import type { AdminEditorProps, MechanicClient, SurfaceProps } from "./registry";

type HuntClue = {
  id: string;
  label: string; // never the code value itself
  found: boolean; // this member has entered it — the row is struck through
  hint: string | null; // present when the policy allows showing it now
  cost: number | null; // points mode: cost to reveal (not yet revealed)
  unlocksAt: number | null; // delay mode: epoch ms until it unlocks
};

type HuntProgress = {
  total: number;
  found: number;
  complete: boolean;
  foundCodeIds: string[];
  instructionsUrl: string | null;
  hintMode: HuntHintMode;
  clues: HuntClue[];
};

type HuntResultRow = { userId: string; points: number; found: number; lastAt: number };
type HuntResults = { visibility: HuntLeaderboard; total: number; rows: HuntResultRow[] } | null;

// ─── Surface: the hunt's submit + progress + leaderboard (in the modal) ──────

function Surface({
  active,
  progress,
  results,
  currentUserId,
  nameByUserId,
  submitAction,
  onChanged,
}: SurfaceProps) {
  const p = progress as HuntProgress;
  const board = results as HuntResults;
  const fetcher = useFetcher<{ ok?: boolean; message?: string }>();
  const [code, setCode] = useState("");
  const busy = fetcher.state !== "idle";

  // On a successful find, clear the field and tell the modal to reload so the
  // progress bar + leaderboard reflect the new event.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      setCode("");
      onChanged?.();
    }
  }, [fetcher.state, fetcher.data, onChanged]);

  const pct = p.total > 0 ? Math.round((p.found / p.total) * 100) : 0;

  return (
    <div className="flex flex-col gap-5">
      {/* Submit a code */}
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-1 text-sm font-semibold text-foreground">Enter a code</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Found a code out in the wild? Drop it in.
        </p>
        <fetcher.Form method="post" action={submitAction} className="flex gap-2">
          <input
            name="code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. MARLIN"
            autoComplete="off"
            disabled={!active}
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent-coral focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={busy || !code.trim() || !active}
            className={buttonClasses("primary", "md")}
          >
            {busy ? "Checking…" : "Submit"}
          </button>
        </fetcher.Form>
        {fetcher.data?.message &&
          (fetcher.data.ok ? (
            <p className="mt-3 flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-800">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {fetcher.data.message}
            </p>
          ) : (
            <p className="mt-2 text-sm text-destructive">{fetcher.data.message}</p>
          ))}
      </section>

      {/* Progress */}
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-foreground">Your progress</h2>
          {p.complete ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-accent-coral/10 px-2.5 py-1 text-xs font-medium text-accent-coral">
              <CheckCircle2 className="h-3.5 w-3.5" /> All found!
            </span>
          ) : (
            <span className="text-sm text-muted-foreground">
              {p.found} of {p.total} found
            </span>
          )}
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-accent-coral transition-all"
            style={{ width: `${pct}%` }}
          />
        </div>
        <ClueList
          clues={p.clues}
          submitAction={submitAction}
          onChanged={onChanged}
          active={active}
        />
        {p.instructionsUrl && (
          <a
            href={p.instructionsUrl}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-sm text-accent-coral hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Open the instructions
          </a>
        )}
      </section>

      {/* Leaderboard */}
      {board && board.rows.length > 0 && (
        <section className="rounded-xl border border-border bg-card p-5">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
            <Trophy className="h-4 w-4 text-accent-coral" /> Leaderboard
          </h2>
          <ol className="flex flex-col divide-y divide-border">
            {board.rows.map((r, i) => {
              const isMe = r.userId === currentUserId;
              return (
                <li
                  key={r.userId}
                  className={cn(
                    "flex items-center justify-between py-2 text-sm",
                    isMe && "font-semibold text-accent-coral",
                  )}
                >
                  <span className="flex items-center gap-3">
                    <span className="w-5 text-right tabular-nums text-muted-foreground">
                      {i + 1}
                    </span>
                    <span>
                      {nameByUserId[r.userId] ?? "Member"}
                      {isMe ? " (you)" : ""}
                    </span>
                  </span>
                  <span className="tabular-nums text-muted-foreground">
                    {r.found}/{board.total} · {r.points} pts
                  </span>
                </li>
              );
            })}
          </ol>
        </section>
      )}
    </div>
  );
}

// ─── Clue checklist: every clue, struck through once its code is entered ─────
// Shows labels and (per the hint policy) hints — never the code values, which
// members have to find out in the world.

function formatUnlock(ms: number): string {
  return new Date(ms).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function ClueList({
  clues,
  submitAction,
  onChanged,
  active,
}: {
  clues: HuntClue[];
  submitAction: string;
  onChanged?: () => void;
  active: boolean;
}) {
  if (!clues.length) return null;
  return (
    <ul className="mt-4 flex flex-col divide-y divide-border border-t border-border">
      {clues.map((c) => (
        <ClueRow
          key={c.id}
          clue={c}
          submitAction={submitAction}
          onChanged={onChanged}
          active={active}
        />
      ))}
    </ul>
  );
}

function ClueRow({
  clue,
  submitAction,
  onChanged,
  active,
}: {
  clue: HuntClue;
  submitAction: string;
  onChanged?: () => void;
  active: boolean;
}) {
  const fetcher = useFetcher<{ ok?: boolean; message?: string; data?: { hint?: string } }>();
  const [open, setOpen] = useState(false);
  const busy = fetcher.state !== "idle";

  // Available when the policy already permits it (free / delay-unlocked /
  // previously revealed) or when this reveal just succeeded.
  const text = clue.hint ?? (fetcher.data?.ok ? fetcher.data.data?.hint ?? null : null);

  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) {
      setOpen(true);
      onChanged?.();
    }
  }, [fetcher.state, fetcher.data, onChanged]);

  return (
    <li className="py-2 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          {clue.found ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-accent-coral" />
          ) : (
            <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          )}
          <span
            className={cn(
              "truncate font-medium text-foreground",
              clue.found && "text-muted-foreground line-through",
            )}
          >
            {clue.label}
          </span>
        </span>
        {clue.found ? null : text ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="shrink-0 text-xs font-medium text-accent-coral hover:underline"
          >
            {open ? "Hide hint" : "Show hint"}
          </button>
        ) : clue.unlocksAt != null ? (
          <span className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
            <Lock className="h-3 w-3" /> Unlocks {formatUnlock(clue.unlocksAt)}
          </span>
        ) : clue.cost != null ? (
          <fetcher.Form method="post" action={submitAction} className="shrink-0">
            <input type="hidden" name="reveal" value={clue.id} />
            <button
              type="submit"
              disabled={busy || !active}
              className="text-xs font-medium text-accent-coral hover:underline disabled:opacity-50"
            >
              {busy ? "Revealing…" : clue.cost > 0 ? `Reveal hint (−${clue.cost} pts)` : "Reveal hint"}
            </button>
          </fetcher.Form>
        ) : null}
      </div>
      {!clue.found && open && text && (
        <p className="mt-1 flex items-start gap-1.5 text-muted-foreground">
          <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent-coral" />
          {text}
        </p>
      )}
      {fetcher.data && !fetcher.data.ok && fetcher.data.message && (
        <p className="mt-1 text-xs text-destructive">{fetcher.data.message}</p>
      )}
    </li>
  );
}

// ─── Admin editor: the code list + leaderboard/instructions/hint settings ────

function coerceConfig(value: unknown): HuntConfig {
  const v = (value ?? {}) as Partial<HuntConfig>;
  return {
    codes: Array.isArray(v.codes) ? v.codes : [],
    leaderboard: v.leaderboard ?? "public",
    instructionsUrl: v.instructionsUrl ?? "",
    hintPolicy: { ...DEFAULT_HINT_POLICY, ...(v.hintPolicy ?? {}) },
  };
}

function AdminEditor({ value, onChange }: AdminEditorProps) {
  const cfg = coerceConfig(value);
  const policy = cfg.hintPolicy ?? DEFAULT_HINT_POLICY;

  const update = (patch: Partial<HuntConfig>) => onChange({ ...cfg, ...patch });
  const updatePolicy = (patch: Partial<HuntHintPolicy>) =>
    update({ hintPolicy: { ...policy, ...patch } });
  const updateCode = (i: number, patch: Partial<HuntCode>) => {
    const codes = cfg.codes.map((c, idx) => (idx === i ? { ...c, ...patch } : c));
    update({ codes });
  };
  const addCode = () =>
    update({
      codes: [
        ...cfg.codes,
        { id: crypto.randomUUID(), value: "", label: "", points: 1, hint: "" },
      ],
    });
  const removeCode = (i: number) =>
    update({ codes: cfg.codes.filter((_, idx) => idx !== i) });

  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">Leaderboard</span>
          <select
            value={cfg.leaderboard}
            onChange={(e) => update({ leaderboard: e.target.value as HuntLeaderboard })}
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          >
            <option value="public">Public — everyone sees it</option>
            <option value="core">Core only</option>
            <option value="off">Off</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">Instructions doc URL</span>
          <input
            value={cfg.instructionsUrl ?? ""}
            onChange={(e) => update({ instructionsUrl: e.target.value })}
            placeholder="https://docs.google.com/…"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
          <span className="text-xs text-muted-foreground">
            Full link to the Drive clue doc. Members open it from the hunt (the
            “Open the instructions” link). Optional.
          </span>
        </label>
      </div>

      {/* Hint policy — configurable per activity */}
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4">
        <div className="flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-accent-coral" />
          <h3 className="text-sm font-semibold text-foreground">Hints</h3>
        </div>
        <p className="text-xs text-muted-foreground">
          Add an optional hint to any code below. This controls how members may
          reveal them.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">Reveal</span>
            <select
              value={policy.mode}
              onChange={(e) => updatePolicy({ mode: e.target.value as HuntHintMode })}
              className="rounded-md border border-border bg-card px-3 py-2 text-sm"
            >
              <option value="free">Free — reveal anytime</option>
              <option value="points">Costs points</option>
              <option value="delay">Unlock after a delay</option>
            </select>
          </label>
          {policy.mode === "points" && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">Points per hint</span>
              <input
                type="number"
                min={0}
                value={policy.penalty}
                onChange={(e) => updatePolicy({ penalty: Number(e.target.value) || 0 })}
                className="rounded-md border border-border bg-card px-3 py-2 text-sm"
              />
            </label>
          )}
          {policy.mode === "delay" && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">Unlock after (minutes)</span>
              <input
                type="number"
                min={0}
                value={policy.delayMinutes}
                onChange={(e) => updatePolicy({ delayMinutes: Number(e.target.value) || 0 })}
                className="rounded-md border border-border bg-card px-3 py-2 text-sm"
              />
              <span className="text-xs text-muted-foreground">
                Minutes after the activity’s start time.
              </span>
            </label>
          )}
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">
            Codes ({cfg.codes.length})
          </h3>
          <button type="button" onClick={addCode} className={buttonClasses("secondary", "sm")}>
            <Plus className="h-3.5 w-3.5" /> Add code
          </button>
        </div>
        {cfg.codes.length === 0 ? (
          <p className="rounded-md border border-dashed border-border px-3 py-4 text-center text-xs text-muted-foreground">
            No codes yet. Add one for each thing to find.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {cfg.codes.map((c, i) => (
              <div
                key={c.id}
                className="flex flex-col gap-2 rounded-md border border-border bg-background p-2"
              >
                <div className="grid grid-cols-[1fr_1fr_4rem_auto] items-end gap-2">
                  <Field label="Code">
                    <input
                      value={c.value}
                      onChange={(e) => updateCode(i, { value: e.target.value })}
                      placeholder="MARLIN"
                      className="w-full rounded border border-border bg-card px-2 py-1.5 text-sm"
                    />
                  </Field>
                  <Field label="Label">
                    <input
                      value={c.label}
                      onChange={(e) => updateCode(i, { label: e.target.value })}
                      placeholder="Projects clue"
                      className="w-full rounded border border-border bg-card px-2 py-1.5 text-sm"
                    />
                  </Field>
                  <Field label="Points">
                    <input
                      type="number"
                      min={0}
                      value={c.points}
                      onChange={(e) => updateCode(i, { points: Number(e.target.value) || 0 })}
                      className="w-full rounded border border-border bg-card px-2 py-1.5 text-sm"
                    />
                  </Field>
                  <button
                    type="button"
                    onClick={() => removeCode(i)}
                    aria-label="Remove code"
                    className={buttonClasses("ghost", "sm")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
                <Field label="Hint (optional)">
                  <input
                    value={c.hint ?? ""}
                    onChange={(e) => updateCode(i, { hint: e.target.value })}
                    placeholder="Where should they look? e.g. “Check a project’s Overview tab.”"
                    className="w-full rounded border border-border bg-card px-2 py-1.5 text-sm"
                  />
                </Field>
              </div>
            ))}
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Members can enter any of these codes from the activity modal on any
          page — nothing is tied to a particular part of the site. They see the{" "}
          <strong>Label</strong> (never the code) in their clue checklist, struck
          through once they’ve entered it.
        </p>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

export const scavengerHuntClient: MechanicClient = {
  kind: "scavenger_hunt",
  Surface,
  AdminEditor,
  defaultConfig: (): HuntConfig => ({
    codes: [],
    leaderboard: "public",
    hintPolicy: DEFAULT_HINT_POLICY,
  }),
  bannerCta: "Find the codes →",
};
