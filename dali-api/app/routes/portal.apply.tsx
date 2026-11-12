import { useState, useRef, useEffect, useCallback } from "react";
import { useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/portal.apply";
import { loadPortalApply } from "~/hiring/lib/portal-apply.server";
import { runPortalApplyAction } from "~/hiring/lib/portal-apply-actions.server";
import { CycleChooser } from "~/components/portal/apply/CycleChooser";
import { SectionNavMobile, SectionNavDesktop, BackToTopButton } from "~/components/portal/apply/SectionNav";
import { getDomainColor, formatShortDate, getPickedQuestions, computeRequiredProgress, buildSections, type DomainShape, type ContinuedProgress } from "~/hiring/lib/apply-sections";
import type { WaitlistedApplicationOption } from "~/hiring/lib/continued-interest.server";
import { formatDeadline } from "~/hiring/components/ApplicationTracker";
import { APPLICATION_TZ } from "~/lib/timezone";
import { Tooltip } from "~/components/ui/floating";
import type { SubmissionCheckResult } from "~/lib/submission-check";
import type { WordCountViolation } from "~/lib/word-count";
import { countRequired, visibleQuestions } from "~/forms/lib/form-logic";
import { termCodeLabel } from "~/lib/display";
import type { Question } from "~/types";
import { ApplicantErrorBoundary } from "~/components/ApplicantErrorBoundary";
import { Modal } from "~/components/Modal";
import { modalCardClass } from "~/components/os-chrome";
import { QuestionList } from "~/hiring/components/ApplicationAnswers";
import { DocEditor } from "~/components/doc";
import { isEmptyBlocks } from "~/lib/blocks";
import { type UrlCheckState } from "~/components/form-builder/QuestionField";
import { FormField } from "~/forms/components/FormField";
import { useToast } from "~/components/ui/toast";
import { useDialog } from "~/components/ui/dialog";
import { Radio } from "~/components/ui/Radio";
import { buttonClasses } from "~/components/ui/Button";
import { Pill } from "~/components/ui/Pill";

export const meta: Route.MetaFunction = () => [{ title: "Apply · DALI OS" }];

export async function loader({ request, params }: Route.LoaderArgs) {
  return loadPortalApply(request, params.cycleId);
}

export async function action({ request }: Route.ActionArgs) {
  return runPortalApplyAction(request);
}

export default function PortalApply() {
  const loaderData = useLoaderData<typeof loader>();
  if (loaderData.kind === "choose") return <CycleChooser cycles={loaderData.choose} />;
  return <ApplyForm key={loaderData.formKey} loaderData={loaderData} />;
}

type ApplyLoaderData = Extract<ReturnType<typeof useLoaderData<typeof loader>>, { kind: "apply" }>;

function ApplyForm({ loaderData }: { loaderData: ApplyLoaderData }) {
  const toast = useToast();
  const { cycleId, cycleName, applicationFormVersionId, formQuestions, generalDescription, domains, isAlreadySubmitted, hasChallenges } = loaderData;
  // Empty unless the cycle offers a real choice (two or more) and the flag is on.
  const startTermOptions: { id: string; code: string }[] = loaderData.startTermOptions ?? [];
  // Continued interest: the cycle's form, the applicant's waitlisted
  // applications it can be attached to, and which domains already reuse one.
  const continuedInterest: { description: any; questions: Question[] } | null =
    loaderData.continuedInterest;
  const waitlistedApplications: WaitlistedApplicationOption[] = loaderData.waitlistedApplications;
  const continuedFrom: Record<string, string> = loaderData.continuedFrom;
  const generalLocked = Object.keys(continuedFrom).length > 0;
  // A selected domain has closed: the shared general answers are frozen (under
  // review) and that domain's own answers can no longer be edited either.
  const generalFrozen: boolean = !!loaderData.generalFrozen;
  const closedSelectedDomainIds: string[] = loaderData.closedSelectedDomainIds ?? [];
  const closedDomainIds = new Set((domains as DomainShape[]).filter(d => d.closed).map(d => d.id));
  const deadline: string | null = loaderData.deadline ?? null;
  const cycleCloseDate: string | null = loaderData.closeDate ?? null;
  const [continuedAnswers, setContinuedAnswers] = useState<Record<string, Record<string, string>>>(
    loaderData.continuedInterestAnswers,
  );
  const [showWaitlistedModal, setShowWaitlistedModal] = useState(false);
  const reuseFetcher = useFetcher<{ error?: string }>();
  const dialog = useDialog();
  const [draft, setDraft] = useState(loaderData.draft);
  const [selectedDomainIds, setSelectedDomainIds] = useState<string[]>(
    loaderData.draft?.selectedDomainIds ?? [],
  );
  const [answers, setAnswers] = useState<Record<string, string>>(
    (loaderData.draft?.answers as Record<string, string>) ?? {},
  );
  const [domainAnswers, setDomainAnswers] = useState<Record<string, Record<string, string>>>(
    () => {
      const initial: Record<string, Record<string, string>> = {};
      for (const da of loaderData.draft?.domainApplications ?? []) {
        initial[da.domainId] = (da.answers as Record<string, string>) ?? {};
      }
      return initial;
    },
  );
  // Which challenge version the applicant has picked for each domain.
  // Populated from the draft for existing DomainApplications; for newly toggled
  // domains, defaults to the first linked CV (or stays unset for >1-CV domains
  // until the applicant picks).
  const [pickedChallengeByDomain, setPickedChallengeByDomain] = useState<Record<string, string>>(
    () => {
      const initial: Record<string, string> = {};
      for (const da of loaderData.draft?.domainApplications ?? []) {
        if (da.domainId && da.challengeVersionId) initial[da.domainId] = da.challengeVersionId;
      }
      return initial;
    },
  );
  const [pendingChallengeChange, setPendingChallengeChange] = useState<{
    domainId: string;
    fromCvId: string;
    toCvId: string;
  } | null>(null);
  const [startTermId, setStartTermId] = useState<string | null>(
    loaderData.draft?.startTermId ?? null,
  );
  const [saving, setSaving] = useState(false);
  const [hasSavedOnce, setHasSavedOnce] = useState(() => {
    const initialAnswers = (loaderData.draft?.answers as Record<string, string> | undefined) ?? {};
    if (Object.values(initialAnswers).some(v => typeof v === "string" && v.trim() !== "")) return true;
    for (const da of loaderData.draft?.domainApplications ?? []) {
      const daAnswers = (da.answers as Record<string, string> | undefined) ?? {};
      if (Object.values(daAnswers).some(v => typeof v === "string" && v.trim() !== "")) return true;
    }
    return false;
  });
  const [submitting, setSubmitting] = useState(false);
  const [checkingUrls, setCheckingUrls] = useState(false);
  const [acceptedUrlWarnings, setAcceptedUrlWarnings] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlWarnings, setUrlWarnings] = useState<Record<string, string>>({});
  const [wordCountErrors, setWordCountErrors] = useState<Record<string, WordCountViolation>>({});
  const [urlChecks, setUrlChecks] = useState<Record<string, UrlCheckState>>({});
  const [showWarningModal, setShowWarningModal] = useState(false);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const warningBannerRef = useRef<HTMLDivElement | null>(null);
  const createFetcher = useFetcher();
  const submitFetcher = useFetcher();

  // Auto-save debounce
  function scheduleSave() {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => doSave(), 1500);
  }

  function setAnswer(key: string, value: string) {
    setAnswers(prev => ({ ...prev, [key]: value }));
    scheduleSave();
  }

  function setDomainAnswer(domainId: string, key: string, value: string) {
    setDomainAnswers(prev => ({
      ...prev,
      [domainId]: { ...(prev[domainId] ?? {}), [key]: value },
    }));
    scheduleSave();
  }

  function setContinuedAnswer(domainId: string, key: string, value: string) {
    setContinuedAnswers(prev => ({
      ...prev,
      [domainId]: { ...(prev[domainId] ?? {}), [key]: value },
    }));
    scheduleSave();
  }

  function buildDomainAnswersPayload() {
    return (draft.domainApplications ?? [])
      .filter((da: any) => selectedDomainIds.includes(da.domainId))
      .map((da: any) => ({
        domainApplicationId: da.id,
        answers: domainAnswers[da.domainId] ?? {},
        ...(continuedFrom[da.domainId] && {
          continuedInterestAnswers: continuedAnswers[da.domainId] ?? {},
        }),
      }));
  }

  // Reusing overwrites the draft server-side and the loader then remounts this
  // form, so pending edits to the other domains are flushed first.
  async function reuseWaitlisted(option: WaitlistedApplicationOption) {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await doSave();
    reuseFetcher.submit(
      {
        intent: "use-waitlisted",
        cycleId,
        waitlistedDomainApplicationId: option.domainApplicationId,
      },
      { method: "post" },
    );
  }

  async function stopReusing(domainId: string, domainName: string) {
    if (
      !(await dialog.confirm({
        title: `Start a new ${domainName} application?`,
        description:
          "Your waitlisted application stays on file, but your continued interest answers are cleared and you answer this cycle's questions instead.",
        confirmLabel: "Start new",
        tone: "destructive",
      }))
    )
      return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    await doSave();
    reuseFetcher.submit(
      { intent: "stop-using-waitlisted", applicationId: draft.id, domainId },
      { method: "post" },
    );
  }

  useEffect(() => {
    if (reuseFetcher.state === "idle" && reuseFetcher.data?.error) {
      toast.error(reuseFetcher.data.error);
    }
  }, [reuseFetcher.state, reuseFetcher.data]);

  // `overrides` carries a value that must reach the server as posted rather
  // than as this closure saw it. The debounced path re-reads state on the next
  // keystroke, but a discrete one-click control (the start term) has no next
  // keystroke to correct a stale capture, so it saves immediately and explicitly.
  async function doSave(overrides?: { startTermId?: string }) {
    if (!draft) return;
    setSaving(true);
    try {
      const daPayload = buildDomainAnswersPayload();

      await fetch(`/portal/apply`, {
        method: "POST",
        credentials: "include",
        body: new URLSearchParams({
          intent: "save-draft",
          applicationId: draft.id,
          answers: JSON.stringify(answers),
          domainAnswers: JSON.stringify(daPayload),
          ...(startTermOptions.length > 0 && {
            startTermId: overrides?.startTermId ?? startTermId ?? "",
          }),
        }),
      });
      setHasSavedOnce(true);
    } finally {
      setSaving(false);
    }
  }

  const checkUrlField = useCallback(async (key: string, url: string, type: "github_url" | "figma_url" | "drive_url") => {
    if (!url.trim()) {
      setUrlChecks(prev => ({ ...prev, [key]: { status: "idle" } }));
      return;
    }
    setUrlChecks(prev => ({ ...prev, [key]: { status: "checking" } }));
    try {
      const res = await fetch("/api/check-url", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url, type }),
      });
      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({}));
        const message =
          res.status === 429
            ? "Too many checks — please wait a moment and try again"
            : errorBody.error ?? `Unexpected error (${res.status})`;
        setUrlChecks(prev => ({
          ...prev,
          [key]: { status: "done", result: { status: "error" as const, url, message } },
        }));
        return;
      }
      const result: SubmissionCheckResult = await res.json();
      setUrlChecks(prev => ({ ...prev, [key]: { status: "done", result } }));
    } catch {
      setUrlChecks(prev => ({
        ...prev,
        [key]: { status: "done", result: { status: "error", url, message: "Failed to check URL" } },
      }));
    }
  }, []);

  function buildSelectedDomainsPayload(
    ids: string[],
    picks: Record<string, string>,
  ): { domainId: string; challengeVersionId: string }[] {
    const payload: { domainId: string; challengeVersionId: string }[] = [];
    for (const id of ids) {
      const cvId = picks[id];
      // A cycle without challenges sends bare domains.
      if (cvId || !hasChallenges) payload.push({ domainId: id, challengeVersionId: cvId ?? "" });
    }
    return payload;
  }

  function toggleDomain(domainId: string) {
    // A closed domain can't be added or removed by the applicant — the pill
    // is rendered disabled, but guard here too since the server also enforces
    // this and a stale client state shouldn't even try.
    if (closedDomainIds.has(domainId)) return;
    const isAdding = !selectedDomainIds.includes(domainId);
    const newIds = isAdding
      ? [...selectedDomainIds, domainId]
      : selectedDomainIds.filter(id => id !== domainId);

    let nextPicks = pickedChallengeByDomain;
    if (isAdding && !pickedChallengeByDomain[domainId]) {
      // Default to the first linked challenge so single-challenge domains don't
      // require an extra click. Multi-challenge domains: applicant can switch
      // via the radio picker rendered in the domain section.
      const domain = (domains as DomainShape[]).find((d: DomainShape) => d.id === domainId);
      const defaultCvId = domain?.challenges[0]?.challengeVersionId;
      if (defaultCvId) {
        nextPicks = { ...pickedChallengeByDomain, [domainId]: defaultCvId };
        setPickedChallengeByDomain(nextPicks);
      }
    }

    setSelectedDomainIds(newIds);

    if (draft) {
      const form = new FormData();
      form.set("intent", "update-domains");
      form.set("applicationId", draft.id);
      form.set("cycleId", cycleId);
      form.set("selectedDomains", JSON.stringify(buildSelectedDomainsPayload(newIds, nextPicks)));
      createFetcher.submit(form, { method: "post" });
    }
  }

  function handleChallengePick(domainId: string, newCvId: string) {
    const currentCvId = pickedChallengeByDomain[domainId];
    if (currentCvId === newCvId) return;
    const hasAnswers = Object.values(domainAnswers[domainId] ?? {}).some(
      v => typeof v === "string" && v.trim() !== "",
    );
    if (currentCvId && hasAnswers) {
      setPendingChallengeChange({ domainId, fromCvId: currentCvId, toCvId: newCvId });
      return;
    }
    applyChallengePick(domainId, newCvId);
  }

  function applyChallengePick(domainId: string, newCvId: string) {
    const nextPicks = { ...pickedChallengeByDomain, [domainId]: newCvId };
    setPickedChallengeByDomain(nextPicks);
    // Clear local answers — the backend will too, since the question set changed.
    setDomainAnswers(prev => ({ ...prev, [domainId]: {} }));
    if (draft) {
      const form = new FormData();
      form.set("intent", "update-domains");
      form.set("applicationId", draft.id);
      form.set("cycleId", cycleId);
      form.set(
        "selectedDomains",
        JSON.stringify(buildSelectedDomainsPayload(selectedDomainIds, nextPicks)),
      );
      createFetcher.submit(form, { method: "post" });
    }
  }

  function handleCreateDraft() {
    if (selectedDomainIds.length === 0) {
      setError("Please select at least one domain.");
      return;
    }
    const missing = hasChallenges && selectedDomainIds.find(id => !pickedChallengeByDomain[id]);
    if (missing) {
      setError("Please pick a challenge for every selected domain.");
      return;
    }

    const form = new FormData();
    form.set("intent", "create-draft");
    form.set("cycleId", cycleId);
    form.set("applicationFormVersionId", applicationFormVersionId ?? "");
    form.set(
      "selectedDomains",
      JSON.stringify(buildSelectedDomainsPayload(selectedDomainIds, pickedChallengeByDomain)),
    );
    createFetcher.submit(form, { method: "post" });
  }

  // When create-draft or update-domains returns, update the draft state
  useEffect(() => {
    if (createFetcher.data?.draft) {
      const newDraft = createFetcher.data.draft;
      setDraft(newDraft);
      // Restore domain answers from any existing DomainApplications (for re-added domains)
      setDomainAnswers(prev => {
        const updated = { ...prev };
        for (const da of newDraft.domainApplications ?? []) {
          if (!updated[da.domainId] || Object.keys(updated[da.domainId]).length === 0) {
            updated[da.domainId] = (da.answers as Record<string, string>) ?? {};
          }
        }
        return updated;
      });
      // Sync picked CV from server (authoritative — handles backend CV switches)
      setPickedChallengeByDomain(prev => {
        const updated = { ...prev };
        for (const da of newDraft.domainApplications ?? []) {
          if (da.domainId && da.challengeVersionId) {
            updated[da.domainId] = da.challengeVersionId;
          }
        }
        return updated;
      });
    }
  }, [createFetcher.data]);

  const continuedProgress: ContinuedProgress = Object.fromEntries(
    Object.keys(continuedFrom).map(domainId => {
      const counted = countRequired(
        visibleQuestions(continuedInterest?.questions ?? [], continuedAnswers[domainId] ?? {}),
        continuedAnswers[domainId],
      );
      return [domainId, { required: counted.required, answered: counted.answered }];
    }),
  );

  // Validation gate: runs before opening the review modal. Returns null on
  // success, or an error string to surface to the user.
  function validateForReview(): string | null {
    if (!draft) return null;
    if (selectedDomainIds.length === 0) {
      return "Please select at least one domain.";
    }
    const missingPick = hasChallenges && selectedDomainIds.find(id => !pickedChallengeByDomain[id]);
    if (missingPick) {
      return "Please pick a challenge for every selected domain.";
    }
    if (startTermOptions.length > 0 && !startTermId) {
      return "Please choose the term you'd start in.";
    }
    const { totalRequired, totalAnswered } = computeRequiredProgress(
      formQuestions as Question[],
      domains as DomainShape[],
      selectedDomainIds,
      pickedChallengeByDomain,
      answers,
      domainAnswers,
      continuedProgress,
      closedDomainIds,
      generalFrozen,
    );
    const totalMissing = totalRequired - totalAnswered;
    if (totalMissing > 0) {
      return `Please answer all required questions (${totalMissing} of ${totalRequired} unanswered).`;
    }
    return null;
  }

  // Collect every non-empty github_url / figma_url / drive_url answer across the
  // general form and each picked domain challenge. Used by both the pre-review
  // check and the final submit payload.
  type UrlQuestionType = "github_url" | "figma_url" | "drive_url";
  function isUrlType(t: string): t is UrlQuestionType {
    return t === "github_url" || t === "figma_url" || t === "drive_url";
  }
  function collectUrlQuestions(): { key: string; url: string; type: UrlQuestionType }[] {
    const urlQuestions: { key: string; url: string; type: UrlQuestionType }[] = [];
    // Frozen waitlisted answers aren't re-checked: the applicant can't fix them.
    for (const q of generalLocked ? [] : visibleQuestions(formQuestions as Question[], answers)) {
      if (isUrlType(q.type) && answers[q.key]?.trim()) {
        urlQuestions.push({ key: q.key, url: answers[q.key], type: q.type });
      }
    }
    for (const domainId of selectedDomainIds) {
      const domain = (domains as DomainShape[]).find((d: DomainShape) => d.id === domainId);
      if (!domain) continue;
      const [questions, source] = continuedFrom[domainId]
        ? [continuedInterest?.questions ?? [], continuedAnswers[domainId]]
        : [getPickedQuestions(domain, pickedChallengeByDomain[domainId]), domainAnswers[domainId]];
      for (const q of visibleQuestions(questions, source ?? {})) {
        if (isUrlType(q.type) && source?.[q.key]?.trim()) {
          urlQuestions.push({ key: q.key, url: source[q.key], type: q.type });
        }
      }
    }
    return urlQuestions;
  }

  // Re-check every URL answer before opening the review modal so the applicant
  // can react to a private/empty link *before* the "last look" preview rather
  // than after they've already clicked Confirm. Reuses cached `urlChecks`
  // results when the value hasn't changed since the on-blur check.
  async function runUrlChecksForReview(): Promise<Record<string, string>> {
    const urlQuestions = collectUrlQuestions();
    if (urlQuestions.length === 0) return {};

    const results = await Promise.all(
      urlQuestions.map(async q => {
        const cached = urlChecks[q.key];
        if (cached?.status === "done" && cached.result && cached.result.url === q.url) {
          return { key: q.key, result: cached.result };
        }
        try {
          const res = await fetch("/api/check-url", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: q.url, type: q.type }),
          });
          if (!res.ok) {
            const errorBody = await res.json().catch(() => ({}));
            const message =
              res.status === 429
                ? "Too many checks — please wait a moment and try again"
                : errorBody.error ?? `Unexpected error (${res.status})`;
            return { key: q.key, result: { status: "error" as const, url: q.url, message } };
          }
          const result: SubmissionCheckResult = await res.json();
          return { key: q.key, result };
        } catch {
          return {
            key: q.key,
            result: { status: "error" as const, url: q.url, message: "Failed to check URL" },
          };
        }
      }),
    );

    setUrlChecks(prev => {
      const next = { ...prev };
      for (const { key, result } of results) {
        next[key] = { status: "done", result };
      }
      return next;
    });

    const warnings: Record<string, string> = {};
    for (const { key, result } of results) {
      if (result.status !== "valid") warnings[key] = result.message;
    }
    return warnings;
  }

  async function openReviewIfValid() {
    setError(null);
    setUrlWarnings({});
    setWordCountErrors({});
    setAcceptedUrlWarnings(false);
    if (!draft) return;
    const validationError = validateForReview();
    if (validationError) {
      setError(validationError);
      return;
    }
    setCheckingUrls(true);
    try {
      const warnings = await runUrlChecksForReview();
      if (Object.keys(warnings).length > 0) {
        setUrlWarnings(warnings);
        setShowWarningModal(true);
        setTimeout(() => warningBannerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
        return;
      }
      setShowReviewModal(true);
    } finally {
      setCheckingUrls(false);
    }
  }

  function doSubmit(force = false) {
    setError(null);
    setUrlWarnings({});
    setWordCountErrors({});
    if (!draft) return;

    const urlQuestions = collectUrlQuestions();

    setSubmitting(true);

    const daPayload = buildDomainAnswersPayload();

    const form = new FormData();
    form.set("intent", "submit");
    form.set("applicationId", draft.id);
    form.set("answers", JSON.stringify(answers));
    form.set("domainAnswers", JSON.stringify(daPayload));
    form.set("selectedDomainIds", JSON.stringify(selectedDomainIds));
    form.set("urlQuestions", JSON.stringify(force ? [] : urlQuestions));
    if (startTermOptions.length > 0) form.set("startTermId", startTermId ?? "");

    submitFetcher.submit(form, { method: "post" });
  }

  function scrollToFirstWarning() {
    const firstKey = Object.keys(urlWarnings)[0];
    if (!firstKey) return;
    const el = document.getElementById(`question-${firstKey}`);
    if (el) {
      // Small delay to let the modal close before scrolling
      setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
    }
  }

  // Handle submit response (urlWarnings, wordCountErrors, error) — redirects are handled automatically by React Router
  useEffect(() => {
    if (submitFetcher.state === "idle" && submitFetcher.data) {
      setSubmitting(false);
      if (submitFetcher.data.error) {
        toast.error(submitFetcher.data.error);
        return;
      }
      if (submitFetcher.data.wordCountErrors) {
        setWordCountErrors(submitFetcher.data.wordCountErrors);
        setTimeout(() => warningBannerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
        return;
      }
      if (submitFetcher.data.urlWarnings) {
        const warnings: Record<string, string> = {};
        for (const [key, result] of Object.entries(submitFetcher.data.urlWarnings) as [string, SubmissionCheckResult][]) {
          warnings[key] = result.message;
        }
        setUrlWarnings(warnings);
        setShowWarningModal(true);
        setTimeout(() => warningBannerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
      }
    } else if (submitFetcher.state === "idle") {
      setSubmitting(false);
    }
  }, [submitFetcher.state, submitFetcher.data]);

  // Derive sections + progress from current answers
  const sections = buildSections(
    formQuestions as Question[],
    domains as DomainShape[],
    selectedDomainIds,
    pickedChallengeByDomain,
    answers,
    domainAnswers,
    continuedProgress,
    closedDomainIds,
    generalFrozen,
  );
  const { totalRequired, totalAnswered } = computeRequiredProgress(
    formQuestions as Question[],
    domains as DomainShape[],
    selectedDomainIds,
    pickedChallengeByDomain,
    answers,
    domainAnswers,
    continuedProgress,
    closedDomainIds,
    generalFrozen,
  );
  const [activeSection, setActiveSection] = useState<string | null>(null);
  const sectionIdsKey = sections.map(s => s.id).join(",");

  useEffect(() => {
    if (!draft || sections.length === 0) return;
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries.filter(e => e.isIntersecting);
        if (visible.length === 0) return;
        const top = visible.reduce((a, b) =>
          a.boundingClientRect.top < b.boundingClientRect.top ? a : b,
        );
        const id = top.target.id.replace(/^section-/, "");
        setActiveSection(id);
      },
      { rootMargin: "-120px 0px -55% 0px", threshold: 0 },
    );
    for (const s of sections) {
      const el = document.getElementById(`section-${s.id}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [draft, sectionIdsKey]);

  // Names of selected domains still open but never themselves submitted —
  // drives the header pill and the "Submit changes" button copy below.
  const notSubmittedDomainNames: string[] = (draft?.domainApplications ?? [])
    .filter((da: any) => selectedDomainIds.includes(da.domainId) && !closedDomainIds.has(da.domainId) && !da.submittedAt)
    .map((da: any) => (domains as DomainShape[]).find(d => d.id === da.domainId)?.name)
    .filter((name: string | undefined): name is string => !!name);

  // The applicant's deadline, under the page title. A per-domain breakdown
  // only shows up when the selected domains don't all share one close date.
  function renderDeadlineLine() {
    if (!deadline) return null;
    const selected = (domains as DomainShape[]).filter(d => selectedDomainIds.includes(d.id));
    const distinctCloseDates = new Set(selected.map(d => d.closeDate).filter(Boolean));
    const showPerDomain = selected.length > 0 && distinctCloseDates.size > 1;
    return (
      <div className="text-sm text-muted-foreground mb-6">
        <p>
          Your deadline:{" "}
          <span className="font-medium text-foreground">{formatDeadline(deadline, APPLICATION_TZ)}</span>
        </p>
        {showPerDomain && (
          <ul className="mt-1 space-y-0.5">
            {selected
              .filter(d => d.closeDate)
              .map(d => (
                <li key={d.id}>
                  {d.name} {d.closed ? "closed" : "closes"} {formatDeadline(d.closeDate!, APPLICATION_TZ)}
                </li>
              ))}
          </ul>
        )}
      </div>
    );
  }

  // Render domain pill selector (shared between both states)
  function renderDomainSelector() {
    return (
      <div className="px-6 py-5 rounded-os-card bg-os-card">
        <h3 className="font-heading text-base font-bold text-foreground mb-1">
          Domains <span className="os-required-mark">*</span>
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Select the domains you'd like to apply for. You can change this anytime before submitting.
        </p>
        <div className="flex flex-wrap gap-2">
          {(domains as DomainShape[]).map((d, i) => {
            const isSelected = selectedDomainIds.includes(d.id);
            const color = getDomainColor(i);
            const isClosed = !!d.closed;
            const closeLabel = d.closeDate ? formatShortDate(d.closeDate) : null;
            const showSecondaryDate = !!closeLabel && d.closeDate !== cycleCloseDate;
            const pillClasses = `px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              isSelected
                ? `${color.bg} ${color.pillText} border-transparent`
                : isClosed
                  ? "bg-muted text-muted-foreground border-border cursor-not-allowed opacity-70"
                  : "bg-card text-foreground border-border hover:border-os-accent"
            }`;
            const label = (
              <span className="flex items-center gap-1.5">
                {d.name}
                {showSecondaryDate && (
                  <span className={isSelected ? "text-xs opacity-80" : "text-xs text-muted-foreground"}>
                    · closes {closeLabel}
                  </span>
                )}
              </span>
            );
            if (isClosed) {
              return (
                <Tooltip
                  key={d.id}
                  content={`Closed ${closeLabel}.${isSelected ? " Under review." : ""}`}
                >
                  <button type="button" disabled className={pillClasses}>
                    {label}
                  </button>
                </Tooltip>
              );
            }
            return (
              <button key={d.id} type="button" onClick={() => toggleDomain(d.id)} className={pillClasses}>
                {label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // The term the applicant would begin in, when the cycle offers more than one.
  // A first-class field rather than a form question: the choices are per-cycle
  // config, and the answers blob is the frozen record of what was submitted.
  function renderStartTermPicker() {
    if (startTermOptions.length === 0) return null;
    return (
      <div className="px-6 py-5 rounded-os-card bg-os-card">
        <h3 className="font-heading text-base font-bold text-foreground mb-1">
          Start term <span className="os-required-mark">*</span>
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Which term would you begin in if you're hired? You can change this anytime before submitting.
        </p>
        <div className="flex flex-wrap gap-2">
          {startTermOptions.map(t => {
            const isSelected = startTermId === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => {
                  setStartTermId(t.id);
                  void doSave({ startTermId: t.id });
                }}
                aria-pressed={isSelected}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  isSelected
                    ? "bg-os-accent text-os-bg border-transparent"
                    : "bg-card text-foreground border-border hover:border-os-accent"
                }`}
              >
                {termCodeLabel(t.code)}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  const reusing = reuseFetcher.state !== "idle";
  const waitlistedButton = waitlistedApplications.length > 0 && (
    <button
      type="button"
      onClick={() => setShowWaitlistedModal(true)}
      disabled={reusing}
      className={buttonClasses("secondary", "sm")}
    >
      Use waitlisted application
    </button>
  );
  const waitlistedModal = (
    <Modal
      open={showWaitlistedModal}
      onClose={() => setShowWaitlistedModal(false)}
      labelledBy="waitlisted-modal-title"
      disableEscape={reusing}
    >
      <h3 id="waitlisted-modal-title" className="font-heading text-base font-bold text-foreground mb-1">
        Use a waitlisted application
      </h3>
      <p className="text-sm text-muted-foreground mb-4">
        Pick one to apply with it again. It replaces your general answers and that domain's answers
        here, and you fill out a short continued interest form.
      </p>
      <ul className="flex flex-col gap-2">
        {waitlistedApplications.map(option => {
          const inUse = !!continuedFrom[option.domainId];
          return (
            <li key={option.domainApplicationId}>
              <button
                type="button"
                disabled={reusing || inUse}
                onClick={() => reuseWaitlisted(option)}
                className="flex w-full items-center justify-between gap-4 rounded-os-item bg-os-well px-4 py-3 text-left transition-colors hover:bg-os-card-hover disabled:opacity-60 disabled:hover:bg-os-well"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {option.domainName}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {option.cycleName} · Waitlisted{" "}
                    {new Date(option.waitlistedAt).toLocaleDateString("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                    })}
                  </span>
                </span>
                {inUse && <Pill outline>In use</Pill>}
              </button>
            </li>
          );
        })}
      </ul>
      <div className="flex justify-end pt-5">
        <button
          type="button"
          onClick={() => setShowWaitlistedModal(false)}
          disabled={reusing}
          className={buttonClasses("secondary")}
        >
          Cancel
        </button>
      </div>
    </Modal>
  );

  // No draft yet — show domain selector + start button
  if (!draft) {
    return (
      <div className="px-6 py-10">
        <div className="flex items-center justify-between gap-3 mb-2">
          <h2 className="font-heading text-4xl font-medium text-foreground">{cycleName} Application</h2>
          {waitlistedButton}
        </div>
        {renderDeadlineLine()}
        <p className="text-sm text-muted-foreground mb-8">
          Select the domains you'd like to apply for, then start your application.
        </p>

        <div className="space-y-8">
          {renderDomainSelector()}

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div>
            <button
              onClick={handleCreateDraft}
              disabled={selectedDomainIds.length === 0}
              className={buttonClasses("primary")}
            >
              Start Application
            </button>
          </div>
        </div>
        {waitlistedModal}
      </div>
    );
  }

  // Application form (single screen with inline domain management)
  return (
    <div className="px-6 py-10">
      {/* Sticky header: (mobile) section chip strip */}
      <div className="lg:hidden sticky top-0 z-30 -mx-6 px-6 pt-1 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 mb-2">
        <SectionNavMobile sections={sections} activeSection={activeSection} />
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_220px] lg:gap-10">
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3 mb-2">
            <h2 className="font-heading text-4xl font-medium text-foreground">{cycleName} Application</h2>
            <div className="flex shrink-0 items-center gap-3">
              {submitting ? (
                <Pill outline>Submitting...</Pill>
              ) : Object.keys(wordCountErrors).length > 0 ? (
                <Pill outline dot="danger">Action required</Pill>
              ) : Object.keys(urlWarnings).length > 0 ? (
                <Pill outline dot="warning">Action required</Pill>
              ) : isAlreadySubmitted && notSubmittedDomainNames.length > 0 ? (
                <Pill outline dot="warning">Not submitted: {notSubmittedDomainNames.join(", ")}</Pill>
              ) : isAlreadySubmitted ? (
                <Pill outline dot="success">Submitted</Pill>
              ) : (
                <Pill outline dot="neutral">Draft</Pill>
              )}
              {waitlistedButton}
            </div>
          </div>
          {renderDeadlineLine()}
          <p className="text-sm text-muted-foreground mb-8">
            Fill out the form below. Your progress is saved automatically.
          </p>

          <div className="space-y-8">
            {/* Domain selector (interactive) */}
            {renderDomainSelector()}

            {/* Start term, when the cycle offers a choice of them */}
            {renderStartTermPicker()}

        {/* General questions (before domains) */}
        {(() => {
          const { before: beforeQuestions } = visibleGeneralParts(formQuestions as Question[], answers);
          return beforeQuestions.length > 0 ? (
            <div id="section-general-before" className="rounded-os-card bg-os-card px-6 py-5 space-y-6 scroll-mt-24">
              <h3 className="font-heading text-sm font-bold text-foreground uppercase tracking-wider">General Questions</h3>
              {!isEmptyBlocks(generalDescription) && (
                <div className="text-foreground">
                  <DocEditor
                    features="notes"
                    density="compact"
                    editable={false}
                    initialContent={generalDescription}
                  />
                </div>
              )}
              {generalLocked && (
                <p className="text-xs text-muted-foreground">
                  From your waitlisted application. These answers can't be edited.
                </p>
              )}
              {!generalLocked && generalFrozen && (
                <p className="text-xs text-muted-foreground">
                  Your general application is under review and can't be changed. You can still finish
                  any domain that is open.
                </p>
              )}
              {(generalLocked || generalFrozen) && (
                <QuestionList questions={beforeQuestions} answers={answers} presigned={false} />
              )}
              {(generalLocked || generalFrozen ? [] : beforeQuestions).map(q => (
                <FormField
                  key={q.key}
                  id={`question-${q.key}`}
                  question={q}
                  labelClassName="font-semibold"
                  value={answers[q.key] ?? ""}
                  onChange={v => setAnswer(q.key, v)}
                  urlCheckState={urlChecks[q.key]}
                  onUrlBlur={() => checkUrlField(q.key, answers[q.key] ?? "", q.type as "github_url" | "figma_url" | "drive_url")}
                  belowField={
                    <>
                      {urlWarnings[q.key] && (
                        <p className="text-xs text-os-amber mt-1">{urlWarnings[q.key]}</p>
                      )}
                      {wordCountErrors[q.key] && (
                        <p className="text-xs text-destructive mt-1">
                          Over the {wordCountErrors[q.key].maxWords}-word limit ({wordCountErrors[q.key].wordCount} words).
                        </p>
                      )}
                    </>
                  }
                />
              ))}
            </div>
          ) : null;
        })()}

        {/* Domain-specific questions — colored left border cards */}
        {selectedDomainIds.map(domainId => {
          const domainIndex = (domains as DomainShape[]).findIndex((d: DomainShape) => d.id === domainId);
          const domain = (domains as DomainShape[])[domainIndex];
          const waitlistedCycle = continuedFrom[domainId];
          // No challenges, no per-domain questions: the domain pick is enough.
          if (!domain || (!hasChallenges && !waitlistedCycle)) return null;
          const color = getDomainColor(domainIndex);
          const pickedCvId = pickedChallengeByDomain[domainId] ?? null;
          const pickedQuestions = getPickedQuestions(domain, pickedCvId);
          const showPicker = domain.challenges.length > 1;

          // Reusing a waitlisted application: its answers read-only, then the
          // continued interest form.
          if (waitlistedCycle) {
            return (
              <div key={domainId} id={`section-domain-${domainId}`} className={`rounded-os-card ${color.cardBg} px-6 py-5 space-y-6 scroll-mt-24`}>
                <div className="flex items-center justify-between gap-3">
                  <h3 className={`font-heading text-sm font-bold uppercase tracking-wider ${color.text}`}>
                    {domain.name} Questions
                  </h3>
                  <button
                    type="button"
                    onClick={() => stopReusing(domainId, domain.name)}
                    disabled={reusing}
                    className={buttonClasses("secondary", "sm")}
                  >
                    Start a new application
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Your waitlisted application from {waitlistedCycle}. These answers can't be edited.
                </p>
                {pickedQuestions.length > 0 && (
                  <QuestionList
                    questions={pickedQuestions}
                    answers={domainAnswers[domainId] ?? {}}
                    presigned={false}
                  />
                )}
                <div className="border-t border-border pt-6 space-y-6">
                  <h4 className="font-heading text-sm font-bold text-foreground uppercase tracking-wider">
                    Continued Interest
                  </h4>
                  {!isEmptyBlocks(continuedInterest?.description) && (
                    <div className="text-foreground">
                      <DocEditor
                        features="notes"
                        density="compact"
                        editable={false}
                        initialContent={continuedInterest!.description}
                      />
                    </div>
                  )}
                  {visibleQuestions(continuedInterest?.questions ?? [], continuedAnswers[domainId] ?? {}).map(q => (
                    <FormField
                      key={q.key}
                      id={`question-${q.key}`}
                      question={q}
                      labelClassName="font-semibold"
                      value={continuedAnswers[domainId]?.[q.key] ?? ""}
                      onChange={v => setContinuedAnswer(domainId, q.key, v)}
                      urlCheckState={urlChecks[q.key]}
                      onUrlBlur={() => checkUrlField(q.key, continuedAnswers[domainId]?.[q.key] ?? "", q.type as "github_url" | "figma_url" | "drive_url")}
                      belowField={
                        <>
                          {urlWarnings[q.key] && (
                            <p className="text-xs text-os-amber mt-1">{urlWarnings[q.key]}</p>
                          )}
                          {wordCountErrors[q.key] && (
                            <p className="text-xs text-destructive mt-1">
                              Over the {wordCountErrors[q.key].maxWords}-word limit ({wordCountErrors[q.key].wordCount} words).
                            </p>
                          )}
                        </>
                      }
                    />
                  ))}
                </div>
              </div>
            );
          }

          const frozen = closedDomainIds.has(domainId);

          if (frozen) {
            return (
              <div key={domainId} id={`section-domain-${domainId}`} className={`rounded-os-card ${color.cardBg} px-6 py-5 space-y-6 scroll-mt-24`}>
                <h3 className={`font-heading text-sm font-bold uppercase tracking-wider ${color.text}`}>
                  {domain.name} Questions
                </h3>
                <p className="text-xs text-muted-foreground">
                  Closed {domain.closeDate ? formatShortDate(domain.closeDate) : ""}. This part is under
                  review and can't be changed.
                </p>
                {pickedQuestions.length > 0 && (
                  <QuestionList
                    questions={pickedQuestions}
                    answers={domainAnswers[domainId] ?? {}}
                    presigned={false}
                  />
                )}
              </div>
            );
          }

          return (
            <div key={domainId} id={`section-domain-${domainId}`} className={`rounded-os-card ${color.cardBg} px-6 py-5 space-y-6 scroll-mt-24`}>
              <div className="flex items-center justify-between">
                <h3 className={`font-heading text-sm font-bold uppercase tracking-wider ${color.text}`}>
                  {domain.name} Questions
                </h3>
                <button
                  onClick={() => toggleDomain(domainId)}
                  aria-label={`Remove ${domain.name}`}
                  className="w-6 h-6 rounded-full flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {showPicker && (
                <div>
                  <p className="text-xs font-semibold text-foreground mb-2">
                    Choose your {domain.name} challenge <span className="os-required-mark">*</span>
                  </p>
                  <div className="space-y-2">
                    {domain.challenges.map(c => (
                      <Radio
                        key={c.challengeVersionId}
                        name={`challenge-${domainId}`}
                        value={c.challengeVersionId}
                        checked={pickedCvId === c.challengeVersionId}
                        onChange={() => handleChallengePick(domainId, c.challengeVersionId)}
                        label={<span className="text-foreground">{c.challengeName}</span>}
                        className="text-sm"
                      />
                    ))}
                  </div>
                  {pickedCvId && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Switching to a different challenge will clear your answers for this domain.
                    </p>
                  )}
                </div>
              )}

              {pickedCvId ? (
                <>
                  {(() => {
                    const pickedChallenge = domain.challenges.find(c => c.challengeVersionId === pickedCvId);
                    return !isEmptyBlocks(pickedChallenge?.description) ? (
                      <div className="text-foreground">
                        {/* Keyed per picked challenge: DocEditor reads
                            initialContent once, so switching must remount. */}
                        <DocEditor
                          key={pickedCvId}
                          features="notes"
                          density="compact"
                          editable={false}
                          initialContent={pickedChallenge!.description}
                        />
                      </div>
                    ) : null;
                  })()}
                  {visibleQuestions(pickedQuestions, domainAnswers[domainId] ?? {}).map((q: Question) => (
                    <FormField
                      key={q.key}
                      id={`question-${q.key}`}
                      question={q}
                      labelClassName="font-semibold"
                      value={domainAnswers[domainId]?.[q.key] ?? ""}
                      onChange={v => setDomainAnswer(domainId, q.key, v)}
                      urlCheckState={urlChecks[q.key]}
                      onUrlBlur={() => checkUrlField(q.key, domainAnswers[domainId]?.[q.key] ?? "", q.type as "github_url" | "figma_url" | "drive_url")}
                      belowField={
                        <>
                          {urlWarnings[q.key] && (
                            <p className="text-xs text-os-amber mt-1">{urlWarnings[q.key]}</p>
                          )}
                          {wordCountErrors[q.key] && (
                            <p className="text-xs text-destructive mt-1">
                              Over the {wordCountErrors[q.key].maxWords}-word limit ({wordCountErrors[q.key].wordCount} words).
                            </p>
                          )}
                        </>
                      }
                    />
                  ))}
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Pick a challenge above to see this domain's questions.
                </p>
              )}
            </div>
          );
        })}

        {/* General questions (after domains — "anything else") */}
        {(() => {
          const { after: afterQuestions } = visibleGeneralParts(formQuestions as Question[], answers);
          return afterQuestions.length > 0 ? (
            <div id="section-general-after" className="rounded-os-card bg-os-card px-6 py-5 space-y-6 scroll-mt-24">
              <h3 className="font-heading text-sm font-bold text-foreground uppercase tracking-wider">Anything Else</h3>
              {(generalLocked || generalFrozen) && (
                <QuestionList questions={afterQuestions} answers={answers} presigned={false} />
              )}
              {(generalLocked || generalFrozen ? [] : afterQuestions).map(q => (
                <FormField
                  key={q.key}
                  id={`question-${q.key}`}
                  question={q}
                  labelClassName="font-semibold"
                  value={answers[q.key] ?? ""}
                  onChange={v => setAnswer(q.key, v)}
                  belowField={
                    wordCountErrors[q.key] ? (
                      <p className="text-xs text-destructive mt-1">
                        Over the {wordCountErrors[q.key].maxWords}-word limit ({wordCountErrors[q.key].wordCount} words).
                      </p>
                    ) : null
                  }
                />
              ))}
            </div>
          ) : null;
        })()}

        {error && <p className="text-sm text-destructive">{error}</p>}

        {/* Word-count errors banner — hard error, blocks submission */}
        {Object.keys(wordCountErrors).length > 0 && (
          <div ref={warningBannerRef} className="rounded-os-item border border-destructive/35 bg-destructive/10 px-5 py-4">
            <p className="text-sm font-semibold text-destructive mb-1">Some answers exceed the word limit</p>
            <p className="text-xs text-destructive">
              The following answers are over the allowed word count. Trim them down before submitting.
            </p>
            <ul className="text-xs text-destructive mt-2 list-disc list-inside space-y-0.5">
              {Object.entries(wordCountErrors).map(([key, v]) => (
                <li key={key}>
                  <span className="font-semibold">{v.label}:</span> {v.wordCount} / {v.maxWords} words
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* URL warnings banner */}
        {Object.keys(urlWarnings).length > 0 && (
          <div ref={Object.keys(wordCountErrors).length > 0 ? undefined : warningBannerRef} className="rounded-os-item border border-os-amber/35 bg-os-amber/15 px-5 py-4">
            <p className="text-sm font-semibold text-os-amber mb-1">Some URLs may have issues</p>
            <p className="text-xs text-os-amber">
              One or more of your submitted links appear to be private or inaccessible. You can still submit, but reviewers may not be able to view them.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={() => openReviewIfValid()}
            disabled={submitting || checkingUrls}
            className={buttonClasses("primary")}
          >
            {checkingUrls && (
              <span className="inline-block w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            )}
            {submitting
              ? "Submitting..."
              : checkingUrls
                ? "Checking links..."
                : isAlreadySubmitted
                  ? notSubmittedDomainNames.length > 0
                    ? "Submit changes"
                    : "Review Updates"
                  : "Review Application"}
          </button>
          <span className="text-xs text-muted-foreground/70 flex items-center gap-1.5">
            {saving ? (
              <>
                <span className="inline-block w-3 h-3 border-2 border-border border-t-os-accent rounded-full animate-spin" />
                Saving...
              </>
            ) : hasSavedOnce ? (
              <>
                <svg className="w-3.5 h-3.5 text-os-green" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                Draft auto-saved
              </>
            ) : (
              <>Changes will be saved automatically</>
            )}
          </span>
        </div>
      </div>
        </div>

        <SectionNavDesktop sections={sections} activeSection={activeSection} />
      </div>

      <BackToTopButton />

      {/* Pre-submit review modal */}
      <Modal
        open={showReviewModal}
        onClose={() => setShowReviewModal(false)}
        labelledBy="review-modal-title"
        disableEscape={submitting}
        containerClassName={modalCardClass("max-w-2xl")}
      >
        <h3 id="review-modal-title" className="font-heading text-base font-bold text-foreground mb-1">
          {isAlreadySubmitted ? "Review your changes" : "Review your application"}
        </h3>
        <p className="text-sm text-muted-foreground mb-5">
          Take one last look at your answers before {isAlreadySubmitted ? "updating" : "submitting"}. You can still go back to edit.
        </p>

        <div className="space-y-5">
          {/* Start term is a first-class field, not an answer, so it is not
              in any QuestionList below. validateForReview guarantees one is
              picked whenever the cycle offers a choice. */}
          {startTermOptions.length > 0 && (
            <div className="rounded-os-card bg-os-card px-5 py-4">
              <h4 className="font-heading text-xs font-bold text-foreground uppercase tracking-wider mb-1">
                Start term
              </h4>
              <p className="text-sm text-foreground">
                {(() => {
                  const picked = startTermOptions.find(t => t.id === startTermId);
                  return picked ? termCodeLabel(picked.code) : "Not selected";
                })()}
              </p>
            </div>
          )}

          {/* The per-domain cards below only appear for domains with
              questions, so list the picks themselves here. */}
          <div className="rounded-os-card bg-os-card px-5 py-4">
            <h4 className="font-heading text-xs font-bold text-foreground uppercase tracking-wider mb-1">
              Domains
            </h4>
            <p className="text-sm text-foreground">
              {selectedDomainIds
                .map(id => (domains as DomainShape[]).find(d => d.id === id)?.name)
                .filter(Boolean)
                .join(", ") || "None selected"}
            </p>
            {(() => {
              const closedSelected = selectedDomainIds.filter(id => closedDomainIds.has(id));
              if (closedSelected.length === 0) return null;
              const openNames = selectedDomainIds
                .filter(id => !closedDomainIds.has(id))
                .map(id => (domains as DomainShape[]).find(d => d.id === id)?.name)
                .filter(Boolean);
              const closedNames = closedSelected
                .map(id => (domains as DomainShape[]).find(d => d.id === id)?.name)
                .filter(Boolean);
              return (
                <p className="text-xs text-muted-foreground mt-2">
                  Submitting now: {openNames.join(", ") || "none"}. {closedNames.join(", ")}{" "}
                  {closedNames.length === 1 ? "is" : "are"} closed and under review, not resubmitted.
                </p>
              );
            })()}
          </div>

          {(() => {
            const { before: beforeQuestions } = visibleGeneralParts(formQuestions as Question[], answers);
            return beforeQuestions.length > 0 ? (
              <div className="rounded-os-card bg-os-card px-5 py-4">
                <h4 className="font-heading text-xs font-bold text-foreground uppercase tracking-wider mb-4">
                  General Questions
                </h4>
                {/* Apply page only has S3 keys, not presigned URLs — show filenames only */}
                <QuestionList questions={beforeQuestions} answers={answers} presigned={false} />
              </div>
            ) : null;
          })()}

          {selectedDomainIds.map(domainId => {
            const domainIndex = (domains as DomainShape[]).findIndex((d: DomainShape) => d.id === domainId);
            const domain = (domains as DomainShape[])[domainIndex];
            if (!domain) return null;
            const pickedCvId = pickedChallengeByDomain[domainId] ?? null;
            const pickedQuestions = getPickedQuestions(domain, pickedCvId);
            const continuedQuestions = continuedFrom[domainId] ? (continuedInterest?.questions ?? []) : [];
            if (pickedQuestions.length === 0 && continuedQuestions.length === 0) return null;
            const pickedName = domain.challenges.find(c => c.challengeVersionId === pickedCvId)?.challengeName;
            const color = getDomainColor(domainIndex);
            return (
              <div key={domainId} className={`rounded-os-card ${color.cardBg} px-5 py-4`}>
                <h4 className={`font-heading text-xs font-bold uppercase tracking-wider mb-1 ${color.text}`}>
                  {domain.name}
                </h4>
                {pickedName && domain.challenges.length > 1 && (
                  <p className="text-xs text-muted-foreground mb-3">Challenge: {pickedName}</p>
                )}
                {pickedQuestions.length > 0 && (
                  <QuestionList
                    questions={pickedQuestions}
                    answers={domainAnswers[domainId] ?? {}}
                    presigned={false}
                  />
                )}
                {continuedQuestions.length > 0 && (
                  <div className={pickedQuestions.length > 0 ? "mt-5 border-t border-border pt-4" : undefined}>
                    <p className="text-xs font-bold text-foreground uppercase tracking-wider mb-3">
                      Continued Interest
                    </p>
                    <QuestionList
                      questions={continuedQuestions}
                      answers={continuedAnswers[domainId] ?? {}}
                      presigned={false}
                    />
                  </div>
                )}
              </div>
            );
          })}

          {(() => {
            const { after: afterQuestions } = visibleGeneralParts(formQuestions as Question[], answers);
            return afterQuestions.length > 0 ? (
              <div className="rounded-os-card bg-os-card px-5 py-4">
                <h4 className="font-heading text-xs font-bold text-foreground uppercase tracking-wider mb-4">
                  Anything Else
                </h4>
                <QuestionList questions={afterQuestions} answers={answers} presigned={false} />
              </div>
            ) : null;
          })()}
        </div>

        <div className="flex gap-3 justify-end pt-5 mt-5 border-t border-border">
          <button
            type="button"
            onClick={() => setShowReviewModal(false)}
            disabled={submitting}
            className={buttonClasses("secondary")}
          >
            Go Back and Edit
          </button>
          <button
            type="button"
            onClick={() => { setShowReviewModal(false); doSubmit(acceptedUrlWarnings); }}
            disabled={submitting}
            className={buttonClasses("primary")}
          >
            {submitting ? "Submitting..." : "Confirm Submission"}
          </button>
        </div>
      </Modal>

      {/* URL warning modal */}
      <Modal
        open={showWarningModal}
        onClose={() => {
          setShowWarningModal(false);
          scrollToFirstWarning();
        }}
        labelledBy="url-warning-modal-title"
      >
        <h3 id="url-warning-modal-title" className="font-heading text-base font-bold text-foreground mb-2">Some links may be inaccessible</h3>
        <p className="text-sm text-muted-foreground mb-4">
          One or more URLs appear to be private or inaccessible. Reviewers may not be able to view them.
        </p>
        <ul className="space-y-2 mb-5">
          {Object.entries(urlWarnings).map(([key, message]) => {
            const allQuestions = [
              ...(formQuestions as Question[]),
              ...(domains as DomainShape[]).flatMap((d: DomainShape) =>
                d.challenges.flatMap(c => c.questions),
              ),
            ];
            const q = allQuestions.find(q => q.key === key);
            return (
              <li key={key} className="text-sm text-os-amber bg-os-amber/15 rounded-lg px-3 py-2">
                <span className="font-semibold">{q?.data.label ?? key}:</span> {message}
              </li>
            );
          })}
        </ul>
        <div className="flex gap-3 justify-end">
          <button
            onClick={() => {
              setShowWarningModal(false);
              scrollToFirstWarning();
            }}
            className={buttonClasses("secondary")}
          >
            Go Back and Fix
          </button>
          <button
            onClick={() => {
              setAcceptedUrlWarnings(true);
              setShowWarningModal(false);
              setShowReviewModal(true);
            }}
            disabled={submitting}
            className={buttonClasses("primary")}
          >
            Submit Anyway
          </button>
        </div>
      </Modal>

      {waitlistedModal}

      {/* Confirm challenge switch — wipes domain answers */}
      <Modal
        open={pendingChallengeChange !== null}
        onClose={() => setPendingChallengeChange(null)}
        labelledBy="challenge-switch-title"
      >
        <h3 id="challenge-switch-title" className="font-heading text-base font-bold text-foreground mb-2">
          Switch challenge?
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Switching to a different challenge will clear the answers you've already written
          for this domain, since each challenge has its own questions. This can't be undone.
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={() => setPendingChallengeChange(null)}
            className={buttonClasses("secondary")}
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (pendingChallengeChange) {
                applyChallengePick(pendingChallengeChange.domainId, pendingChallengeChange.toCvId);
              }
              setPendingChallengeChange(null);
            }}
            className={buttonClasses("primary")}
          >
            Switch and Clear Answers
          </button>
        </div>
      </Modal>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <ApplicantErrorBoundary error={error} />;
}
