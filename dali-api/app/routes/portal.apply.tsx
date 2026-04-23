import { useState, useRef, useEffect, useCallback } from "react";
import { redirect, useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/portal.apply";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { getActiveCycle } from "~/lib/cycles";
import { checkGitHubUrl, checkFigmaUrl } from "~/lib/submission-check";
import type { SubmissionCheckResult } from "~/lib/submission-check";
import type { Question } from "~/types";

// ─── Loader ──────────────────────────────────────────────────────────────────

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");

  const active = await getActiveCycle();
  if (!active || active.currentStatus !== "Open") {
    return redirect("/portal");
  }

  // Load cycle with its challenge versions and hiring domains
  const cycle = await prisma.applicationCycle.findUnique({
    where: { id: active.id },
    include: {
      domains: {
        include: { domain: true },
      },
      challengeVersions: {
        include: {
          challengeVersion: {
            include: { domain: true },
          },
        },
      },
    },
  });

  if (!cycle) return redirect("/portal");

  // General form = ChallengeVersion with domainId: null linked to this cycle
  const generalCvac = cycle.challengeVersions.find(
    cvc => cvc.challengeVersion.domainId === null,
  );

  if (!generalCvac) return redirect("/portal");

  const generalChallengeVersionId = generalCvac.challengeVersionId;
  const formQuestions = (generalCvac.challengeVersion.questions as unknown as Question[]) ?? [];

  // Build domain info with challenge questions (only domain-specific ones)
  const domains = cycle.domains.map(dac => {
    const cv = cycle.challengeVersions.find(
      cvc => cvc.challengeVersion.domainId === dac.domainId,
    );
    return {
      id: dac.domainId,
      name: dac.domain.name,
      challengeVersionId: cv?.challengeVersionId ?? null,
      challengeQuestions: cv
        ? (cv.challengeVersion.questions as unknown as Question[]) ?? []
        : [],
    };
  });

  // Check for existing draft
  const draft = await prisma.application.findFirst({
    where: {
      userId: auth.user.sub,
      applicationCycleId: active.id,
    },
    include: {
      statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
      domainApplications: {
        include: {
          challengeVersion: { select: { domainId: true } },
        },
      },
    },
  });

  const draftStatus = draft?.statusUpdates[0]?.newStatus ?? null;
  // If already submitted, go back to portal
  if (draftStatus === "Submitted") {
    return redirect("/portal");
  }

  return {
    cycleId: active.id,
    cycleName: active.name,
    generalChallengeVersionId,
    formQuestions,
    domains,
    draft: draft
      ? {
          id: draft.id,
          answers: draft.answers as Record<string, string>,
          selectedDomainIds: draft.domainApplications.map(da => da.challengeVersion.domainId),
          domainApplications: draft.domainApplications.map(da => ({
            id: da.id,
            domainId: da.challengeVersion.domainId,
            answers: da.answers as Record<string, string>,
          })),
        }
      : null,
  };
}

// ─── Action ──────────────────────────────────────────────────────────────────

