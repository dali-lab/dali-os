// Client-safe shared shapes for certificate templates. The template editor
// (client) and the PDF/web renderers (server) both import from here so the
// placed-field JSON stays in one definition. No server-only imports.

export const CERTIFICATE_FIELD_KEYS = [
  "studentName",
  "offeringTitle",
  "dateRange",
  "instructors",
  "issuedDate",
] as const;

export type CertificateFieldKey = (typeof CERTIFICATE_FIELD_KEYS)[number];

export const CERTIFICATE_FIELD_LABELS: Record<CertificateFieldKey, string> = {
  studentName: "Student name",
  offeringTitle: "Course title",
  dateRange: "Date range",
  instructors: "Instructors",
  issuedDate: "Issued date",
};

/** Placeholder values shown in the editor so the operator can eyeball layout. */
export const CERTIFICATE_FIELD_SAMPLE: Record<CertificateFieldKey, string> = {
  studentName: "Ada Lovelace",
  offeringTitle: "Introduction to Interaction Design",
  dateRange: "Sep 1 – Oct 15, 2026",
  instructors: "Jane Doe, John Smith",
  issuedDate: "Oct 20, 2026",
};

/**
 * A dynamic field placed on the background. `x`/`y` are 0..1 fractions of the
 * page (the anchor point); `align` decides whether that anchor is the text's
 * left edge, centre, or right edge — the PDF renderer and the editor preview
 * apply the same anchor math so placement is WYSIWYG. `fontSize` is in page
 * units (the page is sized to the background's pixel dimensions, 1px = 1pt).
 */
export type PlacedField = {
  key: CertificateFieldKey;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  align: "left" | "center" | "right";
  bold: boolean;
};

export function isCertificateFieldKey(v: unknown): v is CertificateFieldKey {
  return typeof v === "string" && (CERTIFICATE_FIELD_KEYS as readonly string[]).includes(v);
}

/** Coerce stored JSON into a clean PlacedField[] (drops unknown keys / bad rows). */
export function parsePlacedFields(raw: unknown): PlacedField[] {
  if (!Array.isArray(raw)) return [];
  const out: PlacedField[] = [];
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const f = r as Record<string, unknown>;
    if (!isCertificateFieldKey(f.key)) continue;
    out.push({
      key: f.key,
      x: typeof f.x === "number" ? f.x : 0.5,
      y: typeof f.y === "number" ? f.y : 0.5,
      fontSize: typeof f.fontSize === "number" ? f.fontSize : 24,
      color: typeof f.color === "string" ? f.color : "#1c2b4a",
      align:
        f.align === "left" || f.align === "right" ? f.align : "center",
      bold: f.bold === true,
    });
  }
  return out;
}

/** The dynamic value for a field, given a resolved certificate. */
export function certificateFieldValue(
  key: CertificateFieldKey,
  cert: {
    studentName: string;
    offeringTitle: string;
    dateRange: string;
    instructors: string;
    issuedDate: string;
  },
): string {
  return cert[key];
}
