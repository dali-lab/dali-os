// Dev-preview data for the Mentorship notes page (`/mentorship/browse?mock=1`,
// never in production): ten mentors with 1–3 mentees each, varied weekly
// progress and week 5 form states, so the layout can be judged at scale
// without touching the database.

import type { GridCell, GridMenteeRow, GridMentorGroup, GridPerson, MentorGridResult } from "./mentor-grid.server";
import type { Vibe } from "./vibe";
import { emptyDomainTermForms, type TermFormResponse, type TermForms } from "./term-forms";

// One char per week: G/O/B = submitted with that vibe, u = submitted with no
// rating, m = due but missing, f = not yet due.
const WEEKS = 10;
const CURRENT_WEEK = 7;
const VIBE_BY_CHAR: Record<string, Vibe> = { G: "Good", O: "Ok", B: "Bad" };

const person = (id: string, first: string, last: string): GridPerson => ({
  id,
  firstName: first,
  lastName: last,
  photoUrl: null,
});

type MockMentee = {
  id: string;
  first: string;
  last: string;
  project: string;
  weeks: string;
  mentorForm: boolean;
  menteeForm: boolean;
};

type MockMentor = { id: string; first: string; last: string; mentees: MockMentee[] };

const DOMAIN = { id: "mock-dom-dev", code: "DEV" };

const MENTORS: MockMentor[] = [
  {
    id: "mock-admin", first: "Admin", last: "User",
    mentees: [{ id: "mock-mira", first: "Mira", last: "Chen", project: "Atlas", weeks: "GGGOGGmfff", mentorForm: true, menteeForm: true }],
  },
  {
    id: "mock-sarah", first: "Sarah", last: "Johnson",
    mentees: [
      { id: "mock-alex", first: "Alex", last: "Kim", project: "Beacon", weeks: "GGOGGGGfff", mentorForm: true, menteeForm: true },
      { id: "mock-olivia", first: "Olivia", last: "Park", project: "Beacon", weeks: "GmGOumGfff", mentorForm: true, menteeForm: false },
    ],
  },
  {
    id: "mock-michael", first: "Michael", last: "Torres",
    mentees: [{ id: "mock-daniel", first: "Daniel", last: "Lee", project: "Compass", weeks: "mmGBmmmfff", mentorForm: false, menteeForm: false }],
  },
  {
    id: "mock-emily", first: "Emily", last: "Davis",
    mentees: [
      { id: "mock-sophie", first: "Sophie", last: "Wang", project: "Delta", weeks: "GGGGGGGfff", mentorForm: false, menteeForm: true },
      { id: "mock-james", first: "James", last: "Miller", project: "Delta", weeks: "OOBOmGOfff", mentorForm: false, menteeForm: false },
      { id: "mock-noah", first: "Noah", last: "Patel", project: "Echo", weeks: "GOGmGmmfff", mentorForm: false, menteeForm: true },
    ],
  },
  {
    id: "mock-david", first: "David", last: "Wilson",
    mentees: [
      { id: "mock-grace", first: "Grace", last: "Liu", project: "Fathom", weeks: "GGGGOGGfff", mentorForm: true, menteeForm: true },
      { id: "mock-ethan", first: "Ethan", last: "Brooks", project: "Fathom", weeks: "GBOGGumfff", mentorForm: true, menteeForm: true },
    ],
  },
  {
    id: "mock-priya", first: "Priya", last: "Raman",
    mentees: [
      { id: "mock-lena", first: "Lena", last: "Ortiz", project: "Atlas", weeks: "GGGGGGGfff", mentorForm: true, menteeForm: true },
      { id: "mock-theo", first: "Theo", last: "Nguyen", project: "Atlas", weeks: "OGOOmmGfff", mentorForm: true, menteeForm: false },
    ],
  },
  {
    id: "mock-marcus", first: "Marcus", last: "Bell",
    mentees: [
      { id: "mock-zoe", first: "Zoe", last: "Alvarez", project: "Beacon", weeks: "GBBOmmmfff", mentorForm: false, menteeForm: true },
      { id: "mock-kai", first: "Kai", last: "Tanaka", project: "Compass", weeks: "GGGOGuGfff", mentorForm: false, menteeForm: false },
      { id: "mock-ivy", first: "Ivy", last: "Foster", project: "Compass", weeks: "GGOGGGGfff", mentorForm: false, menteeForm: true },
    ],
  },
  {
    id: "mock-rachel", first: "Rachel", last: "Green",
    mentees: [{ id: "mock-omar", first: "Omar", last: "Hassan", project: "Echo", weeks: "mGmGmGmfff", mentorForm: true, menteeForm: false }],
  },
  {
    id: "mock-tom", first: "Tom", last: "Becker",
    mentees: [
      { id: "mock-nina", first: "Nina", last: "Sato", project: "Delta", weeks: "GGGGGGOfff", mentorForm: true, menteeForm: true },
      { id: "mock-leo", first: "Leo", last: "Martin", project: "Fathom", weeks: "GOGBGOGfff", mentorForm: true, menteeForm: true },
    ],
  },
];

