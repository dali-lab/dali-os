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

export type FieldFit = "wrap" | "shrink";

export const LINE_HEIGHT = 1.156;
export const SHRINK_FLOOR = 0.4;
export const LEGACY_BOX_WIDTH = 0.7;
const MIN_BOX_WIDTH = 0.05;

export type PlacedField = {
  key: CertificateFieldKey;
  x: number;
  y: number;
  fontSize: number;
  color: string;
  align: "left" | "center" | "right";
  bold: boolean;
  w?: number;
  fit?: FieldFit;
};

export type BoxField = PlacedField & { w: number };

export type PageBox = { x: number; y: number; w: number; h: number };

export type BackgroundIssue = "pdf" | "unsupported";

const RASTER_TYPES = ["image/png", "image/jpeg", "image/jpg"];

export function backgroundIssue(contentType: string | null | undefined, key: string): BackgroundIssue | null {
  const type = contentType?.split(";")[0].trim().toLowerCase() || null;
  const ext = key.toLowerCase().split(".").pop() ?? "";
  if (type ? RASTER_TYPES.includes(type) : ["png", "jpg", "jpeg"].includes(ext)) return null;
  return type === "application/pdf" || (!type && ext === "pdf") ? "pdf" : "unsupported";
}

export function isCertificateFieldKey(v: unknown): v is CertificateFieldKey {
  return typeof v === "string" && (CERTIFICATE_FIELD_KEYS as readonly string[]).includes(v);
}

export function isBoxField(f: PlacedField): f is BoxField {
  return typeof f.w === "number" && f.w > 0;
}

export function defaultFit(key: CertificateFieldKey): FieldFit {
  return key === "studentName" ? "shrink" : "wrap";
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Coerce stored JSON into a clean PlacedField[] (drops unknown keys, bad rows and repeated keys). */
export function parsePlacedFields(raw: unknown): PlacedField[] {
  if (!Array.isArray(raw)) return [];
  const out: PlacedField[] = [];
  const seen = new Set<string>();
  for (const r of raw) {
    if (!r || typeof r !== "object") continue;
    const f = r as Record<string, unknown>;
    if (!isCertificateFieldKey(f.key) || seen.has(f.key)) continue;
    seen.add(f.key);
    const field: PlacedField = {
      key: f.key,
      x: typeof f.x === "number" ? f.x : 0.5,
      y: typeof f.y === "number" ? f.y : 0.5,
      fontSize: typeof f.fontSize === "number" ? f.fontSize : 24,
      color: typeof f.color === "string" ? f.color : "#1c2b4a",
      align: f.align === "left" || f.align === "right" ? f.align : "center",
      bold: f.bold === true,
    };
    if (typeof f.w === "number" && f.w > 0 && Number.isFinite(f.w)) {
      field.x = clamp(field.x, 0, 1 - MIN_BOX_WIDTH);
      field.w = Math.min(f.w, 1 - field.x);
      field.fit = f.fit === "shrink" ? "shrink" : "wrap";
    }
    out.push(field);
  }
  return out;
}

/** A legacy anchor field as a box that keeps its anchor where it was, narrowing the width near a page edge. */
export function upgradeLegacyField(f: PlacedField): BoxField {
  if (isBoxField(f)) return { ...f, fit: f.fit ?? "wrap" };
  const x = clamp(f.x, 0, 1);
  const limit = f.align === "center" ? 2 * Math.min(x, 1 - x) : f.align === "left" ? 1 - x : x;
  const w = Math.max(MIN_BOX_WIDTH, Math.min(LEGACY_BOX_WIDTH, limit));
  const left = f.align === "center" ? x - w / 2 : f.align === "left" ? x : x - w;
  const boxX = clamp(left, 0, 1 - w);
  return { ...f, x: boxX, w, fit: defaultFit(f.key) };
}

/** A field's box in page units. Height is one line at the field's font size. */
export function fieldBox(f: PlacedField, bgW: number, bgH: number): PageBox {
  const b = upgradeLegacyField(f);
  return { x: b.x * bgW, y: b.y * bgH, w: b.w * bgW, h: b.fontSize * LINE_HEIGHT };
}

/** The font size a shrink field draws at: the set size, scaled down to fit one line, never below the floor. */
export function shrinkFontSize(size: number, boxWidth: number, widthAtSize: number): number {
  if (!(widthAtSize > boxWidth) || !(boxWidth > 0)) return size;
  return Math.max(size * SHRINK_FLOOR, (size * boxWidth) / widthAtSize);
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
