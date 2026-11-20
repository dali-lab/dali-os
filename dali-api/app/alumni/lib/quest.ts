// Tim's onboarding quest, mirroring the real alumni onboarding checklist.
// Client-safe — the server route maps keys onto profile writes.
//
// Field kinds:
//   text    — writes one User column through the shared profile updater
//   name    — confirms (or corrects) the name on file
//   email   — confirms the best email to reach them, saved as personalEmail
//   list    — writes a list column (majors, minors, ask me about), split on commas
//   work    — adds a WorkExperience row from what they describe
//   pastWork — adds the job before that, with the year they left
//   history — they review their DALI roles/projects and confirm
//   openTo  — sets the open-to toggles, the same five the onboarding form shows
// Non-text kinds count as filled once their key lands in
// PixelAvatar.confirmedFields.

export const QUEST_FIELDS = [
  {
    key: "name",
    kind: "name",
    required: true,
    label: "Name",
    question: "first things first!  I have your name down as {name}.  still right?",
    done: "super!",
    placeholder: "Yep! / First Last",
  },
  {
    key: "email",
    kind: "email",
    required: true,
    label: "Preferred email",
    question:
      "what's the best email to reach you at these days?  on file I have {emails}",
    done: "got it, that's where we'll reach you!",
    placeholder: "you@example.com",
  },
  {
    key: "classYear",
    kind: "text",
    required: false,
    label: "Class year",
    question: "what class year are you?  four digits, like 2019",
    done: "a fine vintage haha",
    placeholder: "2019",
  },
  {
    key: "currentLocation",
    kind: "text",
    required: false,
    label: "Based in",
    question: "where in the world are you based these days?",
    done: "super!  pinned you on the community map",
    placeholder: "City, state or country",
  },
  {
    key: "work",
    kind: "work",
    required: false,
    label: "Work",
    question: "what are you up to for work?  something like 'designer at google' works!",
    done: "aah that's awesome!!",
    placeholder: "Role at company",
  },
  {
    key: "pastWork",
    kind: "pastWork",
    required: false,
    label: "Before that",
    question: "and before that?  where were you, and roughly when did you leave?",
    done: "love that path!",
    placeholder: "Role at company, 2023",
  },
  {
    key: "history",
    kind: "history",
    required: false,
    label: "DALI history",
    question:
      "here's what I have from your DALI days:\n{history}\ndoes that look right?  if anything's off just tell me and I'll flag it for the team",
    done: "haha those were good times!",
    placeholder: "Looks right! / what's off",
  },
  {
    key: "funFact",
    kind: "text",
    required: false,
    label: "Fun fact",
    question: "give me a fun fact about you!",
    done: "haha I love that!!",
    placeholder: "Fun fact",
  },
  {
    key: "askMeAbout",
    kind: "list",
    required: false,
    label: "Ask me about",
    question:
      "what could students ask you about?  stuff like breaking into a field, grad school, moving cities.  a few words each!",
    done: "super, students are gonna love that!",
    placeholder: "e.g. product design, grad school",
  },
  {
    key: "outsideOfWork",
    kind: "text",
    required: false,
    label: "Outside of work",
    question: "and outside of work?  what are you into these days?",
    done: "haha amazing!",
    placeholder: "Climbing, film photography",
  },
  {
    key: "majors",
    kind: "list",
    required: false,
    label: "Majors",
    question: "what did you major in?  if you double majored, tell me both!",
    done: "aah interesting!",
    placeholder: "Major",
  },
  {
    key: "minors",
    kind: "list",
    required: false,
    label: "Minors",
    question: "any minors?",
    done: "nice!",
    placeholder: "Minor(s)",
  },
  {
    key: "hometown",
    kind: "text",
    required: false,
    label: "Hometown",
    question: "and where's home originally?",
    done: "nice!",
    placeholder: "Hometown",
  },
  {
    key: "birthday",
    kind: "text",
    required: false,
    label: "Birthday",
    question: "when's your birthday?  so we can celebrate you",
    done: "noted!!",
    placeholder: "June 5, 2001",
  },
  {
    key: "dietaryRestrictions",
    kind: "text",
    required: false,
    label: "Dietary restrictions",
    question: "any dietary restrictions?  for when we feed you at alumni events haha",
    done: "noted, thanks!",
    placeholder: "e.g. vegetarian",
  },
  {
    key: "linkedinUrl",
    kind: "text",
    required: false,
    label: "LinkedIn",
    question: "can you drop your linkedin so people can find you?",
    done: "super!",
    placeholder: "https://linkedin.com/in/...",
  },
  {
    key: "personalSite",
    kind: "text",
    required: false,
    label: "Personal site",
    question: "got a personal site or portfolio?  would love to see it",
    done: "nice, added it!",
    placeholder: "https://...",
  },
  {
    key: "openTo",
    kind: "openTo",
    required: false,
    label: "Open to",
    question:
      "last one!  what are you up for?  coffee chats, resume or portfolio reviews, mentoring a student project, speaking at a DALI event, or pointing a partner our way.  any or all!",
    done: "that's everything!  thanks for all your efforts!!",
    placeholder: "e.g. coffee chats and mentoring",
  },
] as const;

