// Enhance's server-side verification pass (specs/meeting-notes-model.md §2):
// "prompt rules alone are not a guard." Pure and DB-free on purpose — the
// caller (api.ai.meeting-notes.enhance.ts) resolves the roster and transcript
// lines first, so this is unit-testable without mocking Prisma.
//
// NEVER log the plan's text or the transcript lines — only counts.

import type {
  EnhanceActionItem,
  EnhanceBlockOp,
  EnhancePlan,
  EnhanceVerified,
} from "~/components/meeting-recorder/enhance-plan";

export type VerifyTranscriptLine = { at: number; text: string; channel?: "mic" | "call" };
export type VerifyRosterUser = { userId: string; name: string };

const CITE_TOLERANCE_SECONDS = 2;
const CONTENT_WORD_RE = /[a-z']{4,}/g;
// How many lines on either side of a cited line count as "near" it when
// looking for the spoken owner's first name (fix for owners getting matched
// to the wrong roster member, specs/meeting-notes-model.md §6).
const OWNER_EVIDENCE_WINDOW = 2;

// Common 4+ letter words that carry no topical meaning — excluded so the
// content-word overlap check isn't satisfied by filler alone.
const STOPWORDS = new Set([
  "that",
  "this",
  "with",
  "from",
  "have",
  "were",
  "they",
  "there",
  "about",
  "which",
  "would",
  "could",
  "should",
  "into",
  "your",
  "their",
  "been",
  "when",
  "what",
  "than",
  "then",
  "also",
  "just",
  "only",
  "over",
  "some",
  "such",
  "will",
  "each",
  "these",
  "those",
  "where",
  "while",
  "after",
  "before",
  "between",
  "because",
  "through",
  "during",
  "under",
  "again",
  "both",
  "same",
  "other",
  "most",
  "very",
  "here",
]);

function contentWords(text: string): Set<string> {
  const words = text.toLowerCase().match(CONTENT_WORD_RE) ?? [];
  return new Set(words.filter((w) => !STOPWORDS.has(w)));
}

function hasOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const w of a) if (b.has(w)) return true;
  return false;
}

/** Drops cites that aren't within CITE_TOLERANCE_SECONDS of any transcript
 *  line; returns the surviving cites plus how many were dropped. */
function filterCites(
  cites: number[] | undefined,
  lines: VerifyTranscriptLine[],
): { cites: number[]; dropped: number; matchedLines: VerifyTranscriptLine[] } {
  const kept: number[] = [];
  const matchedLines: VerifyTranscriptLine[] = [];
  let dropped = 0;
  for (const cite of cites ?? []) {
    const match = lines.find((l) => Math.abs(l.at - cite) <= CITE_TOLERANCE_SECONDS);
    if (match) {
      kept.push(cite);
      matchedLines.push(match);
    } else {
      dropped++;
    }
  }
  return { cites: kept, dropped, matchedLines };
}

/**
 * Matches a model-provided owner name to a roster user id. Roster names are
 * fuller than what the model may echo back (spec example: "Ada L" for "Ada
 * Lovelace"), so an exact match is tried first, then first-name + initial.
 */
export function matchRosterOwner(ownerName: string, roster: VerifyRosterUser[]): string | null {
  const norm = ownerName.trim().toLowerCase();
  if (!norm) return null;

  const exact = roster.find((r) => r.name.trim().toLowerCase() === norm);
  if (exact) return exact.userId;

  const nameTokens = norm.split(/\s+/);
  const [first, second] = nameTokens;
  if (!first) return null;

  const loose = roster.find((r) => {
    const rTokens = r.name.trim().toLowerCase().split(/\s+/);
    if (rTokens[0] !== first) return false;
    if (!second) return true;
    const rSecond = rTokens[1] ?? "";
    return rSecond.startsWith(second) || second.startsWith(rSecond);
  });
  return loose?.userId ?? null;
}

/** Whether `firstName` appears in a cited line's own text or in the
 *  OWNER_EVIDENCE_WINDOW lines on either side of it, within `allLines`
 *  (reference equality — `matchedLines` entries come straight out of
 *  `allLines` via `filterCites`). */
