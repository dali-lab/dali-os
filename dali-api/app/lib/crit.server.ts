import { prisma } from "~/lib/db.server";
import { canEditResourceHub, ledDomainIds, requireResourceHubViewer } from "~/lib/resource-hub.server";
import { fetchLinkPreview } from "~/lib/link-preview.server";
import { safeHref } from "~/components/doc/components/kinds";

export const UPLOAD_URL_PREFIX = "/api/upload/raw?key=uploads%2F";
const MAX_TITLE = 120;
const MAX_QUESTION = 400;

export interface CritContext {
  userId: string;
  userName: string;
  domainId: string;
  domainName: string;
  pageId: string;
  canModerate: boolean;
}

/** A Crit Wall belongs to the domain of a domain Resource Hub; a hub with no domain has none. */
export async function loadCritContext(request: Request, pageId: string): Promise<CritContext> {
  const { user, core, userName } = await requireResourceHubViewer(request);
  const page = await prisma.resourceHubPage.findUnique({
    where: { id: pageId },
    select: { id: true, domainId: true, createdById: true, publishedAt: true, domain: { select: { displayName: true } } },
  });
  if (!page?.domainId) throw new Response("Not found", { status: 404 });
  if (!page.publishedAt && !(await canEditResourceHub(user.sub, page))) throw new Response("Not found", { status: 404 });
  const led = core ? [] : await ledDomainIds(user.sub);
  return {
    userId: user.sub,
    userName,
    domainId: page.domainId,
    domainName: page.domain?.displayName ?? "",
    pageId: page.id,
    canModerate: core || led.includes(page.domainId),
  };
}

export const displayName = (u: { firstName: string | null; lastName: string | null } | null) =>
  [u?.firstName, u?.lastName].filter(Boolean).join(" ") || "Member";

type Person = { firstName: string | null; lastName: string | null } | null;

export async function critCommentCounts(submissionIds: string[]): Promise<Map<string, number>> {
  if (submissionIds.length === 0) return new Map();
  const rows = await prisma.docComment.groupBy({
    by: ["targetId"],
    where: { targetType: "crit", targetId: { in: submissionIds } },
    _count: { _all: true },
  });
  return new Map(rows.map((r) => [r.targetId, r._count._all]));
}

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
}

/** What the client sees of a submission. An anonymous post carries no author name or id at all. */
export function serializeSubmission(row: SubmissionRow, viewerId: string, canModerate: boolean, commentCount = 0) {
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
    canModerate,
    commentCount,
    createdAt: row.createdAt.toISOString(),
  };
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
