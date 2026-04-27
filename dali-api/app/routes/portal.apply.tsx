import { useState, useRef, useEffect, useCallback } from "react";
import { redirect, useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/portal.apply";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { getActiveCycle } from "~/lib/cycles";
import { checkGitHubUrl, checkFigmaUrl } from "~/lib/submission-check";
import type { SubmissionCheckResult } from "~/lib/submission-check";
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  fileMatchesAccept,
} from "~/lib/file-validation";
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

  return {
    cycleId: active.id,
    cycleName: active.name,
    generalChallengeVersionId,
    formQuestions,
    domains,
    isAlreadySubmitted: draftStatus === "Submitted",
    draft: draft
      ? {
          id: draft.id,
          answers: draft.answers as Record<string, string>,
          selectedDomainIds: draft.domainApplications
            .filter(da => da.selected)
            .map(da => da.challengeVersion.domainId),
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

  if (intent === "update-domains") {
    const applicationId = formData.get("applicationId") as string;
    const cycleId = formData.get("cycleId") as string;
    const newDomainIds = JSON.parse(formData.get("selectedDomainIds") as string) as string[];

    // Find existing domain applications for this application
    const existing = await prisma.domainApplication.findMany({
      where: { applicationId },
      include: { challengeVersion: { select: { domainId: true } } },
    });

    const existingDomainIds = existing.map(da => da.challengeVersion.domainId);

    // Domains to add (not already in DB)
    const toAdd = newDomainIds.filter(id => !existingDomainIds.includes(id));

    if (toAdd.length > 0) {
      const cvacs = await prisma.challengeVersionApplicationCycle.findMany({
        where: { applicationCycleId: cycleId },
        include: { challengeVersion: true },
      });

      for (const domainId of toAdd) {
        const cv = cvacs.find(c => c.challengeVersion.domainId === domainId);
        if (cv) {
          await prisma.domainApplication.create({
            data: {
              applicationId,
              challengeVersionId: cv.challengeVersionId,
              answers: {},
            },
          });
        }
      }
    }

    // Mark deselected domains as not selected (keep records for answer preservation)
    const toDeselect = existing.filter(da => !newDomainIds.includes(da.challengeVersion.domainId!));
    if (toDeselect.length > 0) {
      await prisma.domainApplication.updateMany({
        where: { id: { in: toDeselect.map(da => da.id) } },
        data: { selected: false },
      });
    }

    // Mark re-selected domains as selected
    const toReselect = existing.filter(
      da => newDomainIds.includes(da.challengeVersion.domainId!) && !da.selected,
    );
    if (toReselect.length > 0) {
      await prisma.domainApplication.updateMany({
        where: { id: { in: toReselect.map(da => da.id) } },
        data: { selected: true },
      });
    }

    // Return full updated draft
    const updatedApp = await prisma.application.findUnique({
      where: { id: applicationId },
      include: {
        domainApplications: {
          include: { challengeVersion: { select: { domainId: true } } },
        },
      },
    });

    return {
      draft: updatedApp ? {
        id: updatedApp.id,
        answers: updatedApp.answers,
        selectedDomainIds: newDomainIds,
        domainApplications: updatedApp.domainApplications.map((da) => ({
          id: da.id,
          domainId: da.challengeVersion.domainId,
          answers: da.answers,
        })),
      } : null,
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

    // Persist final domain selection state
    const selectedDomainIds = JSON.parse(formData.get("selectedDomainIds") as string) as string[];
    const allDas = await prisma.domainApplication.findMany({
      where: { applicationId },
      include: { challengeVersion: { select: { domainId: true } } },
    });
    const toSelect = allDas.filter(da => selectedDomainIds.includes(da.challengeVersion.domainId!) && !da.selected);
    const toDeselect = allDas.filter(da => !selectedDomainIds.includes(da.challengeVersion.domainId!) && da.selected);
    if (toSelect.length > 0) {
      await prisma.domainApplication.updateMany({
        where: { id: { in: toSelect.map(da => da.id) } },
        data: { selected: true },
      });
    }
    if (toDeselect.length > 0) {
      await prisma.domainApplication.updateMany({
        where: { id: { in: toDeselect.map(da => da.id) } },
        data: { selected: false },
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

    // Create Submitted status update only on first submission
    const existingSubmitted = await prisma.applicationStatusUpdate.findFirst({
      where: { applicationId, newStatus: "Submitted" },
    });
    if (!existingSubmitted) {
      await prisma.applicationStatusUpdate.create({
        data: {
          newStatus: "Submitted",
          applicationId,
          userId: auth.user.sub,
        },
      });
    }

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

// ─── SkillsRatingField Component ────────────────────────────────────────────

function SkillsRatingField({
  skills,
  value,
  onChange,
}: {
  skills: string[];
  value: string;
  onChange: (v: string) => void;
}) {
  // Parse "Skill: N\nSkill: N" into a map
  const ratings: Record<string, string> = {};
  if (value) {
    for (const line of value.split("\n")) {
      const idx = line.lastIndexOf(":");
      if (idx > 0) {
        const skill = line.slice(0, idx).trim();
        const rating = line.slice(idx + 1).trim();
        ratings[skill] = rating;
      }
    }
  }

  function setRating(skill: string, rating: string) {
    const updated = { ...ratings, [skill]: rating };
    const serialized = skills
      .map(s => `${s}: ${updated[s] ?? "0"}`)
      .join("\n");
    onChange(serialized);
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-2">
      {skills.map(skill => (
        <div key={skill} className="flex items-center justify-between gap-2 py-1">
          <span className="text-sm text-dark-blue truncate">{skill}</span>
          <select
            value={ratings[skill] ?? "0"}
            onChange={e => setRating(skill, e.target.value)}
            className="w-14 shrink-0 rounded-md border border-gray-200 bg-white text-sm text-center text-dark-blue py-1 focus:outline-none focus:border-accent-coral"
          >
            {["0", "1", "2", "3", "4", "5"].map(n => (
              <option key={n} value={n}>{n}</option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}

// ─── FileUploadField Component ──────────────────────────────────────────────

function FileUploadField({
  value,
  onChange,
  accept,
  questionKey,
}: {
  value: string;
  onChange: (v: string) => void;
  accept?: string;
  questionKey: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fileName = value ? value.split("/").pop() ?? "Uploaded file" : null;

  async function handleFile(file: File) {
    setError(null);

    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`File too large (max ${MAX_UPLOAD_LABEL})`);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    if (!fileMatchesAccept(file.name, file.type, accept)) {
      setError(
        accept
          ? `File type not allowed. Accepted: ${accept}`
          : "File type not allowed",
      );
      if (fileRef.current) fileRef.current.value = "";
      return;
    }

    setUploading(true);
    try {
      // 1. Get presigned upload URL
      const presignRes = await fetch("/api/upload/presign", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          key: `applications/${questionKey}/${crypto.randomUUID()}-${file.name}`,
          contentType: file.type,
          contentLength: file.size,
        }),
      });
      if (!presignRes.ok) {
        const text = await presignRes.text();
        let message = "Failed to get upload URL";
        try { message = JSON.parse(text).error ?? message; } catch {}
        throw new Error(message);
      }
      const { uploadUrl, key } = await presignRes.json();

      // 2. Upload directly to S3
      const uploadRes = await fetch(uploadUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!uploadRes.ok) throw new Error("Upload failed");

      // 3. Store the S3 key as the answer
      onChange(key);
    } catch (err: any) {
      setError(err.message ?? "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  if (uploading) {
    return (
      <div className="flex items-center gap-2 px-4 py-3 rounded-lg border border-gray-200 bg-white text-sm text-gray-500">
        <span className="inline-block w-4 h-4 border-2 border-gray-300 border-t-accent-coral rounded-full animate-spin" />
        Uploading...
      </div>
    );
  }

  if (fileName) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-gray-200 bg-white">
        <svg className="w-5 h-5 text-accent-coral shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
        <span className="text-sm text-dark-blue truncate flex-1">{fileName}</span>
        <button
          type="button"
          onClick={() => { onChange(""); if (fileRef.current) fileRef.current.value = ""; }}
          className="text-xs text-gray-400 hover:text-red-500 transition"
        >
          Remove
        </button>
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="text-xs text-accent-coral hover:text-accent-coral/80 transition"
        >
          Replace
        </button>
        <input
          ref={fileRef}
          type="file"
          accept={accept}
          onChange={handleInputChange}
          className="hidden"
        />
      </div>
    );
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        className="flex items-center gap-2 px-4 py-3 rounded-lg border-2 border-dashed border-gray-200 bg-white text-sm text-gray-500 hover:border-accent-coral hover:text-accent-coral transition w-full"
      >
        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
        </svg>
        Choose file to upload
      </button>
      <input
        ref={fileRef}
        type="file"
        accept={accept}
        onChange={handleInputChange}
        className="hidden"
      />
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
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
    const wordCount = value.trim() ? value.trim().split(/\s+/).filter(Boolean).length : 0;
    const maxWords = question.data.maxWords;
    const overLimit = maxWords !== undefined && wordCount > maxWords;
    return (
      <div>
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          rows={4}
          className={`${inputBase} resize-none`}
          placeholder="Your answer"
        />
        <p className={`text-xs mt-1 ${overLimit ? "text-red-500" : "text-muted-foreground"}`}>
          {maxWords !== undefined ? `${wordCount} / ${maxWords} words` : `${wordCount} words`}
        </p>
      </div>
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

  if (question.type === "file") {
    return (
      <FileUploadField
        value={value}
        onChange={onChange}
        accept={question.data.accept}
        questionKey={question.key}
      />
    );
  }

  if (question.type === "skills_rating") {
    return (
      <SkillsRatingField
        skills={question.data.options ?? []}
        value={value}
        onChange={onChange}
      />
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

// ─── Domain Colors ──────────────────────────────────────────────────────────

const DOMAIN_COLORS = [
  { border: "border-l-accent-pink", text: "text-accent-pink", bg: "bg-accent-pink", pillText: "text-white", cardBg: "bg-[hsl(350_70%_93%)]" },
  { border: "border-l-accent-teal", text: "text-accent-teal", bg: "bg-accent-teal", pillText: "text-white", cardBg: "bg-accent-teal/20" },
  { border: "border-l-accent-yellow", text: "text-yellow-700", bg: "bg-accent-yellow", pillText: "text-dark-blue", cardBg: "bg-accent-yellow/30" },
  { border: "border-l-accent-coral", text: "text-accent-coral", bg: "bg-accent-coral", pillText: "text-white", cardBg: "bg-accent-coral/20" },
  { border: "border-l-accent-green", text: "text-green-700", bg: "bg-accent-green", pillText: "text-dark-blue", cardBg: "bg-accent-green/30" },
];

function getDomainColor(index: number) {
  return DOMAIN_COLORS[index % DOMAIN_COLORS.length];
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function PortalApply() {
  const loaderData = useLoaderData<typeof loader>() as any;
  const { cycleId, cycleName, generalChallengeVersionId, formQuestions, domains, isAlreadySubmitted } = loaderData;
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
  const [error, setError] = useState<string | null>(null);
  const [urlWarnings, setUrlWarnings] = useState<Record<string, string>>({});
  const [urlChecks, setUrlChecks] = useState<Record<string, UrlCheckState>>({});
  const [showWarningModal, setShowWarningModal] = useState(false);
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

  async function doSave() {
    if (!draft) return;
    setSaving(true);
    try {
      const daPayload = (draft.domainApplications ?? [])
        .filter((da: any) => selectedDomainIds.includes(da.domainId))
        .map((da: any) => ({
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
      setHasSavedOnce(true);
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

  function toggleDomain(domainId: string) {
    const newIds = selectedDomainIds.includes(domainId)
      ? selectedDomainIds.filter(id => id !== domainId)
      : [...selectedDomainIds, domainId];
    setSelectedDomainIds(newIds);

    // If draft exists, sync domains to server (create new DomainApplications as needed)
    if (draft) {
      const form = new FormData();
      form.set("intent", "update-domains");
      form.set("applicationId", draft.id);
      form.set("cycleId", cycleId);
      form.set("selectedDomainIds", JSON.stringify(newIds));
      createFetcher.submit(form, { method: "post" });
    }
  }

  function handleCreateDraft() {
    if (selectedDomainIds.length === 0) {
      setError("Please select at least one domain.");
      return;
    }

    const form = new FormData();
    form.set("intent", "create-draft");
    form.set("cycleId", cycleId);
    form.set("generalChallengeVersionId", generalChallengeVersionId);
    form.set("selectedDomainIds", JSON.stringify(selectedDomainIds));
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
    }
  }, [createFetcher.data]);

  function handleSubmit(force = false) {
    setError(null);
    setUrlWarnings({});
    if (!draft) return;

    if (selectedDomainIds.length === 0) {
      setError("Please select at least one domain.");
      return;
    }

    // Validate all required questions across general + selected domains
    let totalRequired = 0;
    let totalMissing = 0;

    const requiredGeneral = (formQuestions as Question[]).filter(q => q.required);
    totalRequired += requiredGeneral.length;
    totalMissing += requiredGeneral.filter(q => !answers[q.key]?.trim()).length;

    for (const domainId of selectedDomainIds) {
      const domain = domains.find((d: any) => d.id === domainId);
      if (!domain) continue;
      const requiredDomain = (domain.challengeQuestions as Question[]).filter((q: Question) => q.required);
      totalRequired += requiredDomain.length;
      totalMissing += requiredDomain.filter((q: Question) => !(domainAnswers[domainId]?.[q.key]?.trim())).length;
    }

    if (totalMissing > 0) {
      setError(`Please answer all required questions (${totalMissing} of ${totalRequired} unanswered).`);
      return;
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

    const daPayload = (draft.domainApplications ?? [])
      .filter((da: any) => selectedDomainIds.includes(da.domainId))
      .map((da: any) => ({
        domainApplicationId: da.id,
        answers: domainAnswers[da.domainId] ?? {},
      }));

    const form = new FormData();
    form.set("intent", "submit");
    form.set("applicationId", draft.id);
    form.set("answers", JSON.stringify(answers));
    form.set("domainAnswers", JSON.stringify(daPayload));
    form.set("selectedDomainIds", JSON.stringify(selectedDomainIds));
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
        setShowWarningModal(true);
        setTimeout(() => warningBannerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
      }
    } else if (submitFetcher.state === "idle") {
      setSubmitting(false);
    }
  }, [submitFetcher.state, submitFetcher.data]);

  // Render domain pill selector (shared between both states)
  function renderDomainSelector() {
    return (
      <div className="px-6 py-5 rounded-2xl bg-[#E8F4FA]">
        <h3 className="font-heading text-base font-bold text-dark-blue mb-1">
          Domains <span className="text-accent-coral">*</span>
        </h3>
        <p className="text-xs text-muted-foreground mb-3">
          Select the domains you'd like to apply for. You can change this anytime before submitting.
        </p>
        <div className="flex flex-wrap gap-2">
          {(domains as any[]).map((d: any, i: number) => {
            const isSelected = selectedDomainIds.includes(d.id);
            const color = getDomainColor(i);
            return (
              <button
                key={d.id}
                onClick={() => toggleDomain(d.id)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                  isSelected
                    ? `${color.bg} ${color.pillText} border-transparent`
                    : "bg-card text-dark-blue border-border hover:border-accent-coral"
                }`}
              >
                {d.name}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // No draft yet — show domain selector + start button
  if (!draft) {
    return (
      <div className="max-w-3xl mx-auto px-6 py-10">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-heading text-xl font-bold text-dark-blue">{cycleName} Application</h2>
        </div>
        <p className="text-sm text-gray-500 mb-8">
          Select the domains you'd like to apply for, then start your application.
        </p>

        <div className="space-y-8">
          {renderDomainSelector()}

          {error && <p className="text-sm text-red-500">{error}</p>}

          <div>
            <button
              onClick={handleCreateDraft}
              disabled={selectedDomainIds.length === 0}
              className="px-6 py-2.5 rounded-full bg-accent-coral text-white text-sm font-semibold hover:bg-accent-coral/90 transition disabled:opacity-50"
            >
              Start Application
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Application form (single screen with inline domain management)
  return (
    <div className="max-w-3xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-2">
        <h2 className="font-heading text-xl font-bold text-dark-blue">{cycleName} Application</h2>
        {submitting ? (
          <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-gray-100 text-gray-600 flex items-center gap-1">
            <span className="inline-block w-3 h-3 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
            Submitting...
          </span>
        ) : Object.keys(urlWarnings).length > 0 ? (
          <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-amber-100 text-amber-700">Action required</span>
        ) : isAlreadySubmitted ? (
          <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-green-100 text-green-700">Submitted</span>
        ) : (
          <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-blue-100 text-blue-700">Draft</span>
        )}
      </div>
      <p className="text-sm text-muted-foreground mb-8">
        Fill out the form below. Your progress is saved automatically.
      </p>

      <div className="space-y-8">
        {/* Domain selector (interactive) */}
        {renderDomainSelector()}

        {/* General questions (before domains) */}
        {(() => {
          const beforeQuestions = (formQuestions as Question[]).filter(q => !q.data.afterDomains);
          return beforeQuestions.length > 0 ? (
            <div className="rounded-2xl bg-[#E8F4FA] px-6 py-5 space-y-6">
              <h3 className="font-heading text-sm font-bold text-dark-blue uppercase tracking-wider">General Questions</h3>
              {beforeQuestions.map(q => (
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
          ) : null;
        })()}

        {/* Domain-specific questions — colored left border cards */}
        {selectedDomainIds.map(domainId => {
          const domainIndex = (domains as any[]).findIndex((d: any) => d.id === domainId);
          const domain = (domains as any[])[domainIndex];
          if (!domain || domain.challengeQuestions.length === 0) return null;
          const color = getDomainColor(domainIndex);

          return (
            <div key={domainId} className={`rounded-2xl ${color.cardBg} px-6 py-5 space-y-6`}>
              <div className="flex items-center justify-between">
                <h3 className={`font-heading text-sm font-bold uppercase tracking-wider ${color.text}`}>
                  {domain.name} Questions
                </h3>
                <button
                  onClick={() => toggleDomain(domainId)}
                  aria-label={`Remove ${domain.name}`}
                  className="w-6 h-6 rounded-full flex items-center justify-center text-gray-400 hover:text-red-500 hover:bg-red-50 transition"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
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

        {/* General questions (after domains — "anything else") */}
        {(() => {
          const afterQuestions = (formQuestions as Question[]).filter(q => q.data.afterDomains);
          return afterQuestions.length > 0 ? (
            <div className="rounded-2xl bg-[#E8F4FA] px-6 py-5 space-y-6">
              <h3 className="font-heading text-sm font-bold text-dark-blue uppercase tracking-wider">Anything Else</h3>
              {afterQuestions.map(q => (
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
          ) : null;
        })()}

        {error && <p className="text-sm text-red-500">{error}</p>}

        {/* URL warnings banner */}
        {Object.keys(urlWarnings).length > 0 && (
          <div ref={warningBannerRef} className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
            <p className="text-sm font-semibold text-amber-800 mb-1">Some URLs may have issues</p>
            <p className="text-xs text-amber-700">
              One or more of your submitted links appear to be private or inaccessible. You can still submit, but reviewers may not be able to view them.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={() => handleSubmit()}
            disabled={submitting}
            className="px-6 py-2.5 rounded-full bg-accent-coral text-white text-sm font-semibold hover:bg-accent-coral/90 transition disabled:opacity-50"
          >
            {submitting ? "Submitting..." : isAlreadySubmitted ? "Update Application" : "Submit Application"}
          </button>
          <span className="text-xs text-muted-foreground/70 flex items-center gap-1.5">
            {saving ? (
              <>
                <span className="inline-block w-3 h-3 border-2 border-gray-300 border-t-accent-coral rounded-full animate-spin" />
                Saving...
              </>
            ) : hasSavedOnce ? (
              <>
                <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
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

      {/* URL warning modal */}
      {showWarningModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full mx-4 p-6">
            <h3 className="font-heading text-base font-bold text-dark-blue mb-2">Some links may be inaccessible</h3>
            <p className="text-sm text-gray-600 mb-4">
              One or more URLs appear to be private or inaccessible. Reviewers may not be able to view them.
            </p>
            <ul className="space-y-2 mb-5">
              {Object.entries(urlWarnings).map(([key, message]) => {
                const allQuestions = [
                  ...(formQuestions as Question[]),
                  ...(domains as any[]).flatMap((d: any) => d.challengeQuestions as Question[]),
                ];
                const q = allQuestions.find(q => q.key === key);
                return (
                  <li key={key} className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                    <span className="font-semibold">{q?.data.label ?? key}:</span> {message}
                  </li>
                );
              })}
            </ul>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => {
                  setShowWarningModal(false);
                  warningBannerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
                }}
                className="px-5 py-2 rounded-full border-2 border-border text-sm font-semibold text-muted-foreground hover:border-accent-coral hover:text-accent-coral transition"
              >
                Go Back and Fix
              </button>
              <button
                onClick={() => { setShowWarningModal(false); handleSubmit(true); }}
                disabled={submitting}
                className="px-5 py-2 rounded-full bg-accent-coral text-white text-sm font-semibold hover:bg-accent-coral/90 transition disabled:opacity-50"
              >
                Submit Anyway
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
