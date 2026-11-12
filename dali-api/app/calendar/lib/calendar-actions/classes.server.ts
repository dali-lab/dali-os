import { resolveTermFilter } from "~/lib/terms";
import { MemberClassError, createClass, parseDestination, refreshClass, removeClass, updateClass } from "~/lib/member-class.server";
import type { PeriodMeeting } from "~/calendar/lib/dartmouth-periods";

function hhmmToMinute(s: string): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

function parseCustomMeetings(raw: Record<string, FormDataEntryValue>): PeriodMeeting[] | undefined {
  const daysStr = typeof raw.customDays === "string" ? raw.customDays : "";
  const days = daysStr
    .split(",")
    .map((n) => n.trim())
    .filter((n) => n !== "")
    .map(Number)
    .filter((n) => Number.isInteger(n) && n >= 0 && n <= 6);
  const startMin = hhmmToMinute(typeof raw.customStart === "string" ? raw.customStart : "");
  const endMin = hhmmToMinute(typeof raw.customEnd === "string" ? raw.customEnd : "");
  if (days.length === 0 || startMin === null || endMin === null || endMin <= startMin) return undefined;
  return [{ kind: "main", days, startMin, endMin }];
}

// Add / edit / remove a class. The termId comes from the form but is validated
// against the allowed set (current + upcoming terms) server-side so past/arbitrary
// term ids are rejected. Falls back to the current term when omitted.
export async function handleClassAction(
  intent: string,
  raw: Record<string, FormDataEntryValue>,
  userId: string,
  request: Request,
): Promise<Response | null> {
  const get = (k: string) => (typeof raw[k] === "string" ? (raw[k] as string) : "");
  try {
    if (intent === "class-remove") {
      const classId = get("classId");
      if (!classId) return Response.json({ error: "Missing class id" }, { status: 400 });
      await removeClass(userId, classId);
      return null;
    }

    if (intent === "class-refresh") {
      const classId = get("classId");
      if (!classId) return Response.json({ error: "Missing class id" }, { status: 400 });
      await refreshClass(userId, classId);
      return null;
    }

    // Resolve the allowed terms (current + upcoming) and validate the submitted termId.
    const termFilter = await resolveTermFilter(request, { default: "upcoming" });
    const allowedIds = termFilter.termIds ?? [];
    if (allowedIds.length === 0) {
      return Response.json({ error: "There's no active term to add classes to." }, { status: 400 });
    }
    const submittedTermId = get("termId");
    // Pick the submitted id if it's allowed; otherwise fall back to the current term
    // (or the first upcoming term if there's no current term).
    const currentTermId = termFilter.terms.find((t) => t.isCurrent)?.id ?? allowedIds[0];
    const termId = allowedIds.includes(submittedTermId) ? submittedTermId : currentTermId;

    // Load the term row (needed for date-range math in createClass/updateClass).
    const termRow = termFilter.terms.find((t) => t.id === termId);
    if (!termRow) return Response.json({ error: "Term not found." }, { status: 400 });

    const title = get("title").trim();
    if (!title) return Response.json({ error: "Give the class a name." }, { status: 400 });
    const location = get("location").trim() || null;
    const destination = parseDestination(get("destination") || "local");
    const periodCode = get("periodCode").trim() || null;
    const includeXHour = get("includeXHour") === "1" || get("includeXHour") === "on";
    let customMeetings: PeriodMeeting[] | undefined;
    if (!periodCode) {
      customMeetings = parseCustomMeetings(raw);
      if (!customMeetings) {
        return Response.json({ error: "Pick a class period, or set a custom day and time." }, { status: 400 });
      }
    }

    // Timetable-autofill provenance (all blank for a manually-entered class).
    const offeringCrn = get("offeringCrn").trim() || null;
    const courseSubject = get("courseSubject").trim() || null;
    const courseNumber = get("courseNumber").trim() || null;
    const courseSection = get("courseSection").trim() || null;

    const params = {
      userId,
      termId,
      title,
      location,
      periodCode,
      includeXHour,
      customMeetings,
      destination,
      offeringCrn,
      subject: courseSubject,
      courseNumber,
      section: courseSection,
    };
    if (intent === "class-add") {
      await createClass(params);
    } else if (intent === "class-update") {
      const classId = get("classId");
      if (!classId) return Response.json({ error: "Missing class id" }, { status: 400 });
      await updateClass(classId, params);
    } else {
      return Response.json({ error: "Unknown class action" }, { status: 400 });
    }
    return null;
  } catch (err) {
    if (err instanceof MemberClassError) return Response.json({ error: err.message }, { status: 400 });
    console.error("class action failed", err);
    return Response.json(
      { error: "Couldn't save the class. If it syncs to Google, check that calendar is still connected." },
      { status: 500 },
    );
  }
}
