// Certificate template CRUD, binding, and render resolution. Templates are a
// background image + placed dynamic fields (see certificate-fields.ts). A
// template is bound to an offering (EducationCertificateBinding) or serves as
// the single lab-wide default (isDefault); issuance stamps the resolved id onto
// the EducationCertificate. Gated by the `certificate-templates` flag at the
// callers (issuance + admin UI).

import { prisma } from "~/lib/db";
import { getObjectBytes, getDownloadUrl } from "~/lib/s3";
import { parsePlacedFields, type PlacedField } from "./certificate-fields";

export type CertificateTemplateSummary = {
  id: string;
  name: string;
  isDefault: boolean;
  fieldCount: number;
  createdAt: Date;
};

/** Library list for the Core management page (newest first, non-archived). */
export async function listCertificateTemplates(): Promise<CertificateTemplateSummary[]> {
  const rows = await prisma.certificateTemplate.findMany({
    where: { archivedAt: null },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    select: { id: true, name: true, isDefault: true, fields: true, createdAt: true },
  });
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    isDefault: t.isDefault,
    fieldCount: parsePlacedFields(t.fields).length,
    createdAt: t.createdAt,
  }));
}

/** Full template for the editor (fields + background metadata). */
export async function getCertificateTemplate(id: string) {
  const t = await prisma.certificateTemplate.findFirst({
    where: { id, archivedAt: null },
    select: {
      id: true,
      name: true,
      backgroundKey: true,
      backgroundContentType: true,
      bgWidth: true,
      bgHeight: true,
      fields: true,
      isDefault: true,
    },
  });
  if (!t) return null;
  return { ...t, fields: parsePlacedFields(t.fields) };
}

export async function createCertificateTemplate(args: {
  name: string;
  backgroundKey: string;
  backgroundContentType: string;
  bgWidth: number;
  bgHeight: number;
  actorId: string;
}): Promise<{ id: string } | { error: string; status: number }> {
  const name = args.name.trim();
  if (!name) return { error: "Name is required", status: 400 };
  if (!args.backgroundKey.startsWith("uploads/"))
    return { error: "Invalid background image", status: 400 };
  if (!(args.bgWidth > 0 && args.bgHeight > 0))
    return { error: "Background dimensions are required", status: 400 };
  const created = await prisma.certificateTemplate.create({
    data: {
      name,
      backgroundKey: args.backgroundKey,
      backgroundContentType: args.backgroundContentType,
      bgWidth: Math.round(args.bgWidth),
      bgHeight: Math.round(args.bgHeight),
      createdById: args.actorId,
      fields: [],
    },
    select: { id: true },
  });
  return created;
}

async function assertTemplate(id: string) {
  const t = await prisma.certificateTemplate.findFirst({
    where: { id, archivedAt: null },
    select: { id: true },
  });
  return t;
}

/** Persist the placed-field layout from the editor. */
export async function saveCertificateTemplateFields(args: {
  id: string;
  fields: PlacedField[];
}): Promise<{ ok: true } | { error: string; status: number }> {
  if (!(await assertTemplate(args.id))) return { error: "Template not found", status: 404 };
  // Round-trip through the parser so only valid rows land in the DB.
  await prisma.certificateTemplate.update({
    where: { id: args.id },
    data: { fields: parsePlacedFields(args.fields) },
  });
  return { ok: true };
}

export async function renameCertificateTemplate(args: {
  id: string;
  name: string;
}): Promise<{ ok: true } | { error: string; status: number }> {
  const name = args.name.trim();
  if (!name) return { error: "Name is required", status: 400 };
  if (!(await assertTemplate(args.id))) return { error: "Template not found", status: 404 };
  await prisma.certificateTemplate.update({ where: { id: args.id }, data: { name } });
  return { ok: true };
}

export async function archiveCertificateTemplate(
  id: string,
): Promise<{ ok: true } | { error: string; status: number }> {
  if (!(await assertTemplate(id))) return { error: "Template not found", status: 404 };
  // Drop any per-offering bindings that point here so resolution falls back
  // cleanly to the default / built-in design.
  await prisma.$transaction([
    prisma.educationCertificateBinding.deleteMany({ where: { templateId: id } }),
    prisma.certificateTemplate.update({
      where: { id },
      data: { archivedAt: new Date(), isDefault: false },
    }),
  ]);
  return { ok: true };
}

