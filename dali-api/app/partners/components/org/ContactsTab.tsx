import { useState } from "react";
import { Form, Link } from "react-router";
import { ArrowRightLeft, Mail, Plus, Star, UserMinus, X } from "lucide-react";
import { Select, Combobox } from "~/components/ui/floating";
import { Button } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import { ContactAvatar } from "../contact/ContactAvatar";
import { DotPill } from "./OrgStatusPill";
import { memberName } from "./org-tabs";
import type { PartnerOrgLoaderData } from "../../routes/core.partners.orgs.$orgId";

type Props = Pick<PartnerOrgLoaderData, "org" | "pendingInvites" | "otherOrgs" | "allContacts" | "canEdit">;

export function ContactsTab({ org, pendingInvites, otherOrgs, allContacts, canEdit }: Props) {
  const confirmSubmit = useConfirmSubmit();
  const os = useOsChrome();
  const [inviting, setInviting] = useState(false);
  const [addingContact, setAddingContact] = useState(false);
  const [addContactId, setAddContactId] = useState("");
  const [movingId, setMovingId] = useState<string | null>(null);

  const soleContact = org.isIndividual ? org.memberships[0]?.contact ?? null : null;
  const memberContactIds = new Set(org.memberships.map((m) => m.contact.id));
  const addContactCandidates = allContacts.filter((c) => !memberContactIds.has(c.id));

  return (
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
  );
}
