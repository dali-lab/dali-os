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
  AtSign,
  Briefcase,
  Building2,
  Landmark,
  Linkedin,
  Mail as MailIcon,
  MessageSquare,
  Pencil,
  Phone,
  User,
} from "lucide-react";
import type { Route } from "./+types/core.partners.contacts.$contactId";
import { requireAuth, isNonMember } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db.server";
import { isCore } from "~/lib/roles";
import { coreHandle } from "~/core/coreNav";
import { logAuditEvent } from "~/lib/audit";
import { cn } from "~/lib/cn";
import { useOsChrome } from "~/components/os-chrome";
import {
  DetailEditRow,
  DetailRow,
  OS_DETAIL_CARD,
  OS_DETAIL_ICON,
  OsTabBar,
} from "~/components/os-page";
import { EditableSection } from "~/components/EditableSection";
import { PartnerActivityFeed } from "../components/PartnerActivityFeed";
import { PartnerEmailPanel } from "../components/PartnerEmailPanel";
import { ContactAvatar } from "../components/contact/ContactAvatar";
import { PartnerStagePill } from "../components/org/OrgStatusPill";
import { getPartnerContactEmailThreads } from "../lib/partner-email.server";
import { loadPartnerActivityPage } from "../lib/partner-activity-page.server";
import { logPartnerActivity } from "../lib/partner-activity.server";
import {
  PARTNER_CHANNELS,
  PARTNER_CHANNEL_LABELS,
  isPartnerChannel,
} from "../lib/partner-contact";

export const meta: Route.MetaFunction = ({ data }) => {
  const name = (data as { contact?: { name: string } } | undefined)?.contact?.name;
  return [{ title: name ? `${name} · DALI OS` : "Contact · DALI OS" }];
};

export const handle = {
  ...coreHandle("partners", (data) => (data as { trailLabel?: string } | null)?.trailLabel),
  favoriteRoute: true,
};