/** Make one template the lab-wide default (clearing any prior default). */
export async function setDefaultCertificateTemplate(
  id: string,
): Promise<{ ok: true } | { error: string; status: number }> {
  if (!(await assertTemplate(id))) return { error: "Template not found", status: 404 };
  await prisma.$transaction([
    prisma.certificateTemplate.updateMany({
      where: { isDefault: true, id: { not: id } },
      data: { isDefault: false },
    }),
    prisma.certificateTemplate.update({ where: { id }, data: { isDefault: true } }),
  ]);
  return { ok: true };
}

/** Clear the lab-wide default entirely (fall back to the built-in design). */
export async function clearDefaultCertificateTemplate(): Promise<{ ok: true }> {
  await prisma.certificateTemplate.updateMany({
    where: { isDefault: true },
    data: { isDefault: false },
  });
  return { ok: true };
}

/** Bind (or clear, when templateId is null) an offering's certificate template. */
export async function bindOfferingCertificateTemplate(args: {
  offeringId: string;
  templateId: string | null;
}): Promise<{ ok: true } | { error: string; status: number }> {
  if (args.templateId === null) {
    await prisma.educationCertificateBinding.deleteMany({
      where: { offeringId: args.offeringId },
    });
    return { ok: true };
  }
  if (!(await assertTemplate(args.templateId)))
    return { error: "Template not found", status: 404 };
  await prisma.educationCertificateBinding.upsert({
    where: { offeringId: args.offeringId },
    create: { offeringId: args.offeringId, templateId: args.templateId },
    update: { templateId: args.templateId },
  });
  return { ok: true };
}

/** The template currently bound to an offering (override or null → default). */
export async function getOfferingCertificateBinding(offeringId: string) {
  const b = await prisma.educationCertificateBinding.findUnique({
    where: { offeringId },
    select: { templateId: true },
  });
  return b?.templateId ?? null;
}

/**
 * Which template applies to an offering, resolved at issue time:
 * per-offering binding → lab-wide default → null (built-in design). Archived
 * templates are skipped so a deleted design never sticks to new certificates.
 */
export async function resolveCertificateTemplateId(offeringId: string): Promise<string | null> {
  const binding = await prisma.educationCertificateBinding.findUnique({
    where: { offeringId },
    select: { templateId: true },
  });
  if (binding) {
    const bound = await prisma.certificateTemplate.findFirst({
      where: { id: binding.templateId, archivedAt: null },
      select: { id: true },
    });
    if (bound) return bound.id;
  }
  const def = await prisma.certificateTemplate.findFirst({
    where: { isDefault: true, archivedAt: null },
    select: { id: true },
  });
  return def?.id ?? null;
}

export type CertificateRenderTemplate = {
  bgWidth: number;
  bgHeight: number;
  fields: PlacedField[];
  background: Buffer;
  contentType: string;
};

/**
 * Everything the renderer needs for a template-backed certificate: the
 * background image bytes + placed fields. Returns null when the template is
 * gone/archived or its background can't be fetched — callers fall back to the
 * built-in design.
 */
export async function getCertificateRenderTemplate(
  templateId: string,
): Promise<CertificateRenderTemplate | null> {
  const t = await prisma.certificateTemplate.findFirst({
    where: { id: templateId, archivedAt: null },
    select: { backgroundKey: true, bgWidth: true, bgHeight: true, fields: true },
  });
  if (!t) return null;
  try {
    const { body, contentType } = await getObjectBytes(t.backgroundKey);
    return {
      bgWidth: t.bgWidth,
      bgHeight: t.bgHeight,
      fields: parsePlacedFields(t.fields),
      background: body,
      contentType: contentType ?? "image/png",
    };
  } catch {
    return null;
  }
}

export type CertificateWebTemplate = {
  bgUrl: string;
  bgWidth: number;
  bgHeight: number;
  fields: PlacedField[];
};

/**
 * The on-screen (HTML) render data for a template-backed certificate: a
 * presigned background URL + placed fields + dimensions. The certificate page
 * overlays the resolved field values on the image with CSS. Null when the
 * template is gone/archived → the page falls back to the built-in HTML design.
 */
export async function getCertificateWebTemplate(
  templateId: string,
): Promise<CertificateWebTemplate | null> {
  const t = await prisma.certificateTemplate.findFirst({
    where: { id: templateId, archivedAt: null },
    select: { backgroundKey: true, backgroundContentType: true, bgWidth: true, bgHeight: true, fields: true },
  });
  if (!t) return null;
  const bgUrl = await getDownloadUrl(t.backgroundKey, {
    contentType: t.backgroundContentType,
    inline: true,
  });
  return {
    bgUrl,
    bgWidth: t.bgWidth,
    bgHeight: t.bgHeight,
    fields: parsePlacedFields(t.fields),
  };
}
