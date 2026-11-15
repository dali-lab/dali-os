import { redirect, useLoaderData, useFetcher, type ShouldRevalidateFunctionArgs } from "react-router";
import { useState } from "react";
import { requireAuth, forbidden } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { isCore } from "~/lib/roles";
import {
  getCertificateTemplate,
  getCertificateTemplateBgUrl,
  renameCertificateTemplate,
  saveCertificateTemplateFields,
} from "~/education/lib/certificate-templates.server";
import { parsePlacedFields } from "~/education/lib/certificate-fields";
import { CertificateTemplateEditor } from "~/education/components/CertificateTemplateEditor";
import { SAVE_FIELDS_INTENT } from "~/education/lib/use-certificate-autosave";
import { Button } from "~/components/ui/Button";
import { useDialog } from "~/components/ui/dialog";

// Route types aren't generated until the route is registered in routes.ts, so
// we use loose arg types here rather than importing from ./+types/...

export const meta = () => [{ title: "Edit Certificate Template · DALI OS" }];

export async function loader({
  request,
  params,
}: {
  request: Request;
  params: Record<string, string>;
}) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) return redirect("/education");

  const t = await getCertificateTemplate(params.templateId!);
  if (!t) throw new Response("Not found", { status: 404 });

  const bgUrl = await getCertificateTemplateBgUrl(t.backgroundFileId);
  if (!bgUrl) throw new Response("Not found", { status: 404 });

  return { template: t, bgUrl };
}

export function shouldRevalidate({ formData, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  if (formData?.get("intent") === SAVE_FIELDS_INTENT) return false;
  return defaultShouldRevalidate;
}

export async function action({
  request,
  params,
}: {
  request: Request;
  params: Record<string, string>;
}) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  if (!(await isCore(auth.user.sub))) return forbidden(request);

  const formData = await request.formData();
  const intent = String(formData.get("intent") ?? "");
  const id = params.templateId!;

  if (intent === SAVE_FIELDS_INTENT) {
    let parsed: unknown = [];
    try {
      parsed = JSON.parse(String(formData.get("fields") ?? "[]"));
    } catch {
      parsed = [];
    }
    const fields = parsePlacedFields(parsed);
    const result = await saveCertificateTemplateFields({ id, fields });
    if ("error" in result) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json({ ok: true });
  }

  if (intent === "rename") {
    const name = String(formData.get("name") ?? "").trim();
    const result = await renameCertificateTemplate({ id, name });
    if ("error" in result) {
      return Response.json({ error: result.error }, { status: result.status });
    }
    return Response.json({ ok: true });
  }

  return Response.json({ error: "Unknown intent" }, { status: 400 });
}

export default function CertificateTemplateEditorRoute() {
  const { template, bgUrl } = useLoaderData<typeof loader>();
  const [name, setName] = useState(template.name);
  const dialog = useDialog();
  const renameFetcher = useFetcher<{ ok?: boolean; error?: string }>();

  async function handleRename() {
    const newName = await dialog.prompt({
      title: "Rename template",
      label: "Name",
      defaultValue: name,
      confirmLabel: "Rename",
      validate: (v) => (v.trim() ? null : "Name is required"),
    });
    if (newName == null) return;
    setName(newName);
    renameFetcher.submit(
      { intent: "rename", name: newName },
      { method: "post" },
    );
  }

  return (
    <div className="flex flex-col gap-6 px-4 py-6 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-semibold text-foreground">{name}</h1>
        <Button type="button" variant="ghost" size="sm" onClick={handleRename}>
          Rename
        </Button>
        {renameFetcher.data && "error" in renameFetcher.data && (
          <span className="text-xs text-destructive">
            {renameFetcher.data.error}
          </span>
        )}
      </div>

      {/* Editor */}
      <CertificateTemplateEditor
        templateId={template.id}
        bgUrl={bgUrl}
        bgWidth={template.bgWidth}
        bgHeight={template.bgHeight}
        initialFields={template.fields}
      />
    </div>
  );
}
