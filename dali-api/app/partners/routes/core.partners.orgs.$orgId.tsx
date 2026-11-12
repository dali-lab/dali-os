import { useRef, useState } from "react";
import { loadPartnerOrgDetail } from "../lib/org-detail.server";
import { SettingsTab } from "../components/org/SettingsTab";
import {
  ORG_TAB_LABELS,
  ORG_TAB_VALUES,
  isOrgTab,
  memberName,
  type OrgTab,
} from "../components/org/org-tabs";
import { runPartnerOrgAction } from "../lib/org-actions.server";
import { Form, Link, useActionData, useLoaderData, useSearchParams, useSubmit } from "react-router";
import { Select, Combobox } from "~/components/ui/floating";
import { ArrowRightLeft, Mail, Pencil, Plus, Settings2, Star, Unlink, UserMinus, X } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { useOsChrome } from "~/components/os-chrome";
import { OsTabBar } from "~/components/os-page";
import { ProjectIcon } from "~/components/ProjectIcon";
import type { Route } from "./+types/core.partners.orgs.$orgId";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db.server";
import { isCore } from "~/lib/roles";
import { cn } from "~/lib/cn";
import { coreHandle } from "~/core/coreNav";
import { relativeTime } from "~/lib/relative-time";
import { formatUsd } from "~/lib/money";
import { PROJECT_FUNDING_TYPE_LABELS } from "~/lib/chart-string";
import { PartnerActivityFeed } from "../components/PartnerActivityFeed";
import { maintenanceLabel } from "../lib/partner-renewals";
import { OrgAvatar } from "../components/org/OrgAvatar";
import { ContactAvatar } from "../components/contact/ContactAvatar";
import {
  DotPill,
  OrgStatusPill,
  OrgTypePill,
  PartnerStagePill,
} from "../components/org/OrgStatusPill";
import { InvoicesPanel } from "../components/org/InvoicesPanel";
import { type PartnerRelationshipStatus } from "../lib/partner-org";

export const meta: Route.MetaFunction = ({ data }) => {
  const name = (data as { org?: { name: string } } | undefined)?.org?.name;
  return [{ title: name ? `${name} · DALI OS` : "Organization · DALI OS" }];
};

// The trailing crumb reads the org name off `trailLabel`, set below, so the
// trail is "Core › Partner CRM › <org name>".
export const handle = {
  ...coreHandle("partners", (data) => (data as { trailLabel?: string } | null)?.trailLabel),
  favoriteRoute: true,
};

export async function loader({ request, params }: Route.LoaderArgs) {
  return loadPartnerOrgDetail(request, params.orgId);
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) {
    return { error: "You don't have permission to edit organizations." };
  }
  const org = await prisma.partnerOrg.findUnique({
    where: { id: params.orgId },
    select: { id: true, name: true, primaryContactId: true, isIndividual: true },
  });
  if (!org) throw new Response("Not found", { status: 404 });

  const form = await request.formData();
  const intent = form.get("intent") as string;
  return runPartnerOrgAction(
    {
      form,
      org,
      userId: auth.user.sub,
      request,
      actor: { actorUserId: auth.user.sub, request },
    },
    intent,
  );
}

export type PartnerOrgLoaderData = ReturnType<typeof useLoaderData<typeof loader>>;

