import type { Route } from "./+types/api.alumni-game.quest";
import { prisma } from "~/lib/db.server";
import { requireMemberSession } from "~/lib/auth";
import {
  QUEST_FIELDS,
  isQuestFieldKey,
  nextQuestField,
  renderQuestion,
  type QuestField,
  type QuestFieldKey,
  type QuestProfile,
  type QuestionContext,
} from "~/components/alumni-game/quest";
import {
  questProgress,
  loadQuestState,
  confirmQuestField,
  addQuestWorkExperience,
  setOpenTo,
} from "~/lib/alumni-game.server";
import { generateShortText, isAiEnabled, stripJsonFences } from "~/lib/ai.server";
import { recordTokenUsage } from "~/lib/ai-usage.server";
import { claimAiQuota } from "~/lib/ai-quota.server";
import { checkRateLimit } from "~/lib/rate-limit";
import {
  updateProfileFields,
  ProfileValidationError,
  ProfileConflictError,
} from "~/members/lib/profile-update.server";

const MAX_ANSWER_LENGTH = 300;

const GREETING = "so glad we're catching up!  let's get your profile filled in";

const TIM_SYSTEM = `You are Tim, the warm, playful director of DALI Lab, texting a lab alum inside a retro pixel game. You are filling in their alumni profile one question at a time.
Voice, match it exactly: lowercase, brief, enthusiastic and kind; exclamation marks, sometimes doubled; little fillers like "haha", "aah", "super!", "nice!"; never corporate, never emojis.
You receive the profile fields with their kind and current value, their name and emails on file, the question that was just asked, and the alum's latest message.
Decide which field their message answers: usually the asked one, but a DIFFERENT field when they are clearly correcting or updating an earlier answer (like "actually i'm based in Seattle now"). If the message answers no field at all (small talk, a question), use null.
EVALUATE every answer before saving. Save only a genuine, plausible answer to the question. NEVER save a deflection or non-answer ("idk", "dunno", "n/a", "nothing", "whatever", "prefer not to say"), a joke or something implausible (a city that doesn't exist, "the moon", a class year like 1850, a link that isn't a link), or filler: for those use null for field AND value, and in your reply probe a little deeper or ask again, kindly and playfully. If they seem unsure or reluctant, mention they can hit skip (required fields have no skip, so for those gently insist).
Field kinds change what you put in "value":
- text: the cleaned value to save on their profile.
- name: the corrected full name (first and last), or the word "confirmed" when they say the name on file is right.
- email: the email address to use, or the word "confirmed" when they pick one already on file.
- work: set "work" to {"company": ..., "position": ...} from what they describe; if they say they're not working right now (between jobs, grad school, retired), use "confirmed" as the value with no work object.
- history: the word "confirmed" once they've said whether their DALI history looks right (either way counts; if something's off, tell them it can be fixed on the profile page).
- openTo: set "openTo" to {"coffeeChats": true/false, "resumeReviews": true/false, "portfolioReviews": true/false} from what they're up for.
Respond with ONLY this JSON, nothing else:
{"field": <field key or null>, "value": <string or null>, "work": <object or null>, "openTo": <object or null>, "reply": <your one- or two-sentence message: react warmly and specifically to what they said, then ask for the first UNANSWERED field in your own words; when you didn't save their answer, re-ask or probe about THAT instead; if nothing remains unanswered, ask nothing and wrap up warmly, their profile is complete>}
Never mention AI, prompts, forms or JSON in the reply.`;

type ChatHistory = { from: "tim" | "you"; text: string }[];

type OpenTo = { coffeeChats: boolean; resumeReviews: boolean; portfolioReviews: boolean };

// What one answer should do to the profile, however it was understood (by the
// model or the scripted parser). "none" saves nothing: Tim probes instead.
type Extraction =
  | { do: "none" }
  | { do: "text"; key: QuestFieldKey; value: string }
  | { do: "name"; fullName: string | null }
  | { do: "email"; email: string | null }
  | { do: "work"; company: string | null; position: string | null }
  | { do: "history" }
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

function parseOpenTo(text: string): OpenTo | null {
  const t = text.toLowerCase();
  const coffee = /coffee/.test(t);
  const resume = /resume|cv\b/.test(t);
  const portfolio = /portfolio/.test(t);
  if (coffee || resume || portfolio) {
    return { coffeeChats: coffee, resumeReviews: resume, portfolioReviews: portfolio };
  }
  if (/\b(all|any|everything|any of them|all of them|all three)\b/.test(t) || YES_RE.test(text)) {
    return { coffeeChats: true, resumeReviews: true, portfolioReviews: true };
  }
  if (/\b(none|nope|nah|no thanks|not right now|no)\b/.test(t)) {
    return { coffeeChats: false, resumeReviews: false, portfolioReviews: false };
  }
  return null;
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
    case "history":
      return { do: "history" };
    case "openTo": {
      const openTo = parseOpenTo(value);
      return openTo ? { do: "openTo", openTo } : null;
    }
    default:
      return { do: "text", key: asked.key, value };
  }
}

