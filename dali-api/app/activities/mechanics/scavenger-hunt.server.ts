// Scavenger-hunt mechanic — server half (specs/activities.md §8). Validates the
// hunt config, filters codes to the current route for the overlay, records a
// dedup'd ActivityEvent when a member submits a correct code or reveals a hint,
// and derives progress + the leaderboard from the event stream.

import { z } from "zod";
import { prisma } from "~/lib/db";
import type { Activity } from "~/generated/prisma/client";
import {
  DEFAULT_HINT_POLICY,
  normalizeRoute,
  resolveHintState,
  routesMatch,
  type HuntConfig,
  type HuntHintPolicy,
} from "~/lib/activities";
import type { ActionOutcome, MechanicServer } from "./registry.server";

const HuntCodeSchema = z.object({
  id: z.string().min(1),
  value: z.string().min(1).max(120),
  label: z.string().max(200).default(""),
  // Normalized on save so the stored route matches how the current path arrives
  // (leading slash, no trailing slash) — see normalizeRoute.
  location: z.string().max(300).default("").transform(normalizeRoute),
  points: z.number().int().min(0).max(1000).default(1),
  hint: z.string().max(500).default(""),
});

const HuntHintPolicySchema = z
  .object({
    mode: z.enum(["free", "points", "delay"]).default("free"),
    penalty: z.number().int().min(0).max(1000).default(0),
    delayMinutes: z.number().int().min(0).max(100_000).default(0),
  })
  .default(DEFAULT_HINT_POLICY);

const HuntConfigSchema = z.object({
  codes: z.array(HuntCodeSchema).max(200).default([]),
  leaderboard: z.enum(["public", "core", "off"]).default("public"),
  instructionsUrl: z.string().max(2000).optional(),
  hintPolicy: HuntHintPolicySchema,
});

function readConfig(activity: Activity): HuntConfig {
  const parsed = HuntConfigSchema.safeParse(activity.config);
  return parsed.success
    ? parsed.data
    : { codes: [], leaderboard: "public", hintPolicy: DEFAULT_HINT_POLICY };
}

const norm = (s: string) => s.trim().toLowerCase();

/** Distinct codes this member has found (dedup'd on refId). */
function countFound(userEvents: { type: string; refId: string }[]): number {
  return new Set(
    userEvents.filter((e) => e.type === "code_found").map((e) => e.refId),
  ).size;
}

// Reveal one code's hint, honoring the activity's hint policy. "free" always
// returns the text; "delay" gates on the unlock time; "points" records a
// (dedup'd) hint_revealed event carrying the negative point cost so the
// leaderboard reflects it, then returns the text.
async function revealHint(
  activity: Activity,
  userId: string,
  codeId: string,
): Promise<ActionOutcome> {
  const cfg = readConfig(activity);
  const code = cfg.codes.find((c) => c.id === codeId);
  if (!code || !code.hint) return { ok: false, message: "No hint for that clue." };
  const policy = cfg.hintPolicy ?? DEFAULT_HINT_POLICY;

  if (policy.mode === "delay") {
    const unlocksAt = new Date(activity.startsAt).getTime() + policy.delayMinutes * 60_000;
    if (Date.now() < unlocksAt) {
      return { ok: false, message: "This hint hasn't unlocked yet." };
    }
    return { ok: true, data: { hint: code.hint } };
  }

  if (policy.mode === "points") {
    const already = await prisma.activityEvent.findUnique({
      where: {
        activityId_userId_type_refId: {
          activityId: activity.id,
          userId,
          type: "hint_revealed",
          refId: code.id,
        },
      },
      select: { id: true },
    });
    if (!already) {
      await prisma.activityEvent.create({
        data: {
          activityId: activity.id,
          userId,
          type: "hint_revealed",
          refId: code.id,
          points: -policy.penalty,
        },
      });
    }
    return { ok: true, data: { hint: code.hint } };
  }

  return { ok: true, data: { hint: code.hint } }; // free
}

