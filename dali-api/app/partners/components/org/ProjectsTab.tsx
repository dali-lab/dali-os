import { useState } from "react";
import { Form, Link } from "react-router";
import { Plus, Settings2, Unlink } from "lucide-react";
import { Select } from "~/components/ui/floating";
import { Button } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { useOsChrome } from "~/components/os-chrome";
import { ProjectIcon } from "~/components/ProjectIcon";
import { cn } from "~/lib/cn";
import { maintenanceLabel } from "../../lib/partner-renewals";
import { DotPill } from "./OrgStatusPill";
import type { PartnerOrgLoaderData } from "../../routes/core.partners.orgs.$orgId";

type Props = Pick<PartnerOrgLoaderData, "org" | "linkableProjects" | "canEdit">;

export function ProjectsTab({ org, linkableProjects, canEdit }: Props) {
  const confirmSubmit = useConfirmSubmit();
  const os = useOsChrome();
  const [linking, setLinking] = useState(false);
  const [managingId, setManagingId] = useState<string | null>(null);

  return (
    <section className={os.sectionShell}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className={os.sectionTitle}>Funded projects</h2>
        {canEdit && linkableProjects.length > 0 && (
          <button type="button" onClick={() => setLinking((v) => !v)} className={os.quietBtn}>
            <Plus className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
            Link project
          </button>
        )}
      </div>

      <div className="rounded-os-card bg-os-card px-5">
        {linking && canEdit && (
          <Form
            method="post"
            className={cn(
              os.formClass,
              "flex flex-wrap items-end gap-3 border-b border-os-container py-4",
            )}
          >
            <input type="hidden" name="intent" value="project-link" />
            <label className={cn(os.fieldLabel, "min-w-[240px] flex-1")}>
              <span>Project</span>
              <Select
                name="projectId"
                required
                defaultValue=""
                placeholder="Select a project…"
                options={linkableProjects.map((p) => ({ value: p.id, label: p.name }))}
              />
            </label>
            <Button type="submit" variant="primary">
              Link
            </Button>
          </Form>
        )}

        {org.projects.length === 0 ? (
          <p className="py-6 text-sm text-os-grey">No linked projects.</p>
        ) : (
          <ul>
            {org.projects.map((pp) => (
              <li
                key={pp.id}
                className="flex flex-col gap-2 border-b border-os-container py-3 last:border-0"
              >
                <div className="flex items-center gap-3">
                  <ProjectIcon iconEmoji={pp.project.iconEmoji} />
                  <div className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <Link
                        to={`/projects/${pp.project.id}`}
                        className="text-sm font-medium text-foreground hover:underline"
                      >
                        {pp.project.name}
                      </Link>
                      <DotPill dot={pp.active ? "bg-os-green" : "bg-os-muted"}>
                        {pp.active
                          ? "Active"
                          : pp.project.status === "Archived"
                            ? "Archived"
                            : "Ended"}
                      </DotPill>
                      {pp.project.maintenancePlans[0] && (
                        <DotPill dot="bg-os-accent">
                          {maintenanceLabel(pp.project.maintenancePlans[0].plan)}
                        </DotPill>
                      )}
                    </span>
                    <div className="text-xs text-os-grey">
                      {pp.startedAt
                        ? `Since ${new Date(pp.startedAt).toLocaleDateString()}`
                        : "No start date"}
                      {pp.endedAt
                        ? ` · Ended ${new Date(pp.endedAt).toLocaleDateString()}`
                        : ""}
                    </div>
                  </div>
                  {canEdit && (
                    <IconButton
                      label="Manage"
                      icon={Settings2}
                      onClick={() => setManagingId(managingId === pp.id ? null : pp.id)}
                    />
                  )}
                </div>
                {/* End/Unlink change what the partner can see — kept behind a
                    disclosure + confirm so neither is a stray one-click. */}
                {canEdit && managingId === pp.id && (
                  <div className="flex flex-wrap items-center gap-3 rounded-os-item bg-os-well p-3">
                    <p className="min-w-[220px] flex-1 text-xs text-os-grey">
                      Ending keeps the history and closes the partner's live access.
                      Unlinking deletes the partnership record entirely.
                    </p>
                    {!pp.endedAt && (
                      <Form
                        method="post"
                        onSubmit={confirmSubmit({
                          title: `End the partnership on ${pp.project.name}?`,
                          description:
                            "The partner loses live access to it; the record stays.",
                          confirmLabel: "End partnership",
                          tone: "destructive",
                        })}
                      >
                        <input type="hidden" name="intent" value="project-end" />
                        <input type="hidden" name="projectPartnerId" value={pp.id} />
                        <Button type="submit" variant="secondary" size="sm">
                          End partnership
                        </Button>
                      </Form>
                    )}
                    <Form
                      method="post"
                      onSubmit={confirmSubmit({
                        title: `Unlink ${pp.project.name}?`,
                        description:
                          "This deletes the partnership record. Prefer “End partnership” to keep history.",
                        confirmLabel: "Unlink",
                        tone: "destructive",
                      })}
                    >
                      <input type="hidden" name="intent" value="project-unlink" />
                      <input type="hidden" name="projectPartnerId" value={pp.id} />
                      <IconButton
                        type="submit"
                        label="Unlink project"
                        icon={Unlink}
                        tone="destructive"
                      />
                    </Form>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
