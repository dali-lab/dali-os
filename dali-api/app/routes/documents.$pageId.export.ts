import type { Route } from "./+types/documents.$pageId.export";
import { prisma } from "~/lib/db";
import { requireAuth, isPartnerAccount } from "~/lib/auth";
import { getPageAccess } from "~/lib/pageAccess.server";
import { buildExportHtml } from "~/collab/export";
import { readDocAsBlocks } from "~/collab/read";
import { blocksToHtml, blocksToMarkdown } from "~/collab/blocknote-server";
import { renderDocumentPdf } from "~/lib/pdf/document-pdf.server";
import { normalizePageTypography } from "~/lib/page-typography";

// GET /documents/:pageId/export?format=pdf|docx|md
//
// Server-renders the document to PDF (headless Chromium over the editor's own
// markup + CSS, falling back to pdfkit), Word .docx (html-to-docx), or Markdown. The body is
// decoded from the persisted Yjs snapshot as BlockNote blocks (see
// app/collab/read.ts). Same read gate as the document page: any workspace
// type the viewer can open, archived meeting notes included.

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
    select: { id: true, title: true, archivedAt: true, meetingNoteId: true, typography: true },
  });
  if (!page || (page.archivedAt !== null && !page.meetingNoteId)) {
    return new Response("Not found", { status: 404 });
  }
  const access = await getPageAccess(auth.user.sub, page.id, request);
  if (!access.canView) return new Response("Not found", { status: 404 });

  const filename = safeFilename(page.title);
  const blocks = await readDocAsBlocks(`doc:${page.id}:body`);

  if (format === "md") {
    const body = blocks.length ? await blocksToMarkdown(blocks) : "";
    const markdown = `# ${page.title}\n\n${body}`;
    return new Response(markdown, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}.md"`,
      },
    });
  }

  if (format === "docx") {
    const html = buildExportHtml(page.title, await blocksToHtml(blocks));
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

  const pdf = await renderDocumentPdf(page.title, blocks, normalizePageTypography(page.typography));
  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}.pdf"`,
    },
  });
}
