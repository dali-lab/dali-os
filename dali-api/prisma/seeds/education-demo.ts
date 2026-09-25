/**
 * Demo content for the seeded "Intro to React" miniseries.
 *
 * The bare seed gives the offering one session and one instructor, so every
 * education surface (catalog card, offering page, course hub, roster, CE
 * compliance) renders as an empty shell. This fills it in: a running course
 * with six sessions, three instructors, a full roster with a waitlist,
 * attendance and CE credits for the sessions that already happened,
 * assignments in three different states, material pages, and a discussion.
 *
 * Idempotent — every row is upserted on a stable id or a natural key, so
 * re-seeding an existing database is safe.
 *
 * The Figma workshop is deliberately left with its empty roster and capacity of
 * 2: the RSVP → waitlist → promotion E2E spec drives it from a clean slate.
 */
import type { PrismaClient } from "../../app/generated/prisma/client.js";
import { randomUUID } from "node:crypto";
import { plainTextToBlocks, type DocBlock } from "../../app/collab/blocknote-server.js";
import { replaceCollabDocContent } from "../../app/collab/write.js";
import { pageDocName } from "../../app/collab/roomName.js";

const OFFERING_ID = "offering-react-miniseries";
const WORKSHOP_ID = "offering-figma-workshop";

const DAY = 86_400_000;

/** A heading/paragraph/bullet block, in the shape BlockNote round-trips. */
function block(type: string, text: string, props: Record<string, unknown> = {}): DocBlock {
  return {
    id: randomUUID(),
    type,
    props: {
      backgroundColor: "default",
      textColor: "default",
      textAlignment: "left",
      ...props,
    },
    content: text ? [{ type: "text", text, styles: {} }] : [],
    children: [],
  };
}

const h = (text: string, level = 2) => block("heading", text, { level });
const p = (text: string) => block("paragraph", text);
const li = (text: string) => block("bulletListItem", text);

