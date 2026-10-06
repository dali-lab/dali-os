import { useRef } from "react";
import {
  Form,
  Link,
  redirect,
  useActionData,
  useLoaderData,
  useSearchParams,
  useSubmit,
} from "react-router";
import { Select } from "~/components/ui/floating";
import {
  Building2,
  Calendar,
  ClipboardList,
  Clock,
  Mail as MailIcon,
  User,
} from "lucide-react";
import type { Route } from "./+types/core.partners.contacts.$contactId";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db";
import { isCore, getUserRoles } from "~/lib/roles";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { coreHandle } from "~/core/coreNav";
import { logAuditEvent } from "~/lib/audit";
import { UnderlineTabButtons } from "~/components/AreaPillNav";
import { EditableSection } from "~/components/EditableSection";
import { PartnerActivityFeed } from "../components/PartnerActivityFeed";
import { PartnerEmailPanel } from "../components/PartnerEmailPanel";
import { ContactAvatar } from "../components/contact/ContactAvatar";
import { getPartnerContactEmailThreads } from "../lib/partner-email.server";
import { logPartnerActivity } from "../lib/partner-activity.server";
import {
  PARTNER_CHANNELS,
  PARTNER_CHANNEL_LABELS,
  isPartnerChannel,
} from "../lib/partner-contact";
import {
  PARTNER_STAGE_LABELS,
  PARTNER_STAGE_PILL,
} from "../lib/partner-application";

export const meta: Route.MetaFunction = ({ data }) => {
  const name = (data as { contact?: { name: string } } | undefined)?.contact?.name;
  return [{ title: name ? `${name} · DALI OS` : "Contact · DALI OS" }];
};

export const handle = {
  ...coreHandle("partners", (data) => (data as { trailLabel?: string } | null)?.trailLabel),
  favoriteRoute: true,
};

const detailInputClass =
  "w-full rounded-lg border border-border bg-background px-3 py-2 text-sm";

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (auth.user.type === "applicant") return redirect("/portal");
  const canEdit = await isCore(auth.user.sub);
  if (!canEdit) return redirect("/");

  const roles = await getUserRoles(auth.user.sub, request);
  const emailEnabled = await isFeatureEnabled("partner-email", auth.user.sub, roles, request);

  const contact = await prisma.partnerContact.findUnique({
    where: { id: params.contactId },
    select: {
      id: true,
      name: true,
      email: true,
      title: true,
      phone: true,
      linkedinUrl: true,
      affiliation: true,
      notes: true,
      preferredChannel: true,
      memberships: {
        where: { endedAt: null },
        orderBy: { createdAt: "asc" },
        select: { id: true, role: true, org: { select: { id: true, name: true } } },
      },
    },
  });
  if (!contact) throw new Response("Not found", { status: 404 });

  const [applications, meetingRows, activityRows, threads] = await Promise.all([
    prisma.partnerApplication.findMany({
      where: { applicantContactId: contact.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, stage: true, createdAt: true },
    }),
    prisma.partnerMeeting.findMany({
      where: { contactId: contact.id },
      orderBy: { scheduledAt: "desc" },
      select: {
        id: true,
        scheduledAt: true,
        outcome: true,
        application: { select: { id: true, title: true } },
        scheduledMeeting: { select: { selectedAt: true } },
      },
    }),
    prisma.partnerActivity.findMany({
      where: { contactId: contact.id },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true,
        createdAt: true,
        applicationId: true,
        actorUserId: true,
        type: true,
        body: true,
        metadata: true,
      },
    }),
    emailEnabled ? getPartnerContactEmailThreads(contact.id) : Promise.resolve([]),
  ]);

  const activities = activityRows.map((r) => ({
    id: r.id,
    createdAt: r.createdAt.toISOString(),
    applicationId: r.applicationId,
    actorUserId: r.actorUserId,
    type: r.type,
    body: r.body,
    metadata: (r.metadata ?? null) as Record<string, unknown> | null,
  }));
  const actorIds = [
    ...new Set(activityRows.map((r) => r.actorUserId).filter(Boolean)),
  ] as string[];
  let actorNames: Record<string, string> = {};
  if (actorIds.length > 0) {
    const users = await prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, firstName: true, lastName: true, daliEmail: true },
    });
    actorNames = Object.fromEntries(
      users.map((u) => [
        u.id,
        [u.firstName, u.lastName].filter(Boolean).join(" ") || u.daliEmail || u.id,
      ]),
    );
  }

  const meetings = meetingRows.map((m) => ({
    id: m.id,
    applicationId: m.application.id,
    applicationTitle: m.application.title,
    scheduledAt: (m.scheduledMeeting?.selectedAt ?? m.scheduledAt).toISOString(),
    outcome: m.outcome,
  }));

  return {
    contact,
    applications,
    meetings,
    activities,
    actorNames,
    emailEnabled,
    threads,
    canEdit,
    trailLabel: contact.name,
  };
}