function ownerNameHasEvidence(
  firstName: string,
  matchedLines: VerifyTranscriptLine[],
  allLines: VerifyTranscriptLine[],
): boolean {
  const needle = firstName.toLowerCase();
  if (!needle) return false;
  for (const line of matchedLines) {
    const idx = allLines.indexOf(line);
    const start = Math.max(0, idx - OWNER_EVIDENCE_WINDOW);
    const end = Math.min(allLines.length, idx + OWNER_EVIDENCE_WINDOW + 1);
    for (let i = start; i < end; i++) {
      if (allLines[i]!.text.toLowerCase().includes(needle)) return true;
    }
  }
  return false;
}

/**
 * Resolves an action item's owner name to a roster user id and requires
 * evidence beyond the name match itself (owners were getting substituted
 * with the wrong roster member, specs/meeting-notes-model.md §6): either the
 * owner's first name appears near one of the item's cited lines, or every
 * cited line is on the "mic" channel (the recorder's own mic) and the
 * matched user is the recorder. Without either, the match is dropped —
 * `ownerUserId` stays null but `ownerName` is kept for the "no match on the
 * roster" helper text.
 */
function verifyActionItem(
  item: EnhanceActionItem,
  lines: VerifyTranscriptLine[],
  roster: VerifyRosterUser[],
  recorderUserId: string | null,
): { item: EnhanceActionItem; droppedCites: number; unmatchedOwner: boolean } {
  const { cites, dropped, matchedLines } = filterCites(item.cites, lines);
  let ownerUserId: string | null = null;
  let unmatchedOwner = false;
  if (item.ownerName) {
    const candidate = matchRosterOwner(item.ownerName, roster);
    if (!candidate) {
      unmatchedOwner = true;
    } else {
      const firstName = item.ownerName.trim().split(/\s+/)[0] ?? "";
      const allMic = matchedLines.length > 0 && matchedLines.every((l) => l.channel === "mic");
      const hasEvidence =
        ownerNameHasEvidence(firstName, matchedLines, lines) || (allMic && candidate === recorderUserId);
      if (hasEvidence) {
        ownerUserId = candidate;
      } else {
        unmatchedOwner = true;
      }
    }
  }
  return {
    item: { ...item, cites, ownerUserId },
    droppedCites: dropped,
    unmatchedOwner,
  };
}

/**
 * Verifies a model-generated EnhancePlan against the real transcript and
 * roster: drops cites that don't land on a real line, drops inserted blocks
 * that end up with no surviving citation or no shared content word with what
 * they cite, and resolves owner names to roster user ids. Returns a new plan
 * safe to store and show — nothing past this point is trusted model output.
 */
export function verifyEnhancePlan(
  plan: EnhancePlan,
  lines: VerifyTranscriptLine[],
  roster: VerifyRosterUser[],
  recorderUserId: string | null = null,
): { plan: EnhancePlan; verified: EnhanceVerified } {
  let droppedCites = 0;
  let droppedBlocks = 0;
  let unmatchedOwners = 0;

  const blocks = plan.blocks.flatMap((block): EnhanceBlockOp[] => {
    if (block.op === "keep") return [block];

    if (block.op === "expand") {
      const { cites, dropped } = filterCites(block.cites, lines);
      droppedCites += dropped;
      return [{ ...block, cites }];
    }

    // op === "insert"
    const { cites, dropped, matchedLines } = filterCites(block.cites, lines);
    droppedCites += dropped;
    if (cites.length === 0) {
      droppedBlocks++;
      return [];
    }
    const insertWords = contentWords(block.text);
    const citedWords = new Set<string>();
    for (const line of matchedLines) for (const w of contentWords(line.text)) citedWords.add(w);
    if (!hasOverlap(insertWords, citedWords)) {
      droppedBlocks++;
      return [];
    }
    return [{ ...block, cites }];
  });

  const actionItems = plan.actionItems.map((item) => {
    const { item: verified, droppedCites: itemDropped, unmatchedOwner } = verifyActionItem(
      item,
      lines,
      roster,
      recorderUserId,
    );
    droppedCites += itemDropped;
    if (unmatchedOwner) unmatchedOwners++;
    return verified;
  });

  return {
    plan: { blocks, actionItems },
    verified: { droppedCites, droppedBlocks, unmatchedOwners },
  };
}
