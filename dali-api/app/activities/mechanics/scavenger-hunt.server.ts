// Scavenger-hunt mechanic — server half (specs/activities.md §8). Validates the
// hunt config, filters codes to the current route for the overlay, records a
// dedup'd ActivityEvent when a member submits a correct code, and derives
// progress + the leaderboard from the event stream.

import { z } from "zod";
import { prisma } from "~/lib/db";
import type { Activity } from "~/generated/prisma/client";
import type { HuntConfig } from "~/lib/activities";
import type { MechanicServer } from "./registry.server";

const HuntCodeSchema = z.object({
  id: z.string().min(1),
  value: z.string().min(1).max(120),
  label: z.string().max(200).default(""),
  location: z.string().max(300).default(""),
  points: z.number().int().min(0).max(1000).default(1),
});

const HuntConfigSchema = z.object({
  codes: z.array(HuntCodeSchema).max(200).default([]),
  leaderboard: z.enum(["public", "core", "off"]).default("public"),
  instructionsUrl: z.string().max(2000).optional(),
});

function readConfig(activity: Activity): HuntConfig {
  const parsed = HuntConfigSchema.safeParse(activity.config);
  return parsed.success ? parsed.data : { codes: [], leaderboard: "public" };
}

const norm = (s: string) => s.trim().toLowerCase();

export const scavengerHuntServer: MechanicServer = {
  kind: "scavenger_hunt",

  parseConfig(input) {
    return HuntConfigSchema.parse(input);
  },

  overlayPayload(activity, pathname) {
    const cfg = readConfig(activity);
    const codes = cfg.codes
      .filter((c) => c.location && c.location === pathname)
      .map((c) => ({ id: c.id, value: c.value, label: c.label }));
    return codes.length ? { codes } : null;
  },

  async onAction({ activity, userId, input }) {
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

  summarize({ activity, viewerIsCore, userEvents, allEvents }) {
    const cfg = readConfig(activity);
    const total = cfg.codes.length;

    const foundIds = new Set(
      userEvents.filter((e) => e.type === "code_found").map((e) => e.refId),
    );
    const progress = {
      total,
      found: foundIds.size,
      complete: total > 0 && foundIds.size >= total,
      foundCodeIds: [...foundIds],
      // Safe to send: just the clue-doc link, not any code values.
      instructionsUrl: cfg.instructionsUrl ?? null,
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
      for (const e of allEvents) {
        if (e.type !== "code_found") continue;
        const row =
          byUser.get(e.userId) ??
          { userId: e.userId, points: 0, found: 0, lastAt: 0 };
        row.points += e.points;
        row.found += 1;
        row.lastAt = Math.max(row.lastAt, new Date(e.createdAt).getTime());
        byUser.set(e.userId, row);
      }
      const rows = [...byUser.values()].sort(
        (a, b) => b.points - a.points || b.found - a.found || a.lastAt - b.lastAt,
      );
      results = { visibility: cfg.leaderboard, total, rows };
    }

    return { progress, results };
  },
};