export const scavengerHuntServer: MechanicServer = {
  kind: "scavenger_hunt",

  parseConfig(input) {
    return HuntConfigSchema.parse(input);
  },

  overlayPayload(activity, pathname) {
    const cfg = readConfig(activity);
    const codes = cfg.codes
      .filter((c) => routesMatch(c.location, pathname))
      .map((c) => ({ id: c.id, value: c.value, label: c.label }));
    return codes.length ? { codes } : null;
  },

  async onAction({ activity, userId, input }) {
    // Two actions share this handler: revealing a hint and submitting a code.
    if (typeof input.reveal === "string" && input.reveal.trim()) {
      return revealHint(activity, userId, input.reveal.trim());
    }

    const code = typeof input.code === "string" ? input.code : "";
    if (!code.trim()) return { ok: false, message: "Enter a code." };

    const cfg = readConfig(activity);
    const match = cfg.codes.find((c) => norm(c.value) === norm(code));
    if (!match) {
      return { ok: false, message: "That code isn't right — keep looking!" };
    }

    // Dedup on the (activityId, userId, type, refId) unique index: a re-submit
    // of an already-found code is a friendly no-op, not an error or a dupe.
    const existing = await prisma.activityEvent.findUnique({
      where: {
        activityId_userId_type_refId: {
          activityId: activity.id,
          userId,
          type: "code_found",
          refId: match.id,
        },
      },
      select: { id: true },
    });
    if (existing) {
      return { ok: true, message: "You already found this one.", data: { already: true } };
    }

    await prisma.activityEvent.create({
      data: {
        activityId: activity.id,
        userId,
        type: "code_found",
        refId: match.id,
        points: match.points,
      },
    });
    return {
      ok: true,
      message: `Found: ${match.label || match.value}`,
      data: { points: match.points },
    };
  },

  bannerSummary(activity, userEvents) {
    const total = readConfig(activity).codes.length;
    if (total === 0) return null;
    return `${countFound(userEvents)}/${total} found`;
  },

  summarize({ activity, viewerIsCore, userEvents, allEvents }) {
    const cfg = readConfig(activity);
    const policy = cfg.hintPolicy ?? DEFAULT_HINT_POLICY;
    const total = cfg.codes.length;
    const nowMs = Date.now();
    const startsAtMs = new Date(activity.startsAt).getTime();

    const foundIds = new Set(
      userEvents.filter((e) => e.type === "code_found").map((e) => e.refId),
    );
    const revealedIds = new Set(
      userEvents.filter((e) => e.type === "hint_revealed").map((e) => e.refId),
    );

    // Hints for codes that carry one and aren't found yet. The text is included
    // only when the policy permits showing it now, so points/delay hold on the
    // server — the client can't reveal early by reading the payload.
    const hints = cfg.codes
      .filter((c) => c.hint && !foundIds.has(c.id))
      .map((c) => {
        const st = resolveHintState(policy, {
          revealed: revealedIds.has(c.id),
          nowMs,
          startsAtMs,
        });
        return {
          id: c.id,
          label: c.label,
          hint: st.show ? c.hint ?? "" : null,
          cost: st.cost,
          unlocksAt: st.unlocksAt,
        };
      });

    const progress = {
      total,
      found: foundIds.size,
      complete: total > 0 && foundIds.size >= total,
      foundCodeIds: [...foundIds],
      // Safe to send: just the clue-doc link, not any code values.
      instructionsUrl: cfg.instructionsUrl ?? null,
      hintMode: policy.mode,
      hints,
    };

    // Leaderboard visibility is enforced here: "core" hides it from non-Core
    // viewers, "off" hides it entirely.
    let results: unknown = null;
    const visible =
      cfg.leaderboard === "public" || (cfg.leaderboard === "core" && viewerIsCore);
    if (visible) {
      const byUser = new Map<
        string,
        { userId: string; points: number; found: number; lastAt: number }
      >();
      const rowFor = (uid: string) => {
        let row = byUser.get(uid);
        if (!row) {
          row = { userId: uid, points: 0, found: 0, lastAt: 0 };
          byUser.set(uid, row);
        }
        return row;
      };
      for (const e of allEvents) {
        if (e.type === "code_found") {
          const row = rowFor(e.userId);
          row.points += e.points;
          row.found += 1;
          row.lastAt = Math.max(row.lastAt, new Date(e.createdAt).getTime());
        } else if (e.type === "hint_revealed") {
          // Penalty (negative or zero); doesn't count as a find.
          rowFor(e.userId).points += e.points;
        }
      }
      // Only rank members who've actually found something — a hint-only row
      // (negative points, zero finds) shouldn't appear on the board.
      const rows = [...byUser.values()]
        .filter((r) => r.found > 0)
        .sort((a, b) => b.points - a.points || b.found - a.found || a.lastAt - b.lastAt);
      results = { visibility: cfg.leaderboard, total, rows };
    }

    return { progress, results };
  },
};