export type QuestField = (typeof QUEST_FIELDS)[number];
export type QuestFieldKey = QuestField["key"];
export type QuestFieldKind = QuestField["kind"];

export type QuestProfile = Record<QuestFieldKey, string | null>;

export type QuestionContext = {
  fullName?: string | null;
  emails?: string[];
  historyLines?: string[];
};

export function isQuestFieldKey(value: unknown): value is QuestFieldKey {
  return QUEST_FIELDS.some((f) => f.key === value);
}

export function renderQuestion(field: QuestField, ctx: QuestionContext = {}): string {
  return field.question
    .replace("{name}", ctx.fullName?.trim() || "what we have on file")
    .replace(
      "{emails}",
      ctx.emails && ctx.emails.length > 0 ? ctx.emails.join(", ") : "a couple of addresses",
    )
    .replace(
      "{history}",
      ctx.historyLines && ctx.historyLines.length > 0
        ? ctx.historyLines.map((l) => `• ${l}`).join("\n")
        : "• hmm, nothing on file yet",
    );
}

export const TEXT_QUEST_KEYS = QUEST_FIELDS.filter((f) => f.kind === "text").map((f) => f.key);

export const LIST_QUEST_KEYS = QUEST_FIELDS.filter((f) => f.kind === "list").map((f) => f.key);
export type ListQuestKey = (typeof LIST_QUEST_KEYS)[number];

export function splitAnswerList(value: string): string[] {
  return value
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// Maps the data the server gathers onto the quest's filled/value view. A text
// field is filled when its column is; every other kind is filled once its key
// was confirmed (work also counts an existing WorkExperience row).
export function toQuestProfile(input: {
  user: {
    firstName: string;
    lastName: string;
    personalEmail: string | null;
    preferredEmail: string | null;
    classYear: number | null;
    currentLocation: string | null;
    hometown: string | null;
    birthday: string | null;
    majors: string[];
    minors: string[];
    askMeAbout: string[];
    funFact: string | null;
    outsideOfWork: string | null;
    dietaryRestrictions: string | null;
    linkedinUrl: string | null;
    personalSite: string | null;
  };
  confirmed: readonly string[];
  workCount: number;
}): QuestProfile {
  const { user, confirmed, workCount } = input;
  const has = (key: QuestFieldKey) => confirmed.includes(key);
  const profile = {} as QuestProfile;
  for (const f of QUEST_FIELDS) {
    switch (f.key) {
      case "name":
        profile.name = has("name") ? `${user.firstName} ${user.lastName}`.trim() : null;
        break;
      case "email":
        profile.email = has("email")
          ? (user.preferredEmail ?? user.personalEmail ?? "confirmed")
          : null;
        break;
      case "classYear":
        profile.classYear = user.classYear === null ? null : String(user.classYear);
        break;
      case "work":
        profile.work = has("work") || workCount > 0 ? "on file" : null;
        break;
      case "pastWork":
        profile.pastWork = has("pastWork") || workCount > 1 ? "on file" : null;
        break;
      case "majors":
      case "minors":
      case "askMeAbout":
        profile[f.key] = user[f.key].length > 0 ? user[f.key].join(", ") : null;
        break;
      case "history":
        profile.history = has("history") ? "confirmed" : null;
        break;
      case "openTo":
        profile.openTo = has("openTo") ? "confirmed" : null;
        break;
      default:
        profile[f.key] = user[f.key] ?? null;
    }
  }
  return profile;
}

export function filledCount(profile: QuestProfile): number {
  return QUEST_FIELDS.filter((f) => {
    const v = profile[f.key];
    return typeof v === "string" && v.trim() !== "";
  }).length;
}

export function questPercent(profile: QuestProfile): number {
  return Math.round((filledCount(profile) / QUEST_FIELDS.length) * 100);
}

// The next question Tim should ask: the first unfilled field that the player
// hasn't skipped this session. Required fields can't be skipped.
export function nextQuestField(
  profile: QuestProfile,
  skipped: readonly QuestFieldKey[] = [],
): QuestField | null {
  return (
    QUEST_FIELDS.find((f) => {
      const v = profile[f.key];
      const empty = !(typeof v === "string" && v.trim() !== "");
      return empty && (f.required || !skipped.includes(f.key));
    }) ?? null
  );
}
