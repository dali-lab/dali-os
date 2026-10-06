// The component library for resource pages and blog posts. Pure data: no
// React, no editor imports, safe on client and server.
//
// Every component is ONE block type (`component`, see schema/configs.ts) whose
// `kind` prop names an entry here and whose `data` prop is that entry's content
// as JSON. Adding a component is one entry in COMPONENT_KINDS plus its view in
// views.tsx — never a new node type, so the collaborative document schema does
// not change and no surface can strip a component it predates.

export type FieldType = "text" | "textarea" | "url" | "image" | "tone" | "code";

export interface FieldDef {
  key: string;
  label: string;
  type: FieldType;
  placeholder?: string;
}

export interface ComponentData {
  fields: Record<string, string>;
  items: Record<string, string>[];
}

export interface KindDef {
  kind: string;
  title: string;
  subtext: string;
  aliases: string[];
  fields: FieldDef[];
  /** Present when the component is a list: what one entry is called + holds. */
  itemLabel?: string;
  itemFields?: FieldDef[];
  defaults: ComponentData;
}

export const TONES = ["neutral", "accent", "success", "warning", "danger"] as const;
export type Tone = (typeof TONES)[number];

export function toneOf(value: string | undefined): Tone {
  return (TONES as readonly string[]).includes(value ?? "") ? (value as Tone) : "neutral";
}

const title: FieldDef = { key: "title", label: "Title", type: "text" };
const href: FieldDef = { key: "href", label: "Link", type: "url", placeholder: "https://" };
const tone: FieldDef = { key: "tone", label: "Color", type: "tone" };

export const COMPONENT_KINDS: KindDef[] = [
  {
    kind: "chips",
    title: "Quick links",
    subtext: "A row of shortcut chips",
    aliases: ["chips", "quick start", "shortcuts"],
    fields: [{ key: "label", label: "Label", type: "text" }],
    itemLabel: "Chip",
    itemFields: [{ key: "label", label: "Text", type: "text" }, href],
    defaults: {
      fields: { label: "Quick start" },
      items: [{ label: "New here", href: "" }, { label: "Templates", href: "" }],
    },
  },
  {
    kind: "cards",
    title: "Pinned cards",
    subtext: "Tagged cards for deadlines and key links",
    aliases: ["cards", "pinned", "deadline", "highlights"],
    fields: [title],
    itemLabel: "Card",
    itemFields: [
      { key: "tag", label: "Tag", type: "text" },
      tone,
      title,
      { key: "meta", label: "Detail", type: "text" },
      href,
    ],
    defaults: {
      fields: { title: "This term" },
      items: [
        { tag: "Deadline", tone: "danger", title: "Prototype due", meta: "Due Thu", href: "" },
        { tag: "Schedule", tone: "success", title: "Crit schedule", meta: "Next: Tue 7pm", href: "" },
        { tag: "Template", tone: "accent", title: "Testing template", meta: "", href: "" },
      ],
    },
  },
  {
    kind: "timeline",
    title: "Timeline",
    subtext: "Numbered steps with the current one marked",
    aliases: ["timeline", "steps", "stepper", "schedule", "progress"],
    fields: [
      title,
      { key: "note", label: "Note", type: "text" },
      { key: "current", label: "Current step number", type: "text", placeholder: "1" },
    ],
    itemLabel: "Step",
    itemFields: [{ key: "label", label: "Name", type: "text" }],
    defaults: {
      fields: { title: "Term timeline", note: "", current: "2" },
      items: [{ label: "Kickoff" }, { label: "Research" }, { label: "Crit 1" }, { label: "Demo Day" }],
    },
  },
  {
    kind: "links",
    title: "Resource list",
    subtext: "A titled group of links with descriptions",
    aliases: ["links", "resources", "list", "group"],
    fields: [title, { key: "subtitle", label: "Subtitle", type: "text" }],
    itemLabel: "Link",
    itemFields: [
      title,
      { key: "description", label: "Description", type: "text" },
      { key: "meta", label: "Detail", type: "text" },
      href,
    ],
    defaults: {
      fields: { title: "Resources", subtitle: "" },
      items: [{ title: "How it works", description: "Read this first.", meta: "", href: "" }],
    },
  },
  {
    kind: "stats",
    title: "Stats",
    subtext: "Big numbers with labels",
    aliases: ["stats", "numbers", "metrics", "infographic"],
    fields: [],
    itemLabel: "Stat",
    itemFields: [
      { key: "value", label: "Number", type: "text" },
      { key: "label", label: "Label", type: "text" },
      tone,
    ],
    defaults: {
      fields: {},
      items: [
        { value: "24", label: "Projects", tone: "accent" },
        { value: "110", label: "Members", tone: "neutral" },
        { value: "10", label: "Weeks", tone: "neutral" },
      ],
    },
  },
  {
    kind: "bars",
    title: "Bar chart",
    subtext: "Labelled horizontal bars",
    aliases: ["bars", "chart", "graph", "infographic"],
    fields: [title],
    itemLabel: "Bar",
    itemFields: [
      { key: "label", label: "Label", type: "text" },
      { key: "value", label: "Value", type: "text" },
      tone,
    ],
    defaults: {
      fields: { title: "" },
      items: [
        { label: "Design", value: "40", tone: "accent" },
        { label: "Dev", value: "55", tone: "accent" },
        { label: "PM", value: "15", tone: "accent" },
      ],
    },
  },
  {
    kind: "gallery",
    title: "Gallery",
    subtext: "A grid of images with titles and credits",
    aliases: ["gallery", "grid", "showcase", "work"],
    fields: [title, { key: "subtitle", label: "Subtitle", type: "text" }],
    itemLabel: "Piece",
    itemFields: [
      { key: "image", label: "Image", type: "image" },
      title,
      { key: "byline", label: "Credit", type: "text" },
      tone,
      href,
    ],
    defaults: {
      fields: { title: "From the lab", subtitle: "" },
      items: [
        { image: "", title: "Untitled", byline: "", tone: "accent", href: "" },
        { image: "", title: "Untitled", byline: "", tone: "success", href: "" },
        { image: "", title: "Untitled", byline: "", tone: "warning", href: "" },
      ],
    },
  },
  {
    kind: "feature",
    title: "Feature",
    subtext: "A spotlight with image, text and a button",
    aliases: ["feature", "hero", "spotlight", "banner"],
    fields: [
      { key: "image", label: "Image", type: "image" },
      { key: "eyebrow", label: "Eyebrow", type: "text" },
      title,
      { key: "body", label: "Text", type: "textarea" },
      { key: "cta", label: "Button text", type: "text" },
      href,
      tone,
    ],
    defaults: {
      fields: { image: "", eyebrow: "Today", title: "Spotlight", body: "", cta: "Open", href: "", tone: "warning" },
      items: [],
    },
  },
  {
    kind: "spacer",
    title: "Spacer",
    subtext: "Empty space between blocks",
    aliases: ["spacer", "space", "gap", "margin"],
    fields: [{ key: "height", label: "Height in px", type: "text", placeholder: "32" }],
    defaults: { fields: { height: "32" }, items: [] },
  },
  {
    kind: "code",
    title: "Custom code",
    subtext: "Your own HTML, CSS and JS in a sandbox",
    aliases: ["code", "html", "custom", "embed", "interactive", "sandbox"],
    fields: [
      { key: "html", label: "HTML", type: "code" },
      { key: "height", label: "Height in px, or full", type: "text", placeholder: "480" },
    ],
    defaults: {
      fields: {
        html: "<style>body{font-family:system-ui;margin:24px}</style>\n<h2>Hello</h2>\n<p>Edit this block to add your own HTML, CSS and JS.</p>",
        height: "320",
      },
      items: [],
    },
  },
];