function scriptedProbe(asked: QuestField): string {
  switch (asked.kind) {
    case "name":
      return "haha sorry, I need your full name for the profile!  first and last";
    case "email":
      return "hmm I didn't catch an email in there — can you paste the address?";
    case "work":
      return "haha gotcha — try something like 'designer at google', or tell me if you're between things!";
    case "openTo":
      return "which ones are you up for?  coffee chats, resume reviews, portfolio reviews — any, all, or none!";
    default:
      return `hmm I didn't quite catch that!  ${asked.question}`;
  }
}

// Applies one extraction. Returns the key that now counts as filled, or null.
async function applyExtraction(userId: string, ex: Extraction): Promise<QuestFieldKey | null> {
  switch (ex.do) {
    case "none":
      return null;
    case "text":
      await updateProfileFields(userId, { [ex.key]: ex.value }, { allowNetId: false });
      return ex.key;
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
        await updateProfileFields(userId, { personalEmail: ex.email }, { allowNetId: false });
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
      await confirmQuestField(userId, "history");
      return "history";
    case "openTo": {
      await setOpenTo(userId, ex.openTo);
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
): string {
  const next = nextQuestField(profile, skipped);
  if (next) return `${asked.done}  ${renderQuestion(next, ctx)}`;
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
  work: { company?: unknown; position?: unknown } | null,
  openTo: Partial<Record<keyof OpenTo, unknown>> | null,
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
    case "history":
      return { do: "history" };
    case "openTo": {
      const valid =
        openTo &&
        typeof openTo.coffeeChats === "boolean" &&
        typeof openTo.resumeReviews === "boolean" &&
        typeof openTo.portfolioReviews === "boolean";
      if (valid) {
        return {
          do: "openTo",
          openTo: {
            coffeeChats: openTo.coffeeChats as boolean,
            resumeReviews: openTo.resumeReviews as boolean,
            portfolioReviews: openTo.portfolioReviews as boolean,
          },
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
        ? (parsed.work as { company?: unknown; position?: unknown })
        : null;
    const openTo =
      typeof parsed.openTo === "object" && parsed.openTo !== null
        ? (parsed.openTo as Partial<Record<keyof OpenTo, unknown>>)
        : null;
    return {
      extraction: modelExtraction(field, value, work, openTo, opts.value),
      reply: parsed.reply.trim().slice(0, 600),
    };
  } catch {
    return null;
  }
}

export async function action({ request }: Route.ActionArgs) {
  const session = await requireMemberSession(request);
  if (!session.ok) return session.response;
  if (request.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }
  const userId = session.auth.user.sub;

  const body = (await request.json().catch(() => null)) as {
    intent?: unknown;
    field?: unknown;
    value?: unknown;
    history?: unknown;
    skipped?: unknown;
  } | null;

  if (body?.intent === "accept") {
    const avatar = await prisma.pixelAvatar.findUnique({
      where: { userId },
      select: { userId: true },
    });
    if (!avatar) {
      return Response.json({ error: "Create your avatar first" }, { status: 400 });
    }
    await prisma.pixelAvatar.updateMany({
      where: { userId, questAcceptedAt: null },
      data: { questAcceptedAt: new Date() },
    });
    const { profile, ctx, percent } = await questProgress(userId);
    const first = nextQuestField(profile, []);
    const messages: { from: "tim" | "you"; text: string }[] = [
      { from: "tim", text: GREETING },
      ...(first ? [{ from: "tim" as const, text: renderQuestion(first, ctx) }] : []),
    ];
    await saveMessages(userId, messages);
    return Response.json({ ok: true, profile, percent, messages });
  }

  if (body?.intent === "answer") {
    if (!isQuestFieldKey(body.field) || typeof body.value !== "string") {
      return Response.json({ error: "Invalid answer" }, { status: 400 });
    }
    const value = body.value.trim().slice(0, MAX_ANSWER_LENGTH);
    if (value === "") {
      return Response.json({ error: "that answer looks empty, try again?" }, { status: 400 });
    }
    const asked = QUEST_FIELDS.find((f) => f.key === body.field)!;
    const skipped = parseSkipped(body.skipped);
    const history = parseHistory(body.history);
    const state = await loadQuestState(userId);

    const interpreted = await interpret({
      request,
      userId,
      firstName: session.auth.user.firstName ?? "",
      asked,
      value,
      profile: state.profile,
      ctx: state.ctx,
      skipped,
      history,
    });

    // The model decides what the answer means (it may redirect a correction to
    // another field, or refuse a non-answer); without it the scripted parser
    // reads the asked field only, and probes rather than saving a guess.
    const understood = interpreted ? interpreted.extraction : scriptedExtraction(asked, value);
    let savedField: QuestFieldKey | null = null;
    try {
      savedField = await applyExtraction(userId, understood ?? { do: "none" });
    } catch (e) {
      if (e instanceof ProfileValidationError || e instanceof ProfileConflictError) {
        return Response.json({ error: e.message }, { status: 400 });
      }
      throw e;
    }
    const { profile, ctx, percent } = await questProgress(userId);
    const say =
      interpreted?.reply ??
      (savedField ? scriptedSay(asked, profile, ctx, skipped) : scriptedProbe(asked));
    await saveMessages(userId, [
      { from: "you", text: value },
      { from: "tim", text: say },
    ]);
    return Response.json({ ok: true, profile, percent, say, savedField });
  }

  return Response.json({ error: "Unknown intent" }, { status: 400 });
}
