import { prisma } from "~/lib/db.server";
import {
  QUEST_FIELDS,
  isQuestFieldKey,
  nextQuestField,
  renderQuestion,
  splitAnswerList,
  type ListQuestKey,
  type QuestField,
  type QuestFieldKey,
  type QuestProfile,
  type QuestionContext,
} from "~/alumni/lib/quest";
import {
  questProgress,
  loadQuestState,
  confirmQuestField,
  addQuestWorkExperience,
  markAlumniOnboarded,
  setPreferredEmail,
} from "~/alumni/lib/alumni-game.server";
import { saveWorkSlot } from "~/alumni/lib/alumni-onboarding.server";
import { openToPatch, type OpenToChoices } from "~/members/lib/open-to";
import { reportHistoryCorrection } from "~/alumni/lib/alumni-history.server";
import { BadRequestError } from "~/lib/http-error";
import { generateShortText, isAiEnabled, stripJsonFences } from "~/lib/ai.server";
import { recordTokenUsage } from "~/lib/ai-usage.server";
import { claimAiQuota } from "~/lib/ai-quota.server";
import { checkRateLimit } from "~/lib/rate-limit";
import { updateProfileFields, ProfileConflictError } from "~/members/lib/profile-update.server";

const MAX_ANSWER_LENGTH = 300;

const GREETING = "so glad we're catching up!  let's get your profile filled in";

const TIM_SYSTEM = `You are Tim, the warm, playful director of DALI Lab, texting a lab alum inside a retro pixel game. You are filling in their alumni profile one question at a time.
Voice, match it exactly: lowercase, brief, enthusiastic and kind; exclamation marks, sometimes doubled; little fillers like "haha", "aah", "super!", "nice!"; never corporate, never emojis.
You receive the profile fields with their kind and current value, their name and emails on file, the question that was just asked, and the alum's latest message.
Decide which field their message answers: usually the asked one, but a DIFFERENT field when they are clearly correcting or updating an earlier answer (like "actually i'm based in Seattle now"). If the message answers no field at all (small talk, a question), use null.
EVALUATE every answer before saving. Save only a genuine, plausible answer to the question. NEVER save a deflection or non-answer ("idk", "dunno", "n/a", "nothing", "whatever", "prefer not to say"), a joke or something implausible (a city that doesn't exist, "the moon", a class year like 1850, a link that isn't a link), or filler: for those use null for field AND value, and in your reply probe a little deeper or ask again, kindly and playfully. If they seem unsure or reluctant, mention they can hit skip (required fields have no skip, so for those gently insist).
Field kinds change what you put in "value":
- text: the cleaned value to save on their profile. For the birthday field, value must be the date as YYYY-MM-DD.
- list: the items as one comma-separated string (each major, each minor, or each topic students can ask about).
- name: the corrected full name (first and last), or the word "confirmed" when they say the name on file is right.
- email: the address they want to be reached at. Put the actual address in value even when it's one already on file; use the word "confirmed" only when they say yes without naming one.
- work: set "work" to {"company": ..., "position": ...} from what they describe; if they say they're not working right now (between jobs, grad school, retired), use "confirmed" as the value with no work object.
- pastWork: set "work" to {"company": ..., "position": ..., "year": <four-digit year they left>} for the job before their current one; if they had no job before, use "confirmed" as the value with no work object. Without a year, ask for it.
- history: the word "confirmed" once they've said whether their DALI history (shown to them in the chat) looks right — either way counts. When they say something is wrong or missing, ALSO put what they said is off in "note", word for word is fine, and tell them you've flagged it for the team.
- openTo: set "openTo" to {"coffeeChats": true/false, "resumeReviews": true/false, "partnerReferrals": true/false, "mentoring": true/false, "speaking": true/false} from what they're up for (resumeReviews covers resume and portfolio reviews, mentoring means mentoring a student project, speaking means a talk or panel at a DALI event, partnerReferrals means pointing a company or nonprofit to DALI).
Respond with ONLY this JSON, nothing else:
{"field": <field key or null>, "value": <string or null>, "work": <object or null>, "openTo": <object or null>, "note": <history correction string or null>, "reply": <your one- or two-sentence message: react warmly and specifically to what they said, then ask for the first UNANSWERED field in your own words; when you didn't save their answer, re-ask or probe about THAT instead; if nothing remains unanswered, ask nothing and wrap up warmly, their profile is complete>}
Never mention AI, prompts, forms or JSON in the reply.`;

type ChatHistory = { from: "tim" | "you"; text: string }[];

