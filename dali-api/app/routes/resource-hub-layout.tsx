import { useEffect, useMemo, useRef, useState } from "react";
import { Outlet, useFetcher, useLoaderData } from "react-router";
import type { Route } from "./+types/resource-hub-layout";
import { uploadEditorImage } from "~/components/doc";
import { PageRowControlsScope, PageTabRow } from "~/components/os-page";
import { isPatternCover } from "~/components/cover/CoverPattern";
import { HubHeader } from "~/components/resource-hub/HubHeader";
import { HubCoverStudio } from "~/components/resource-hub/HubCoverStudio";
import { prisma } from "~/lib/db.server";
import { loadHubShell } from "~/lib/resource-hub.server";

export type HubOutletContext = { leaveGuard: { current: (() => boolean) | null } };

export async function loader({ request, params }: Route.LoaderArgs) {
  const { page, canEdit } = await loadHubShell(request, params.pageId!);
  return {
    hub: {
      id: page.id,
      title: page.title,
      coverUrl: page.coverUrl,
      published: page.publishedAt !== null,
      domainName: page.domain?.displayName ?? null,
    },
    canEdit,
  };
}

const UPLOAD_PREFIX = "/api/upload/raw?key=uploads%2F";

export async function action({ request, params }: Route.ActionArgs) {
  const { page, canEdit } = await loadHubShell(request, params.pageId!);
  if (!canEdit) throw new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  if (form.get("intent") !== "banner") throw new Response("Bad request", { status: 400 });
  const title = String(form.get("title") ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const url = String(form.get("url") ?? "");
  if (!title) return Response.json({ error: "Title is required" }, { status: 400 });
  if (url && !isPatternCover(url) && !url.startsWith(UPLOAD_PREFIX)) {
    return Response.json({ error: "Invalid image" }, { status: 400 });
  }
  await prisma.resourceHubPage.update({ where: { id: page.id }, data: { title, coverUrl: url || null } });
  return { ok: true };
}

export default function ResourceHubLayout() {
  const { hub, canEdit } = useLoaderData<typeof loader>();
  const fetcher = useFetcher<{ error?: string; ok?: boolean }>();
  const [editing, setEditing] = useState(false);
  const leaveGuard = useRef<(() => boolean) | null>(null);
  const context = useMemo<HubOutletContext>(() => ({ leaveGuard }), []);
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) setEditing(false);
  }, [fetcher.state, fetcher.data]);

  return (
    <PageRowControlsScope>
      <div className="flex min-h-dvh flex-col gap-4">
        <HubHeader
          title={hub.title}
          domainName={hub.domainName}
          coverUrl={hub.coverUrl}
          published={hub.published}
          onBack={(e) => {
            if (leaveGuard.current?.()) e.preventDefault();
          }}
        />
        <PageTabRow
          label="Hub"
          tabs={[]}
          onSettings={canEdit ? () => setEditing(true) : undefined}
          settingsLabel="Edit title and cover"
          settingsActive={editing}
        />
        <Outlet context={context} />
        {editing && (
          <HubCoverStudio
            busy={fetcher.state !== "idle"}
            heading="Edit title and cover"
            submitLabel="Save"
            initialTitle={hub.title}
            initialCover={hub.coverUrl}
            uploadImage={uploadEditorImage}
            serverError={fetcher.data?.error ?? null}
            onClose={() => setEditing(false)}
            onSubmit={(title, url) => {
              if (!title.trim()) return;
              fetcher.submit({ intent: "banner", title, url }, { method: "post" });
            }}
          />
        )}
      </div>
    </PageRowControlsScope>
  );
}
