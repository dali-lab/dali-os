// The project hub's Infrastructure section. Read-only Fly + Neon inventory/usage
// for anyone who can view the project; config editing + change-requests for
// staffed members (core||isProjectMember, passed as canEdit). No infra actions
// here — those live in the Core/Admin fleet console; staffed members ask via a
// request that Core fulfills. Config editing uses the shared EditableSection
// primitive, so it reads like the other hub sections.

import { useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { Form, useFetcher, useSubmit } from "react-router";
import type { ProjectFleet } from "~/lib/infra/dashboard.server";
import type { ProjectInfraRequest } from "~/lib/infra/requests.server";
import { ProjectInfraView } from "~/components/infra/ProjectInfraView";
import { EditableSection } from "~/components/EditableSection";
import { buttonClasses } from "~/components/ui/Button";
import { Checkbox } from "~/components/ui/Checkbox";
import { Select } from "~/components/ui/floating";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { timeAgo } from "~/components/infra/format";
import { INFRA_REQUEST_KINDS, infraRequestKindLabel } from "~/lib/infra/request-kinds";

type Config = {
  flyOrgSlug: string | null;
  neonOrgId: string | null;
  infraEnabled: boolean;
  hasFlyReadToken: boolean;
  hasFlyWriteToken: boolean;
};

export function ProjectInfraSection({
  projectId,
  canEdit,
  config,
  view,
  requests,
}: {
  projectId: string;
  canEdit: boolean;
  config: Config;
  view: ProjectFleet | null;
  requests: ProjectInfraRequest[];
}) {
  const submit = useSubmit();
  const formRef = useRef<HTMLFormElement | null>(null);
  const configured = Boolean(config.flyOrgSlug || config.neonOrgId);

  return (
    <EditableSection
      title="Infrastructure"
      canEdit={canEdit}
      onSave={() => {
        if (formRef.current) submit(formRef.current);
      }}
    >
      {({ editing, resetKey }) =>
        editing ? (
          <ConfigForm formRef={formRef} resetKey={resetKey} config={config} />
        ) : (
          <div className="flex flex-col gap-3">
            {view ? (
              <ProjectInfraView project={view} />
            ) : configured ? (
              <p className="text-sm text-muted-foreground">
                Configured — check back after the next infrastructure sweep.
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">
                No cloud infrastructure linked to this project yet.
                {canEdit ? " Use Edit to add its Fly.io / Neon details." : ""}
              </p>
            )}
            {canEdit && configured && <RequestPanel projectId={projectId} />}
            {canEdit && requests.length > 0 && <RequestHistory requests={requests} />}
          </div>
        )
      }
    </EditableSection>
  );
}

function ConfigForm({
  formRef,
  resetKey,
  config,
}: {
  formRef: RefObject<HTMLFormElement | null>;
  resetKey: number;
  config: Config;
}) {
  const { panel, fieldLabel } = useOsChrome();
  return (
    <Form
      method="post"
      ref={formRef}
      key={resetKey}
      className={cn(panel, "os-form p-5 flex flex-col gap-3")}
    >
      <input type="hidden" name="intent" value="infra-config" />
      <div className="flex flex-wrap gap-3">
        <label className={cn(fieldLabel, "w-44")}>
          <span>Fly org slug</span>
          <input name="flyOrgSlug" defaultValue={config.flyOrgSlug ?? ""} placeholder="acme-org" className="w-full" />
        </label>
        <label className={cn(fieldLabel, "w-44")}>
          <span>Neon org id</span>
          <input name="neonOrgId" defaultValue={config.neonOrgId ?? ""} placeholder="org-acme-1234" className="w-full" />
        </label>
        <Checkbox name="infraEnabled" defaultChecked={config.infraEnabled} label="Sweep enabled" className="self-end pb-1.5" />
      </div>
      <div className="flex flex-wrap gap-3">
        <label className={cn(fieldLabel, "w-56")}>
          <span>Fly read token</span>
          <input name="flyReadToken" type="password" placeholder={config.hasFlyReadToken ? "•••• set — blank keeps" : "FlyV1 …"} className="w-full" />
        </label>
        <label className={cn(fieldLabel, "w-56")}>
          <span>Fly write token</span>
          <input name="flyWriteToken" type="password" placeholder={config.hasFlyWriteToken ? "•••• set — blank keeps" : "FlyV1 …"} className="w-full" />
        </label>
      </div>
    </Form>
  );
}

function RequestPanel({ projectId }: { projectId: string }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <div>
        <button type="button" className={buttonClasses("secondary", "sm")} onClick={() => setOpen(true)}>
          Request a change
        </button>
      </div>
    );
  }
  return <RequestForm projectId={projectId} onDone={() => setOpen(false)} />;
}

function RequestForm({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const { panel, fieldLabel } = useOsChrome();
  const fetcher = useFetcher<{ ok?: boolean; error?: string }>();
  useEffect(() => {
    if (fetcher.state === "idle" && fetcher.data?.ok) onDone();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetcher.state]);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    fetcher.submit(
      {
        intent: "submit",
        projectId,
        kind: String(fd.get("kind") ?? "other"),
        details: String(fd.get("details") ?? ""),
        targetHint: String(fd.get("targetHint") ?? ""),
      },
      { method: "post", action: "/api/infra/request", encType: "application/json" },
    );
  }

  return (
    <form onSubmit={submit} className={cn(panel, "os-form p-5 flex flex-col gap-3")}>
      <div className="flex flex-wrap gap-3">
        <label className={cn(fieldLabel, "w-52")}>
          <span>Request</span>
          <Select name="kind" defaultValue={INFRA_REQUEST_KINDS[0].value} options={INFRA_REQUEST_KINDS} />
        </label>
        <label className={cn(fieldLabel, "w-52")}>
          <span>Which resource? (optional)</span>
          <input name="targetHint" placeholder="e.g. the worker app" className="w-full" />
        </label>
      </div>
      <label className={cn(fieldLabel, "w-full")}>
        <span>Details</span>
        <textarea name="details" required rows={2} placeholder="What do you need, and why?" className="w-full" />
      </label>
      {fetcher.data?.error && <p className="text-xs text-destructive">{fetcher.data.error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="submit" disabled={fetcher.state !== "idle"} className={buttonClasses("primary", "sm")}>
          {fetcher.state !== "idle" ? "Sending…" : "Send request"}
        </button>
        <button type="button" className={buttonClasses("ghost", "sm")} onClick={onDone}>Cancel</button>
      </div>
    </form>
  );
}

function RequestHistory({ requests }: { requests: ProjectInfraRequest[] }) {
  const { card } = useOsChrome();
  return (
    <div className={cn(card, "overflow-hidden")}>
      <p className="border-b border-border px-3 py-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Requests
      </p>
      <ul className="divide-y divide-border">
        {requests.map((r) => (
          <li key={r.id} className="flex items-start justify-between gap-3 px-3 py-2 text-xs">
            <div>
              <span className="text-foreground">{infraRequestKindLabel(r.kind)}</span>
              <span className="text-muted-foreground"> — {r.details}</span>
              {r.resolutionNote && <span className="block text-muted-foreground">Note: {r.resolutionNote}</span>}
            </div>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                r.status === "Fulfilled"
                  ? "bg-green-100 text-green-800"
                  : r.status === "Rejected"
                    ? "bg-red-100 text-red-700"
                    : "bg-amber-100 text-amber-800"
              }`}
              title={timeAgo(r.createdAt)}
            >
              {r.status}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