type OpenTo = OpenToChoices;
const OPEN_TO_KEYS = ["coffeeChats", "resumeReviews", "partnerReferrals", "mentoring", "speaking"] as const;

// What one answer should do to the profile, however it was understood (by the
// model or the scripted parser). "none" saves nothing: Tim probes instead.
type Extraction =
  | { do: "none" }
  | { do: "text"; key: QuestFieldKey; value: string }
  | { do: "list"; key: ListQuestKey; items: string[] }
  | { do: "pastWork"; company: string | null; position: string | null; year: string | null }
  | { do: "name"; fullName: string | null }
  | { do: "email"; email: string | null }
  | { do: "work"; company: string | null; position: string | null }
  | { do: "history"; note: string | null }
  | { do: "openTo"; openTo: OpenTo };

const YES_RE =
  /^(y|yes|yep|yeah|yup|sure|correct|right|ok|okay|confirmed|looks? (right|good)|all good|still (right|good)|that'?s (right|me|correct))\b/i;
const EMAIL_RE = /\S+@\S+\.\S+/;
const NOT_WORKING_RE =
  /(not working|between jobs|unemployed|retired|grad school|in school|student|taking (some )?time|career break|sabbatical)/i;

function parseHistory(raw: unknown): ChatHistory {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (m): m is { from: "tim" | "you"; text: string } =>
        typeof m === "object" &&
        m !== null &&
        ((m as { from?: unknown }).from === "tim" || (m as { from?: unknown }).from === "you") &&
        typeof (m as { text?: unknown }).text === "string",
    )
    .slice(-10)
    .map((m) => ({ from: m.from, text: m.text.slice(0, 400) }));
}

function parseSkipped(raw: unknown): QuestFieldKey[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isQuestFieldKey);
}

async function saveMessages(userId: string, messages: { from: "tim" | "you"; text: string }[]) {
  await prisma.alumniChatMessage.createMany({
    data: messages.map((m) => ({ userId, from: m.from, text: m.text })),
  });
}

function allOpenTo(on: boolean): OpenTo {
  return Object.fromEntries(OPEN_TO_KEYS.map((k) => [k, on])) as OpenTo;
}

function parseOpenTo(text: string): OpenTo | null {
  const t = text.toLowerCase();
  const picked: OpenTo = {
    coffeeChats: /coffee|chat/.test(t),
    resumeReviews: /resume|cv\b|portfolio|review/.test(t),
    partnerReferrals: /partner|refer|company|nonprofit/.test(t),
    mentoring: /mentor/.test(t),
    speaking: /speak|talk|panel/.test(t),
  };
  if (OPEN_TO_KEYS.some((k) => picked[k])) return picked;
  if (/\b(all|any|everything|any of them|all of them)\b/.test(t) || YES_RE.test(text)) {
    return allOpenTo(true);
  }
  if (/\b(none|nope|nah|no thanks|not right now|no)\b/.test(t)) return allOpenTo(false);
  return null;
}

function parsePastWork(text: string): { company: string; position: string; year: string | null } | null {
  const yearMatch = text.match(/\b(19|20)\d{2}\b/);
  const year = yearMatch ? yearMatch[0] : null;
  const rest = text.replace(/[,(]?\s*(?:left in |until |till )?\b(19|20)\d{2}\b\)?/, "").trim();
  const work = parseWork(rest);
  return work ? { ...work, year } : null;
}

function parseWork(text: string): { company: string; position: string } | null {
  const m = text.match(/^(.{2,80}?)\s+(?:at|@)\s+(.{2,80})$/i);
  if (!m) return null;
  return { position: m[1].trim(), company: m[2].trim() };
}

// How the scripted path (no model available) understands an answer to the
// asked field. Returns null when it can't: Tim re-asks instead of guessing.
function scriptedExtraction(asked: QuestField, value: string): Extraction | null {
  switch (asked.kind) {
    case "name": {
      if (YES_RE.test(value)) return { do: "name", fullName: null };
      const words = value.split(/\s+/).filter(Boolean);
      if (words.length >= 2 && !/[@\d]/.test(value)) return { do: "name", fullName: value };
      return null;
    }
    case "email": {
      const match = value.match(EMAIL_RE);
      if (match) return { do: "email", email: match[0] };
      if (YES_RE.test(value)) return { do: "email", email: null };
      return null;
    }
    case "work": {
      const parsed = parseWork(value);
      if (parsed) return { do: "work", ...parsed };
      if (NOT_WORKING_RE.test(value)) return { do: "work", company: null, position: null };
      return null;
    }
    case "pastWork": {
      const parsed = parsePastWork(value);
      if (parsed?.year) return { do: "pastWork", ...parsed };
      if (/^(no|nope|none|nah)\b/i.test(value) || NOT_WORKING_RE.test(value)) {
        return { do: "pastWork", company: null, position: null, year: null };
      }
      return null;
    }
    case "history":
      return { do: "history", note: YES_RE.test(value) ? null : value };
    case "openTo": {
      const openTo = parseOpenTo(value);
      return openTo ? { do: "openTo", openTo } : null;
    }
    case "list": {
      const items = splitAnswerList(value);
      return items.length > 0 ? { do: "list", key: asked.key as ListQuestKey, items } : null;
    }
    default:
      return { do: "text", key: asked.key, value };
  }
}