export async function loader({ request, params }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  if (await isNonMember(auth, request)) return redirect("/portal");
  const canEdit = await isCore(auth.user.sub);
  if (!canEdit) return redirect("/");

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

  const [applications, meetingRows, activityPage, threads] = await Promise.all([
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
    loadPartnerActivityPage({ contactId: contact.id }),
    getPartnerContactEmailThreads(contact.id),
  ]);

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
    activities: activityPage.items,
    activitiesNextCursor: activityPage.nextCursor,
    actorNames: activityPage.actorNames,
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

// The Details tab's facts card — the same DetailRow list the member profile
// and project page state their facts in, swapping to fields when editing.
function ContactDetailsFields({ contact, editing }: { contact: LoaderContact; editing: boolean }) {
  const { formClass } = useOsChrome();
  const ic = OS_DETAIL_ICON;
  const dash = <span className="text-os-muted">—</span>;

  if (editing) {
    return (
      <div className={cn(OS_DETAIL_CARD, "pb-2 pt-1", formClass, "grid grid-cols-[max-content_1fr]")}>
        <input type="hidden" name="intent" value="contact-details" />
        <DetailEditRow icon={<User className={ic} />} label="Name">
          <input name="name" type="text" defaultValue={contact.name} required className="w-full" />
        </DetailEditRow>
        <DetailEditRow icon={<AtSign className={ic} />} label="Email">
          <input
            name="email"
            type="email"
            defaultValue={contact.email ?? ""}
            required
            className="w-full"
          />
        </DetailEditRow>
        <DetailEditRow icon={<Briefcase className={ic} />} label="Title">
          <input name="title" type="text" defaultValue={contact.title ?? ""} className="w-full" />
        </DetailEditRow>
        <DetailEditRow icon={<Phone className={ic} />} label="Phone">
          <input name="phone" type="text" defaultValue={contact.phone ?? ""} className="w-full" />
        </DetailEditRow>
        <DetailEditRow icon={<Linkedin className={ic} />} label="LinkedIn">
          <input
            name="linkedinUrl"
            type="url"
            defaultValue={contact.linkedinUrl ?? ""}
            placeholder="https://"
            className="w-full"
          />
        </DetailEditRow>
        <DetailEditRow icon={<Landmark className={ic} />} label="Affiliation">
          <input
            name="affiliation"
            type="text"
            defaultValue={contact.affiliation ?? ""}
            className="w-full"
          />
        </DetailEditRow>
        <DetailEditRow icon={<MessageSquare className={ic} />} label="Preferred channel">
          <Select
            name="preferredChannel"
            defaultValue={contact.preferredChannel ?? ""}
            options={[
              { value: "", label: "Not set" },
              ...PARTNER_CHANNELS.map((c) => ({ value: c, label: PARTNER_CHANNEL_LABELS[c] })),
            ]}
          />
        </DetailEditRow>
        <div className="col-span-2 flex flex-col gap-2 py-3">
          <span className="flex items-center gap-2.5 text-sm text-os-grey">
            <Pencil className={ic} />
            Notes
          </span>
          <textarea name="notes" defaultValue={contact.notes ?? ""} rows={3} className="w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className={OS_DETAIL_CARD}>
      <DetailRow icon={<User className={ic} />} label="Name">
        {contact.name}
      </DetailRow>
      <DetailRow icon={<AtSign className={ic} />} label="Email">
        {contact.email ?? dash}
      </DetailRow>
      <DetailRow icon={<Briefcase className={ic} />} label="Title">
        {contact.title ?? dash}
      </DetailRow>
      <DetailRow icon={<Phone className={ic} />} label="Phone">
        {contact.phone ?? dash}
      </DetailRow>
      <DetailRow icon={<Linkedin className={ic} />} label="LinkedIn">
        {contact.linkedinUrl ? (
          <a
            href={contact.linkedinUrl}
            target="_blank"
            rel="noreferrer"
            className="text-os-accent hover:underline break-all"
          >
            {contact.linkedinUrl}
          </a>
        ) : (
          dash
        )}
      </DetailRow>
      <DetailRow icon={<Landmark className={ic} />} label="Affiliation">
        {contact.affiliation ?? dash}
      </DetailRow>
      <DetailRow icon={<MessageSquare className={ic} />} label="Preferred channel">
        {contact.preferredChannel ? PARTNER_CHANNEL_LABELS[contact.preferredChannel] : dash}
      </DetailRow>
      <div className="flex flex-col gap-2 py-3">
        <span className="flex items-center gap-2.5 text-sm text-os-grey">
          <Pencil className={ic} />
          Notes
        </span>
        <p className="whitespace-pre-wrap text-sm text-foreground">{contact.notes ?? "—"}</p>
      </div>
    </div>
  );
}

const CONTACT_TAB_VALUES = ["timeline", "applications", "meetings", "email", "details"] as const;
type ContactTab = (typeof CONTACT_TAB_VALUES)[number];
function isContactTab(x: string | null): x is ContactTab {
  return !!x && (CONTACT_TAB_VALUES as readonly string[]).includes(x);
}

const CONTACT_TAB_LABELS: Record<ContactTab, string> = {
  timeline: "Timeline",
  applications: "Applications",
  meetings: "Meetings",
  email: "Email",
  details: "Details",
};

export default function PartnerContactDetail() {
  const {
    contact,
    applications,
    meetings,
    activities,
    activitiesNextCursor,
    actorNames,
    threads,
    canEdit,
  } = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const submit = useSubmit();
  const os = useOsChrome();
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

  const subtitle = [contact.title, contact.affiliation].filter(Boolean).join(" · ");

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center gap-6">
        <ContactAvatar contact={contact} size="lg" />
        <div className="min-w-0 flex flex-1 flex-col gap-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex flex-col gap-1">
              <h1 className="font-heading text-[32px] font-medium leading-none text-foreground truncate">
                {contact.name}
              </h1>
              {subtitle && <span className="text-[13px] text-os-grey">{subtitle}</span>}
            </div>
            {canEdit && tab !== "details" && (
              <button type="button" onClick={() => setTab("details")} className={os.actionBtn()}>
                <Pencil className="h-3.5 w-3.5" />
                Edit
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {contact.memberships.map((m) => (
              <Link
                key={m.id}
                to={`/core/partners/orgs/${m.org.id}`}
                className="inline-flex items-center gap-1.5 rounded-full bg-os-well px-3 py-[5px] text-[13px] font-semibold text-foreground transition-colors hover:bg-os-container"
              >
                <Building2 className="h-3.5 w-3.5 text-os-grey" aria-hidden />
                {m.org.name}
              </Link>
            ))}
            {contact.email && (
              <a
                href={`mailto:${contact.email}`}
                className="inline-flex items-center gap-1.5 text-[13px] text-os-grey transition-colors hover:text-foreground"
              >
                <MailIcon className="h-3.5 w-3.5" aria-hidden />
                {contact.email}
              </a>
            )}
            {contact.phone && (
              <span className="inline-flex items-center gap-1.5 text-[13px] text-os-grey">
                <Phone className="h-3.5 w-3.5" aria-hidden />
                {contact.phone}
              </span>
            )}
            {contact.linkedinUrl && (
              <a
                href={contact.linkedinUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[13px] text-os-grey transition-colors hover:text-foreground"
              >
                <Linkedin className="h-3.5 w-3.5" aria-hidden />
                LinkedIn
              </a>
            )}
            {contact.preferredChannel && (
              <span className="inline-flex items-center gap-1.5 text-[13px] text-os-grey">
                <MessageSquare className="h-3.5 w-3.5" aria-hidden />
                Prefers {PARTNER_CHANNEL_LABELS[contact.preferredChannel]}
              </span>
            )}
          </div>
        </div>
      </header>

      <OsTabBar
        ariaLabel="Contact sections"
        tabs={CONTACT_TAB_VALUES.map((t) => ({ key: t, label: CONTACT_TAB_LABELS[t] }))}
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
            scope={{ contactId: contact.id }}
            actorNames={actorNames}
            canEdit={canEdit}
          />
        )}

        {tab === "applications" && (
          <section className={os.sectionShell}>
            <h2 className={os.sectionTitle}>Applications</h2>
            <div className="rounded-os-card bg-os-card px-5">
              {applications.length === 0 ? (
                <p className="py-6 text-sm text-os-grey">No applications.</p>
              ) : (
                <ul>
                  {applications.map((a) => (
                    <li
                      key={a.id}
                      className="flex items-center gap-3 border-b border-os-container py-3 last:border-0"
                    >
                      <Link
                        to={`/core/partners/applications/${a.id}`}
                        className="min-w-0 flex-1 truncate text-sm font-medium text-foreground hover:underline"
                      >
                        {a.title}
                      </Link>
                      <PartnerStagePill stage={a.stage} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {tab === "meetings" && (
          <section className={os.sectionShell}>
            <h2 className={os.sectionTitle}>Meetings</h2>
            <div className="rounded-os-card bg-os-card px-5">
              {meetings.length === 0 ? (
                <p className="py-6 text-sm text-os-grey">No meetings yet.</p>
              ) : (
                <ul>
                  {meetings.map((m) => (
                    <li
                      key={m.id}
                      className="flex flex-wrap items-center gap-3 border-b border-os-container py-3 last:border-0"
                    >
                      <Link
                        to={`/core/partners/applications/${m.applicationId}`}
                        className="min-w-0 flex-1 truncate text-sm font-medium text-foreground hover:underline"
                      >
                        {m.applicationTitle}
                      </Link>
                      <span className="text-xs text-os-grey">
                        {new Date(m.scheduledAt).toLocaleString("en-US", {
                          dateStyle: "medium",
                          timeStyle: "short",
                        })}
                      </span>
                      {m.outcome && (
                        <span className="rounded-full bg-os-well px-2.5 py-0.5 text-xs text-foreground">
                          {m.outcome}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {tab === "email" && (
          <section className={os.sectionShell}>
            <h2 className={os.sectionTitle}>Email</h2>
            <div className={cn("rounded-os-card bg-os-card", os.panelPad)}>
              {threads.length > 0 ? (
                <PartnerEmailPanel contactId={contact.id} threads={threads} />
              ) : (
                <p className="text-sm text-os-grey">No email history with partners@ yet.</p>
              )}
            </div>
          </section>
        )}

        {tab === "details" && (
          <Form method="post" ref={detailsFormRef}>
            <EditableSection
              title="Details"
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
    </div>
  );
}
