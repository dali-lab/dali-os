// The project hub's Infrastructure section. Read-only Fly + Neon inventory/usage
// for anyone who can view the project; config editing + change-requests for
// staffed members (core||isProjectMember, passed as canEdit). No infra actions
// here — those live in the Core/Admin fleet console; staffed members ask via a
// request that Core fulfills. Config editing uses the shared EditableSection
// primitive, so it reads like the other hub sections.

import { useEffect, useRef, useState, type FormEvent } from "react";
import { Form, useFetcher, useSubmit } from "react-router";
import type { KnownOrgs, ProjectFleet } from "~/lib/infra/dashboard.server";
import { InfraConfigFields, withOwnOrg, type InfraConfigValues } from "~/components/infra/InfraConfigFields";
import type { ProjectInfraRequest } from "~/lib/infra/requests.server";
import { ProjectInfraView } from "~/components/infra/ProjectInfraView";
import { EditableSection } from "~/components/EditableSection";
import { buttonClasses } from "~/components/ui/Button";
import { Select } from "~/components/ui/floating";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { timeAgo } from "~/components/infra/format";
import { INFRA_REQUEST_KINDS, infraRequestKindLabel } from "~/lib/infra/request-kinds";

export function ProjectInfraSection({
  projectId,
  canEdit,
  config,
  view,
  requests,
  knownOrgs,
  setupErrors = [],
}: {
  projectId: string;
  canEdit: boolean;
  config: InfraConfigValues;
  view: ProjectFleet | null;
  requests: ProjectInfraRequest[];
  knownOrgs: KnownOrgs;
  /** Starting-infra steps that failed at project creation. */
  setupErrors?: string[];
}) {
  const submit = useSubmit();
  const { panel } = useOsChrome();
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
          <Form method="post" ref={formRef} key={resetKey} className={cn(panel, "os-form p-5")}>
            <input type="hidden" name="intent" value="infra-config" />
            <InfraConfigFields
              config={config}
              knownOrgs={{
                fly: withOwnOrg(knownOrgs.fly, config.flyOrgSlug, view?.flyOrgApps ?? []),
                neon: withOwnOrg(knownOrgs.neon, config.neonOrgId, view?.neonOrgProjects ?? []),
              }}
            />
          </Form>
        ) : (
          <div className="flex flex-col gap-3">
            {setupErrors.length > 0 && <SetupErrors errors={setupErrors} />}
            {view ? (
              <ProjectInfraView project={view} />
            ) : configured ? (
              <p className="text-sm text-muted-foreground">
                Configured. Check back after the next infrastructure sweep.
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

function SetupErrors({ errors }: { errors: string[] }) {
  return (
    <div className="rounded-md bg-os-amber/10 px-3 py-2 text-xs text-os-amber">
      <p className="font-medium">Some starting infrastructure wasn't created:</p>
      <ul className="mt-1 list-disc pl-4">
        {errors.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
    </div>
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
                  ? "bg-os-green/15 text-os-green"
                  : r.status === "Rejected"
                    ? "bg-destructive/15 text-destructive"
                    : "bg-os-amber/15 text-os-amber"
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