export async function action({ request, params }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (!(await isCore(auth.user.sub))) {
    return { error: "You don't have permission to edit contacts." };
  }
  const contact = await prisma.partnerContact.findUnique({
    where: { id: params.contactId },
    select: { id: true },
  });
  if (!contact) throw new Response("Not found", { status: 404 });

  const form = await request.formData();
  const intent = form.get("intent") as string;

  if (intent === "contact-details") {
    const name = (form.get("name") as string | null)?.trim() ?? "";
    if (!name) return { error: "A name is required." };
    const email = (form.get("email") as string | null)?.trim().toLowerCase() ?? "";
    if (!email.includes("@")) return { error: "A valid email is required." };
    const title = (form.get("title") as string | null)?.trim() || null;
    const phone = (form.get("phone") as string | null)?.trim() || null;
    const linkedinUrl = (form.get("linkedinUrl") as string | null)?.trim() || null;
    const affiliation = (form.get("affiliation") as string | null)?.trim() || null;
    const notes = (form.get("notes") as string | null)?.trim() || null;
    const preferredChannelRaw = (form.get("preferredChannel") as string | null) ?? "";
    const preferredChannel = isPartnerChannel(preferredChannelRaw) ? preferredChannelRaw : null;

    try {
      await prisma.partnerContact.update({
        where: { id: contact.id },
        data: { name, email, title, phone, linkedinUrl, affiliation, notes, preferredChannel },
      });
    } catch (e) {
      if ((e as { code?: string })?.code === "P2002") {
        return { error: "Another partner contact already uses that email address." };
      }
      throw e;
    }
    await logAuditEvent({
      action: "partner.member.update",
      userId: auth.user.sub,
      targetId: contact.id,
      request,
    });
    return { ok: true };
  }

  if (intent === "note") {
    // Mirrors the org page: PartnerActivityFeed's built-in composer always
    // posts intent "note", scoped here to this one contact's timeline.
    const body = (form.get("body") as string | null)?.trim() ?? "";
    if (!body) return { error: "Note can't be empty." };
    await logPartnerActivity(prisma, {
      contactId: contact.id,
      actorUserId: auth.user.sub,
      type: "Note",
      body,
    });
    return { ok: true };
  }

  return { error: "Unknown action." };
}

type LoaderData = Exclude<Awaited<ReturnType<typeof loader>>, Response>;
type LoaderContact = LoaderData["contact"];