export default function PartnerOrgDetail() {
  const {
    org,
    status,
    pendingInvites,
    linkableProjects,
    otherOrgs,
    allContacts,
    activities,
    activitiesNextCursor,
    actorNames,
    chartStrings,
    canDeleteOrg,
    canEdit,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const confirmSubmit = useConfirmSubmit();
  const os = useOsChrome();
  const detailsFormRef = useRef<HTMLFormElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [inviting, setInviting] = useState(false);
  const [linking, setLinking] = useState(false);
  const [addingContact, setAddingContact] = useState(false);
  const [addContactId, setAddContactId] = useState("");
  // Which member row has the "move to another org" form open.
  const [movingId, setMovingId] = useState<string | null>(null);
  // Which project row has its End/Unlink actions revealed.
  const [managingId, setManagingId] = useState<string | null>(null);

  const error = actionData && "error" in actionData ? actionData.error : null;

  // An individual partner is a single person — their sole membership's contact.
  const soleContact = org.isIndividual ? org.memberships[0]?.contact ?? null : null;

  const tabParam = searchParams.get("tab");
  const tab: OrgTab = isOrgTab(tabParam) ? tabParam : "timeline";
  const setTab = (next: OrgTab) =>
    setSearchParams(
      (prev) => {
        prev.set("tab", next);
        return prev;
      },
      { replace: true, preventScrollReset: true },
    );

  const memberContactIds = new Set(org.memberships.map((m) => m.contact.id));
  const addContactCandidates = allContacts.filter((c) => !memberContactIds.has(c.id));

  const websiteHost = org.website?.replace(/^https?:\/\//, "").replace(/\/$/, "");

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-6">
        <OrgAvatar org={org} size="lg" />
        <div className="min-w-0 flex flex-1 flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex flex-col gap-1">
              <h1 className="font-heading text-[32px] font-medium leading-none text-foreground truncate">
                {org.name}
              </h1>
              <span className="text-[13px] text-os-grey">
                {org.isIndividual ? "Individual partner" : "Partner organization"}
                {websiteHost && (
                  <>
                    {" · "}
                    <a
                      href={org.website!}
                      target="_blank"
                      rel="noreferrer"
                      className="transition-colors hover:text-foreground hover:underline"
                    >
                      {websiteHost}
                    </a>
                  </>
                )}
              </span>
            </div>
            {canEdit && tab !== "settings" && (
              <button type="button" onClick={() => setTab("settings")} className={os.actionBtn()}>
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <OrgStatusPill status={status as PartnerRelationshipStatus} size="md" />
            <OrgTypePill type={org.type} size="md" />
            {org.tags.map((t) => (
              <DotPill key={t} size="md" className="font-normal text-os-grey">
                {t}
              </DotPill>
            ))}
          </div>
        </div>
      </header>

      <OsTabBar
        ariaLabel="Organization sections"
        tabs={ORG_TAB_VALUES.map((t) => ({ key: t, label: ORG_TAB_LABELS[t] }))}
        active={tab}
        onSelect={setTab}
      />

      {error && (
        <p className="rounded-os-item bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex min-h-[25vh] flex-col gap-6">
        {tab === "timeline" && (
          <PartnerActivityFeed
            activities={activities}
            nextCursor={activitiesNextCursor}
            scope={{ orgId: org.id }}
            actorNames={actorNames}
            canEdit={canEdit}
          />
        )}

        {tab === "contacts" && (
          <section className={os.sectionShell}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className={os.sectionTitle}>{org.isIndividual ? "Contact" : "Members"}</h2>
              {!org.isIndividual && canEdit && (
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => setAddingContact((v) => !v)} className={os.quietBtn}>
                    <Plus className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
                    Add existing contact
                  </button>
                  <button type="button" onClick={() => setInviting((v) => !v)} className={os.quietBtn}>
                    <Plus className="h-3.5 w-3.5" strokeWidth={3} aria-hidden />
                    Invite member
                  </button>
                </div>
              )}
            </div>

            <div className="rounded-os-card bg-os-card px-5">
              {addingContact && canEdit && !org.isIndividual && (
                <Form
                  method="post"
                  onSubmit={() => {
                    setAddingContact(false);
                    setAddContactId("");
                  }}
                  className={cn(
                    os.formClass,
                    "flex flex-wrap items-end gap-3 border-b border-os-container py-4",
                  )}
                >
                  <input type="hidden" name="intent" value="member-add" />
                  <input type="hidden" name="contactId" value={addContactId} />
                  <label className={cn(os.fieldLabel, "min-w-[240px] flex-1")}>
                    <span>Contact</span>
                    <Combobox
                      value={addContactId}
                      onChange={setAddContactId}
                      ariaLabel="Add existing contact"
                      placeholder="Search contacts…"
                      options={addContactCandidates.map((c) => ({
                        value: c.id,
                        label: c.name || c.email || c.id,
                        description: c.email ?? undefined,
                      }))}
                      className={cn(os.formTrigger, "flex border-os-container")}
                    />
                  </label>
                  <Button type="submit" variant="primary" disabled={!addContactId}>
                    Add
                  </Button>
                </Form>
              )}

              {inviting && canEdit && !org.isIndividual && (
                <Form
                  method="post"
                  onSubmit={confirmSubmit({
                    title: "Send partner invite?",
                    description: "This emails a join link to the address you entered.",
                    confirmLabel: "Send invite",
                  })}
                  className={cn(
                    os.formClass,
                    "flex flex-wrap items-end gap-3 border-b border-os-container py-4",
                  )}
                >
                  <input type="hidden" name="intent" value="invite" />
                  <label className={cn(os.fieldLabel, "min-w-[200px] flex-1")}>
                    <span>Email</span>
                    <input name="email" type="email" required className="w-full" />
                  </label>
                  <label className={cn(os.fieldLabel, "min-w-[160px] flex-1")}>
                    <span>Role (optional)</span>
                    <input name="displayRole" type="text" placeholder="e.g. CTO" className="w-full" />
                  </label>
                  <Button type="submit" variant="primary">
                    Send invite
                  </Button>
                </Form>
              )}

              {org.isIndividual ? (
                soleContact ? (
                  <div className="flex items-center gap-3 py-4">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-foreground">
                        {memberName(soleContact)}
                      </div>
                      <div className="text-xs text-os-grey">{soleContact.email ?? "no email"}</div>
                    </div>
                    <DotPill dot={soleContact.userId ? "bg-os-green" : "bg-os-muted"}>
                      {soleContact.userId ? "Active" : "Hasn't signed in"}
                    </DotPill>
                    {canEdit && (
                      <Form
                        method="post"
                        onSubmit={confirmSubmit({
                          title: `Send a sign-in link to ${soleContact.email}?`,
                          description:
                            "This emails them a one-time link to sign in to the partner portal.",
                          confirmLabel: "Send link",
                        })}
                      >
                        <input type="hidden" name="intent" value="send-signin-link" />
                        <button type="submit" className={os.actionBtn()}>
                          {soleContact.userId ? "Resend sign-in link" : "Send sign-in link"}
                        </button>
                      </Form>
                    )}
                  </div>
                ) : (
                  <p className="py-6 text-sm text-os-grey">
                    Add this person's email in Settings to set up their portal access.
                  </p>
                )
              ) : org.memberships.length === 0 && pendingInvites.length === 0 ? (
                <p className="py-6 text-sm text-os-grey">
                  No members yet{canEdit ? ". Invite the first contact." : "."}
                </p>
              ) : (
                <ul>
                  {org.memberships.map((m) => (
                    <li
                      key={m.id}
                      className="flex flex-col gap-2 border-b border-os-container py-3 last:border-0"
                    >
                      <div className="flex items-center gap-3">
                        <ContactAvatar contact={m.contact} />
                        <div className="min-w-0 flex-1">
                          <span className="flex items-center gap-2">
                            <Link
                              to={`/core/partners/contacts/${m.contact.id}`}
                              className="text-sm font-medium text-foreground hover:underline"
                            >
                              {memberName(m.contact)}
                            </Link>
                            {org.primaryContactId === m.id && (
                              <DotPill dot="bg-os-accent">Primary</DotPill>
                            )}
                          </span>
                          <div className="text-xs text-os-grey">
                            {m.contact.email ?? "no email"}
                            {m.contact.title ? ` · ${m.contact.title}` : ""}
                            {m.role ? ` · ${m.role}` : ""}
                          </div>
                        </div>
                        {canEdit && org.primaryContactId !== m.id && (
                          <Form method="post">
                            <input type="hidden" name="intent" value="member-set-primary" />
                            <input type="hidden" name="membershipId" value={m.id} />
                            <IconButton type="submit" label="Set primary" icon={Star} />
                          </Form>
                        )}
                        {canEdit && otherOrgs.length > 0 && (
                          <IconButton
                            label="Move"
                            icon={ArrowRightLeft}
                            onClick={() => setMovingId(movingId === m.id ? null : m.id)}
                          />
                        )}
                        {canEdit && (
                          <Form
                            method="post"
                            onSubmit={confirmSubmit({
                              title: `Remove ${memberName(m.contact)} from ${org.name}?`,
                              description: "They lose portal access immediately.",
                              confirmLabel: "Remove",
                              tone: "destructive",
                            })}
                          >
                            <input type="hidden" name="intent" value="member-remove" />
                            <input type="hidden" name="partnerUserId" value={m.id} />
                            <IconButton
                              type="submit"
                              label="Remove"
                              icon={UserMinus}
                              tone="destructive"
                            />
                          </Form>
                        )}
                      </div>
                      {canEdit && movingId === m.id && (
                        <Form
                          method="post"
                          className="flex items-center gap-2 rounded-os-item bg-os-well p-3"
                          onSubmit={confirmSubmit({
                            title: `Move ${memberName(m.contact)} to the selected organization?`,
                            description: "Their portal access switches immediately.",
                            confirmLabel: "Move",
                          })}
                        >
                          <input type="hidden" name="intent" value="member-move" />
                          <input type="hidden" name="partnerUserId" value={m.id} />
                          <Select
                            name="targetOrgId"
                            required
                            defaultValue=""
                            placeholder="Move to…"
                            options={otherOrgs.map((o) => ({ value: o.id, label: o.name }))}
                            buttonClassName={cn(os.formTrigger, "flex-1 border-os-container")}
                          />
                          <Button type="submit" variant="primary" size="sm">
                            Move
                          </Button>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            onClick={() => setMovingId(null)}
                          >
                            Cancel
                          </Button>
                        </Form>
                      )}
                    </li>
                  ))}
                  {pendingInvites.map((inv) => (
                    <li
                      key={inv.id}
                      className="flex items-center gap-3 border-b border-os-container py-3 last:border-0"
                    >
                      <Mail className="h-4 w-4 flex-shrink-0 text-os-grey" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="text-sm text-foreground">{inv.email}</span>
                          <DotPill dot="bg-os-amber">Invited</DotPill>
                        </span>
                        <div className="text-xs text-os-grey">
                          Expires {new Date(inv.expiresAt).toLocaleDateString()}
                          {inv.displayRole ? ` · ${inv.displayRole}` : ""}
                        </div>
                      </div>
                      {canEdit && (
                        <Form
                          method="post"
                          onSubmit={confirmSubmit({
                            title: `Revoke invite for ${inv.email}?`,
                            description: "Their invite link will stop working.",
                            confirmLabel: "Revoke",
                            tone: "destructive",
                          })}
                        >
                          <input type="hidden" name="intent" value="revoke-invite" />
                          <input type="hidden" name="inviteId" value={inv.id} />
                          <IconButton
                            type="submit"
                            label="Revoke invite"
                            icon={X}
                            tone="destructive"
                          />
                        </Form>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {tab === "applications" && (
          <section className={os.sectionShell}>
            <h2 className={os.sectionTitle}>Applications</h2>
            <div className="rounded-os-card bg-os-card px-5">
              {org.applications.length === 0 ? (
                <p className="py-6 text-sm text-os-grey">No applications.</p>
              ) : (
                <ul>
                  {org.applications.map((a) => (
                    <li
                      key={a.id}
                      className="flex flex-wrap items-center gap-3 border-b border-os-container py-3 last:border-0"
                    >
                      <Link
                        to={`/core/partners/applications/${a.id}`}
                        className="min-w-0 flex-1 truncate text-sm font-medium text-foreground hover:underline"
                      >
                        {a.title}
                      </Link>
                      <PartnerStagePill stage={a.stage} />
                      {a.nextStep && <span className="text-xs text-os-grey">{a.nextStep}</span>}
                      <span className="whitespace-nowrap text-xs text-os-grey">
                        {relativeTime(a.lastActivityAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {tab === "projects" && (
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
        )}

        {tab === "finance" && (
          <>
            <section className={os.sectionShell}>
              <h2 className={os.sectionTitle}>Deal terms</h2>
              <div className="rounded-os-card bg-os-card px-5">
                {org.applications.filter((a) => a.stage === "Accepted").length === 0 ? (
                  <p className="py-6 text-sm text-os-grey">No accepted applications yet.</p>
                ) : (
                  <ul>
                    {org.applications
                      .filter((a) => a.stage === "Accepted")
                      .map((a) => (
                        <li
                          key={a.id}
                          className="flex flex-wrap items-center gap-3 border-b border-os-container py-3 last:border-0"
                        >
                          <Link
                            to={`/core/partners/applications/${a.id}`}
                            className="min-w-0 flex-1 truncate text-sm font-medium text-foreground hover:underline"
                          >
                            {a.title}
                          </Link>
                          <span className="text-xs text-os-grey">
                            {a.fundingType
                              ? PROJECT_FUNDING_TYPE_LABELS[a.fundingType]
                              : "Funding type not set"}
                          </span>
                          <span className="text-xs text-os-grey">
                            {a.feeCents != null ? formatUsd(a.feeCents / 100) : "No fee set"}
                          </span>
                        </li>
                      ))}
                  </ul>
                )}
              </div>
            </section>

            <section className={os.sectionShell}>
              <h2 className={os.sectionTitle}>Chart strings</h2>
              <div className="rounded-os-card bg-os-card px-5">
                {chartStrings.length === 0 ? (
                  <p className="py-6 text-sm text-os-grey">No chart strings on file.</p>
                ) : (
                  <ul>
                    {chartStrings.map((cs) => (
                      <li
                        key={cs.id}
                        className="flex flex-wrap items-center gap-3 border-b border-os-container py-3 last:border-0"
                      >
                        <span className="font-mono text-sm text-foreground">{cs.raw}</span>
                        <span className="text-xs text-os-grey">{cs.termCode}</span>
                        <span className="text-xs text-os-grey">{cs.projectName}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>

            <InvoicesPanel orgId={org.id} invoices={org.invoices} canEdit={canEdit} />
          </>
        )}

        {tab === "settings" && (
          <SettingsTab
            org={org}
            otherOrgs={otherOrgs}
            allContacts={allContacts}
            canEdit={canEdit}
            canDeleteOrg={canDeleteOrg}
          />
        )}
      </div>
    </div>
  );
}