const BY_KIND = new Map(COMPONENT_KINDS.map((k) => [k.kind, k]));

export function kindDef(kind: string): KindDef | undefined {
  return BY_KIND.get(kind);
}

function stringRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter((e): e is [string, string] => typeof e[1] === "string"),
  );
}

/** Decode a block's `data` prop. Never throws: bad or empty JSON reads as the
 * kind's defaults, so a component always renders something editable. */
export function parseComponentData(kind: string, json: string): ComponentData {
  const defaults = kindDef(kind)?.defaults ?? { fields: {}, items: [] };
  try {
    const raw = JSON.parse(json) as { fields?: unknown; items?: unknown };
    if (!raw || typeof raw !== "object" || !("fields" in raw)) return defaults;
    return {
      fields: stringRecord(raw.fields),
      items: Array.isArray(raw.items) ? raw.items.map(stringRecord) : [],
    };
  } catch {
    return defaults;
  }
}

/** Only web links, mail links and in-app paths. Anything else (javascript:,
 * data:) is dropped — component data is member-authored. */
export function safeHref(value: string | undefined): string | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  if (/^(https?:\/\/|mailto:)/i.test(v)) return v;
  if (v.startsWith("/") && !v.startsWith("//")) return v;
  return undefined;
}

// Custom code runs in an iframe with an opaque origin (sandbox without
// allow-same-origin): no cookies, no access to the app. The policy below also
// cuts it off from the network (no fetch/XHR/WebSocket, no form posts), leaving
// inline code plus scripts from the common public CDNs.
const CODE_CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' https://cdnjs.cloudflare.com https://cdn.jsdelivr.net https://unpkg.com",
  "style-src 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com data:",
  "img-src https: data: blob:",
  "media-src https: data: blob:",
].join("; ");

export const CODE_SANDBOX = "allow-scripts";

export function codeSrcDoc(html: string): string {
  return `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CODE_CSP}">${html}`;
}

export function codeHeight(value: string | undefined): string {
  if (value?.trim().toLowerCase() === "full") return "calc(100dvh - 160px)";
  const px = Number.parseInt(value ?? "", 10);
  return `${Number.isFinite(px) && px >= 80 ? Math.min(px, 4000) : 320}px`;
}

export function spacerHeight(value: string | undefined): string {
  const px = Number.parseInt(value ?? "", 10);
  return `${Number.isFinite(px) && px > 0 ? Math.min(px, 400) : 32}px`;
}
