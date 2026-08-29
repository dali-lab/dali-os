# Education — Student UI redesign

Status: in progress (feat/education-changes). Redesigns the full student-facing
education area around a **session-timeline** course view wrapped in a **thin
cross-course shell**. Grounded in a deep-research pass across Canvas, Blackboard
Ultra, Google Classroom, Moodle, Maven, MOOCs, and cohort tools.

## Why this shape (evidence)

- **Linear/sequenced home > dashboard-of-cards.** A 2026 quasi-experiment
  (N=386) found a linear/collapsed-topics layout scored significantly higher on
  student-rated UX (3.99 vs 3.64) and UI (4.14 vs 3.79) than a grid/card layout,
  and recommends linear layouts "particularly in mandatory or content-heavy
  course sites." Canvas Modules "control the entire flow of the course"; Maven's
  student Home is a week-sequenced syllabus hub, not a feed.
- **Thin persistent cross-course shell.** Blackboard Ultra exposes a small fixed
  set — Activity/to-do, Courses, Calendar, Grades — around the course view.
- **"What's next" = cross-course to-do with due/grade/feedback as always-on
  signals**, plus a compact "due soon" snapshot (Ultra; Google Classroom).
- **Per-item completion dots + manual "mark as done"** on a linear view (Moodle).
- **QR check-in best practice = rotating code + typed-PIN browser fallback +
  student attendance history** (Qwickly, aPlus+). We stay web-first; static
  time-window QR now, rotation later (mobile-app track).

**Caveat (honest):** the linear>grid study warns the advantage "may not hold"
for "exploratory, collaborative, or project-based" courses — DALI's
collaborative-docs cohort model. So the timeline is evidence-*suggested*, not
proven, for our case; validate with real students. Workshops (1 session)
collapse to a single card and don't need a timeline.

## IA

Thin shell (≤4 primary destinations) → per-course session timeline.

```
/education (landing, thin shell)
  ▸ What's next        cross-course: open check-ins + assignments due soon
  ▸ My courses         enrolled, with progress (sessions attended, % , cert)
  ▸ CE credit standing (DALI-specific, keep)
  ▸ Browse catalog     open/upcoming + past + my applications
/education/:id/hub (course view)
  ▸ Timeline (default) ordered sessions; each row inline:
       completion dot · title · date/time · my attendance (+ Check in when open)
       · materials · recording · assignment (status) · session notes
  ▸ Overview           about / instructors / classmates / instructor feedback
  ▸ Grades             per-assignment score + feedback + running standing
                       (attendance % toward certificate, CE credit)
  ▸ Discussion         announcements + board
  ▸ Workspace          shared collab docs (only when present)
```

## Per-surface

### Course view — session timeline (centerpiece)
- Default tab is the timeline. Each session is one row:
  - Completion dot: past+Present = done (✓); upcoming = hollow; next = accent.
  - Attendance chip (Present/Absent/Excused) or a **Check in** button when
    `checkInOpen` and not yet Present.
  - Inline chips/links: each session material, recording link, the session's
    assignment with its status (submitted / due date / grade).
  - Session notes (prep) shown under the row.
- Header strip: attended X/Y · assignments done · next session at …
- Single-session workshop: one card, no timeline chrome.
- Reuses existing hub data (sessions already carry attendance/check-in/notes;
  assignments carry session + submission/grade; materials carry sessionId).

### Grades (promote out of Overview)
- Table: assignment · due · submitted · score/grade · feedback link.
- Running standing: attendance % vs completion threshold, CE credit earned,
  certificate state.

### Landing — thin shell
- **What's next** leads: any open session check-in (one tap), then assignments
  due soon across enrolled courses. Due/attendance = always-on signals.
- **My courses**: enrolled offerings with a progress bar (sessions attended /
  total) + certificate badge; link into the course timeline.
- **CE standing** banner (keep).
- **Browse**: open/upcoming catalog + past (collapsed) + my applications.
- Needs a new cross-course aggregation (`studentEducationDashboard`).

## Avoid
- Heavy IA (keep shell ≤4 destinations); card-grid as the primary *content*
  organizer; anything that breaks on a phone (check-in is on phones).

## Open questions (flagged, not blocking)
- Inline per-session attendance in the timeline is novel (no surveyed LMS does
  it) — sensible, worth a user sanity-check.
- Rotating-QR needs an app for the every-few-seconds guarantee; static
  time-window QR is acceptable for a trusted lab now.

## Build phases (one combined PR, feat/education-changes)
1. ✅ Course view → session timeline + promoted Grades view (reuses hub data).
2. ✅ Landing → What's next + My courses (getStudentDashboard, member + portal).
3. ⬜ Catalog / apply / certificate polish (deferred — already functional; not the
   daily student surface).
