// Tim's onboarding quest, mirroring the real alumni onboarding checklist.
// Client-safe — the server route maps keys onto profile writes.
//
// Field kinds:
//   text    — writes one User column through the shared profile updater
//   name    — confirms (or corrects) the name on file
//   email   — confirms the best email to reach them, saved as personalEmail
//   work    — adds a WorkExperience row from what they describe
//   history — they review their DALI roles/projects and confirm
//   openTo  — sets the open-to toggles (coffee chats, resume/portfolio reviews)
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
    label: "Ask me about",
    question: "give me a fun fact, or something people should ask you about!",
    done: "haha I love that!!",
    placeholder: "Fun fact",
  },
  {
    key: "major",
    kind: "text",
    required: false,
    label: "Major",
    question: "what did you major in?",
    done: "aah interesting!",
    placeholder: "Major",
  },
  {
    key: "minors",
    kind: "text",
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
      "last one!  are you open to coffee chats, resume reviews, or portfolio reviews with current members?  any or all!",
    done: "that's everything!  thanks for all your efforts!!",
    placeholder: "e.g. coffee chats and portfolio reviews",
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
    major: string | null;
    minors: string | null;
    funFact: string | null;
    dietaryRestrictions: string | null;
    linkedinUrl: string | null;
    personalSite: string | null;
  };
  confirmed: readonly string[];
  hasWork: boolean;
}): QuestProfile {
  const { user, confirmed, hasWork } = input;
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
        profile.work = has("work") || hasWork ? "on file" : null;
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