// Birthday answers arrive as prose ("june 5 2001"); profile writes want
// YYYY-MM-DD. Null = unparseable, the route probes instead of saving.
function parseBirthdayText(value: string): string | null {
  const iso = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return value.trim();
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  if (y < 1900 || y > 2100) return null;
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function scriptedProbe(asked: QuestField): string {
  switch (asked.kind) {
    case "name":
      return "haha sorry, I need your full name for the profile!  first and last";
    case "email":
      return "hmm I didn't catch an email in there — can you paste the address?";
    case "work":
      return "haha gotcha — try something like 'designer at google', or tell me if you're between things!";
    case "pastWork":
      return "haha gotcha, try something like 'design intern at etsy, 2023', or tell me if there wasn't one!";
    case "openTo":
      return "which ones are you up for?  coffee chats, resume or portfolio reviews, mentoring, speaking, partner referrals.  any, all, or none!";
    default:
      return `hmm I didn't quite catch that!  ${asked.question}`;
  }
}

// Applies one extraction. Returns the key that now counts as filled, or null.
async function applyExtraction(
  userId: string,
  ex: Extraction,
  request: Request,
  outcome: { notice?: string },
): Promise<QuestFieldKey | null> {
  switch (ex.do) {
    case "none":
      return null;
    case "text": {
      let value = ex.value;
      if (ex.key === "birthday") {
        const parsed = parseBirthdayText(value);
        if (!parsed) return null;
        value = parsed;
      }
      await updateProfileFields(userId, { [ex.key]: value }, { allowNetId: false });
      return ex.key;
    }
    case "list":
      await updateProfileFields(userId, { [ex.key]: ex.items }, { allowNetId: false });
      return ex.key;
    case "pastWork": {
      if (ex.company && ex.position) {
        await saveWorkSlot(userId, {
          slot: "before",
          id: "",
          company: ex.company,
          position: ex.position,
          year: ex.year ?? "",
        });
      }
      await confirmQuestField(userId, "pastWork");
      return "pastWork";
    }
    case "name": {
      if (ex.fullName) {
        const words = ex.fullName.trim().split(/\s+/);
        await updateProfileFields(
          userId,
          { firstName: words[0], lastName: words.slice(1).join(" ") },
          { allowNetId: false },
        );
      }
      await confirmQuestField(userId, "name");
      return "name";
    }
    case "email": {
      if (ex.email) {
        if ((await setPreferredEmail(userId, ex.email, request)) === "code_sent") {
          outcome.notice = `a code is on its way to ${ex.email.trim().toLowerCase()}, so check your inbox!  enter it under Settings, then Security to make it your contact email.`;
        }
      }
      await confirmQuestField(userId, "email");
      return "email";
    }
    case "work": {
      if (ex.company && ex.position) {
        await addQuestWorkExperience(userId, ex.company, ex.position);
      }
      await confirmQuestField(userId, "work");
      return "work";
    }
    case "history":
      if (ex.note) await reportHistoryCorrection(userId, ex.note);
      await confirmQuestField(userId, "history");
      return "history";
    case "openTo": {
      await updateProfileFields(userId, { openTo: openToPatch(ex.openTo) }, { allowNetId: false });
      await confirmQuestField(userId, "openTo");
      return "openTo";
    }
  }
}

// Scripted reply: the asked field's done-line plus the next question, in one
// message, matching what Tim would have said before the model era.
function scriptedSay(
  asked: QuestField,
  profile: QuestProfile,
  ctx: QuestionContext,
  skipped: QuestFieldKey[],
  doneOverride?: string,
): string {
  const doneLine = doneOverride ?? asked.done;
  const next = nextQuestField(profile, skipped);
  if (next) return `${doneLine}  ${renderQuestion(next, ctx)}`;
  const done = QUEST_FIELDS.every((f) => {
    const v = profile[f.key];
    return typeof v === "string" && v.trim() !== "";
  });
  return done
    ? "that's a complete profile!  you're officially settled in, welcome back to the lab!!"
    : "that's all my questions for now!  you can finish the rest on your profile page anytime";
}

type Interpreted = { extraction: Extraction; reply: string } | null;

function modelExtraction(
  field: QuestFieldKey | null,
  value: string | null,
  work: { company?: unknown; position?: unknown; year?: unknown } | null,
  openTo: Partial<Record<keyof OpenTo, unknown>> | null,
  note: string | null,
  rawAnswer: string,
): Extraction {
  if (!field) return { do: "none" };
  const spec = QUEST_FIELDS.find((f) => f.key === field)!;
  const confirmed = value !== null && (value.toLowerCase() === "confirmed" || YES_RE.test(value));
  switch (spec.kind) {
    case "name":
      return { do: "name", fullName: confirmed || !value ? null : value };
    case "email":
      return { do: "email", email: value && EMAIL_RE.test(value) ? value : null };
    case "work": {
      if (
        work &&
        typeof work.company === "string" &&
        work.company.trim() !== "" &&
        typeof work.position === "string" &&
        work.position.trim() !== ""
      ) {
        return { do: "work", company: work.company.trim(), position: work.position.trim() };
      }
      return confirmed ? { do: "work", company: null, position: null } : { do: "none" };
    }
    case "pastWork": {
      const year =
        work && (typeof work.year === "string" || typeof work.year === "number") ? String(work.year) : null;
      if (
        work &&
        year &&
        typeof work.company === "string" &&
        work.company.trim() !== "" &&
        typeof work.position === "string" &&
        work.position.trim() !== ""
      ) {
        return { do: "pastWork", company: work.company.trim(), position: work.position.trim(), year };
      }
      return confirmed ? { do: "pastWork", company: null, position: null, year: null } : { do: "none" };
    }
    case "list": {
      const items = value ? splitAnswerList(value) : [];
      return items.length > 0 ? { do: "list", key: spec.key as ListQuestKey, items } : { do: "none" };
    }
    case "history":
      return { do: "history", note };
    case "openTo": {
      if (openTo && OPEN_TO_KEYS.every((k) => typeof openTo[k] === "boolean")) {
        return {
          do: "openTo",
          openTo: Object.fromEntries(OPEN_TO_KEYS.map((k) => [k, openTo[k] as boolean])) as OpenTo,
        };
      }
      const parsed = parseOpenTo(value ?? rawAnswer);
      return parsed ? { do: "openTo", openTo: parsed } : { do: "none" };
    }
    default:
      return value ? { do: "text", key: spec.key, value: value.slice(0, MAX_ANSWER_LENGTH) } : { do: "none" };
  }
}

// One model call interprets the message (which field it answers, if any) and
// writes Tim's reply. Any closed gate or failure returns null and the caller
// uses the scripted path.
async function interpret(opts: {
  request: Request;
  userId: string;
  firstName: string;
  asked: QuestField;
  value: string;
  profile: QuestProfile;
  ctx: QuestionContext;
  skipped: QuestFieldKey[];
  history: ChatHistory;
}): Promise<Interpreted> {
  if (!isAiEnabled()) return null;
  if (checkRateLimit(opts.request, { max: 20, windowMs: 60_000 }, `ai-alumni:${opts.userId}`)) {
    return null;
  }
  const quota = await claimAiQuota(opts.userId);
  if (!quota.ok) return null;
  const name = opts.firstName || "the alum";
  const fields = QUEST_FIELDS.map((f) => {
    const v = opts.profile[f.key];
    const state = typeof v === "string" && v.trim() ? v : "UNANSWERED";
    return `- ${f.key} ("${f.label}", kind ${f.kind}${f.required ? ", required" : ""}): ${state}`;
  }).join("\n");
  const transcript = opts.history
    .map((m) => `${m.from === "tim" ? "tim" : name}: ${m.text}`)
    .join("\n");
  const prompt = [
    `Chatting with ${name}.`,
    `Name on file: ${opts.ctx.fullName ?? "unknown"}`,
    `Emails on file: ${opts.ctx.emails?.join(", ") || "none"}`,
    `DALI history on file: ${opts.ctx.historyLines?.join("; ") || "nothing"}`,
    `Profile fields:\n${fields}`,
    transcript ? `Recent messages:\n${transcript}` : "This is the start of the conversation.",
    `Question just asked was about: ${opts.asked.key} ("${opts.asked.label}")`,
    `Their latest message: ${opts.value}`,
  ].join("\n\n");
  try {
    const result = await generateShortText({
      task: "alumniChat",
      system: TIM_SYSTEM,
      prompt,
      maxTokens: 500,
    });
    if (!result?.text) return null;
    await recordTokenUsage(opts.userId, quota.day, result.inputTokens, result.outputTokens);
    const parsed = JSON.parse(stripJsonFences(result.text)) as {
      field?: unknown;
      value?: unknown;
      work?: unknown;
      openTo?: unknown;
      note?: unknown;
      reply?: unknown;
    };
    if (typeof parsed.reply !== "string" || parsed.reply.trim() === "") return null;
    const field = isQuestFieldKey(parsed.field) ? parsed.field : null;
    const value =
      typeof parsed.value === "string" && parsed.value.trim() !== ""
        ? parsed.value.trim().slice(0, MAX_ANSWER_LENGTH)
        : null;
    const work =
      typeof parsed.work === "object" && parsed.work !== null
        ? (parsed.work as { company?: unknown; position?: unknown; year?: unknown })
        : null;
    const openTo =
      typeof parsed.openTo === "object" && parsed.openTo !== null
        ? (parsed.openTo as Partial<Record<keyof OpenTo, unknown>>)
        : null;
    const note =
      typeof parsed.note === "string" && parsed.note.trim() !== ""
        ? parsed.note.trim().slice(0, 1000)
        : null;
    return {
      extraction: modelExtraction(field, value, work, openTo, note, opts.value),
      reply: parsed.reply.trim().slice(0, 600),
    };
  } catch {
    return null;
  }
}


type ChatMessage = { from: "tim" | "you"; text: string };

export async function acceptQuest(userId: string) {
  const avatar = await prisma.pixelAvatar.findUnique({
    where: { userId },
    select: { userId: true },
  });
  if (!avatar) return null;
  await prisma.pixelAvatar.updateMany({
    where: { userId, questAcceptedAt: null },
    data: { questAcceptedAt: new Date() },
  });
  const { profile, ctx, percent } = await questProgress(userId);
  const first = nextQuestField(profile, []);
  const messages: ChatMessage[] = [
    { from: "tim", text: GREETING },
    ...(first ? [{ from: "tim" as const, text: renderQuestion(first, ctx) }] : []),
  ];
  await saveMessages(userId, messages);
  return { profile, percent, messages };
}

export async function answerQuest(opts: {
  request: Request;
  userId: string;
  firstName: string;
  field: QuestFieldKey;
  value: string;
  skipped: unknown;
  history: unknown;
}): Promise<
  | { ok: true; profile: QuestProfile; percent: number; say: string; savedField: QuestFieldKey | null }
  | { ok: false; error: string }
> {
  const { request, userId } = opts;
  const value = opts.value.trim().slice(0, MAX_ANSWER_LENGTH);
  if (value === "") return { ok: false, error: "that answer looks empty, try again?" };
  const asked = QUEST_FIELDS.find((f) => f.key === opts.field)!;
  const skipped = parseSkipped(opts.skipped);
  const history = parseHistory(opts.history);
  const state = await loadQuestState(userId);

  const interpreted = await interpret({
    request,
    userId,
    firstName: opts.firstName,
    asked,
    value,
    profile: state.profile,
    ctx: state.ctx,
    skipped,
    history,
  });

  const understood = interpreted ? interpreted.extraction : scriptedExtraction(asked, value);
  let savedField: QuestFieldKey | null = null;
  const outcome: { notice?: string } = {};
  try {
    savedField = await applyExtraction(userId, understood ?? { do: "none" }, request, outcome);
  } catch (e) {
    if (e instanceof BadRequestError || e instanceof ProfileConflictError) {
      return { ok: false, error: e.message };
    }
    throw e;
  }
  const { profile, ctx, percent } = await questProgress(userId);
  if (!nextQuestField(profile, skipped)) await markAlumniOnboarded(userId);
  const flagged =
    understood?.do === "history" && understood.note
      ? "got it, I've flagged that for the team to fix!"
      : undefined;
  const say = outcome.notice
    ? scriptedSay(asked, profile, ctx, skipped, outcome.notice)
    : (interpreted?.reply ??
      (savedField ? scriptedSay(asked, profile, ctx, skipped, flagged) : scriptedProbe(asked)));
  await saveMessages(userId, [
    { from: "you", text: value },
    { from: "tim", text: say },
  ]);
  return { ok: true, profile, percent, say, savedField };
}

export async function finishQuest(userId: string, skipped: unknown) {
  const { profile } = await loadQuestState(userId);
  if (nextQuestField(profile, parseSkipped(skipped))) return false;
  await markAlumniOnboarded(userId);
  return true;
}
