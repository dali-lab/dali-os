// Scavenger-hunt mechanic — client half (specs/activities.md §8): the on-page
// clue Overlay, the Surface page (submit + progress + leaderboard), and the
// admin config editor (the code list). Client-safe; no server imports.

import { useEffect, useState, type ReactNode } from "react";
import { useFetcher } from "react-router";
import { CheckCircle2, ExternalLink, Plus, Search, Trash2, Trophy } from "lucide-react";
import { cn } from "~/lib/cn";
import { buttonClasses } from "~/components/ui/Button";
import type { HuntCode, HuntConfig, HuntLeaderboard } from "~/lib/activities";
import type {
  AdminEditorProps,
  MechanicClient,
  OverlayProps,
  SurfaceProps,
} from "./registry";

type OverlayData = { codes: { id: string; value: string; label: string }[] } | null;

type HuntProgress = {
  total: number;
  found: number;
  complete: boolean;
  foundCodeIds: string[];
  instructionsUrl: string | null;
};

type HuntResultRow = { userId: string; points: number; found: number; lastAt: number };
type HuntResults = { visibility: HuntLeaderboard; total: number; rows: HuntResultRow[] } | null;

// ─── Overlay: the codes hidden on the current route ──────────────────────────

function Overlay({ overlay }: OverlayProps) {
  const data = overlay as OverlayData;
  if (!data || !data.codes.length) return null;
  return (
    <div className="fixed bottom-4 left-4 z-40 flex max-w-[18rem] flex-col gap-2">
      {data.codes.map((c) => (
        <div
          key={c.id}
          className="flex items-center gap-2 rounded-full border border-border bg-card/95 px-3 py-1.5 text-xs shadow-lg backdrop-blur"
          title={c.label || "You found a clue"}
        >
          <Search className="h-3.5 w-3.5 shrink-0 text-accent-coral" />
          <span className="text-muted-foreground">
            {c.label ? `${c.label}:` : "Clue:"}
          </span>
          <code className="truncate font-semibold text-foreground">{c.value}</code>
        </div>
      ))}
    </div>
  );
}

// ─── Surface: the /activities/:id page for this hunt ─────────────────────────

function Surface({ progress, results, currentUserId, nameByUserId }: SurfaceProps) {
  const p = progress as HuntProgress;
  const board = results as HuntResults;
  const fetcher = useFetcher<{ ok?: boolean; message?: string }>();
  const [code, setCode] = useState("");
  const busy = fetcher.state !== "idle";

  // Clear the field after a successful, non-duplicate find.
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) setCode("");
  }, [fetcher.state, fetcher.data]);

  const pct = p.total > 0 ? Math.round((p.found / p.total) * 100) : 0;

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
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

      {/* Submit a code */}
      <section className="rounded-xl border border-border bg-card p-5">
        <h2 className="mb-1 text-sm font-semibold text-foreground">Enter a code</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Found a code out in the wild? Drop it in.
        </p>
        <fetcher.Form method="post" className="flex gap-2">
          <input
            name="code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. MARLIN"
            autoComplete="off"
            className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:border-accent-coral focus:outline-none"
          />
          <button
            type="submit"
            disabled={busy || !code.trim()}
            className={buttonClasses("primary", "md")}
          >
            {busy ? "Checking…" : "Submit"}
          </button>
        </fetcher.Form>
        {fetcher.data?.message && (
          <p
            className={cn(
              "mt-2 text-sm",
              fetcher.data.ok ? "text-accent-coral" : "text-destructive",
            )}
          >
            {fetcher.data.message}
          </p>
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

// ─── Admin editor: the code list + leaderboard/instructions settings ─────────

function coerceConfig(value: unknown): HuntConfig {
  const v = (value ?? {}) as Partial<HuntConfig>;
  return {
    codes: Array.isArray(v.codes) ? v.codes : [],
    leaderboard: v.leaderboard ?? "public",
    instructionsUrl: v.instructionsUrl ?? "",
  };
}

function AdminEditor({ value, onChange }: AdminEditorProps) {
  const cfg = coerceConfig(value);

  const update = (patch: Partial<HuntConfig>) => onChange({ ...cfg, ...patch });
  const updateCode = (i: number, patch: Partial<HuntCode>) => {
    const codes = cfg.codes.map((c, idx) => (idx === i ? { ...c, ...patch } : c));
    update({ codes });
  };
  const addCode = () =>
    update({
      codes: [
        ...cfg.codes,
        { id: crypto.randomUUID(), value: "", label: "", location: "", points: 1 },
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
            placeholder="https://… (optional Drive clue doc)"
            className="rounded-md border border-border bg-background px-3 py-2 text-sm"
          />
        </label>
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
                className="grid grid-cols-[1fr_1fr_1fr_4rem_auto] items-end gap-2 rounded-md border border-border bg-background p-2"
              >
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
                <Field label="Route">
                  <input
                    value={c.location}
                    onChange={(e) => updateCode(i, { location: e.target.value })}
                    placeholder="/projects"
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
            ))}
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Each code shows as a clue on its route while the hunt is live. Leave the
          route blank to keep a code off-site (clued only by the doc).
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
  Overlay,
  Surface,
  AdminEditor,
  defaultConfig: (): HuntConfig => ({ codes: [], leaderboard: "public" }),
  bannerCta: "Find the codes →",
};