function ContactDetailsFields({ contact, editing }: { contact: LoaderContact; editing: boolean }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="intent" value="contact-details" />
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">Name</div>
        {editing ? (
          <input name="name" defaultValue={contact.name} required className={detailInputClass} />
        ) : (
          <div className="text-sm text-foreground">{contact.name}</div>
        )}
      </div>
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">Email</div>
        {editing ? (
          <input
            name="email"
            type="email"
            defaultValue={contact.email ?? ""}
            required
            className={detailInputClass}
          />
        ) : (
          <div className="text-sm text-foreground">{contact.email ?? "—"}</div>
        )}
      </div>
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">Title</div>
        {editing ? (
          <input name="title" defaultValue={contact.title ?? ""} className={detailInputClass} />
        ) : (
          <div className="text-sm text-foreground">{contact.title ?? "—"}</div>
        )}
      </div>
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">Phone</div>
        {editing ? (
          <input name="phone" defaultValue={contact.phone ?? ""} className={detailInputClass} />
        ) : (
          <div className="text-sm text-foreground">{contact.phone ?? "—"}</div>
        )}
      </div>
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">LinkedIn</div>
        {editing ? (
          <input
            name="linkedinUrl"
            defaultValue={contact.linkedinUrl ?? ""}
            placeholder="https://"
            className={detailInputClass}
          />
        ) : contact.linkedinUrl ? (
          <a
            href={contact.linkedinUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-dark-blue hover:underline"
          >
            {contact.linkedinUrl}
          </a>
        ) : (
          <div className="text-sm text-foreground">—</div>
        )}
      </div>
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">Affiliation</div>
        {editing ? (
          <input
            name="affiliation"
            defaultValue={contact.affiliation ?? ""}
            className={detailInputClass}
          />
        ) : (
          <div className="text-sm text-foreground">{contact.affiliation ?? "—"}</div>
        )}
      </div>
      <div>
        <div className="text-xs font-medium text-muted-foreground mb-1">Preferred channel</div>
        {editing ? (
          <Select
            name="preferredChannel"
            defaultValue={contact.preferredChannel ?? ""}
            options={[
              { value: "", label: "Not set" },
              ...PARTNER_CHANNELS.map((c) => ({ value: c, label: PARTNER_CHANNEL_LABELS[c] })),
            ]}
            buttonClassName={`${detailInputClass} inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40`}
          />
        ) : (
          <div className="text-sm text-foreground">
            {contact.preferredChannel ? PARTNER_CHANNEL_LABELS[contact.preferredChannel] : "—"}
          </div>
        )}
      </div>
      <div className="sm:col-span-2">
        <div className="text-xs font-medium text-muted-foreground mb-1">Notes</div>
        {editing ? (
          <textarea name="notes" defaultValue={contact.notes ?? ""} rows={3} className={detailInputClass} />
        ) : (
          <div className="text-sm text-foreground whitespace-pre-wrap">{contact.notes ?? "—"}</div>
        )}
      </div>
    </div>
  );
}

const CONTACT_TAB_VALUES = ["timeline", "applications", "meetings", "email", "details"] as const;
type ContactTab = (typeof CONTACT_TAB_VALUES)[number];
function isContactTab(x: string | null): x is ContactTab {
  return !!x && (CONTACT_TAB_VALUES as readonly string[]).includes(x);
}