export async function seedEducationDemo(
  prisma: PrismaClient,
  opts: { adminId: string; termId: string },
) {
  const { adminId, termId } = opts;
  const now = Date.now();
  const at = (days: number, hourUtc = 18) => {
    const d = new Date(now + days * DAY);
    d.setUTCHours(hourUtc, 0, 0, 0);
    return d;
  };

  // ── People ───────────────────────────────────────────────────────────────
  // Looked up rather than created: every one of these is seeded earlier in
  // prisma/seed.ts. A missing row just drops out of the demo roster.
  const userId = async (where: { daliEmail?: string; netId?: string }) =>
    (await prisma.user.findFirst({ where, select: { id: true } }))?.id ?? null;

  const [mira, isabela] = await Promise.all([
    userId({ daliEmail: "eng.lead@dali.dartmouth.edu" }),
    userId({ daliEmail: "design.lead@dali.dartmouth.edu" }),
  ]);

  const memberEmails = [
    "jordan.taylor@dali.dartmouth.edu",
    "reviewer1@dali.dartmouth.edu",
    "reviewer2@dali.dartmouth.edu",
    "reviewer3@dali.dartmouth.edu",
    "pm.lead@dali.dartmouth.edu",
  ];
  const studentNetIds = ["f007em5", "f007li6", "f007so7", "f007no8", "f007ol9", "f007et0"];
  const waitlistNetIds = ["f007av1", "f007ma2"];

  const enrolled = (
    await Promise.all([
      ...memberEmails.map((daliEmail) => userId({ daliEmail })),
      ...studentNetIds.map((netId) => userId({ netId })),
    ])
  ).filter((id): id is string => id !== null);
  const waitlisted = (
    await Promise.all(waitlistNetIds.map((netId) => userId({ netId })))
  ).filter((id): id is string => id !== null);

  // ── The offering itself ──────────────────────────────────────────────────
  // Moved onto a window around today so the course reads as *running*: three
  // sessions behind it (with attendance), three ahead. Registration stays open
  // a little longer so the apply flow is still demoable from the catalog.
  await prisma.educationOffering.update({
    where: { id: OFFERING_ID },
    data: {
      iconEmoji: "⚛️",
      // Capacity matches the roster so the card shows a full offering with a
      // real waitlist behind it.
      capacity: enrolled.length,
      registrationOpensAt: at(-45),
      registrationClosesAt: at(12),
      startsAt: at(-21),
      endsAt: at(14),
    },
  });

  await replaceCollabDocContent(
    `eduoffering:${OFFERING_ID}:description`,
    [
      p(
        "A six-week miniseries on building real interfaces with React. We start from components and props and finish with a shipped project you can put in your portfolio.",
      ),
      h("What you'll learn"),
      li("Composing components and passing data with props"),
      li("State, effects, and when you don't need either"),
      li("Loading data with React Router loaders"),
      li("Forms, validation, and accessible inputs"),
      li("Testing what a user actually does"),
      h("What to expect"),
      p(
        "Sessions are 90 minutes: a short walkthrough, then lab time with the instructors in the room. Expect about two hours of work between sessions.",
      ),
      p(
        "Attend at least 80% of the sessions to earn a completion certificate. Every session counts toward your CE credit for the term.",
      ),
    ],
    adminId,
  );

  await replaceCollabDocContent(
    `eduoffering:${WORKSHOP_ID}:description`,
    [
      p(
        "A single-session crash course in Figma for people who have never opened it. Bring a laptop; we design a small app screen together, start to finish.",
      ),
      h("Covered"),
      li("Frames, auto layout, and constraints"),
      li("Components and variants"),
      li("Prototyping a flow you can click through"),
    ],
    adminId,
  );
  await prisma.educationOffering.update({
    where: { id: WORKSHOP_ID },
    data: { iconEmoji: "🎨" },
  });

  // ── Instructors ──────────────────────────────────────────────────────────
  for (const id of [adminId, mira, isabela].filter((i): i is string => i !== null)) {
    await prisma.instructorAssignment.upsert({
      where: { userId_offeringId_termId: { userId: id, offeringId: OFFERING_ID, termId } },
      update: {},
      create: { userId: id, offeringId: OFFERING_ID, termId },
    });
  }

  // ── Sessions ─────────────────────────────────────────────────────────────
  const sessions = [
    { seq: 1, day: -21, title: "Components and props", location: "DALI Space", notes: null },
    { seq: 2, day: -14, title: "State and effects", location: "DALI Space", notes: null },
    {
      seq: 3,
      day: -7,
      title: "Data fetching with loaders",
      location: "Sudikoff 007",
      notes: "Read the React Router data guide before this one.",
    },
    {
      seq: 4,
      day: 0,
      title: "Forms and validation",
      location: "DALI Space",
      notes: "Bring a laptop. We build the sign-up form together.",
    },
    { seq: 5, day: 7, title: "Testing components", location: "Sudikoff 007", notes: null },
    { seq: 6, day: 14, title: "Ship it: project reviews", location: "DALI Space", notes: null },
  ];

  const sessionIds: string[] = [];
  for (const s of sessions) {
    const id = `session-react-${s.seq}`;
    const datetime = at(s.day);
    const data = {
      title: s.title,
      datetime,
      endsAt: new Date(datetime.getTime() + 90 * 60_000),
      location: s.location,
      notes: s.notes,
    };
    await prisma.educationSession.upsert({
      where: { id },
      update: data,
      create: { id, offeringId: OFFERING_ID, sequence: s.seq, ...data },
    });
    sessionIds.push(id);
  }
  const pastSessionIds = sessionIds.slice(0, 3);

  // ── Roster ───────────────────────────────────────────────────────────────
  const applicationIds = new Map<string, string>();
  for (const [i, id] of enrolled.entries()) {
    const app = await prisma.educationApplication.upsert({
      where: { applicantUserId_offeringId: { applicantUserId: id, offeringId: OFFERING_ID } },
      update: { status: "Approved", waitlistRank: null },
      create: {
        applicantUserId: id,
        offeringId: OFFERING_ID,
        status: "Approved",
        submittedAt: at(-30 + i),
        reviewedAt: at(-28 + i),
        reviewedBy: adminId,
      },
      select: { id: true },
    });
    applicationIds.set(id, app.id);
  }
  for (const [i, id] of waitlisted.entries()) {
    await prisma.educationApplication.upsert({
      where: { applicantUserId_offeringId: { applicantUserId: id, offeringId: OFFERING_ID } },
      update: { status: "Waitlisted", waitlistRank: i + 1 },
      create: {
        applicantUserId: id,
        offeringId: OFFERING_ID,
        status: "Waitlisted",
        submittedAt: at(-5 + i),
        waitlistRank: i + 1,
      },
    });
  }

  // ── Attendance + CE credits for the sessions that already happened ───────
  // One absence and one excused mark so the roster matrix isn't a wall of
  // green, and so the completion threshold has something to bite on.
  for (const [si, sessionId] of pastSessionIds.entries()) {
    for (const [ui, [uid, applicationId]] of [...applicationIds].entries()) {
      const status =
        si === 1 && ui === 3 ? "Absent" : si === 2 && ui === 7 ? "Excused" : "Present";
      await prisma.educationAttendance.upsert({
        where: { applicationId_sessionId: { applicationId, sessionId } },
        update: { status },
        create: { applicationId, sessionId, status },
      });
      // Attendance-derived CE credit, the same row saveAttendance() writes.
      if (status === "Absent") continue;
      await prisma.cECredit.upsert({
        where: { userId_sessionId: { userId: uid, sessionId } },
        update: {},
        create: {
          userId: uid,
          sessionId,
          termId,
          grantedById: adminId,
          reason: "Attended session",
        },
      });
    }
  }

  // ── Assignments ──────────────────────────────────────────────────────────
  const assignments = [
    {
      id: "assignment-react-counter",
      sessionId: "session-react-2",
      title: "Counter component",
      submissionType: "Link" as const,
      dueAt: at(-12),
      points: null,
      instructions:
        "Build a counter with increment, decrement, and reset. Push it to a repo and submit the link.",
    },
    {
      id: "assignment-react-list",
      sessionId: "session-react-3",
      title: "Fetch and render a list",
      submissionType: "Link" as const,
      dueAt: at(-3),
      points: null,
      instructions:
        "Load the sample API in a loader and render the results, including the empty and error states.",
    },
    {
      id: "assignment-react-proposal",
      sessionId: null,
      title: "Final project proposal",
      submissionType: "Doc" as const,
      dueAt: at(5),
      points: 20,
      instructions:
        "One page: what you're building, who it's for, and the three screens you'll ship by the last session.",
    },
    {
      id: "assignment-react-reflection",
      sessionId: null,
      title: "Course reflection",
      submissionType: "Text" as const,
      dueAt: at(25),
      points: null,
      instructions: "A few paragraphs on what clicked, what didn't, and what you'd build next.",
    },
  ];

  for (const a of assignments) {
    const instructionsDocId = `eduassignment:${a.id}:instructions`;
    const data = {
      title: a.title,
      dueAt: a.dueAt,
      submissionType: a.submissionType,
      points: a.points,
      instructionsDocId,
    };
    await prisma.educationAssignment.upsert({
      where: { id: a.id },
      update: data,
      create: {
        id: a.id,
        offeringId: a.sessionId ? null : OFFERING_ID,
        sessionId: a.sessionId,
        ...data,
      },
    });
    await replaceCollabDocContent(instructionsDocId, [p(a.instructions)], adminId);
  }

  // Graded work on the first assignment, ungraded on the second, and nothing
  // on the third — so a student's hub shows a grade, a pending submission, and
  // an overdue item at the same time.
  const graders = [...applicationIds.keys()];
  for (const [i, studentId] of graders.entries()) {
    if (i < 8) {
      await prisma.educationSubmission.upsert({
        where: {
          assignmentId_studentId: { assignmentId: "assignment-react-counter", studentId },
        },
        update: {},
        create: {
          assignmentId: "assignment-react-counter",
          studentId,
          educationApplicationId: applicationIds.get(studentId),
          link: "https://github.com/dali-lab/react-counter-exercise",
          submittedAt: at(-13),
          gradedAt: at(-11),
          grade: "Complete",
          feedbackText:
            i % 3 === 0
              ? "Clean state handling. Next time pull the button into its own component."
              : "Works end to end. Watch the reset case when the count is already zero.",
        },
      });
    }
    if (i >= 2 && i < 6) {
      await prisma.educationSubmission.upsert({
        where: { assignmentId_studentId: { assignmentId: "assignment-react-list", studentId } },
        update: {},
        create: {
          assignmentId: "assignment-react-list",
          studentId,
          educationApplicationId: applicationIds.get(studentId),
          link: "https://github.com/dali-lab/react-list-exercise",
          submittedAt: at(-4),
        },
      });
    }
  }

  // ── Material pages ───────────────────────────────────────────────────────
  // Idempotent by (workspace, title): Page ids are cuids, so there's no stable
  // id to upsert on.
  const materials = [
    {
      title: "Syllabus",
      sessionId: null,
      studentEditable: false,
      body: [
        h("Weekly plan"),
        li("Week 1 — Components and props"),
        li("Week 2 — State and effects"),
        li("Week 3 — Data fetching with loaders"),
        li("Week 4 — Forms and validation"),
        li("Week 5 — Testing components"),
        li("Week 6 — Project reviews"),
        h("Grading"),
        p(
          "Everything is complete/incomplete. Attend 80% of sessions and submit the final project to earn a certificate.",
        ),
      ],
    },
    {
      title: "Setup guide",
      sessionId: null,
      studentEditable: false,
      body: [
        p("Do this before the first session. It takes about ten minutes."),
        li("Install Node 22 and npm"),
        li("Clone the starter repo"),
        li("Run npm install, then npm run dev"),
        p("Stuck? Post in the course discussion and an instructor will pick it up."),
      ],
    },
    {
      title: "Week 1 slides",
      sessionId: "session-react-1",
      studentEditable: false,
      body: [
        h("Components and props"),
        p(
          "A component is a function that takes props and returns markup. Props flow down; nothing flows up on its own.",
        ),
        li("Name components for what they are, not where they sit"),
        li("Keep props small — one idea per prop"),
        li("If two components need the same state, lift it to their parent"),
      ],
    },
    {
      title: "Group scratchpad",
      sessionId: null,
      studentEditable: true,
      body: [
        p("Shared notes from lab time. Anyone in the course can edit this page."),
      ],
    },
  ];

  for (const [i, m] of materials.entries()) {
    const existing = await prisma.page.findFirst({
      where: { workspaceType: "EducationOffering", workspaceId: OFFERING_ID, title: m.title },
      select: { id: true },
    });
    const page = existing
      ? await prisma.page.update({
          where: { id: existing.id },
          data: {
            position: i,
            sessionId: m.sessionId,
            studentEditable: m.studentEditable,
            archivedAt: null,
          },
          select: { id: true, contentDocId: true },
        })
      : await prisma.page.create({
          data: {
            workspaceType: "EducationOffering",
            workspaceId: OFFERING_ID,
            title: m.title,
            kind: "FreeForm",
            position: i,
            sessionId: m.sessionId,
            studentEditable: m.studentEditable,
            createdById: adminId,
          },
          select: { id: true, contentDocId: true },
        });
    await replaceCollabDocContent(
      page.contentDocId ?? pageDocName(page.id),
      m.body,
      adminId,
    );
  }

  // ── Discussion ───────────────────────────────────────────────────────────
  // No natural key on a post, so the demo thread is rebuilt each run.
  await prisma.educationAnnouncement.deleteMany({ where: { offeringId: OFFERING_ID } });
  const welcome = await prisma.educationAnnouncement.create({
    data: {
      offeringId: OFFERING_ID,
      authorId: adminId,
      kind: "Announcement",
      sentAt: at(-22),
      body: "Welcome to Intro to React. Work through the setup guide before the first session so we can start building right away. Bring a laptop and questions.",
    },
    select: { id: true },
  });
  await prisma.educationAnnouncement.create({
    data: {
      offeringId: OFFERING_ID,
      authorId: adminId,
      kind: "Announcement",
      sentAt: at(-6),
      body: "Reminder: final project proposals are due next week. One page is plenty. Office hours are open in the DALI Space on Tuesday afternoon.",
    },
  });
  const asker = enrolled[1] ?? adminId;
  const question = await prisma.educationAnnouncement.create({
    data: {
      offeringId: OFFERING_ID,
      authorId: asker,
      kind: "Message",
      sentAt: at(-20),
      body: "npm install fails on the starter repo with a node-gyp error. Anyone seen this?",
    },
    select: { id: true },
  });
  await prisma.educationAnnouncement.create({
    data: {
      offeringId: OFFERING_ID,
      authorId: mira ?? adminId,
      kind: "Message",
      parentId: question.id,
      sentAt: at(-20),
      body: "That's almost always Node 20. Switch to Node 22 and delete node_modules, then install again.",
    },
  });
  await prisma.educationAnnouncement.create({
    data: {
      offeringId: OFFERING_ID,
      authorId: enrolled[2] ?? adminId,
      kind: "Message",
      parentId: welcome.id,
      sentAt: at(-21),
      body: "Setup done. Is there a reading list for after the course?",
    },
  });

  return {
    enrolled: enrolled.length,
    waitlisted: waitlisted.length,
    sessions: sessions.length,
    assignments: assignments.length,
    materials: materials.length,
  };
}
