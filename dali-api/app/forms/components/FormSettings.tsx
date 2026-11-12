import { useState } from "react";
import { Link, useFetcher } from "react-router";
import { Lock, Unlink } from "lucide-react";
import { Modal, ModalHeader } from "~/components/Modal";
import { modalCardClass, useOsChrome } from "~/components/os-chrome";
import { Button } from "~/components/ui/Button";
import { Checkbox } from "~/components/ui/Checkbox";
import { DateField } from "~/components/ui/DateField";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { DocEditor } from "~/components/doc";
import { isEmptyBlocks } from "~/lib/blocks";
import type { HiringFormLink } from "~/forms/lib/form-links.server";

type Usage = { kind: string; label: string; href?: string | null };

// Everything about a form that isn't its questions — response rules, the
// publish schedule, and where it's in use — behind the editor's
// settings button. A managed form (its distribution owned by a hiring cycle,
// offering, etc.) shows only where it's managed and used.
export function FormSettingsDialog({
  open,
  onClose,
  managing,
  usages,
  hiringLinks,
  ...fields
}: {
  open: boolean;
  onClose: () => void;
  managing: { kind?: string; label: string; href?: string | null } | null;
  usages: Usage[];
  hiringLinks: HiringFormLink[];
} & Parameters<typeof FormSettingsFields>[0]) {
  const { heading } = useOsChrome();
  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        labelledBy="form-settings-title"
        containerClassName={modalCardClass("max-w-lg os-form")}
      >
        <ModalHeader
          titleId="form-settings-title"
          title="Settings"
          onClose={onClose}
        />
        <div className="flex flex-col gap-6">
          {managing ? (
            <div className="rounded-os-item bg-os-accent/10 p-4 flex items-start gap-3 text-sm text-foreground">
              <Lock className="w-4 h-4 text-os-accent shrink-0 mt-0.5" />
              <div className="flex flex-col gap-1">
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
                {/* The response rules below are hidden for a managed form, so
                    name the one the staffing slot enforces instead of leaving
                    it to be discovered from a refused submission. */}
                {managing.kind === "staffing" && (
                  <span className="text-xs text-muted-foreground">
                    One response per member, always: a second submit is refused
                    and the member sees when they filled it. Unbind the slot to
                    hand the form's settings back.
                  </span>
                )}
              </div>
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

// ISO timestamp → the local wall-time string a datetime-local input expects.
function toLocalInputValue(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Per-form response settings. Toggles submit both boolean values (single
// idempotent update). Pending fetcher FormData drives optimistic state so
// changes feel instant and settle to the loader's truth. Who can fill is set
// under Share.
function FormSettingsFields({
  formId,
  oneResponsePerMember,
  allowResponseEdit,
  remindBeforeClose,
  confirmationMessage,
  sendReceipt,
  audience,
  hasEmailQuestion,
  notifyOnSubmission,
  listed,
  opensAt,
  closesAt,
}: {
  formId: string;
  oneResponsePerMember: boolean;
  allowResponseEdit: boolean;
  remindBeforeClose: boolean;
  confirmationMessage: unknown;
  sendReceipt: boolean;
  audience: string;
  hasEmailQuestion: boolean;
  notifyOnSubmission: boolean;
  listed: boolean;
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
  const canEdit = pendingSettings
    ? pending!.get("allowResponseEdit") === "true"
    : allowResponseEdit;
  const receipt = pendingSettings
    ? pending!.get("sendReceipt") === "true"
    : sendReceipt;
  const isPublic = audience === "Public";
  const hasCloseTime = closesAt !== null;
  const remind = pendingSettings
    ? pending!.get("remindBeforeClose") === "true"
    : remindBeforeClose;
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

  function saveSettings(
    nextOneResponse: boolean,
    nextNotify: boolean,
    nextListed: boolean,
    nextCanEdit: boolean = canEdit,
    nextRemind: boolean = remind,
    extra: Record<string, string> = {},
  ) {
    fetcher.submit(
      {
        intent: "update-form-settings",
        id: formId,
        oneResponsePerMember: String(nextOneResponse),
        allowResponseEdit: String(nextOneResponse && nextCanEdit),
        remindBeforeClose: String(nextRemind),
        notifyOnSubmission: String(nextNotify),
        listed: String(nextListed),
        sendReceipt: String(receipt),
        ...extra,
      },
      { method: "post" },
    );
  }

  // Saved on the button, not per keystroke. Cleared content sends "" to clear.
  const [draftMessage, setDraftMessage] = useState<unknown>(confirmationMessage);
  const [messageDirty, setMessageDirty] = useState(false);

  function saveMessage() {
    const cleared = isEmptyBlocks(draftMessage);
    saveSettings(oneResponse, notify, isListed, canEdit, remind, {
      confirmationMessage: cleared ? "" : JSON.stringify(draftMessage),
    });
    setMessageDirty(false);
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
        {oneResponse && (
          <div className="pl-[26px]">
            <Checkbox
              checked={canEdit}
              onChange={(e) => saveSettings(oneResponse, notify, isListed, e.target.checked)}
              label="Let people edit their response"
            />
          </div>
        )}
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
        <div className="flex flex-col gap-1">
          <Checkbox
            checked={remind && hasCloseTime}
            disabled={!hasCloseTime}
            onChange={(e) =>
              saveSettings(oneResponse, notify, isListed, canEdit, e.target.checked)
            }
            label="Remind people 1 day before closing"
          />
          {!hasCloseTime && (
            <p className="pl-[26px] text-xs text-os-grey">Set a close time to use this.</p>
          )}
        </div>
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
        <span className={heading}>After submitting</span>
        <div className="flex flex-col gap-1">
          <span id="confirmation-message-label" className="text-xs text-muted-foreground">
            Confirmation message
          </span>
          <DocEditor
            features="notes"
            density="compact"
            initialContent={Array.isArray(confirmationMessage) ? confirmationMessage : undefined}
            onChange={(blocks) => {
              setDraftMessage(blocks);
              setMessageDirty(true);
            }}
            placeholder="Shown after someone submits. Add links or next steps."
            className="rounded-os-item bg-os-well py-2"
          />
          {messageDirty && (
            <Button
              variant="secondary"
              size="sm"
              onClick={saveMessage}
              className="self-start mt-1"
            >
              Save message
            </Button>
          )}
        </div>
        <Checkbox
          checked={receipt}
          onChange={(e) =>
            saveSettings(oneResponse, notify, isListed, canEdit, remind, {
              sendReceipt: String(e.target.checked),
            })
          }
          label="Email people a copy of their response"
        />
        {isPublic && (
          <p
            className={`pl-[26px] text-xs ${
              hasEmailQuestion ? "text-os-grey" : "text-amber-700"
            }`}
          >
            {hasEmailQuestion
              ? "People who aren't signed in get a short note at the first Email question, without their answers."
              : "Add an Email question so people who aren't signed in get a copy too."}
          </p>
        )}
      </div>

      <p className="text-sm text-os-grey">Who can fill this form is set under Share.</p>

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
