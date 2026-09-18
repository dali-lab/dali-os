import { useState } from "react";
import { Link, useFetcher } from "react-router";
import { Lock, Settings, Unlink } from "lucide-react";
import { Modal, ModalHeader } from "~/components/Modal";
import { modalCardClass, useOsChrome } from "~/components/os-chrome";
import { Button } from "~/components/ui/Button";
import { Checkbox } from "~/components/ui/Checkbox";
import { Radio } from "~/components/ui/Radio";
import { DateField } from "~/components/ui/DateField";
import { Tooltip } from "~/components/ui/floating";
import { useConfirmSubmit } from "~/components/ui/dialog";
import type { HiringFormLink } from "~/hiring/lib/form-links.server";

type Usage = { kind: string; label: string; href?: string | null };

// Everything about a form that isn't its questions — response rules, the
// publish schedule, the audience, and where it's in use — behind the editor's
// settings button. A managed form (its distribution owned by a hiring cycle,
// offering, etc.) shows only where it's managed and used.
export function FormSettingsButton({
  managing,
  usages,
  hiringLinks,
  ...fields
}: {
  managing: { label: string; href?: string | null } | null;
  usages: Usage[];
  hiringLinks: HiringFormLink[];
} & Parameters<typeof FormSettingsFields>[0]) {
  const [open, setOpen] = useState(false);
  const { heading } = useOsChrome();
  return (
    <>
      <Tooltip content="Settings">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Settings"
          className="inline-flex items-center justify-center w-10 h-10 rounded-full text-os-grey hover:bg-os-container hover:text-foreground transition-colors"
        >
          <Settings className="w-5 h-5" />
        </button>
      </Tooltip>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        labelledBy="form-settings-title"
        containerClassName={modalCardClass("max-w-lg os-form")}
      >
        <ModalHeader
          titleId="form-settings-title"
          title="Settings"
          onClose={() => setOpen(false)}
        />
        <div className="flex flex-col gap-6">
          {managing ? (
            <div className="rounded-os-item bg-os-accent/10 p-4 flex items-start gap-3 text-sm text-foreground">
              <Lock className="w-4 h-4 text-os-accent shrink-0 mt-0.5" />
              <span>
                Managed by{" "}
                {managing.href ? (
                  <Link to={managing.href} className="font-semibold underline hover:no-underline">
                    {managing.label}
                  </Link>
                ) : (
                  <span className="font-semibold">{managing.label}</span>
                )}
              </span>
            </div>
          ) : (
            <FormSettingsFields {...fields} />
          )}

          {usages.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className={heading}>In use</span>
              <div className="flex items-center gap-1.5 flex-wrap text-xs">
                {usages.map((u) => {
                  const className =
                    "inline-flex items-center px-2.5 py-1 rounded-full bg-os-accent/15 text-os-accent font-medium";
                  return u.href ? (
                    <Link
                      key={`${u.kind}:${u.label}`}
                      to={u.href}
                      className={`${className} hover:bg-os-accent/25 transition-colors`}
                    >
                      {u.label}
                    </Link>
                  ) : (
                    <span key={`${u.kind}:${u.label}`} className={className}>
                      {u.label}
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          {hiringLinks.length > 0 && <HiringLinksPanel links={hiringLinks} />}
        </div>
      </Modal>
    </>
  );
}

type AudienceValue = "Members" | "SignedIn" | "Groups" | "Public";
type GroupOption = { id: string; name: string; type: "Static" | "Dynamic" };

const AUDIENCE_OPTIONS: { value: AudienceValue; label: string }[] = [
  { value: "Members", label: "Lab members" },
  { value: "SignedIn", label: "Anyone signed in" },
  { value: "Groups", label: "Specific groups" },
  { value: "Public", label: "Public" },
];

// ISO timestamp → the local wall-time string a datetime-local input expects.
function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Per-form response settings + audience. Toggles submit both boolean values
// (single idempotent update); audience submits on radio change — except
// "Specific groups", which waits until at least one group is checked (the
// server enforces the same rule). Pending fetcher FormData drives optimistic
// state so changes feel instant and settle to the loader's truth.
function FormSettingsFields({
  formId,
  oneResponsePerMember,
  notifyOnSubmission,
  listed,
  audience,
  audienceGroupIds,
  groups,
  opensAt,
  closesAt,
}: {
  formId: string;
  oneResponsePerMember: boolean;
  notifyOnSubmission: boolean;
  listed: boolean;
  audience: AudienceValue;
  audienceGroupIds: string[];
  groups: GroupOption[];
  opensAt: string | null;
  closesAt: string | null;
}) {
  const fetcher = useFetcher();
  const { heading } = useOsChrome();
  const err =
    fetcher.data && typeof fetcher.data === "object" && "error" in fetcher.data
      ? String((fetcher.data as { error: unknown }).error)
      : null;

  const pending = fetcher.formData;
  const pendingSettings = pending?.get("intent") === "update-form-settings";
  const oneResponse = pendingSettings
    ? pending!.get("oneResponsePerMember") === "true"
    : oneResponsePerMember;
  const notify = pendingSettings
    ? pending!.get("notifyOnSubmission") === "true"
    : notifyOnSubmission;
  const isListed = pendingSettings
    ? pending!.get("listed") === "true"
    : listed;

  // Window edits stage locally and save on the button — datetime inputs fire
  // change per keystroke in some browsers, so instant-save would spam.
  const [draftOpensAt, setDraftOpensAt] = useState(() => toLocalInputValue(opensAt));
  const [draftClosesAt, setDraftClosesAt] = useState(() => toLocalInputValue(closesAt));
  const windowDirty =
    draftOpensAt !== toLocalInputValue(opensAt) ||
    draftClosesAt !== toLocalInputValue(closesAt);

  function saveWindow() {
    fetcher.submit(
      {
        intent: "update-form-window",
        id: formId,
        opensAt: draftOpensAt ? new Date(draftOpensAt).toISOString() : "",
        closesAt: draftClosesAt ? new Date(draftClosesAt).toISOString() : "",
      },
      { method: "post" },
    );
  }

  // Audience edits stage locally: picking "Specific groups" with nothing
  // checked must not submit (the saved audience stays live until a valid
  // selection exists).
  const [draftAudience, setDraftAudience] = useState<AudienceValue>(audience);
  const [groupSel, setGroupSel] = useState<Set<string>>(
    () => new Set(audienceGroupIds),
  );

  function saveSettings(
    nextOneResponse: boolean,
    nextNotify: boolean,
    nextListed: boolean,
  ) {
    fetcher.submit(
      {
        intent: "update-form-settings",
        id: formId,
        oneResponsePerMember: String(nextOneResponse),
        notifyOnSubmission: String(nextNotify),
        listed: String(nextListed),
      },
      { method: "post" },
    );
  }

  function saveAudience(nextAudience: AudienceValue, ids: Set<string>) {
    fetcher.submit(
      {
        intent: "update-form-audience",
        id: formId,
        audience: nextAudience,
        groupIds: JSON.stringify([...ids]),
      },
      { method: "post" },
    );
  }

  function pickAudience(next: AudienceValue) {
    setDraftAudience(next);
    if (next !== "Groups") {
      saveAudience(next, new Set());
      return;
    }
    if (groupSel.size > 0) saveAudience("Groups", groupSel);
  }

  function toggleGroup(id: string) {
    const next = new Set(groupSel);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setGroupSel(next);
    if (draftAudience === "Groups" && next.size > 0) {
      saveAudience("Groups", next);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <span className={heading}>Settings</span>
        <Checkbox
          checked={oneResponse}
          onChange={(e) => saveSettings(e.target.checked, notify, isListed)}
          label="One response per member"
        />
        <Checkbox
          checked={notify}
          onChange={(e) => saveSettings(oneResponse, e.target.checked, isListed)}
          label="Notify on submission"
        />
        <Checkbox
          checked={isListed}
          onChange={(e) => saveSettings(oneResponse, notify, e.target.checked)}
          label="List in Forms for you"
        />
      </div>

      <div className="flex flex-col gap-2">
        <span className={heading}>Schedule</span>
        <label className="flex items-center gap-2 text-sm">
          <span className="w-14 text-muted-foreground">Opens</span>
          <DateField
            mode="datetime-local"
            value={draftOpensAt}
            onChange={(value) => setDraftOpensAt(value)}
            ariaLabel="Opens at"
          />
        </label>
        <label className="flex items-center gap-2 text-sm">
          <span className="w-14 text-muted-foreground">Closes</span>
          <DateField
            mode="datetime-local"
            value={draftClosesAt}
            onChange={(value) => setDraftClosesAt(value)}
            ariaLabel="Closes at"
          />
        </label>
        {windowDirty && (
          <Button
            variant="secondary"
            size="sm"
            onClick={saveWindow}
            className="self-start"
          >
            Save schedule
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <span className={heading}>Who can fill this form</span>
        {AUDIENCE_OPTIONS.map((opt) => (
          <Radio
            key={opt.value}
            name="form-audience"
            checked={draftAudience === opt.value}
            onChange={() => pickAudience(opt.value)}
            label={opt.label}
          />
        ))}

        {draftAudience === "Groups" && (
          <div className="ml-6 flex flex-col gap-1.5">
            {groups.length === 0 ? (
              <span className="text-xs text-muted-foreground">
                No groups yet. Create them in Admin › Groups.
              </span>
            ) : (
              groups.map((g) => (
                <Checkbox
                  key={g.id}
                  checked={groupSel.has(g.id)}
                  onChange={() => toggleGroup(g.id)}
                  label={
                    <>
                      <span className="text-sm text-foreground truncate">{g.name}</span>
                      <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full shrink-0">
                        {g.type}
                      </span>
                    </>
                  }
                />
              ))
            )}
            {groupSel.size === 0 && (
              <span className="text-xs text-os-amber">
                Select at least one group. Until then the saved audience stays
                in effect.
              </span>
            )}
          </div>
        )}
      </div>

      {err && <div className="text-destructive text-xs">{err}</div>}
    </div>
  );
}


// Panel showing every hiring cycle this form is linked to, with an Unlink
// button for cycles still in Draft. Renders nothing when `links` is empty.
function HiringLinksPanel({ links }: { links: HiringFormLink[] }) {
  const confirmSubmit = useConfirmSubmit();
  const { heading } = useOsChrome();
  return (
    <div className="flex flex-col gap-2">
      <span className={heading}>Linked to hiring</span>
      <ul className="space-y-2">
        {links.map((link) => (
          <HiringLinkRow key={`${link.linkType}:${link.cycleDomainFormId ?? link.cycleId}`} link={link} confirmSubmit={confirmSubmit} />
        ))}
      </ul>
    </div>
  );
}

function HiringLinkRow({
  link,
  confirmSubmit,
}: {
  link: HiringFormLink;
  confirmSubmit: ReturnType<typeof useConfirmSubmit>;
}) {
  const fetcher = useFetcher<{ ok?: true; error?: string }>();
  const isSubmitting = fetcher.state !== "idle";
  const responseError =
    fetcher.data && "error" in fetcher.data ? fetcher.data.error : null;

  return (
    <li className="flex items-center justify-between gap-3 text-sm">
      <div className="flex items-center gap-2 min-w-0">
        <Unlink className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
        <span className="truncate text-foreground">{link.label}</span>
        {responseError && (
          <span className="text-xs text-destructive ml-1">{responseError}</span>
        )}
      </div>
      {link.locked ? (
        <span className="text-xs text-muted-foreground flex-shrink-0">
          {link.lockReason}
        </span>
      ) : (
        <fetcher.Form
          method="post"
          onSubmit={confirmSubmit({
            title: "Unlink this form?",
            description: `This will remove the form from "${link.cycleName}". The form itself is kept.`,
            tone: "destructive",
            confirmLabel: "Unlink",
          })}
        >
          <input type="hidden" name="intent" value="unlink-hiring-form" />
          <input type="hidden" name="linkType" value={link.linkType} />
          <input type="hidden" name="cycleId" value={link.cycleId} />
          {link.cycleDomainFormId && (
            <input
              type="hidden"
              name="cycleDomainFormId"
              value={link.cycleDomainFormId}
            />
          )}
          <button
            type="submit"
            disabled={isSubmitting}
            className="text-xs font-medium text-destructive hover:text-destructive/80 disabled:opacity-50 flex-shrink-0"
          >
            {isSubmitting ? "Unlinking…" : "Unlink"}
          </button>
        </fetcher.Form>
      )}
    </li>
  );
}
