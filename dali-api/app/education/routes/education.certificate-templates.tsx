import { redirect, useLoaderData, useFetcher, Link } from "react-router";
import { useRef, useState } from "react";
import { requireAuth, forbidden } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore } from "~/lib/roles";
import {
  listCertificateTemplates,
  createCertificateTemplate,
  setDefaultCertificateTemplate,
  clearDefaultCertificateTemplate,
  renameCertificateTemplate,
  archiveCertificateTemplate,
} from "~/education/lib/certificate-templates.server";
import { CERTIFICATE_TEMPLATES_PROCESS_ID } from "~/lib/bindings.server";
import { DriveFolderBindings } from "~/components/drive/DriveFolderBindings";
import { Button, buttonClasses } from "~/components/ui/Button";
import { useDialog } from "~/components/ui/dialog";
import { uploadFileToS3 } from "~/lib/upload-client";
import { formatDateShort } from "~/lib/display";
import { ImageIcon } from "lucide-react";

// Route types aren't generated until the route is registered in routes.ts, so
// we use loose arg types here.

export const meta = () => [{ title: "Certificate Templates · DALI OS" }];

export async function loader({ request }: { request: Request }) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) return redirect("/education");
  return {
    templates: await listCertificateTemplates(),
    driveProcessId: CERTIFICATE_TEMPLATES_PROCESS_ID,
  };
}

export async function action({ request }: { request: Request }) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub))) return forbidden(request);

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");

  if (intent === "create-template") {
    const name = String(formData.get("name") ?? "").trim();
    const result = await createCertificateTemplate({
      name,
      s3Key: String(formData.get("s3Key") ?? ""),
      fileName: String(formData.get("fileName") ?? "background"),
      contentType: String(formData.get("contentType") ?? "image/png"),
      sizeBytes: Number(formData.get("sizeBytes") ?? 0),
      bgWidth: Number(formData.get("bgWidth") ?? 0),
      bgHeight: Number(formData.get("bgHeight") ?? 0),
      actorId: auth.user.sub,
    });
    if ("error" in result) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return redirect(`/education/certificate-templates/${result.id}`);
  }

  if (intent === "set-default") {
    const templateId = String(formData.get("templateId") ?? "");
    const result = await setDefaultCertificateTemplate(templateId);
    if ("error" in result) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json({ ok: true });
  }

  if (intent === "clear-default") {
    await clearDefaultCertificateTemplate();
    return Response.json({ ok: true });
  }

  if (intent === "rename") {
    const id = String(formData.get("templateId") ?? "");
    const name = String(formData.get("name") ?? "").trim();
    const result = await renameCertificateTemplate({ id, name });
    if ("error" in result) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json({ ok: true });
  }

  if (intent === "delete-template") {
    const id = String(formData.get("templateId") ?? "");
    const result = await archiveCertificateTemplate(id);
    if ("error" in result) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Unknown intent" }, { status: 400 });
}

type LoaderData = Extract<Awaited<ReturnType<typeof loader>>, { templates: unknown }>;

export default function CertificateTemplatesPage() {
  const { templates, driveProcessId } = useLoaderData() as LoaderData;
  const dialog = useDialog();
  const mutateFetcher = useFetcher<{ ok?: boolean; error?: string }>();
  const createFetcher = useFetcher<{ ok?: boolean; error?: string }>();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const defaultName = file.name.replace(/\.[^.]+$/, "");
    const name = await dialog.prompt({
      title: "Template name",
      label: "Name",
      defaultValue: defaultName,
      confirmLabel: "Create",
      validate: (v) => (v.trim() ? null : "Name is required"),
    });
    if (name == null) {
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setUploading(true);
    setUploadError(null);
    try {
      const meta = await uploadFileToS3(file, "certificate-templates");
      const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
        img.onerror = reject;
        img.src = URL.createObjectURL(file);
      });
      createFetcher.submit(
        {
          intent: "create-template",
          name,
          s3Key: meta.s3Key,
          fileName: meta.fileName,
          contentType: meta.contentType,
          sizeBytes: String(meta.sizeBytes),
          bgWidth: String(dims.w),
          bgHeight: String(dims.h),
        },
        { method: "post" },
      );
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleRename(templateId: string, currentName: string) {
    const name = await dialog.prompt({
      title: "Rename template",
      label: "Name",
      defaultValue: currentName,
      confirmLabel: "Rename",
      validate: (v) => (v.trim() ? null : "Name is required"),
    });
    if (name == null) return;
    mutateFetcher.submit(
      { intent: "rename", templateId, name },
      { method: "post" },
    );
  }

  async function handleDelete(templateId: string, name: string) {
    const ok = await dialog.confirm({
      title: "Delete this template?",
      description: `"${name}" will be archived and can no longer be used for new certificates.`,
      confirmLabel: "Delete",
      tone: "destructive",
    });
    if (!ok) return;
    mutateFetcher.submit({ intent: "delete-template", templateId }, { method: "post" });
  }

  return (
    <div className="flex flex-col gap-6 px-4 py-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold text-foreground">Certificate Templates</h1>
        <div className="flex items-center gap-2">
          {uploading && (
            <span className="text-sm text-muted-foreground">Uploading…</span>
          )}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg"
            className="hidden"
            onChange={handleFileChange}
            aria-hidden
          />
          <Button
            type="button"
            size="sm"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            New template
          </Button>
        </div>
      </div>

      {uploadError && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {uploadError}
        </p>
      )}

      {mutateFetcher.data?.error && (
        <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {mutateFetcher.data.error}
        </p>
      )}

      {templates.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-border bg-card px-6 py-12 text-center">
          <ImageIcon className="h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">
            No templates yet. Upload a background image to get started.
          </p>
          <Button
            type="button"
            size="sm"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
          >
            Upload background
          </Button>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {templates.map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{t.name}</span>
                  {t.isDefault && (
                    <span className="rounded-full bg-accent-coral/10 px-2 py-0.5 text-[10px] font-semibold text-accent-coral">
                      Default
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t.fieldCount} {t.fieldCount === 1 ? "field" : "fields"} · Created{" "}
                  {formatDateShort(t.createdAt)}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <Link
                  to={`/education/certificate-templates/${t.id}`}
                  className={buttonClasses("secondary", "sm")}
                >
                  Edit
                </Link>

                {t.isDefault ? (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      mutateFetcher.submit(
                        { intent: "clear-default" },
                        { method: "post" },
                      )
                    }
                  >
                    Clear default
                  </button>
                ) : (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      mutateFetcher.submit(
                        { intent: "set-default", templateId: t.id },
                        { method: "post" },
                      )
                    }
                  >
                    Set as default
                  </button>
                )}

                <button
                  type="button"
                  className="text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => handleRename(t.id, t.name)}
                >
                  Rename
                </button>

                <button
                  type="button"
                  className="text-xs text-destructive hover:underline"
                  onClick={() => handleDelete(t.id, t.name)}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* Where uploaded background images auto-file in Drive (Core-managed). */}
      <div className="rounded-lg border border-border bg-card p-4">
        <DriveFolderBindings processType="CertificateTemplates" processId={driveProcessId} />
      </div>
    </div>
  );
}
