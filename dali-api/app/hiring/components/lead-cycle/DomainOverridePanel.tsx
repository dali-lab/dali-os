import { useState, useEffect } from "react";
import { Form, useFetcher } from "react-router";
import { Select, type SelectOption, Tooltip } from "~/components/ui/floating";
import { domainCloseDate } from "~/hiring/lib/domain-windows";
import { DateField } from "~/components/ui/DateField";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { Trash2, Eye } from "lucide-react";
import { useOsChrome } from "~/components/os-chrome";
import { buttonClasses } from "~/components/ui/Button";
import { DomainSubRow, SubRowEmpty, SubRowVersion } from "~/hiring/components/cycle-setup/DomainSubRow";
import { ChallengeLine, NotReadyIcon, type DomainChallenge } from "~/hiring/components/cycle-setup/ChallengeLine";
import { Pill, rowTrigger } from "~/hiring/components/cycle-setup/SetupCard";
import { formatVersionLabel } from "~/lib/formatVersion";
import { getZonedYMD, formatInTimeZone, APPLICATION_TZ } from "~/lib/timezone";
import { RubricPreviewModal } from "~/hiring/components/lead-cycle/EmailStatusSection";

export function toYmd(d: Date | string | null): string {
  if (!d) return '';
  const { year, month, day } = getZonedYMD(new Date(d), APPLICATION_TZ);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function formatMonD(d: Date | string | null): string {
  if (!d) return '';
  return formatInTimeZone(new Date(d), APPLICATION_TZ, { month: 'short', day: 'numeric' });
}

export function joinNames(names: string[]): string {
  return new Intl.ListFormat('en', { style: 'long', type: 'conjunction' }).format(names);
}

// An Accept decision closes every other still-selected, undecided sibling
// DomainApplication as AcceptedElsewhere (api.decisions.$id.release.ts). When
// the loader found such a sibling still open (openSiblingDomains, from
// accept-preemption.server.ts), releasing needs a stronger confirm than the
// default "this emails the applicant" one. Null when there's nothing to warn
// about.
export function acceptPreemptionWarning(d: any): { title: string; description: string } | null {
  const siblings: { name: string; closeDate: Date | string | null }[] = d.openSiblingDomains ?? [];
  if (d.type !== 'Accepted' || siblings.length === 0) return null;
  const firstName = d.domainApplication.application.user.firstName;
  const names = siblings.map((s) => s.name);
  const nounPhrase =
    siblings.length > 1
      ? `${joinNames(
          siblings.map((s) => (s.closeDate ? `${s.name} (until ${formatMonD(s.closeDate)})` : s.name)),
        )} applications`
      : `${siblings[0].name} application${siblings[0].closeDate ? ` until ${formatMonD(siblings[0].closeDate)}` : ''}`;
  const pronoun = siblings.length > 1 ? 'them' : 'it';
  return {
    title: `Accept and close ${joinNames(names)}?`,
    description: `${firstName} can still edit their ${nounPhrase}. Accepting here closes ${pronoun} as placed elsewhere. This can't be undone.`,
  };
}

export function DomainOverridePanel({
  domain,
  cycleStatus,
  cycleCloseDate,
  showRubric,
  challenge,
  rubricOptions,
  rubricLocked,
  domainAddedRecipientCount,
}: {
  domain: any;
  cycleStatus: string;
  /** The cycle's own close date, for the "Same as cycle" label when this domain inherits it. */
  cycleCloseDate: Date | string | null;
  /** The per-domain rubric scores the challenge; hidden when there is none. */
  showRubric: boolean;
  /** This domain's challenges; null when the cycle has none. */
  challenge: DomainChallenge | null;
  rubricOptions: any[];
  rubricLocked: boolean;
  /** How many applicants "Email applicants" would reach — cycle-wide, not per-domain. */
  domainAddedRecipientCount: number;
}) {
  const [showRubricPreview, setShowRubricPreview] = useState(false);

  const isReady: boolean = !!domain.isReady;
  // A domain staged into an Open cycle stays editable until it's marked ready,
  // which is what publishes it to applicants (canEditDomainSetup).
  const staged = cycleStatus === 'Open' && !isReady;
  const setupEditable = cycleStatus === 'Draft' || staged;
  const readyLocked = !setupEditable;
  // Unlike the rest of this panel's setup, the close date can move any time
  // the cycle is still taking or reviewing changes — a lead may need to give
  // one domain more (or less) time after it's already live to applicants.
  const closeDateEditable = cycleStatus === 'Draft' || cycleStatus === 'Open';
  const effectiveCloseDate = domainCloseDate({ closeDate: domain.closeDate }, { closeDate: cycleCloseDate });

  const closeFetcher = useFetcher<{ error?: string }>();
  const [editingClose, setEditingClose] = useState(false);
  const [closeValue, setCloseValue] = useState(toYmd(domain.closeDate));
  useEffect(() => { setCloseValue(toYmd(domain.closeDate)); }, [domain.closeDate]);
  useEffect(() => {
    if (closeFetcher.state === 'idle' && !closeFetcher.data?.error) setEditingClose(false);
  }, [closeFetcher.state, closeFetcher.data]);

  const [selectedRubricId, setSelectedRubricId] = useState(domain.rubricVersionId ?? '');
  // Like the Challenge line, the rubric shows what's set and opens a picker on demand.
  const [editingRubric, setEditingRubric] = useState(false);
  useEffect(() => { setSelectedRubricId(domain.rubricVersionId ?? ''); }, [domain.rubricVersionId]);

  const currentRubric = rubricOptions.find((rv: any) => rv.id === selectedRubricId);
  const rubricVersion = (rv: any) => ({
    name: rv.rubric?.name ?? 'Rubric',
    versionNumber: rv.versionNumber,
    createdAt: rv.createdAt,
    createdBy: rv.createdBy,
  });

  const os = useOsChrome();
  const confirmSubmit = useConfirmSubmit();
  const domainName = domain.domain?.name ?? domain.domainId;
  const previewButton = (
    <Tooltip content="Preview">
      <button
        type="button"
        onClick={() => setShowRubricPreview(true)}
        aria-label="Preview"
        className={buttonClasses('secondary', 'sm', 'px-2')}
      >
        <Eye className="w-3.5 h-3.5" />
      </button>
    </Tooltip>
  );

  return (
    <div className="flex flex-col gap-3 rounded-os-item bg-os-well p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {!isReady && <NotReadyIcon />}
          <span className="text-sm font-semibold text-foreground">{domainName}</span>
          {staged && <Pill tone="warning">Not visible to applicants yet</Pill>}
        </div>
        <div className="flex items-center gap-1">
          {!readyLocked && (
            <Form
              method="post"
              preventScrollReset
              className="inline"
              onSubmit={confirmSubmit(
                isReady
                  ? {
                      title: `Unmark ${domainName} as ready?`,
                      description:
                        'It goes back to "not ready" until the domain lead (or a hiring lead) marks it ready again.',
                      confirmLabel: 'Unmark ready',
                    }
                  : staged
                    ? {
                        title: `Open ${domainName} to applicants?`,
                        description:
                          'The cycle is already open. Marking this domain ready publishes it: applicants can pick it from now until its close date.',
                        confirmLabel: 'Open domain',
                      }
                    : {
                        title: `Mark ${domainName} ready on the domain lead's behalf?`,
                        description:
                          'Use this when the domain lead is unavailable and the cycle needs to advance.',
                        confirmLabel: 'Force ready',
                      },
              )}
            >
              <input
                type="hidden"
                name="intent"
                value={isReady ? 'hl-force-unmark-ready' : 'hl-force-mark-ready'}
              />
              <input type="hidden" name="domainId" value={domain.domainId} />
              <input type="hidden" name="confirm" value="true" />
              <button type="submit" className={buttonClasses(isReady ? 'ghost' : 'secondary', 'sm')}>
                {isReady ? 'Unmark ready' : 'Force ready'}
              </button>
            </Form>
          )}
          {cycleStatus === 'Open' && isReady && (
            <Form
              method="post"
              preventScrollReset
              className="inline flex items-center gap-1"
              onSubmit={confirmSubmit({
                title: `Email everyone in this cycle about ${domainName}?`,
                description:
                  `Sends to ${domainAddedRecipientCount} applicant${domainAddedRecipientCount === 1 ? '' : 's'}` +
                  (effectiveCloseDate
                    ? `, telling them ${domainName} is open and closes ${formatMonD(effectiveCloseDate)}.`
                    : `, telling them ${domainName} is open.`) +
                  ' One-time: resending only reaches anyone who missed it the first time.',
                confirmLabel: 'Send',
              })}
            >
              <input type="hidden" name="intent" value="notify-domain-added" />
              <input type="hidden" name="domainId" value={domain.domainId} />
              <input type="hidden" name="confirm" value="true" />
              <button type="submit" className={buttonClasses('secondary', 'sm')}>
                Email applicants
              </button>
            </Form>
          )}
          {setupEditable && (
            <Form
              method="post"
              preventScrollReset
              className="inline"
              onSubmit={confirmSubmit({
                title: `Remove ${domainName} from this cycle?`,
                description:
                  "Any challenge version linked for this domain is unlinked. Applicants can no longer target it.",
                confirmLabel: 'Remove',
                tone: 'destructive',
              })}
            >
              <input type="hidden" name="intent" value="remove-domain" />
              <input type="hidden" name="domainId" value={domain.domainId} />
              <Tooltip content="Remove domain">
                <button
                  type="submit"
                  className={os.iconBtn}
                  aria-label={`Remove ${domainName}`}
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </Tooltip>
            </Form>
          )}
        </div>
      </div>

      {challenge && (
        <ChallengeLine domainId={domain.domainId} challenge={challenge} editable={setupEditable} />
      )}

      <DomainSubRow
        label="Closes"
        value={
          domain.closeDate ? (
            <span>{formatMonD(domain.closeDate)}</span>
          ) : (
            <SubRowEmpty>
              {cycleCloseDate ? `Same as cycle (${formatMonD(cycleCloseDate)})` : "Same as cycle (no date set)"}
            </SubRowEmpty>
          )
        }
        action={
          closeDateEditable &&
          !editingClose && (
            <>
              <button type="button" onClick={() => setEditingClose(true)} className={buttonClasses('secondary', 'sm')}>
                {domain.closeDate ? 'Change' : 'Set'}
              </button>
              {domain.closeDate && (
                <button
                  type="button"
                  disabled={closeFetcher.state !== 'idle'}
                  onClick={() =>
                    closeFetcher.submit(
                      { intent: 'set-domain-close-date', domainId: domain.domainId, closeDate: '' },
                      { method: 'post', preventScrollReset: true },
                    )
                  }
                  className={buttonClasses('ghost', 'sm')}
                >
                  Clear
                </button>
              )}
            </>
          )
        }
        editor={
          closeDateEditable && editingClose ? (
            <closeFetcher.Form method="post" preventScrollReset className="flex flex-wrap items-end gap-2">
              <input type="hidden" name="intent" value="set-domain-close-date" />
              <input type="hidden" name="domainId" value={domain.domainId} />
              <DateField
                mode="date"
                name="closeDate"
                value={closeValue}
                onChange={setCloseValue}
                ariaLabel={`${domainName} closes`}
                className="w-44"
                buttonClassName={rowTrigger(os.formTrigger)}
              />
              <button type="submit" disabled={closeFetcher.state !== 'idle'} className={buttonClasses('primary', 'sm', 'h-9')}>
                Save
              </button>
              <button
                type="button"
                onClick={() => {
                  setCloseValue(toYmd(domain.closeDate));
                  setEditingClose(false);
                }}
                className={buttonClasses('secondary', 'sm', 'h-9')}
              >
                Cancel
              </button>
              {closeFetcher.data?.error && <p className="w-full text-xs text-destructive">{closeFetcher.data.error}</p>}
            </closeFetcher.Form>
          ) : null
        }
      />

      {showRubric && (
        <DomainSubRow
          label="Rubric"
          value={
            currentRubric ? <SubRowVersion version={rubricVersion(currentRubric)} /> : <SubRowEmpty>None yet</SubRowEmpty>
          }
          action={
            <>
              {rubricLocked && <Pill>Locked, reviews assigned</Pill>}
              {currentRubric && !editingRubric && previewButton}
              {!rubricLocked && !editingRubric && rubricOptions.length > 0 && (
                <button type="button" onClick={() => setEditingRubric(true)} className={buttonClasses('secondary', 'sm')}>
                  {currentRubric ? 'Change' : 'Set rubric'}
                </button>
              )}
            </>
          }
          editor={
            rubricOptions.length === 0 ? (
              <p className={os.bodyText}>No rubric versions yet. Create one in the Library.</p>
            ) : !rubricLocked && editingRubric ? (
              <Form
                method="post"
                preventScrollReset
                className="flex flex-wrap items-end gap-2"
                onSubmit={() => setEditingRubric(false)}
              >
                <input type="hidden" name="intent" value="hl-set-domain-rubric" />
                <input type="hidden" name="domainId" value={domain.domainId} />
                <div className="min-w-[14rem] flex-1">
                  <Select
                    name="rubricVersionId"
                    value={selectedRubricId}
                    onChange={(value) => setSelectedRubricId(value)}
                    placeholder="No rubric"
                    ariaLabel={`Select rubric version for ${domainName}`}
                    options={[
                      { value: "", label: "No rubric" },
                      ...rubricOptions.map((rv: any): SelectOption => ({
                        value: rv.id,
                        label: formatVersionLabel(rubricVersion(rv)),
                      })),
                    ]}
                    buttonClassName={rowTrigger(os.formTrigger)}
                  />
                </div>
                {selectedRubricId && previewButton}
                <button type="submit" className={buttonClasses('primary', 'md', 'h-9')}>
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedRubricId(domain.rubricVersionId ?? '');
                    setEditingRubric(false);
                  }}
                  className={buttonClasses('secondary', 'md', 'h-9')}
                >
                  Cancel
                </button>
              </Form>
            ) : null
          }
        />
      )}

      {showRubricPreview && currentRubric && (
        <RubricPreviewModal
          rv={currentRubric}
          onClose={() => setShowRubricPreview(false)}
        />
      )}
    </div>
  );
}
