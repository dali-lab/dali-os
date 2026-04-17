import { useState, useRef, useEffect } from "react";
import { redirect, useLoaderData, useFetcher, useNavigate } from "react-router";
import type { Route } from "./+types/portal.apply";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { getActiveCycle } from "~/lib/cycles";
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

// ─── QuestionField Component ─────────────────────────────────────────────────

function QuestionField({
  question,
  value,
  onChange,
}: {
  question: Question;
  value: string;
  onChange: (v: string) => void;
}) {
  const inputBase =
    "w-full rounded-lg border border-gray-200 bg-white text-sm text-dark-blue placeholder:text-gray-400 focus:outline-none focus:border-accent-coral px-4 py-2";

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
  const navigate = useNavigate();

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
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const createFetcher = useFetcher();

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

  async function handleSubmit() {
    setError(null);
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

    setSubmitting(true);
    try {
      const daPayload = (draft.domainApplications ?? []).map((da: any) => ({
        domainApplicationId: da.id,
        answers: domainAnswers[da.domainId] ?? {},
      }));

      const form = new URLSearchParams({
        intent: "submit",
        applicationId: draft.id,
        answers: JSON.stringify(answers),
        domainAnswers: JSON.stringify(daPayload),
      });

      const res = await fetch("/portal/apply", {
        method: "POST",
        credentials: "include",
        body: form,
        redirect: "follow",
      });

      if (res.redirected) {
        navigate("/portal");
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Show domain selection if no draft yet
  if (!draft) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h2 className="font-heading text-xl font-bold text-dark-blue">{cycleName} Application</h2>
          <p className="text-sm text-gray-500 mt-1">Select the roles you'd like to apply for to get started.</p>
        </div>

        <div className="px-6 py-5 rounded-2xl bg-[#E8F4FA]">
          <h3 className="font-heading text-base font-bold text-dark-blue mb-1">
            Roles <span className="text-accent-coral">*</span>
          </h3>
          <p className="text-xs text-gray-500 mb-3">Select every role you'd like to be considered for.</p>
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
                    : "bg-white text-dark-blue border-gray-200 hover:border-accent-coral"
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
          <p className="text-sm text-gray-500 mt-1">Fill out the form below. Your progress is saved automatically.</p>
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
                <span key={id} className="text-xs px-2 py-0.5 rounded-full bg-white text-dark-blue border border-gray-200">
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
                  <p className="text-xs text-gray-500 mb-1">{q.data.description}</p>
                )}
                <QuestionField
                  question={q}
                  value={answers[q.key] ?? ""}
                  onChange={v => setAnswer(q.key, v)}
                />
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
                      <p className="text-xs text-gray-500 mb-1">{q.data.description}</p>
                    )}
                    <QuestionField
                      question={q}
                      value={domainAnswers[domainId]?.[q.key] ?? ""}
                      onChange={v => setDomainAnswer(domainId, q.key, v)}
                    />
                  </div>
                ))}
              </div>
            );
          })}

        {error && <p className="text-sm text-red-500">{error}</p>}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={() => doSave()}
            disabled={saving}
            className="px-5 py-2.5 rounded-full border-2 border-gray-200 text-sm font-semibold text-gray-600 hover:border-accent-coral hover:text-accent-coral transition disabled:opacity-50"
          >
            {saving ? "Saving..." : "Save Draft"}
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-6 py-2.5 rounded-full bg-accent-coral text-white text-sm font-semibold hover:bg-accent-coral/90 transition disabled:opacity-50"
          >
            {submitting ? "Submitting..." : "Submit Application"}
          </button>
          <span className="text-xs text-gray-400 ml-1">
            {saving ? "Saving..." : "Auto-saved"}
          </span>
        </div>
      </div>
    </div>
  );
}
