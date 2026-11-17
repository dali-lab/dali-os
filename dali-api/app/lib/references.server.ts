import { displayName, UPLOAD_URL_PREFIX } from "~/lib/crit.server";
import { fetchLinkPreview } from "~/lib/link-preview.server";
import { safeHref } from "~/components/doc/components/kinds";
import { prisma } from "~/lib/db.server";
import { decodeCursor, keysetAfter, keysetPage } from "~/lib/pagination";

export { loadCritContext as loadReferencesContext } from "~/lib/crit.server";

export const REFERENCES_PAGE_SIZE = 24;
const AUTHOR = { select: { firstName: true, lastName: true } };
const MAX_TITLE = 120;
const MAX_CREATOR = 120;
const MAX_NOTE = 400;
const IMAGE_URL = /\.(png|jpe?g|gif|webp|avif|svg)(?:[?#]|$)/i;

const clean = (v: FormDataEntryValue | null, max: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export interface ReferenceRow {
  id: string;
  title: string;
  kind: string;
  url: string;
  previewUrl: string | null;
  fileName: string | null;
  creatorName: string | null;
  daliMade: boolean;
  note: string | null;
  authorId: string | null;
  author: { firstName: string | null; lastName: string | null } | null;
  createdAt: Date;
}

/** What the client sees. A DALI-made reference is credited to the member who posted it. */
export function serializeReference(row: ReferenceRow, viewerId: string, canModerate: boolean) {
  const sharedBy = displayName(row.author);
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    url: row.url,
    previewUrl: row.previewUrl,
    fileName: row.fileName,
    creatorName: row.daliMade ? sharedBy : row.creatorName,
    sharedBy,
    daliMade: row.daliMade,
    note: row.note,
    mine: row.authorId === viewerId,
    canDelete: row.authorId === viewerId || canModerate,
    createdAt: row.createdAt.toISOString(),
  };
}

export type ReferenceView = ReturnType<typeof serializeReference>;

type Viewer = { userId: string; domainId: string; canModerate: boolean };

export async function loadReferencesPage(ctx: Viewer, cursor: string | null) {
  const rows = await prisma.domainReference.findMany({
    where: { domainId: ctx.domainId, ...keysetAfter("createdAt", decodeCursor(cursor)) },
    include: { author: AUTHOR },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: REFERENCES_PAGE_SIZE + 1,
  });
  const page = keysetPage(rows, REFERENCES_PAGE_SIZE, (r) => ({ at: r.createdAt.toISOString(), id: r.id }));
  return { items: page.items.map((r) => serializeReference(r, ctx.userId, ctx.canModerate)), nextCursor: page.nextCursor };
}

/** Current versions of specific references, for a gallery that holds later pages or a link to one. Missing ids are omitted. */
export async function loadReferencesByIds(ctx: Viewer, ids: string[]) {
  if (ids.length === 0) return [];
  const rows = await prisma.domainReference.findMany({
    where: { domainId: ctx.domainId, id: { in: ids.slice(0, REFERENCES_PAGE_SIZE * 10) } },
    include: { author: AUTHOR },
  });
  return rows.map((r) => serializeReference(r, ctx.userId, ctx.canModerate));
}

type Credit = { daliMade: boolean; creatorName: string | null };

function parseCredit(form: FormData): Credit {
  const daliMade = form.get("creator") === "mine";
  return { daliMade, creatorName: daliMade ? null : clean(form.get("creatorName"), MAX_CREATOR) || null };
}

export type ReferenceInput = Credit & {
  kind: "image" | "file" | "link";
  url: string;
  fileName: string | null;
  title: string;
  note: string | null;
};

/** Validates the add form. Uploads must be the app's own upload URLs; links must be web links. */
export function parseReferenceForm(form: FormData): { ok: true; value: ReferenceInput } | { ok: false; error: string } {
  const kind = String(form.get("kind") ?? "");
  const rawUrl = String(form.get("url") ?? "").trim();
  const base = { title: clean(form.get("title"), MAX_TITLE), note: clean(form.get("note"), MAX_NOTE) || null, ...parseCredit(form) };

  if (kind === "image" || kind === "file") {
    if (!rawUrl.startsWith(UPLOAD_URL_PREFIX)) return { ok: false, error: "Upload a file or paste a link." };
    return { ok: true, value: { ...base, kind, url: rawUrl, fileName: clean(form.get("fileName"), 200) || null } };
  }
  if (kind === "link") {
    const href = safeHref(rawUrl);
    if (!href || !/^https?:\/\//i.test(href)) return { ok: false, error: "Enter a web link, like https://…" };
    return { ok: true, value: { ...base, kind, url: href, fileName: null } };
  }
  return { ok: false, error: "Upload a file or paste a link." };
}

export function parseReferenceEdit(form: FormData): { ok: true; value: Credit & { title: string; note: string | null } } | { ok: false; error: string } {
  const title = clean(form.get("title"), MAX_TITLE);
  if (!title) return { ok: false, error: "Add a title." };
  return { ok: true, value: { title, note: clean(form.get("note"), MAX_NOTE) || null, ...parseCredit(form) } };
}

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "Link";
  }
};

/** The title to store: what the poster typed, else the file name, else the page's own title or its host. */
export async function resolveReference(input: ReferenceInput): Promise<{ title: string; previewUrl: string | null }> {
  if (input.kind !== "link") {
    return { title: input.title || input.fileName?.replace(/\.[^.]+$/, "") || "Untitled reference", previewUrl: null };
  }
  if (IMAGE_URL.test(input.url)) {
    return { title: input.title || hostOf(input.url), previewUrl: input.url.startsWith("https:") ? input.url : null };
  }
  const preview = await fetchLinkPreview(input.url);
  return { title: input.title || (preview?.title ?? "").slice(0, MAX_TITLE) || hostOf(input.url), previewUrl: preview?.image ?? null };
}
