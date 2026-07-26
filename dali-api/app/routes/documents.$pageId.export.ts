import type { Route } from "./+types/documents.$pageId.export";
import { prisma } from "~/lib/db";
import { requireAuth, isPartnerAccount } from "~/lib/auth";
import { isCore } from "~/lib/roles";
import {
  collabDocToProseMirror,
  collabDocToHtml,
  buildExportHtml,
} from "~/collab/export";
import { renderProseMirrorToPdf } from "~/collab/export-pdf";
import { renderMarkdown } from "~/collab/export-markdown";

// GET /documents/:pageId/export?format=pdf|docx|md
//
// Server-renders the document to PDF (pdfkit — pure JS, runs under --omit=dev
// on the Alpine runtime), Word .docx (html-to-docx), or Markdown. The body is
// decoded from the persisted Yjs snapshot (see app/collab/export.ts). Same read
// gate as the document page (live Project page + isCore).

function safeFilename(title: string): string {
  return title.replace(/[^A-Za-z0-9 ._-]/g, "").trim().replace(/\s+/g, "_") || "document";
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return new Response("Unauthorized", { status: 401 });
  if (auth.user.type === "applicant") return new Response("Forbidden", { status: 403 });
  if (await isPartnerAccount(auth)) return new Response("Forbidden", { status: 403 });

  const url = new URL(request.url);
  const rawFormat = url.searchParams.get("format");
  const format = rawFormat === "docx" ? "docx" : rawFormat === "md" ? "md" : "pdf";

  const page = await prisma.page.findUnique({
    where: { id: params.pageId },
    select: { id: true, title: true, workspaceType: true, archivedAt: true },
  });
  if (!page || page.workspaceType !== "Project" || page.archivedAt !== null) {
    return new Response("Not found", { status: 404 });
  }
  if (!(await isCore(auth.user.sub))) {
    return new Response("Forbidden", { status: 403 });
  }

  const filename = safeFilename(page.title);

  if (format === "md") {
    const json = await collabDocToProseMirror(`doc:${page.id}:body`);
    const body = json.content?.length ? renderMarkdown(json) : "";
    const markdown = `# ${page.title}\n\n${body}`;
    return new Response(markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}.md"`,
      },
    });
  }

  if (format === "docx") {
    const bodyHtml = await collabDocToHtml(`doc:${page.id}:body`);
    const html = buildExportHtml(page.title, bodyHtml);
    const HTMLtoDOCX = (await import("html-to-docx")).default;
    const out = await HTMLtoDOCX(html, null, {
      title: page.title,
      margins: { top: 720, right: 720, bottom: 720, left: 720 },
    });
    const buffer = out instanceof ArrayBuffer ? Buffer.from(out) : (out as Buffer);
    return new Response(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "Content-Disposition": `attachment; filename="${filename}.docx"`,
      },
    });
  }

  const json = await collabDocToProseMirror(`doc:${page.id}:body`);
  const pdf = await renderProseMirrorToPdf(page.title, json);
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}.pdf"`,
    },
  });
}
