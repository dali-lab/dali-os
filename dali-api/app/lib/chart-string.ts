// Dartmouth chart string parsing and validation. Client-safe on purpose (no
// Prisma import) so the MCP tool, the project form and the unit tests can all
// share one implementation — CI runs the unit suite without a generated Prisma
// client, so anything that reaches ~/lib/db can't be imported from a test.
//
// Two formats coexist permanently; `Project.chartStringType` already records
// which. They are not eras — a project has one or the other depending on how it
// is funded.
//
//   GL     entity . org . funding . activity . subactivity [. natclass]
//          20.330.161028.128512.4000
//          Natclass is added by the accounting line, not by a hire record, so
//          payroll strings stop at five segments and reimbursements carry six.
//
//   PTAEO  project . task . award . expenditureType . org
//          521765.5000.B04373.XXXXX.330
//          Per Dartmouth OSP: project 6 digits; task 4 digits (5000-5999 =
//          externally sponsored, 6000-6999 = internal cost share); award 6
//          alphanumeric; expenditure type; org 3 digits.
//
// The identifying segment is the same six-digit code space in both: GL calls it
// Activity and puts it fourth, PTAEO calls it Project and puts it first. That
// is `projectCode`, and it is what payroll attribution joins on.

export type ChartStringType = "GL" | "PTAEO";

/** GL subactivity codes seen across FY23-FY27 actuals. Advisory, not closed —
 *  DALI is taking control of more of this segment, so an unknown value warns
 *  rather than failing. */
export const GL_SUBACTIVITIES: Record<string, string> = {
  "0000": "Default",
  "1500": "Student Meetings",
  "2000": "Full Stack",
  "3000": "Programs",
  "4000": "Projects",
  "5000": "External Funding",
};

/** DALI Lab's org since the ~2026-07-01 migration off Magnuson (722). */
export const DALI_ORG = "330";

/** Autolink artefacts seen in stored values: a client read the leading digits
 *  as a phone number. Stripping the scheme is not a repair — see `parse`. */
const URI_SCHEME = /^(?:tel|mailto|callto|sms):/i;

const GL_5 = /^(\d{2})\.(\d{3})\.(\d{6})\.(\d{6})\.([0-9A-Z]{4})$/;
const GL_6 = /^(\d{2})\.(\d{3})\.(\d{6})\.(\d{6})\.([0-9A-Z]{4})\.(\d{4})$/;
const PTAEO_5 = /^(\d{6})\.(\d{4})\.([0-9A-Z]{6})\.([0-9A-Z]{5})\.(\d{3})$/;

/** A run of X's is the placeholder OSP writes for a segment it fills per
 *  transaction. Legal in exactly one position — see `parse`. */
const X_RUN = /^X+$/;

export type ChartStringIssue = {
  code: string;
  message: string;
};

export type ParsedChartString = {
  /** As given, untouched. Always stored so the audit trail starts at the source. */
  raw: string;
  /** Trimmed, scheme-stripped, upper-cased. Never a semantic repair. */
  normalized: string;
  type: ChartStringType | null;
  segments: string[];
  /** GL segment 4 (Activity) or PTAEO segment 1 (Project). The join key. */
  projectCode: string | null;
  /** GL only. */
  subactivity: string | null;
  /** GL segment 2, PTAEO segment 5. */
  org: string | null;
  /** PTAEO segment 3. */
  awardCode: string | null;
  /** GL sixth segment when present. */
  natclass: string | null;
  /** Non-empty means the string must not be stored. */
  errors: ChartStringIssue[];
  /** Worth surfacing; never blocks a write. */
  warnings: ChartStringIssue[];
};

export function normalizeChartString(raw: string): string {
  return raw.trim().replace(URI_SCHEME, "").trim().toUpperCase();
}

/** Which format a normalized string looks like, by its first segment: a GL
 *  entity is two digits, a PTAEO project is six. Returns null when neither. */
function detectType(segments: string[]): ChartStringType | null {
  const head = segments[0] ?? "";
  if (/^\d{2}$/.test(head)) return "GL";
  if (/^\d{6}$/.test(head)) return "PTAEO";
  return null;
}

/**
 * Parse and validate. `declaredType` is the caller's claim (the stored
 * `chartStringType`); a disagreement with the detected shape warns rather than
 * failing, because the detected shape is the more trustworthy of the two.
 *
 * Errors mean "do not store this". Warnings mean "store it, but say something":
 * an unknown subactivity or an unexpected org may be Dartmouth changing
 * something, and a validator that hard-fails on those blocks a legitimate
 * account at the worst possible moment.
 */