const submittedAt = "2026-10-14T16:00:00Z";
// The linked forms carry no preset prompts — a response is just what the person
// typed — so mock responses are a single free-text answer with no question label.
const mentorResponse = (name: string): TermFormResponse => ({
  submittedAt,
  rows: [
    {
      key: "response",
      label: "",
      value: `${name} is steady. Ships work on time and asks good questions in review. The main thing to work on is scoping larger tasks; we've been pairing on breaking them down, and our weekly check-ins have been consistent and productive.`,
    },
  ],
});
const menteeResponse = (name: string): TermFormResponse => ({
  submittedAt,
  rows: [
    {
      key: "response",
      label: "",
      value: `Things are going well. I'm getting more comfortable owning features. It would help to get more feedback on code structure before I open a PR, and a bit more time on architecture questions in our check-ins. (${name.split(" ")[0]})`,
    },
  ],
});

export function buildMockMentorship(): { grid: MentorGridResult; termForms: TermForms } {
  const forms = emptyDomainTermForms();
  forms.mentor.form = { id: "mock-form-mentor", name: "Week 5 mentor check-in" };
  forms.mentee.form = { id: "mock-form-mentee", name: "Week 5 mentee check-in" };

  const mentors: GridMentorGroup[] = MENTORS.map((m) => {
    const mentor = person(m.id, m.first, m.last);
    // The mentor answers once per domain; they count as submitted if any of
    // their mock mentees is flagged so.
    if (m.mentees.some((x) => x.mentorForm)) {
      forms.mentor.responses[m.id] = mentorResponse(`${m.mentees[0].first} ${m.mentees[0].last}`);
    }
    const rows: GridMenteeRow[] = m.mentees.map((x) => {
      const name = `${x.first} ${x.last}`;
      if (x.menteeForm) forms.mentee.responses[x.id] = menteeResponse(name);
      const cells: GridCell[] = [...x.weeks].map((ch, i) => {
        const week = i + 1;
        const base = { week, weekOfIso: new Date(Date.UTC(2026, 8, 7 + i * 7)).toISOString(), canCreate: false };
        if (ch === "f") return { ...base, state: "future", noteId: null, vibe: null };
        if (ch === "m") return { ...base, state: "missing", noteId: null, vibe: null };
        return { ...base, state: "submitted", noteId: `mock-${x.id}-${week}`, vibe: VIBE_BY_CHAR[ch] ?? null };
      });
      return {
        key: `${m.id}|${x.id}`,
        pairId: `mock-pair-${x.id}`,
        manual: false,
        mentee: person(x.id, x.first, x.last),
        menteeId: x.id,
        projectId: `mock-proj-${x.project}`,
        domainId: DOMAIN.id,
        projectName: x.project,
        domainCode: DOMAIN.code,
        cells,
      };
    });
    return { mentor, rows };
  });

  return {
    grid: {
      weeks: Array.from({ length: WEEKS }, (_, i) => i + 1),
      currentWeek: CURRENT_WEEK,
      mentors,
      termSelected: true,
    },
    termForms: { [DOMAIN.id]: forms },
  };
}
