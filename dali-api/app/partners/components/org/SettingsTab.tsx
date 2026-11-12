import { useRef, useState } from "react";
import { Form, useSubmit } from "react-router";
import { Select, Combobox } from "~/components/ui/floating";
import { AtSign, Building2, Eye, Globe, Image as ImageIcon, Landmark, MapPin, Pencil, Star, Tag, Tags, User, UserPlus } from "lucide-react";
import { Checkbox } from "~/components/ui/Checkbox";
import { Button } from "~/components/ui/Button";
import { useConfirmSubmit, useDialog } from "~/components/ui/dialog";
import { useOsChrome } from "~/components/os-chrome";
import { DetailEditRow, DetailRow, OS_DETAIL_CARD, OS_DETAIL_ICON } from "~/components/os-page";
import { cn } from "~/lib/cn";
import { EditableSection } from "~/components/EditableSection";
import { DotPill } from "./OrgStatusPill";
import { PARTNER_ORG_TYPES, PARTNER_ORG_TYPE_LABELS } from "../../lib/partner-org";
import type { PartnerOrgData } from "../../lib/org-detail.server";
import { memberName } from "./org-tabs";

// The Settings tab's facts card. Individuals show Name + Email (both stored on
// the sole contact) and hide the org-only Website/Logo/Primary-contact fields.
// The Individual checkbox is controlled so toggling it swaps the fields live;
// EditableSection remounts this on Cancel, resetting the state.
function DetailsFields({
  org,
  editing,
  allContacts,
}: {
  org: PartnerOrgData["org"];
  editing: boolean;
  allContacts: { id: string; name: string; email: string | null }[];
}) {
  const { formClass, formTrigger } = useOsChrome();
  const [individual, setIndividual] = useState(org.isIndividual);
  const [showcaseConsent, setShowcaseConsent] = useState(org.showcaseConsent);
  const [referredByContactId, setReferredByContactId] = useState(
    org.referredByContactId ?? "",
  );
  const soleContact = org.memberships[0]?.contact ?? null;
  const ic = OS_DETAIL_ICON;
  const dash = <span className="text-os-muted">—</span>;

  if (editing) {
    return (
      <div
        className={cn(OS_DETAIL_CARD, "pb-2 pt-1", formClass, "grid grid-cols-[max-content_1fr]")}
      >
        <input type="hidden" name="intent" value="org-details" />
        <input type="hidden" name="showcaseConsent" value={showcaseConsent ? "on" : ""} />
        <input type="hidden" name="referredByContactId" value={referredByContactId} />
        <DetailEditRow icon={<Building2 className={ic} />} label="Name">
          <input name="name" type="text" defaultValue={org.name} required className="w-full" />
        </DetailEditRow>
        {individual ? (
          <DetailEditRow icon={<AtSign className={ic} />} label="Email">
            <input
              name="email"
              type="email"
              required
              defaultValue={soleContact?.email ?? ""}
              className="w-full"
            />
          </DetailEditRow>
        ) : (
          <>
            <DetailEditRow icon={<Globe className={ic} />} label="Website">
              <input
                name="website"
                type="text"
                defaultValue={org.website ?? ""}
                className="w-full"
              />
            </DetailEditRow>
            <DetailEditRow icon={<ImageIcon className={ic} />} label="Logo URL">
              <input
                name="logoUrl"
                type="text"
                defaultValue={org.logoUrl ?? ""}
                className="w-full"
              />
            </DetailEditRow>
            <DetailEditRow icon={<Star className={ic} />} label="Primary contact">
              <Select
                name="primaryContactId"
                defaultValue={org.primaryContactId ?? ""}
                options={[
                  { value: "", label: "None" },
                  ...org.memberships.map((m) => ({ value: m.id, label: memberName(m.contact) })),
                ]}
              />
            </DetailEditRow>
          </>
        )}
        <DetailEditRow icon={<Tag className={ic} />} label="Type">
          <Select
            name="type"
            defaultValue={org.type ?? ""}
            options={[
              { value: "", label: "Not set" },
              ...PARTNER_ORG_TYPES.map((t) => ({ value: t, label: PARTNER_ORG_TYPE_LABELS[t] })),
            ]}
          />
        </DetailEditRow>
        <DetailEditRow icon={<Landmark className={ic} />} label="Legal entity name">
          <input
            name="legalEntityName"
            type="text"
            defaultValue={org.legalEntityName ?? ""}
            className="w-full"
          />
        </DetailEditRow>
        <DetailEditRow icon={<MapPin className={ic} />} label="Address">
          <input name="address" type="text" defaultValue={org.address ?? ""} className="w-full" />
        </DetailEditRow>
        <DetailEditRow icon={<Tags className={ic} />} label="Tags">
          <input
            name="tags"
            type="text"
            defaultValue={org.tags.join(", ")}
            placeholder="comma-separated"
            className="w-full"
          />
        </DetailEditRow>
        <DetailEditRow icon={<UserPlus className={ic} />} label="Referred by">
          <Combobox
            value={referredByContactId}
            onChange={setReferredByContactId}
            ariaLabel="Referred by"
            placeholder="None"
            options={[
              { value: "", label: "None" },
              ...allContacts.map((c) => ({ value: c.id, label: c.name || c.email || c.id })),
            ]}
            className={cn(formTrigger, "flex border-os-container")}
          />
        </DetailEditRow>
        <DetailEditRow icon={<User className={ic} />} label="Individual">
          <Checkbox
            name="isIndividual"
            checked={individual}
            onChange={(e) => setIndividual(e.target.checked)}
            label="A single person, not an organization"
            className="text-sm text-foreground"
          />
        </DetailEditRow>
        <DetailEditRow icon={<Eye className={ic} />} label="Showcase consent">
          <Checkbox
            checked={showcaseConsent}
            onChange={(e) => setShowcaseConsent(e.target.checked)}
            label="The partner agreed to be named on the public showcase"
            className="text-sm text-foreground"
          />
        </DetailEditRow>
        <div className="col-span-2 flex flex-col gap-2 py-3">
          <span className="flex items-center gap-2.5 text-sm text-os-grey">
            <Pencil className={ic} />
            Notes
          </span>
          <textarea name="notes" defaultValue={org.notes ?? ""} rows={3} className="w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className={OS_DETAIL_CARD}>
      <DetailRow icon={<Building2 className={ic} />} label="Name">
        {org.name}
      </DetailRow>
      {org.isIndividual ? (
        <DetailRow icon={<AtSign className={ic} />} label="Email">
          {soleContact?.email ?? dash}
        </DetailRow>
      ) : (
        <>
          <DetailRow icon={<Globe className={ic} />} label="Website">
            {org.website ?? dash}
          </DetailRow>
          <DetailRow icon={<ImageIcon className={ic} />} label="Logo URL">
            {org.logoUrl ? <span className="break-all">{org.logoUrl}</span> : dash}
          </DetailRow>
          <DetailRow icon={<Star className={ic} />} label="Primary contact">
            {org.memberships.find((m) => m.id === org.primaryContactId)
              ? memberName(org.memberships.find((m) => m.id === org.primaryContactId)!.contact)
              : dash}
          </DetailRow>
        </>
      )}
      <DetailRow icon={<Tag className={ic} />} label="Type">
        {org.type ? PARTNER_ORG_TYPE_LABELS[org.type] : dash}
      </DetailRow>
      <DetailRow icon={<Landmark className={ic} />} label="Legal entity name">
        {org.legalEntityName ?? dash}
      </DetailRow>
      <DetailRow icon={<MapPin className={ic} />} label="Address">
        {org.address ?? dash}
      </DetailRow>
      <DetailRow icon={<Tags className={ic} />} label="Tags">
        {org.tags.length > 0 ? (
          <span className="flex flex-wrap justify-end gap-1.5">
            {org.tags.map((t) => (
              <DotPill key={t}>{t}</DotPill>
            ))}
          </span>
        ) : (
          dash
        )}
      </DetailRow>
      <DetailRow icon={<UserPlus className={ic} />} label="Referred by">
        {allContacts.find((c) => c.id === org.referredByContactId)?.name ?? dash}
      </DetailRow>
      <DetailRow icon={<User className={ic} />} label="Individual">
        {org.isIndividual ? "Yes" : "No"}
      </DetailRow>
      <DetailRow icon={<Eye className={ic} />} label="Showcase consent">
        {org.showcaseConsent ? "Yes" : "No"}
      </DetailRow>
      <div className="flex flex-col gap-2 py-3">
        <span className="flex items-center gap-2.5 text-sm text-os-grey">
          <Pencil className={ic} />
          Notes
        </span>
        <p className="whitespace-pre-wrap text-sm text-foreground">{org.notes ?? "—"}</p>
      </div>
    </div>
  );
}

function MergeOrgCard({
  org,
  otherOrgs,
}: {
  org: { id: string; name: string };
  otherOrgs: { id: string; name: string }[];
}) {
  const [target, setTarget] = useState("");
  const dialog = useDialog();
  const submit = useSubmit();
  const os = useOsChrome();
  const formRef = useRef<HTMLFormElement>(null);
  if (otherOrgs.length === 0) return null;
  const targetName = otherOrgs.find((o) => o.id === target)?.name ?? "";

  return (
    <section className={os.sectionShell}>
      <h2 className={os.sectionTitle}>Merge into another organization</h2>
      <div className={cn("rounded-os-card bg-os-card", os.panelPad, "flex flex-col gap-3")}>
        <p className="text-sm text-os-grey">
          Members, applications, project links, activity, invites, and invoices move to the
          organization you pick. This organization is deleted. It can't be undone.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <Combobox
            value={target}
            onChange={setTarget}
            ariaLabel="Merge into"
            placeholder="Choose an organization…"
            options={otherOrgs.map((o) => ({ value: o.id, label: o.name }))}
            className={cn(os.formTrigger, "min-w-[220px] flex-1 border-os-container")}
          />
          <Form method="post" ref={formRef}>
            <input type="hidden" name="intent" value="org-merge" />
            <input type="hidden" name="survivorOrgId" value={target} />
            <Button
              type="button"
              variant="secondary"
              disabled={!target}
              onClick={async () => {
                if (
                  await dialog.confirm({
                    title: `Merge ${org.name} into ${targetName}?`,
                    description:
                      "This organization is deleted once everything moves over. This can't be undone.",
                    confirmLabel: "Merge",
                    tone: "destructive",
                  })
                ) {
                  submit(formRef.current);
                }
              }}
            >
              Merge
            </Button>
          </Form>
        </div>
      </div>
    </section>
  );
}

export function SettingsTab({
  org,
  otherOrgs,
  allContacts,
  canEdit,
  canDeleteOrg,
}: {
  org: PartnerOrgData["org"];
  otherOrgs: PartnerOrgData["otherOrgs"];
  allContacts: PartnerOrgData["allContacts"];
  canEdit: boolean;
  canDeleteOrg: boolean;
}) {
  const submit = useSubmit();
  const confirmSubmit = useConfirmSubmit();
  const detailsFormRef = useRef<HTMLFormElement>(null);
  return (
    <>
    <Form method="post" ref={detailsFormRef}>
      <EditableSection
        title="Details"
        canEdit={canEdit}
        onSave={() => {
          if (detailsFormRef.current) submit(detailsFormRef.current);
        }}
      >
        {({ editing }) => (
          <DetailsFields org={org} editing={editing} allContacts={allContacts} />
        )}
      </EditableSection>
    </Form>

    {canEdit && <MergeOrgCard org={org} otherOrgs={otherOrgs} />}

    {/* Cleanup for duplicate-org husks — only offered when truly empty. */}
    {canDeleteOrg && (
      <section className="flex flex-wrap items-center justify-between gap-3 rounded-os-card border border-destructive/30 p-5">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Delete organization</h2>
          <p className="mt-0.5 text-xs text-os-grey">
            No members, projects, applications, or pending invites. This organization can
            be removed.
          </p>
        </div>
        <Form
          method="post"
          onSubmit={confirmSubmit({
            title: `Delete ${org.name}?`,
            description: "This can't be undone.",
            confirmLabel: "Delete",
            tone: "destructive",
          })}
        >
          <input type="hidden" name="intent" value="org-delete" />
          <Button type="submit" variant="destructive">
            Delete organization
          </Button>
        </Form>
      </section>
    )}
    </>
  );
}
