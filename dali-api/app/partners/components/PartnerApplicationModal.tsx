// Partner application record modal — follows TaskModal's conventions (type
// badge, record mode with a pencil to edit, useDialog guarded close) but
// wide, with a two-column body: tabs on the left, a property rail on the
// right. specs/partner-crm.md §5.
//
// Mounted from the board route (app/partners/components/PartnerBoard.tsx),
// so every save posts through a plain fetch() to the detail route's action
// (see partner-detail-fetch.ts) rather than a <Form>/useFetcher — a
// cross-route redirect from a fetcher would navigate the whole app there.

import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { Pencil, X } from "lucide-react";
import { Modal } from "~/components/Modal";
import { MultiSelect, Select } from "~/components/ui/floating";
import { Button, buttonClasses } from "~/components/ui/Button";
import { UnderlineTabButtons } from "~/components/AreaPillNav";
import { useDialog } from "~/components/ui/dialog";
import { modalCardClass } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import type { PartnerCardModel } from "../lib/partner-board";
import type { ApplicationDetailResponse } from "../lib/partner-application-detail";
import { ActivityTab } from "./application/ActivityTab";
import { DetailsTab } from "./application/DetailsTab";
import { MeetingsTab } from "./application/MeetingsTab";
import { EvaluationTab } from "./application/EvaluationTab";
import { EmailTab } from "./application/EmailTab";
import { PropertyRail } from "./application/PropertyRail";
import { StageActions } from "./application/StageActions";
import { ScheduleInterviewModal } from "./ScheduleInterviewModal";

const TAB_ROW_LIMIT = 8;

type Tab = "activity" | "details" | "meetings" | "evaluation" | "email";
const TABS: { key: Tab; label: string }[] = [
  { key: "activity", label: "Activity" },
  { key: "details", label: "Details" },
  { key: "meetings", label: "Meetings" },
  { key: "evaluation", label: "Evaluation" },
  { key: "email", label: "Email" },
];

const CREATE_SOURCES: { value: string; label: string }[] = [
  { value: "Manual", label: "Manual" },
  { value: "Email", label: "Email" },
  { value: "Referral", label: "Referral" },
  { value: "Form", label: "Form" },
];