export function parseChartString(
  raw: string,
  declaredType?: ChartStringType | null,
): ParsedChartString {
  const normalized = normalizeChartString(raw);
  const segments = normalized.length > 0 ? normalized.split(".") : [];
  const errors: ChartStringIssue[] = [];
  const warnings: ChartStringIssue[] = [];

  const out: ParsedChartString = {
    raw,
    normalized,
    type: null,
    segments,
    projectCode: null,
    subactivity: null,
    org: null,
    awardCode: null,
    natclass: null,
    errors,
    warnings,
  };

  if (normalized === "") {
    errors.push({ code: "empty", message: "Chart string is empty." });
    return out;
  }

  // A stripped URI scheme is a signal, not a fix. `tel:5226935000.B04560…`
  // lost the dot between 522693 and 5000 when a client linkified it; the digits
  // are still fused after the scheme comes off, so the value has to be retyped
  // from the source rather than silently "repaired" into a plausible string.
  if (URI_SCHEME.test(raw.trim())) {
    errors.push({
      code: "uri_scheme",
      message:
        "Value looks like an autolinked phone/mail link, which loses a separator. Re-enter it from the source document.",
    });
  }

  const type = detectType(segments);
  if (!type) {
    errors.push({
      code: "unrecognized",
      message:
        "Not a recognizable GL or PTAEO chart string. GL starts with a 2-digit entity, PTAEO with a 6-digit project.",
    });
    return out;
  }
  out.type = type;

  if (declaredType && declaredType !== type) {
    warnings.push({
      code: "type_mismatch",
      message: `Declared as ${declaredType} but the shape is ${type}.`,
    });
  }

  if (type === "GL") {
    const m = GL_6.exec(normalized) ?? GL_5.exec(normalized);
    if (!m) {
      errors.push({
        code: "gl_shape",
        message:
          "Expected GL entity.org.funding.activity.subactivity (5 segments, or 6 with a natclass).",
      });
      return out;
    }
    const [, , org, , activity, subactivity, natclass] = m;
    out.org = org;
    out.projectCode = activity;
    out.subactivity = subactivity;
    out.natclass = natclass ?? null;

    // A GL subactivity names the kind of work and is never a placeholder.
    if (X_RUN.test(subactivity)) {
      errors.push({
        code: "gl_subactivity_placeholder",
        message:
          "GL subactivity must be a real code (e.g. 4000 Projects), not a placeholder.",
      });
    } else if (!(subactivity in GL_SUBACTIVITIES)) {
      warnings.push({
        code: "gl_subactivity_unknown",
        message: `Subactivity ${subactivity} isn't one of the known codes.`,
      });
    }
  } else {
    const m = PTAEO_5.exec(normalized);
    if (!m) {
      errors.push({
        code: "ptaeo_shape",
        message:
          "Expected PTAEO project.task.award.expenditureType.org (5 segments).",
      });
      return out;
    }
    const [, project, task, award, expType, org] = m;
    out.projectCode = project;
    out.awardCode = award;
    out.org = org;

    // XXXXX in the expenditure type is correct and expected: DALI submits
    // payroll that way and the type is resolved downstream per transaction.
    // Anywhere else it means a segment went missing.
    for (const [i, seg] of [project, task, award, org].entries()) {
      if (X_RUN.test(seg)) {
        errors.push({
          code: "ptaeo_placeholder",
          message: `Segment ${[1, 2, 3, 5][i]} is a placeholder; only the expenditure type may be XXXXX.`,
        });
      }
    }

    const taskNum = Number(task);
    if (taskNum < 5000 || taskNum > 6999) {
      warnings.push({
        code: "ptaeo_task_range",
        message: `Task ${task} is outside 5000-5999 (sponsored) and 6000-6999 (internal cost share).`,
      });
    }
  }

  if (out.org && out.org !== DALI_ORG) {
    warnings.push({
      code: "org_not_current",
      message: `Org ${out.org} is not DALI Lab's current org (${DALI_ORG}).`,
    });
  }

  return out;
}

/** True when the string is safe to store. */
export function isValidChartString(
  raw: string,
  declaredType?: ChartStringType | null,
): boolean {
  return parseChartString(raw, declaredType).errors.length === 0;
}

/** How the work on a chart string is paid for — the lab's four project types,
 *  matching PROJECT_TYPES in app/admin/lib/budget.shared.ts.
 *
 *  Not an advance-vs-funded distinction: a RAPPORT advance account and the
 *  funded award that follows carry the same Project.Task.Award, so that is a
 *  status of the award in RAPPORT, not a property of the string.
 *
 *  Lives here rather than in chart-string.server.ts because the project panel
 *  renders the dropdown client-side — a constant imported from a server module
 *  drags Prisma into the browser bundle. Same reason budget.shared.ts exists. */
export const PROJECT_FUNDING_TYPES = [
  "DALI_GL",
  "TRANSFER_GL",
  "DALI_PTAEO",
  "OTHER_PTAEO",
] as const;
export type ProjectFundingType = (typeof PROJECT_FUNDING_TYPES)[number];

/** Display labels, in the order the dropdown offers them. */
export const PROJECT_FUNDING_TYPE_LABELS: Record<ProjectFundingType, string> = {
  DALI_GL: "DALI GL",
  TRANSFER_GL: "Transfer GL",
  DALI_PTAEO: "DALI PTAEO",
  OTHER_PTAEO: "Other PTAEO",
};