export async function action({ request }: Route.ActionArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;

  const formData = await request.formData();
  const intent = formData.get("intent") as string;

  if (intent === "create-draft") {
    const cycleId = formData.get("cycleId") as string;
    const generalChallengeVersionId = formData.get("generalChallengeVersionId") as string;
    const selectedDomainIds = JSON.parse(formData.get("selectedDomainIds") as string) as string[];

    // Find challenge versions for selected domains
    const cvacs = await prisma.challengeVersionApplicationCycle.findMany({
      where: { applicationCycleId: cycleId },
      include: { challengeVersion: true },
    });

    const application = await prisma.application.create({
      data: {
        userId: auth.user.sub,
        applicationCycleId: cycleId,
        generalChallengeVersionId,
        answers: {},
        statusUpdates: {
          create: { newStatus: "Draft", userId: auth.user.sub },
        },
        domainApplications: {
          create: selectedDomainIds
            .map(domainId => {
              const cv = cvacs.find(c => c.challengeVersion.domainId === domainId);
              if (!cv) return null;
              return {
                challengeVersionId: cv.challengeVersionId,
                answers: {},
              };
            })
            .filter(Boolean) as any[],
        },
      },
      include: {
        domainApplications: {
          include: { challengeVersion: { select: { domainId: true } } },
        },
      },
    });

    return {
      draft: {
        id: application.id,
        answers: application.answers,
        selectedDomainIds: application.domainApplications.map(
          (da) => da.challengeVersion.domainId,
        ),
        domainApplications: application.domainApplications.map((da) => ({
          id: da.id,
          domainId: da.challengeVersion.domainId,
          answers: da.answers,
        })),
      },
    };
  }

  if (intent === "save-draft") {
    const applicationId = formData.get("applicationId") as string;
    const answers = JSON.parse(formData.get("answers") as string);
    const domainAnswers = JSON.parse(formData.get("domainAnswers") as string) as {
      domainApplicationId: string;
      answers: Record<string, string>;
    }[];

    await prisma.application.update({
      where: { id: applicationId },
      data: { answers },
    });

    // Update domain application answers
    for (const da of domainAnswers) {
      await prisma.domainApplication.update({
        where: { id: da.domainApplicationId },
        data: { answers: da.answers },
      });
    }

    return { saved: true };
  }

  if (intent === "submit") {
    const applicationId = formData.get("applicationId") as string;
    const answers = JSON.parse(formData.get("answers") as string);
    const domainAnswers = JSON.parse(formData.get("domainAnswers") as string) as {
      domainApplicationId: string;
      answers: Record<string, string>;
    }[];
    const urlQuestions = JSON.parse(formData.get("urlQuestions") as string ?? "[]") as {
      key: string;
      url: string;
      type: "github_url" | "figma_url";
    }[];

    // Save final answers
    await prisma.application.update({
      where: { id: applicationId },
      data: { answers },
    });

    for (const da of domainAnswers) {
      await prisma.domainApplication.update({
        where: { id: da.domainApplicationId },
        data: { answers: da.answers },
      });
    }

    // Run server-side URL checks (non-blocking — warnings only)
    const urlWarnings: Record<string, SubmissionCheckResult> = {};
    const urlCheckResults = await Promise.all(
      urlQuestions
        .filter(q => q.url.trim())
        .map(async q => ({
          key: q.key,
          result: await (q.type === "figma_url" ? checkFigmaUrl(q.url) : checkGitHubUrl(q.url)),
        })),
    );
    for (const { key, result } of urlCheckResults) {
      if (result.status !== "valid") {
        urlWarnings[key] = result;
      }
    }

    if (Object.keys(urlWarnings).length > 0) {
      return { urlWarnings };
    }

    // Create Submitted status update
    await prisma.applicationStatusUpdate.create({
      data: {
        newStatus: "Submitted",
        applicationId,
        userId: auth.user.sub,
      },
    });

    return redirect("/portal");
  }

  return { error: "Unknown intent" };
}

// ─── URL Check Status ────────────────────────────────────────────────────────

type UrlCheckState = {
  status: "idle" | "checking" | "done";
  result?: SubmissionCheckResult;
};

function UrlCheckIndicator({ state }: { state: UrlCheckState }) {
  if (state.status === "checking") {
    return (
      <span className="text-xs text-muted-foreground/70 flex items-center gap-1 mt-1">
        <span className="inline-block w-3 h-3 border-2 border-gray-300 border-t-accent-coral rounded-full animate-spin" />
        Checking URL...
      </span>
    );
  }
  if (state.status === "done" && state.result) {
    if (state.result.status === "valid") {
      return (
        <span className="text-xs text-green-600 flex items-center gap-1 mt-1">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>
          {state.result.message}
        </span>
      );
    }
    return (
      <span className="text-xs text-amber-600 flex items-center gap-1 mt-1">
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
        {state.result.message}
      </span>
    );
  }
  return null;
}

// ─── QuestionField Component ─────────────────────────────────────────────────

