import { prisma } from "~/lib/db.server";
import { ledDomainIds, requireResourceHubViewer } from "~/lib/resource-hub.server";
import { fetchLinkPreview } from "~/lib/link-preview.server";
import { safeHref } from "~/components/doc/components/kinds";

export const UPLOAD_URL_PREFIX = "/api/upload/raw?key=uploads%2F";
const MAX_TITLE = 120;
const MAX_QUESTION = 400;
const MAX_COMMENT = 2000;

export interface CritContext {
  userId: string;
  userName: string;
  domainId: string;
  domainName: string;
  pageId: string;
  canModerate: boolean;
  hub: { title: string; coverUrl: string | null; published: boolean };
}

/** A Crit Wall belongs to the domain of a domain Resource Hub; a hub with no domain has none. */
export async function loadCritContext(request: Request, pageId: string): Promise<CritContext> {
  const { user, core, userName } = await requireResourceHubViewer(request);
  const page = await prisma.resourceHubPage.findUnique({
    where: { id: pageId },
    select: { id: true, domainId: true, title: true, coverUrl: true, publishedAt: true, domain: { select: { displayName: true } } },
  });
  if (!page?.domainId) throw new Response("Not found", { status: 404 });
  const led = core ? [] : await ledDomainIds(user.sub);
  return {
    userId: user.sub,
    userName,
    domainId: page.domainId,
    domainName: page.domain?.displayName ?? "",
    pageId: page.id,
    canModerate: core || led.includes(page.domainId),
    hub: { title: page.title, coverUrl: page.coverUrl, published: !!page.publishedAt },
  };
}

export const displayName = (u: { firstName: string | null; lastName: string | null } | null) =>
  [u?.firstName, u?.lastName].filter(Boolean).join(" ") || "Member";

type Person = { firstName: string | null; lastName: string | null } | null;

export interface SubmissionRow {
  id: string;
  title: string;
  question: string | null;
  kind: string;
  url: string;
  previewUrl: string | null;
  fileName: string | null;
  anonymous: boolean;
  authorId: string | null;
  author: Person;
  createdAt: Date;
  _count?: { comments: number };
}

/** What the client sees of a submission. An anonymous post carries no author name or id at all. */
export function serializeSubmission(row: SubmissionRow, viewerId: string, canModerate: boolean) {
  return {
    id: row.id,
    title: row.title,
    question: row.question,
    kind: row.kind,
    url: row.url,
    previewUrl: row.previewUrl,
    fileName: row.fileName,
    anonymous: row.anonymous,
    authorName: row.anonymous ? null : displayName(row.author),
    mine: row.authorId === viewerId,
    canDelete: row.authorId === viewerId || canModerate,
    commentCount: row._count?.comments ?? 0,
    createdAt: row.createdAt.toISOString(),
  };
}

export interface CommentRow {
  id: string;
  parentId: string | null;
  body: string;
  x: number | null;
  y: number | null;
  authorId: string | null;
  author: Person;
  createdAt: Date;
}

/** Pinned top-level comments are numbered 1..n in the order they were placed. */
export function serializeComments(rows: CommentRow[], viewerId: string, canModerate: boolean) {
  const ordered = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  let pin = 0;
  return ordered.map((c) => ({
    id: c.id,
    parentId: c.parentId,
    body: c.body,
    x: c.parentId ? null : c.x,
    y: c.parentId ? null : c.y,
    pin: !c.parentId && c.x !== null && c.y !== null ? ++pin : null,
    authorName: displayName(c.author),
    mine: c.authorId === viewerId,
    canDelete: c.authorId === viewerId || canModerate,
    createdAt: c.createdAt.toISOString(),
  }));
}

export type SubmissionInput = {
  kind: "image" | "file" | "link";
  url: string;
  fileName: string | null;
  title: string;
  question: string | null;
  anonymous: boolean;
};

const clean = (v: FormDataEntryValue | null, max: number) =>
  String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** Validates the share form. Uploads must be the app's own upload URLs; links must be web links. */
export function parseSubmissionForm(form: FormData): { ok: true; value: SubmissionInput } | { ok: false; error: string } {
  const kind = String(form.get("kind") ?? "");
  const rawUrl = String(form.get("url") ?? "").trim();
  const anonymous = form.get("anonymous") === "1";
  const title = clean(form.get("title"), MAX_TITLE);
  const question = clean(form.get("question"), MAX_QUESTION) || null;
  const fileName = clean(form.get("fileName"), 200) || null;

  if (kind === "image" || kind === "file") {
    if (!rawUrl.startsWith(UPLOAD_URL_PREFIX)) return { ok: false, error: "Upload a file or paste a link." };
    return { ok: true, value: { kind, url: rawUrl, fileName, title, question, anonymous } };
  }
  if (kind === "link") {
    const href = safeHref(rawUrl);
    if (!href || !/^https?:\/\//i.test(href)) return { ok: false, error: "Enter a web link, like https://…" };
    return { ok: true, value: { kind, url: href, fileName: null, title, question, anonymous } };
  }
  return { ok: false, error: "Upload a file or paste a link." };
}

export function parseCommentForm(form: FormData): { ok: true; value: { body: string; x: number | null; y: number | null; parentId: string | null } } | { ok: false; error: string } {
  const body = String(form.get("body") ?? "").trim().slice(0, MAX_COMMENT);
  if (!body) return { ok: false, error: "Write a comment." };
  const num = (k: string) => {
    const raw = form.get(k);
    if (raw === null || raw === "") return null;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 && n <= 1 ? n : NaN;
  };
  const x = num("x");
  const y = num("y");
  if (Number.isNaN(x) || Number.isNaN(y) || (x === null) !== (y === null)) return { ok: false, error: "Invalid position." };
  const parentId = String(form.get("parentId") ?? "") || null;
  return { ok: true, value: { body, x: parentId ? null : x, y: parentId ? null : y, parentId } };
}

/** The title to store: what the poster typed, else the file name, else the page's own title or its host. */
export async function resolveSubmission(input: SubmissionInput): Promise<{ title: string; previewUrl: string | null }> {
  if (input.kind !== "link") {
    return { title: input.title || input.fileName?.replace(/\.[^.]+$/, "") || "Untitled work", previewUrl: null };
  }
  const preview = await fetchLinkPreview(input.url);
  const host = (() => {
    try {
      return new URL(input.url).hostname.replace(/^www\./, "");
    } catch {
      return "Link";
    }
  })();
  return { title: input.title || (preview?.title ?? "").slice(0, MAX_TITLE) || host, previewUrl: preview?.image ?? null };
}