export function PartnerApplicationModal({
  card,
  canEdit,
  domainOptions,
  termOptions,
  onClose,
  onChanged,
}: {
  /** null = create mode. */
  card: PartnerCardModel | null;
  canEdit: boolean;
  domainOptions: { id: string; name: string }[];
  termOptions: { id: string; code: string }[];
  onClose: () => void;
  /** Called after any save/move/create the caller should refresh the board for. */
  onChanged: () => void;
}) {
  const isCreate = !card;
  const dialog = useDialog();
  const [tab, setTab] = useState<Tab>("activity");
  const [detail, setDetail] = useState<ApplicationDetailResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [showScheduler, setShowScheduler] = useState(false);

  const load = useCallback(async () => {
    if (!card) return;
    setLoadError(null);
    try {
      const res = await fetch(`/api/partner-applications/${card.id}`, { credentials: "include" });
      if (!res.ok) throw new Error(`Request failed: ${res.status}`);
      setDetail((await res.json()) as ApplicationDetailResponse);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Couldn't load this application.");
    }
  }, [card]);

  useEffect(() => {
    setDetail(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card?.id]);

  const refresh = useCallback(() => {
    void load();
    onChanged();
  }, [load, onChanged]);

  // ─── Create mode ──────────────────────────────────────────────────────
  const [newTitle, setNewTitle] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [newSummary, setNewSummary] = useState("");
  const [newSource, setNewSource] = useState("Manual");
  const [newTermIds, setNewTermIds] = useState<string[]>([]);
  const [newDomainIds, setNewDomainIds] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  function createIsDirty(): boolean {
    return (
      newTitle.trim() !== "" ||
      contactName.trim() !== "" ||
      contactEmail.trim() !== "" ||
      newSummary.trim() !== "" ||
      newSource !== "Manual" ||
      newTermIds.length > 0 ||
      newDomainIds.length > 0
    );
  }

  async function submitCreate() {
    if (!newTitle.trim() || !contactEmail.trim()) return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await fetch("/api/partner-applications", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: newTitle.trim(),
          applicantName: contactName.trim() || null,
          applicantEmail: contactEmail.trim(),
          summary: newSummary.trim() || null,
          source: newSource,
          targetTermIds: newTermIds,
          domainIds: newDomainIds,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed: ${res.status}`);
      }
      // Stays on the board (specs/partner-crm.md §5 create mode): close the
      // modal and let the board revalidate so the new card appears at the
      // top of New, instead of navigating to the full page.
      onClose();
      onChanged();
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Couldn't create the application.");
    } finally {
      setCreating(false);
    }
  }

  async function guardedClose() {
    if (isCreate && createIsDirty()) {
      const ok = await dialog.confirm({
        title: "Discard this application?",
        confirmLabel: "Discard",
        tone: "destructive",
      });
      if (!ok) return;
    }
    onClose();
  }

  async function saveTitle() {
    if (!detail) return;
    const trimmed = titleDraft.trim();
    setEditingTitle(false);
    if (!trimmed || trimmed === detail.application.title) return;
    const fd = new FormData();
    fd.set("intent", "title");
    fd.set("title", trimmed);
    await fetch(`/core/partners/applications/${detail.application.id}`, {
      method: "POST",
      credentials: "include",
      body: fd,
    });
    refresh();
  }

  const availableDomains = detail
    ? domainOptions.filter((d) => !detail.application.domains.some((ad) => ad.domainId === d.id))
    : domainOptions;

  return (
    <>
      <Modal
        open
        onClose={() => void guardedClose()}
        labelledBy="partner-application-modal-title"
        containerClassName={cn(modalCardClass("max-w-4xl max-h-[85vh]"), "flex flex-col")}
      >
        <div className="flex flex-shrink-0 items-start justify-between gap-3 px-6 pt-6 pb-0">
          <span className="os-type-badge os-type-badge--partner mt-1.5 flex-shrink-0">
            Partner application
          </span>
          {isCreate ? (
            <h2 id="partner-application-modal-title" className="os-modal-title min-w-0 flex-1">
              New partner application
            </h2>
          ) : editingTitle ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => void saveTitle()}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
              }}
              className="min-w-0 flex-1 border-0 border-b border-border bg-transparent px-0 py-1 text-lg font-semibold text-foreground focus:border-accent-coral focus:outline-none"
            />
          ) : (
            <h2
              id="partner-application-modal-title"
              className="os-record-name os-modal-title min-w-0 flex-1 break-words"
            >
              {detail?.application.title ?? "Loading…"}
            </h2>
          )}
          <div className="flex flex-shrink-0 items-center gap-1.5">
            {!isCreate && !editingTitle && canEdit && detail && (
              <button
                type="button"
                onClick={() => {
                  setTitleDraft(detail.application.title);
                  setEditingTitle(true);
                }}
                className="os-icon-btn"
                aria-label="Edit title"
              >
                <Pencil className="h-4 w-4" aria-hidden />
              </button>
            )}
            <button type="button" onClick={() => void guardedClose()} className="os-icon-btn" aria-label="Close">
              <X className="h-5 w-5" aria-hidden />
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4">
          {isCreate ? (
            <div className="flex flex-col gap-4">
              <label className="os-field-group">
                <span className="os-field-label">
                  Title<span className="os-required-mark">*</span>
                </span>
                <input
                  autoFocus
                  value={newTitle}
                  onChange={(e) => setNewTitle(e.target.value)}
                  placeholder="What is the partner pitching?"
                  className="w-full"
                />
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="os-field-group">
                  <span className="os-field-label">
                    Contact email<span className="os-required-mark">*</span>
                  </span>
                  <input
                    type="email"
                    value={contactEmail}
                    onChange={(e) => setContactEmail(e.target.value)}
                    placeholder="contact@company.com"
                    className="w-full"
                  />
                </label>
                <label className="os-field-group">
                  <span className="os-field-label">Contact name</span>
                  <input
                    value={contactName}
                    onChange={(e) => setContactName(e.target.value)}
                    placeholder="Jane Smith (optional)"
                    className="w-full"
                  />
                </label>
              </div>
              <label className="os-field-group">
                <span className="os-field-label">Summary</span>
                <textarea
                  value={newSummary}
                  onChange={(e) => setNewSummary(e.target.value)}
                  rows={3}
                  placeholder="One-paragraph synopsis for the lab."
                  className="w-full"
                />
              </label>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className="os-field-group">
                  <span className="os-field-label">Source</span>
                  <Select
                    value={newSource}
                    onChange={setNewSource}
                    options={CREATE_SOURCES}
                    buttonClassName="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground inline-flex items-center justify-between gap-1"
                  />
                </label>
                <label className="os-field-group">
                  <span className="os-field-label">Target terms</span>
                  <MultiSelect
                    values={newTermIds}
                    onChange={setNewTermIds}
                    options={termOptions.map((t) => ({ value: t.id, label: t.code }))}
                    ariaLabel="Target terms"
                    placeholder="None"
                    buttonClassName="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground inline-flex items-center justify-between gap-1"
                  />
                </label>
              </div>
              <label className="os-field-group">
                <span className="os-field-label">Domains</span>
                <MultiSelect
                  values={newDomainIds}
                  onChange={setNewDomainIds}
                  options={domainOptions.map((d) => ({ value: d.id, label: d.name }))}
                  ariaLabel="Domains"
                  placeholder="None"
                  buttonClassName="w-full px-2 py-1.5 text-sm border border-border rounded-md bg-background text-foreground inline-flex items-center justify-between gap-1"
                />
              </label>
              {createError && <p className="text-sm text-destructive">{createError}</p>}
            </div>
          ) : loadError ? (
            <p className="text-sm text-destructive">{loadError}</p>
          ) : !detail ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="grid grid-cols-1 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_18rem]">
              <div className="min-w-0">
                <UnderlineTabButtons
                  label="Application sections"
                  items={TABS.map((t) => ({ label: t.label, active: tab === t.key, onClick: () => setTab(t.key) }))}
                />
                <div className="mt-4">
                  {tab === "activity" && (
                    <ActivityTab
                      applicationId={detail.application.id}
                      activities={detail.activities}
                      actorNames={detail.actorNames}
                      emailThreads={detail.partnerEmailOn ? detail.emailThreads : []}
                      canEdit={canEdit}
                      limit={TAB_ROW_LIMIT}
                      viewAllHref={`/core/partners/applications/${detail.application.id}?tab=activity`}
                      onChanged={refresh}
                    />
                  )}
                  {tab === "details" && (
                    <DetailsTab
                      summary={detail.application.summary}
                      formAnswers={detail.formAnswers}
                      domains={detail.application.domains}
                      targetTerms={detail.application.targetTerms}
                      viewAllHref={`/core/partners/applications/${detail.application.id}?tab=details`}
                    />
                  )}
                  {tab === "meetings" && (
                    <MeetingsTab
                      applicationId={detail.application.id}
                      meetings={detail.application.meetings}
                      meetingRequests={detail.application.meetingRequests}
                      coreMembers={detail.coreMembers}
                      canEdit={canEdit}
                      limit={TAB_ROW_LIMIT}
                      viewAllHref={`/core/partners/applications/${detail.application.id}?tab=meetings`}
                      onScheduleMeeting={() => setShowScheduler(true)}
                      onChanged={refresh}
                    />
                  )}
                  {tab === "evaluation" && (
                    <EvaluationTab
                      applicationId={detail.application.id}
                      evalRubric={detail.application.evalRubric}
                      interviewRating={detail.application.interviewRating}
                      canEdit={canEdit}
                      onChanged={refresh}
                    />
                  )}
                  {tab === "email" && (
                    <EmailTab
                      contactId={detail.application.applicant.id}
                      threads={detail.emailThreads}
                      partnerEmailOn={detail.partnerEmailOn}
                    />
                  )}
                </div>
              </div>
              <div className="border-border lg:w-72 lg:border-l lg:pl-6">
                <PropertyRail
                  application={detail.application}
                  canEdit={canEdit}
                  domainOptions={availableDomains}
                  termOptions={termOptions}
                  onChanged={refresh}
                />
              </div>
            </div>
          )}
        </div>

        <div className="flex flex-shrink-0 items-center gap-3 border-t border-border px-5 py-4 sm:px-6">
          {!isCreate && detail && (
            <Link
              to={`/core/partners/applications/${detail.application.id}`}
              className={buttonClasses("ghost", "sm")}
            >
              Open full page
            </Link>
          )}
          <div className="ml-auto flex items-center gap-3">
            {isCreate ? (
              <div className="flex gap-2">
                <button type="button" onClick={() => void guardedClose()} className={buttonClasses("secondary", "sm")}>
                  Cancel
                </button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => void submitCreate()}
                  disabled={!newTitle.trim() || !contactEmail.trim() || creating}
                >
                  {creating ? "Creating…" : "Create"}
                </Button>
              </div>
            ) : (
              detail &&
              canEdit && (
                <StageActions
                  application={detail.application}
                  canEdit={canEdit}
                  onOpenSchedule={() => setShowScheduler(true)}
                  onChanged={refresh}
                />
              )
            )}
          </div>
        </div>
      </Modal>

      {showScheduler && detail && (
        <ScheduleInterviewModal
          applicationId={detail.application.id}
          partnerName={detail.application.applicant.name}
          partnerEmail={detail.application.applicant.email}
          onClose={() => setShowScheduler(false)}
          onScheduled={() => {
            setShowScheduler(false);
            refresh();
          }}
        />
      )}
    </>
  );
}