export default function PartnerContactDetail() {
  const { contact, applications, meetings, activities, actorNames, emailEnabled, threads, canEdit } =
    useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const detailsFormRef = useRef<HTMLFormElement>(null);
  const [searchParams, setSearchParams] = useSearchParams();

  const error = actionData && "error" in actionData ? actionData.error : null;

  const tabParam = searchParams.get("tab");
  const tab: ContactTab = isContactTab(tabParam) ? tabParam : "timeline";
  const setTab = (next: ContactTab) =>
    setSearchParams(
      (prev) => {
        prev.set("tab", next);
        return prev;
      },
      { replace: true, preventScrollReset: true },
    );

  const tabItems = [
    { label: "Timeline", value: "timeline" as const, icon: Clock },
    { label: "Applications", value: "applications" as const, icon: ClipboardList },
    { label: "Meetings", value: "meetings" as const, icon: Calendar },
    { label: "Email", value: "email" as const, icon: MailIcon },
    { label: "Details", value: "details" as const, icon: User },
  ];

  return (
    <div className="flex flex-col gap-6 max-w-4xl">
      <div className="flex items-center gap-4">
        <ContactAvatar contact={contact} size="lg" />
        <div className="min-w-0 flex-1">
          <h1 className="font-heading text-2xl font-bold text-foreground truncate">
            {contact.name}
          </h1>
          <p className="text-sm text-muted-foreground flex flex-wrap items-center gap-x-2">
            {contact.title && <span>{contact.title}</span>}
            {contact.affiliation && <span>{contact.affiliation}</span>}
            {contact.email && <span>{contact.email}</span>}
            {contact.phone && <span>{contact.phone}</span>}
            {contact.linkedinUrl && (
              <a
                href={contact.linkedinUrl}
                target="_blank"
                rel="noreferrer"
                className="underline hover:text-foreground"
              >
                LinkedIn
              </a>
            )}
            {contact.preferredChannel && (
              <span>Prefers {PARTNER_CHANNEL_LABELS[contact.preferredChannel]}</span>
            )}
          </p>
          {contact.memberships.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {contact.memberships.map((m) => (
                <Link
                  key={m.id}
                  to={`/core/partners/orgs/${m.org.id}`}
                  className="inline-flex items-center gap-1 text-xs rounded-full bg-muted text-muted-foreground px-2 py-0.5 hover:bg-muted/70"
                >
                  <Building2 className="w-3 h-3" />
                  {m.org.name}
                </Link>
              ))}
            </div>
          )}
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={() => setTab("details")}
            className="px-3 py-1.5 text-sm font-medium rounded-md border border-border hover:bg-muted transition"
          >
            Edit
          </button>
        )}
      </div>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 rounded-lg px-4 py-3">{error}</p>
      )}

      <UnderlineTabButtons
        label="Contact"
        items={tabItems.map((t) => ({
          label: t.label,
          icon: t.icon,
          active: tab === t.value,
          onClick: () => setTab(t.value),
        }))}
      />

      {tab === "timeline" && (
        <PartnerActivityFeed activities={activities} actorNames={actorNames} canEdit={canEdit} />
      )}

      {tab === "applications" && (
        <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
          <h2 className="font-heading font-semibold text-foreground">Applications</h2>
          {applications.length === 0 ? (
            <p className="text-sm text-muted-foreground">No applications.</p>
          ) : (
            <ul className="divide-y divide-border">
              {applications.map((a) => (
                <li key={a.id} className="py-2.5 flex items-center gap-3">
                  <Link
                    to={`/core/partners/applications/${a.id}`}
                    className="text-sm font-medium text-foreground hover:underline flex-1 min-w-0 truncate"
                  >
                    {a.title}
                  </Link>
                  <span className={`text-xs rounded-full px-2 py-0.5 ${PARTNER_STAGE_PILL[a.stage]}`}>
                    {PARTNER_STAGE_LABELS[a.stage]}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "meetings" && (
        <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
          <h2 className="font-heading font-semibold text-foreground">Meetings</h2>
          {meetings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No meetings yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {meetings.map((m) => (
                <li key={m.id} className="py-2.5 flex items-center gap-3 flex-wrap">
                  <Link
                    to={`/core/partners/applications/${m.applicationId}`}
                    className="text-sm font-medium text-foreground hover:underline flex-1 min-w-0 truncate"
                  >
                    {m.applicationTitle}
                  </Link>
                  <span className="text-xs text-muted-foreground">
                    {new Date(m.scheduledAt).toLocaleString("en-US", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </span>
                  {m.outcome && (
                    <span className="text-xs rounded-full bg-muted text-muted-foreground px-2 py-0.5">
                      {m.outcome}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {tab === "email" && (
        <section className="bg-card border border-border rounded-lg p-4 flex flex-col gap-3">
          {emailEnabled ? (
            threads.length > 0 ? (
              <PartnerEmailPanel contactId={contact.id} threads={threads} />
            ) : (
              <p className="text-sm text-muted-foreground">No email history with partners@ yet.</p>
            )
          ) : (
            <p className="text-sm text-muted-foreground">Email capture isn't turned on yet.</p>
          )}
        </section>
      )}

      {tab === "details" && (
        <Form method="post" ref={detailsFormRef}>
          <EditableSection
            title="Details"
            icon={<User className="w-4 h-4" />}
            canEdit={canEdit}
            onSave={() => {
              if (detailsFormRef.current) submit(detailsFormRef.current);
            }}
          >
            {({ editing }) => <ContactDetailsFields contact={contact} editing={editing} />}
          </EditableSection>
        </Form>
      )}
    </div>
  );
}