function QuestionField({
  question,
  value,
  onChange,
  urlCheckState,
  onUrlBlur,
}: {
  question: Question;
  value: string;
  onChange: (v: string) => void;
  urlCheckState?: UrlCheckState;
  onUrlBlur?: () => void;
}) {
  const inputBase =
    "w-full rounded-lg border border-border bg-card text-sm text-dark-blue placeholder:text-muted-foreground/70 focus:outline-none focus:border-accent-coral px-4 py-2";

  if (question.type === "textarea") {
    return (
      <textarea
        value={value}
        onChange={e => onChange(e.target.value)}
        rows={4}
        className={`${inputBase} resize-none`}
        placeholder="Your answer"
      />
    );
  }

  if (question.type === "select") {
    return (
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className={`${inputBase} appearance-auto`}
      >
        <option value="">Select...</option>
        {(question.data.options ?? []).map(o => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    );
  }

  if (question.type === "github_url" || question.type === "figma_url") {
    const placeholder = question.type === "github_url"
      ? "https://github.com/owner/repo"
      : "https://www.figma.com/file/...";
    return (
      <div>
        <input
          type="url"
          value={value}
          onChange={e => onChange(e.target.value)}
          onBlur={onUrlBlur}
          className={inputBase}
          placeholder={placeholder}
        />
        {urlCheckState && <UrlCheckIndicator state={urlCheckState} />}
      </div>
    );
  }

  // Default: text
  return (
    <input
      type="text"
      value={value}
      onChange={e => onChange(e.target.value)}
      className={inputBase}
      placeholder="Your answer"
    />
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function PortalApply() {
  const loaderData = useLoaderData<typeof loader>() as any;
  const { cycleId, cycleName, generalChallengeVersionId, formQuestions, domains } = loaderData;
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
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [urlWarnings, setUrlWarnings] = useState<Record<string, string>>({});
  const [urlChecks, setUrlChecks] = useState<Record<string, UrlCheckState>>({});
  const [confirmedSubmit, setConfirmedSubmit] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  async function doSave() {
    if (!draft) return;
    setSaving(true);
    try {
      const daPayload = (draft.domainApplications ?? []).map((da: any) => ({
        domainApplicationId: da.id,
        answers: domainAnswers[da.domainId] ?? {},
      }));

      await fetch(`/portal/apply`, {
        method: "POST",
        credentials: "include",
        body: new URLSearchParams({
          intent: "save-draft",
          applicationId: draft.id,
          answers: JSON.stringify(answers),
          domainAnswers: JSON.stringify(daPayload),
        }),
      });
    } finally {
      setSaving(false);
    }
  }

  const checkUrlField = useCallback(async (key: string, url: string, type: "github_url" | "figma_url") => {
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

  async function handleCreateDraft() {
    if (selectedDomainIds.length === 0) {
      setError("Please select at least one role.");
      return;
    }

    const form = new FormData();
    form.set("intent", "create-draft");
    form.set("cycleId", cycleId);
    form.set("generalChallengeVersionId", generalChallengeVersionId);
    form.set("selectedDomainIds", JSON.stringify(selectedDomainIds));
    createFetcher.submit(form, { method: "post" });
  }

  // When create-draft returns, set the draft state
  useEffect(() => {
    if (createFetcher.data?.draft) {
      setDraft(createFetcher.data.draft);
    }
  }, [createFetcher.data]);

  function handleSubmit(force = false) {
    setError(null);
    setUrlWarnings({});
    if (!draft) return;

    // Validate required general questions
    const missingGeneral = (formQuestions as Question[]).filter(
      q => q.required && !answers[q.key]?.trim(),
    );
    if (missingGeneral.length > 0) {
      setError(`Please answer all required questions (${missingGeneral.length} remaining).`);
      return;
    }

    // Validate required domain questions
    for (const domainId of selectedDomainIds) {
      const domain = domains.find((d: any) => d.id === domainId);
      if (!domain) continue;
      const missing = (domain.challengeQuestions as Question[]).filter(
        (q: Question) => q.required && !(domainAnswers[domainId]?.[q.key]?.trim()),
      );
      if (missing.length > 0) {
        setError(`Please answer all required ${domain.name} questions (${missing.length} remaining).`);
        return;
      }
    }

    // Collect URL questions from general and domain-specific forms
    const urlQuestions: { key: string; url: string; type: "github_url" | "figma_url" }[] = [];
    for (const q of formQuestions as Question[]) {
      if ((q.type === "github_url" || q.type === "figma_url") && answers[q.key]?.trim()) {
        urlQuestions.push({ key: q.key, url: answers[q.key], type: q.type as "github_url" | "figma_url" });
      }
    }
    for (const domainId of selectedDomainIds) {
      const domain = domains.find((d: any) => d.id === domainId);
      if (!domain) continue;
      for (const q of domain.challengeQuestions as Question[]) {
        if ((q.type === "github_url" || q.type === "figma_url") && domainAnswers[domainId]?.[q.key]?.trim()) {
          urlQuestions.push({ key: q.key, url: domainAnswers[domainId][q.key], type: q.type as "github_url" | "figma_url" });
        }
      }
    }

    setSubmitting(true);

    const daPayload = (draft.domainApplications ?? []).map((da: any) => ({
      domainApplicationId: da.id,
      answers: domainAnswers[da.domainId] ?? {},
    }));

    const form = new FormData();
    form.set("intent", "submit");
    form.set("applicationId", draft.id);
    form.set("answers", JSON.stringify(answers));
    form.set("domainAnswers", JSON.stringify(daPayload));
    form.set("urlQuestions", JSON.stringify(force ? [] : urlQuestions));

    submitFetcher.submit(form, { method: "post" });
  }

  // Handle submit response (urlWarnings) — redirects are handled automatically by React Router
  useEffect(() => {
    if (submitFetcher.state === "idle" && submitFetcher.data) {
      setSubmitting(false);
      if (submitFetcher.data.urlWarnings) {
        const warnings: Record<string, string> = {};
        for (const [key, result] of Object.entries(submitFetcher.data.urlWarnings) as [string, SubmissionCheckResult][]) {
          warnings[key] = result.message;
        }
        setUrlWarnings(warnings);
        setConfirmedSubmit(true);
      }
    } else if (submitFetcher.state === "idle") {
      setSubmitting(false);
    }
  }, [submitFetcher.state, submitFetcher.data]);

  // Show domain selection if no draft yet
  if (!draft) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h2 className="font-heading text-xl font-bold text-dark-blue">{cycleName} Application</h2>
          <p className="text-sm text-muted-foreground mt-1">Select the roles you'd like to apply for to get started.</p>
        </div>

        <div className="px-6 py-5 rounded-2xl bg-[#E8F4FA]">
          <h3 className="font-heading text-base font-bold text-dark-blue mb-1">
            Roles <span className="text-accent-coral">*</span>
          </h3>
          <p className="text-xs text-muted-foreground mb-3">Select every role you'd like to be considered for.</p>
          <div className="flex flex-wrap gap-2">
            {(domains as any[]).map((d: any) => (
              <button
                key={d.id}
                onClick={() =>
                  setSelectedDomainIds(prev =>
                    prev.includes(d.id)
                      ? prev.filter(id => id !== d.id)
                      : [...prev, d.id],
                  )
                }
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  selectedDomainIds.includes(d.id)
                    ? "bg-accent-coral text-white border-accent-coral"
                    : "bg-card text-dark-blue border-border hover:border-accent-coral"
                }`}
              >
                {d.name}
              </button>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-500 mt-4">{error}</p>}

        <div className="mt-6">
          <button
            onClick={handleCreateDraft}
            disabled={selectedDomainIds.length === 0}
            className="px-6 py-2.5 rounded-full bg-accent-coral text-white text-sm font-semibold hover:bg-accent-coral/90 transition disabled:opacity-50"
          >
            Start Application
          </button>
        </div>
      </div>
    );
  }

  // Application form
  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h2 className="font-heading text-xl font-bold text-dark-blue">{cycleName} Application</h2>
          <p className="text-sm text-muted-foreground mt-1">Fill out the form below. Your progress is saved automatically.</p>
        </div>
        <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-blue-100 text-blue-700">Draft</span>
      </div>

      <div className="space-y-8">
        {/* Roles display */}
        <div className="px-6 py-5 rounded-2xl bg-[#E8F4FA]">
          <h3 className="font-heading text-base font-bold text-dark-blue mb-2">Roles Applied</h3>
          <div className="flex flex-wrap gap-1.5">
            {selectedDomainIds.map(id => {
              const domain = (domains as any[]).find((d: any) => d.id === id);
              return (
                <span key={id} className="text-xs px-2 py-0.5 rounded-full bg-card text-dark-blue border border-border">
                  {domain?.name ?? id}
                </span>
              );
            })}
          </div>
        </div>

        {/* General questions */}
        {(formQuestions as Question[]).length > 0 && (
          <div className="space-y-6">
            <h3 className="font-heading text-sm font-bold text-dark-blue uppercase tracking-wider">General Questions</h3>
            {(formQuestions as Question[]).map(q => (
              <div key={q.key}>
                <label className="block text-sm font-semibold text-dark-blue mb-1">
                  {q.data.label}
                  {q.required && <span className="text-accent-coral ml-0.5">*</span>}
                </label>
                {q.data.description && (
                  <p className="text-xs text-muted-foreground mb-1">{q.data.description}</p>
                )}
                <QuestionField
                  question={q}
                  value={answers[q.key] ?? ""}
                  onChange={v => setAnswer(q.key, v)}
                  urlCheckState={urlChecks[q.key]}
                  onUrlBlur={() => checkUrlField(q.key, answers[q.key] ?? "", q.type as "github_url" | "figma_url")}
                />
                {urlWarnings[q.key] && (
                  <p className="text-xs text-amber-600 mt-1">{urlWarnings[q.key]}</p>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Domain-specific questions */}
        {selectedDomainIds.map(domainId => {
            const domain = (domains as any[]).find((d: any) => d.id === domainId);
            if (!domain || domain.challengeQuestions.length === 0) return null;
            return (
              <div key={domainId} className="space-y-6">
                <h3 className="font-heading text-sm font-bold uppercase tracking-wider text-accent-coral">
                  {domain.name} Questions
                </h3>
                {(domain.challengeQuestions as Question[]).map((q: Question) => (
                  <div key={q.key}>
                    <label className="block text-sm font-semibold text-dark-blue mb-1">
                      {q.data.label}
                      {q.required && <span className="text-accent-coral ml-0.5">*</span>}
                    </label>
                    {q.data.description && (
                      <p className="text-xs text-muted-foreground mb-1">{q.data.description}</p>
                    )}
                    <QuestionField
                      question={q}
                      value={domainAnswers[domainId]?.[q.key] ?? ""}
                      onChange={v => setDomainAnswer(domainId, q.key, v)}
                      urlCheckState={urlChecks[q.key]}
                      onUrlBlur={() => checkUrlField(q.key, domainAnswers[domainId]?.[q.key] ?? "", q.type as "github_url" | "figma_url")}
                    />
                    {urlWarnings[q.key] && (
                      <p className="text-xs text-amber-600 mt-1">{urlWarnings[q.key]}</p>
                    )}
                  </div>
                ))}
              </div>
            );
          })}

        {error && <p className="text-sm text-red-500">{error}</p>}

        {/* URL warnings banner */}
        {Object.keys(urlWarnings).length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
            <p className="text-sm font-semibold text-amber-800 mb-1">Some URLs may have issues</p>
            <p className="text-xs text-amber-700">
              One or more of your submitted links appear to be private or inaccessible. You can still submit, but reviewers may not be able to view them.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={() => doSave()}
            disabled={saving}
            className="px-5 py-2.5 rounded-full border-2 border-border text-sm font-semibold text-muted-foreground hover:border-accent-coral hover:text-accent-coral transition disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Draft"}
          </button>
          {confirmedSubmit ? (
            <button
              onClick={() => handleSubmit(true)}
              disabled={submitting}
              className="px-6 py-2.5 rounded-full bg-amber-500 text-white text-sm font-semibold hover:bg-amber-600 transition disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "Submit Anyway"}
            </button>
          ) : (
            <button
              onClick={() => handleSubmit()}
              disabled={submitting}
              className="px-6 py-2.5 rounded-full bg-accent-coral text-white text-sm font-semibold hover:bg-accent-coral/90 transition disabled:opacity-50"
            >
              {submitting ? "Submitting..." : "Submit Application"}
            </button>
          )}
          <span className="text-xs text-muted-foreground/70 ml-1">
            {saving ? "Saving..." : "Auto-saved"}
          </span>
        </div>
      </div>
    </div>
  );
}
