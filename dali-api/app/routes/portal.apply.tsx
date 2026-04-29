import { useState, useRef, useEffect, useCallback } from "react";
import { redirect, useLoaderData, useFetcher } from "react-router";
import type { Route } from "./+types/portal.apply";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { getActiveCycle } from "~/lib/cycles";
import { checkGitHubUrl, checkFigmaUrl } from "~/lib/submission-check";
import type { SubmissionCheckResult } from "~/lib/submission-check";
import { countWords, validateWordLimits } from "~/lib/word-count";
import type { WordCountViolation } from "~/lib/word-count";
import {
  MAX_UPLOAD_BYTES,
  MAX_UPLOAD_LABEL,
  fileMatchesAccept,
} from "~/lib/file-validation";
import type { Question } from "~/types";
import { ApplicantErrorBoundary } from "~/components/ApplicantErrorBoundary";
import { Modal } from "~/components/Modal";
import { QuestionList } from "~/components/ApplicationAnswers";
import { RichTextViewer, isEmptyDoc } from "~/components/RichTextViewer";

export const meta: Route.MetaFunction = () => [{ title: "Apply · DALI OS" }];

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
            include: { domain: true, challenge: true },
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
  const generalDescription = generalCvac.challengeVersion.description ?? null;

  // Build domain info with all linked challenge versions (applicant picks one).
  const domains = cycle.domains.map(dac => {
    const linked = cycle.challengeVersions.filter(
      cvc => cvc.challengeVersion.domainId === dac.domainId,
    );
    return {
      id: dac.domainId,
      name: dac.domain.name,
      challenges: linked.map(cvc => ({
        challengeVersionId: cvc.challengeVersionId,
        challengeName: (cvc.challengeVersion as any).challenge?.name ?? "Challenge",
        description: (cvc.challengeVersion as any).description ?? null,
        questions: ((cvc.challengeVersion.questions as unknown) as Question[]) ?? [],
      })),
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
    closeDate: active.closeDate ? active.closeDate.toISOString() : null,
    generalChallengeVersionId,
    formQuestions,
    generalDescription,
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
            challengeVersionId: da.challengeVersionId,
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
    const selectedDomains = JSON.parse(formData.get("selectedDomains") as string) as {
      domainId: string;
      challengeVersionId: string;
    }[];

    // Validate every chosen CV is linked to this cycle and matches the claimed domain.
    const cvacs = await prisma.challengeVersionApplicationCycle.findMany({
      where: { applicationCycleId: cycleId },
      include: { challengeVersion: true },
    });
    const cvByPair = new Map<string, string>();
    for (const c of cvacs) {
      if (c.challengeVersion.domainId) {
        cvByPair.set(`${c.challengeVersion.domainId}:${c.challengeVersionId}`, c.challengeVersionId);
      }
    }

    const validSelections = selectedDomains.filter(s =>
      cvByPair.has(`${s.domainId}:${s.challengeVersionId}`),
    );

    // Upsert keyed on the (userId, applicationCycleId) unique constraint so
    // that two concurrent "Start Application" clicks (e.g. from two open tabs)
    // converge on a single draft instead of creating duplicates. For an
    // existing row the update is a no-op — domain selection is reconciled
    // separately via the `update-domains` intent.
    const application = await prisma.application.upsert({
      where: {
        userId_applicationCycleId: {
          userId: auth.user.sub,
          applicationCycleId: cycleId,
        },
      },
      update: {},
      create: {
        userId: auth.user.sub,
        applicationCycleId: cycleId,
        generalChallengeVersionId,
        answers: {},
        statusUpdates: {
          create: { newStatus: "Draft", userId: auth.user.sub },
        },
        domainApplications: {
          create: validSelections.map(s => ({
            challengeVersionId: s.challengeVersionId,
            answers: {},
          })),
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
          challengeVersionId: da.challengeVersionId,
          answers: da.answers,
        })),
      },
    };
  }

  if (intent === "update-domains") {
    const applicationId = formData.get("applicationId") as string;
    const cycleId = formData.get("cycleId") as string;
    const newSelections = JSON.parse(formData.get("selectedDomains") as string) as {
      domainId: string;
      challengeVersionId: string;
    }[];

    // Validate every chosen CV is linked to this cycle and matches the claimed domain.
    const cvacs = await prisma.challengeVersionApplicationCycle.findMany({
      where: { applicationCycleId: cycleId },
      include: { challengeVersion: true },
    });
    const cvByPair = new Map<string, string>();
    for (const c of cvacs) {
      if (c.challengeVersion.domainId) {
        cvByPair.set(`${c.challengeVersion.domainId}:${c.challengeVersionId}`, c.challengeVersionId);
      }
    }
    const validSelections = newSelections.filter(s =>
      cvByPair.has(`${s.domainId}:${s.challengeVersionId}`),
    );
    const newDomainIds = validSelections.map(s => s.domainId);
    const desiredCvByDomain = new Map(validSelections.map(s => [s.domainId, s.challengeVersionId]));

    // Existing DAs for this application, keyed by domainId
    const existing = await prisma.domainApplication.findMany({
      where: { applicationId },
      include: { challengeVersion: { select: { domainId: true } } },
    });
    const existingByDomain = new Map<string, (typeof existing)[number]>();
    for (const da of existing) {
      const did = da.challengeVersion.domainId;
      if (did) existingByDomain.set(did, da);
    }

    // For each desired (domainId, cvId): create new DA, reselect, or switch CV.
    for (const sel of validSelections) {
      const ex = existingByDomain.get(sel.domainId);
      if (!ex) {
        await prisma.domainApplication.create({
          data: {
            applicationId,
            challengeVersionId: sel.challengeVersionId,
            answers: {},
          },
        });
        continue;
      }
      const updates: { selected?: boolean; challengeVersionId?: string; answers?: any } = {};
      if (!ex.selected) updates.selected = true;
      if (ex.challengeVersionId !== sel.challengeVersionId) {
        // Switching the picked challenge wipes that domain's answers — the
        // question set is different. The applicant is warned client-side.
        updates.challengeVersionId = sel.challengeVersionId;
        updates.answers = {};
      }
      if (Object.keys(updates).length > 0) {
        await prisma.domainApplication.update({
          where: { id: ex.id },
          data: updates,
        });
      }
    }

    // Domains the applicant deselected — preserve answers but mark unselected.
    const toDeselectIds = existing
      .filter(da => da.challengeVersion.domainId && !newDomainIds.includes(da.challengeVersion.domainId))
      .map(da => da.id);
    if (toDeselectIds.length > 0) {
      await prisma.domainApplication.updateMany({
        where: { id: { in: toDeselectIds } },
        data: { selected: false },
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
          challengeVersionId: da.challengeVersionId,
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

    // Validate word limits server-side before any writes. Trust the questions
    // from the ChallengeVersion record, not anything in the request payload.
    const application = await prisma.application.findUnique({
      where: { id: applicationId },
      select: {
        generalChallengeVersion: { select: { questions: true } },
      },
    });
    if (!application) {
      return Response.json({ error: "Application not found" }, { status: 404 });
    }
    const generalQuestions =
      (application.generalChallengeVersion.questions as unknown as Question[]) ?? [];

    const domainApps = domainAnswers.length
      ? await prisma.domainApplication.findMany({
          where: { id: { in: domainAnswers.map(da => da.domainApplicationId) } },
          select: {
            id: true,
            challengeVersion: { select: { questions: true } },
          },
        })
      : [];

    const wordCountErrors: Record<string, WordCountViolation> = {
      ...validateWordLimits(generalQuestions, answers),
    };
    for (const da of domainAnswers) {
      const dbDa = domainApps.find(d => d.id === da.domainApplicationId);
      if (!dbDa) continue;
      const questions = (dbDa.challengeVersion.questions as unknown as Question[]) ?? [];
      Object.assign(wordCountErrors, validateWordLimits(questions, da.answers));
    }
    if (Object.keys(wordCountErrors).length > 0) {
      return { wordCountErrors };
    }

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
        <span className="inline-block w-3 h-3 border-2 border-border border-t-accent-coral rounded-full animate-spin" />
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
            className="w-14 shrink-0 rounded-md border border-border bg-card text-sm text-center text-dark-blue py-1 focus:outline-none focus:border-accent-coral"
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
          accept,
        }),
      });
      if (!presignRes.ok) {
        const text = await presignRes.text();
        let message = "Failed to get upload URL";
        try { message = JSON.parse(text).error ?? message; } catch {}
        throw new Error(message);
      }
      const { url, fields, key } = await presignRes.json();

      // 2. Upload directly to S3 via multipart POST. S3 requires every
      // policy field to come before the file part in the form body.
      const formData = new FormData();
      for (const [name, value] of Object.entries(fields as Record<string, string>)) {
        formData.append(name, value);
      }
      formData.append("file", file);
      const uploadRes = await fetch(url, { method: "POST", body: formData });
      if (!uploadRes.ok) {
        // S3 returns 403 with EntityTooLarge when the size policy fails.
        const body = await uploadRes.text().catch(() => "");
        if (uploadRes.status === 403 && /EntityTooLarge/i.test(body)) {
          throw new Error(`File too large (max ${MAX_UPLOAD_LABEL})`);
        }
        throw new Error("Upload failed");
      }

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
      <div className="flex items-center gap-2 px-4 py-3 rounded-lg border border-border bg-card text-sm text-muted-foreground">
        <span className="inline-block w-4 h-4 border-2 border-border border-t-accent-coral rounded-full animate-spin" />
        Uploading...
      </div>
    );
  }

  if (fileName) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-border bg-card">
        <svg className="w-5 h-5 text-accent-coral shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
        <span className="text-sm text-dark-blue truncate flex-1">{fileName}</span>
        <button
          type="button"
          onClick={() => { onChange(""); if (fileRef.current) fileRef.current.value = ""; }}
          className="text-xs text-muted-foreground hover:text-red-500 transition"
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
        className="flex items-center gap-2 px-4 py-3 rounded-lg border-2 border-dashed border-border bg-card text-sm text-muted-foreground hover:border-accent-coral hover:text-accent-coral transition w-full"
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
    const wordCount = countWords(value);
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
  { border: "border-l-accent-pink", text: "text-accent-pink", bg: "bg-accent-pink", pillText: "text-white", cardBg: "bg-accent-pink/20" },
  { border: "border-l-accent-teal", text: "text-accent-teal", bg: "bg-accent-teal", pillText: "text-white", cardBg: "bg-accent-teal/20" },
  { border: "border-l-accent-yellow", text: "text-yellow-700", bg: "bg-accent-yellow", pillText: "text-dark-blue", cardBg: "bg-accent-yellow/30" },
  { border: "border-l-accent-coral", text: "text-accent-coral", bg: "bg-accent-coral", pillText: "text-white", cardBg: "bg-accent-coral/20" },
  { border: "border-l-accent-green", text: "text-green-700", bg: "bg-accent-green", pillText: "text-dark-blue", cardBg: "bg-accent-green/30" },
];

function getDomainColor(index: number) {
  return DOMAIN_COLORS[index % DOMAIN_COLORS.length];
}

// ─── Section Progress Helpers ───────────────────────────────────────────────

type DomainColor = ReturnType<typeof getDomainColor>;

type Section = {
  id: string;
  label: string;
  color?: DomainColor;
  requiredCount: number;
  answeredRequiredCount: number;
};

function isAnswered(value: string | undefined) {
  return typeof value === "string" && value.trim() !== "";
}

type DomainShape = {
  id: string;
  name: string;
  challenges: { challengeVersionId: string; challengeName: string; description: any; questions: Question[] }[];
};

function getPickedQuestions(
  domain: DomainShape,
  pickedCvId: string | null | undefined,
): Question[] {
  if (!pickedCvId) return [];
  const picked = domain.challenges.find(c => c.challengeVersionId === pickedCvId);
  return picked?.questions ?? [];
}

function computeRequiredProgress(
  formQuestions: Question[],
  domains: DomainShape[],
  selectedDomainIds: string[],
  pickedChallengeByDomain: Record<string, string>,
  answers: Record<string, string>,
  domainAnswers: Record<string, Record<string, string>>,
) {
  let totalRequired = 0;
  let totalAnswered = 0;

  const requiredGeneral = formQuestions.filter(q => q.required);
  totalRequired += requiredGeneral.length;
  totalAnswered += requiredGeneral.filter(q => isAnswered(answers[q.key])).length;

  for (const domainId of selectedDomainIds) {
    const domain = domains.find(d => d.id === domainId);
    if (!domain) continue;
    const questions = getPickedQuestions(domain, pickedChallengeByDomain[domainId]);
    const requiredDomain = questions.filter(q => q.required);
    totalRequired += requiredDomain.length;
    totalAnswered += requiredDomain.filter(q =>
      isAnswered(domainAnswers[domainId]?.[q.key]),
    ).length;
  }

  return { totalRequired, totalAnswered };
}

function buildSections(
  formQuestions: Question[],
  domains: DomainShape[],
  selectedDomainIds: string[],
  pickedChallengeByDomain: Record<string, string>,
  answers: Record<string, string>,
  domainAnswers: Record<string, Record<string, string>>,
): Section[] {
  const sections: Section[] = [];

  const beforeQuestions = formQuestions.filter(q => !q.data.afterDomains);
  if (beforeQuestions.length > 0) {
    const required = beforeQuestions.filter(q => q.required);
    sections.push({
      id: "general-before",
      label: "General",
      requiredCount: required.length,
      answeredRequiredCount: required.filter(q => isAnswered(answers[q.key])).length,
    });
  }

  for (const domainId of selectedDomainIds) {
    const idx = domains.findIndex(d => d.id === domainId);
    if (idx < 0) continue;
    const domain = domains[idx];
    if (domain.challenges.length === 0) continue;
    const questions = getPickedQuestions(domain, pickedChallengeByDomain[domainId]);
    const required = questions.filter(q => q.required);
    sections.push({
      id: `domain-${domainId}`,
      label: domain.name,
      color: getDomainColor(idx),
      requiredCount: required.length,
      answeredRequiredCount: required.filter(q =>
        isAnswered(domainAnswers[domainId]?.[q.key]),
      ).length,
    });
  }

  const afterQuestions = formQuestions.filter(q => q.data.afterDomains);
  if (afterQuestions.length > 0) {
    const required = afterQuestions.filter(q => q.required);
    sections.push({
      id: "general-after",
      label: "Anything Else",
      requiredCount: required.length,
      answeredRequiredCount: required.filter(q => isAnswered(answers[q.key])).length,
    });
  }

  return sections;
}

// ─── SectionNav Component ───────────────────────────────────────────────────

function scrollToSection(id: string) {
  const el = document.getElementById(`section-${id}`);
  if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
}

function SectionNavMobile({
  sections,
  activeSection,
}: {
  sections: Section[];
  activeSection: string | null;
}) {
  if (sections.length === 0) return null;
  return (
    <div className="lg:hidden flex gap-2 overflow-x-auto pb-2">
      {sections.map(s => {
        const isActive = s.id === activeSection;
        const isComplete = s.requiredCount > 0 && s.answeredRequiredCount === s.requiredCount;
        const dotColor = s.color?.bg ?? "bg-dark-blue";
        return (
          <button
            key={s.id}
            type="button"
            onClick={() => scrollToSection(s.id)}
            className={`shrink-0 flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              isActive
                ? "bg-dark-blue text-white border-dark-blue"
                : "bg-card text-dark-blue border-border hover:border-accent-coral"
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor}`} />
            <span>{s.label}</span>
            {s.requiredCount > 0 && (
              isComplete ? (
                <svg className="w-3.5 h-3.5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <span className={isActive ? "text-white/80" : "text-muted-foreground"}>
                  {s.answeredRequiredCount}/{s.requiredCount}
                </span>
              )
            )}
          </button>
        );
      })}
    </div>
  );
}

function SectionNavDesktop({
  sections,
  activeSection,
}: {
  sections: Section[];
  activeSection: string | null;
}) {
  if (sections.length === 0) return null;
  return (
    <aside className="hidden lg:block">
      <div className="sticky top-24 space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-2">
          Sections
        </p>
        {sections.map(s => {
          const isActive = s.id === activeSection;
          const isComplete = s.requiredCount > 0 && s.answeredRequiredCount === s.requiredCount;
          const dotColor = s.color?.bg ?? "bg-dark-blue";
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => scrollToSection(s.id)}
              className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-sm transition text-left ${
                isActive
                  ? "bg-dark-blue/5 text-dark-blue font-semibold"
                  : "text-muted-foreground hover:bg-muted hover:text-dark-blue"
              }`}
            >
              <span className={`w-2 h-2 rounded-full shrink-0 ${dotColor}`} />
              <span className="flex-1 truncate">{s.label}</span>
              {s.requiredCount > 0 && (
                isComplete ? (
                  <svg className="w-4 h-4 text-green-500 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
                    {s.answeredRequiredCount}/{s.requiredCount}
                  </span>
                )
              )}
            </button>
          );
        })}
      </div>
    </aside>
  );
}

// ─── BackToTopButton Component ──────────────────────────────────────────────

function BackToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    function onScroll() {
      setVisible(window.scrollY > 600);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="Back to top"
      className="fixed bottom-6 right-6 z-30 w-11 h-11 rounded-full bg-dark-blue text-white shadow-lg hover:bg-dark-blue/90 transition flex items-center justify-center"
    >
      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" />
      </svg>
    </button>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function PortalApply() {
  const loaderData = useLoaderData<typeof loader>() as any;
  const { cycleId, cycleName, generalChallengeVersionId, formQuestions, generalDescription, domains, isAlreadySubmitted } = loaderData;
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

  function buildSelectedDomainsPayload(
    ids: string[],
    picks: Record<string, string>,
  ): { domainId: string; challengeVersionId: string }[] {
    const payload: { domainId: string; challengeVersionId: string }[] = [];
    for (const id of ids) {
      const cvId = picks[id];
      if (cvId) payload.push({ domainId: id, challengeVersionId: cvId });
    }
    return payload;
  }

  function toggleDomain(domainId: string) {
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
    const missing = selectedDomainIds.find(id => !pickedChallengeByDomain[id]);
    if (missing) {
      setError("Please pick a challenge for every selected domain.");
      return;
    }

    const form = new FormData();
    form.set("intent", "create-draft");
    form.set("cycleId", cycleId);
    form.set("generalChallengeVersionId", generalChallengeVersionId);
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

  // Validation gate: runs before opening the review modal. Returns null on
  // success, or an error string to surface to the user.
  function validateForReview(): string | null {
    if (!draft) return null;
    if (selectedDomainIds.length === 0) {
      return "Please select at least one domain.";
    }
    const missingPick = selectedDomainIds.find(id => !pickedChallengeByDomain[id]);
    if (missingPick) {
      return "Please pick a challenge for every selected domain.";
    }
    const { totalRequired, totalAnswered } = computeRequiredProgress(
      formQuestions as Question[],
      domains as DomainShape[],
      selectedDomainIds,
      pickedChallengeByDomain,
      answers,
      domainAnswers,
    );
    const totalMissing = totalRequired - totalAnswered;
    if (totalMissing > 0) {
      return `Please answer all required questions (${totalMissing} of ${totalRequired} unanswered).`;
    }
    return null;
  }

  // Collect every non-empty github_url / figma_url answer across the general
  // form and each picked domain challenge. Used by both the pre-review check
  // and the final submit payload.
  function collectUrlQuestions(): { key: string; url: string; type: "github_url" | "figma_url" }[] {
    const urlQuestions: { key: string; url: string; type: "github_url" | "figma_url" }[] = [];
    for (const q of formQuestions as Question[]) {
      if ((q.type === "github_url" || q.type === "figma_url") && answers[q.key]?.trim()) {
        urlQuestions.push({ key: q.key, url: answers[q.key], type: q.type as "github_url" | "figma_url" });
      }
    }
    for (const domainId of selectedDomainIds) {
      const domain = (domains as DomainShape[]).find((d: DomainShape) => d.id === domainId);
      if (!domain) continue;
      const questions = getPickedQuestions(domain, pickedChallengeByDomain[domainId]);
      for (const q of questions) {
        if ((q.type === "github_url" || q.type === "figma_url") && domainAnswers[domainId]?.[q.key]?.trim()) {
          urlQuestions.push({ key: q.key, url: domainAnswers[domainId][q.key], type: q.type as "github_url" | "figma_url" });
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

  function scrollToFirstWarning() {
    const firstKey = Object.keys(urlWarnings)[0];
    if (!firstKey) return;
    const el = document.getElementById(`question-${firstKey}`);
    if (el) {
      // Small delay to let the modal close before scrolling
      setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "center" }), 50);
    }
  }

  // Handle submit response (urlWarnings, wordCountErrors) — redirects are handled automatically by React Router
  useEffect(() => {
    if (submitFetcher.state === "idle" && submitFetcher.data) {
      setSubmitting(false);
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
  );
  const { totalRequired, totalAnswered } = computeRequiredProgress(
    formQuestions as Question[],
    domains as DomainShape[],
    selectedDomainIds,
    pickedChallengeByDomain,
    answers,
    domainAnswers,
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
        <p className="text-sm text-muted-foreground mb-8">
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
    <div className="lg:max-w-6xl max-w-3xl mx-auto px-6 py-10">
      {/* Sticky header: (mobile) section chip strip */}
      <div className="lg:hidden sticky top-0 z-30 -mx-6 px-6 pt-1 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 mb-2">
        <SectionNavMobile sections={sections} activeSection={activeSection} />
      </div>

      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_220px] lg:gap-10">
        <div className="max-w-3xl">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-heading text-xl font-bold text-dark-blue">{cycleName} Application</h2>
            {submitting ? (
              <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-muted text-muted-foreground flex items-center gap-1">
                <span className="inline-block w-3 h-3 border-2 border-border border-t-muted-foreground rounded-full animate-spin" />
                Submitting...
              </span>
            ) : Object.keys(wordCountErrors).length > 0 ? (
              <span className="text-xs px-2.5 py-0.5 rounded-full font-semibold bg-red-100 text-red-700">Action required</span>
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
            <div id="section-general-before" className="rounded-2xl bg-[#E8F4FA] px-6 py-5 space-y-6 scroll-mt-24">
              <h3 className="font-heading text-sm font-bold text-dark-blue uppercase tracking-wider">General Questions</h3>
              {!isEmptyDoc(generalDescription) && (
                <div className="text-dark-blue">
                  <RichTextViewer content={generalDescription} />
                </div>
              )}
              {beforeQuestions.map(q => (
                <div key={q.key} id={`question-${q.key}`}>
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
                  {wordCountErrors[q.key] && (
                    <p className="text-xs text-red-500 mt-1">
                      Over the {wordCountErrors[q.key].maxWords}-word limit ({wordCountErrors[q.key].wordCount} words).
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : null;
        })()}

        {/* Domain-specific questions — colored left border cards */}
        {selectedDomainIds.map(domainId => {
          const domainIndex = (domains as DomainShape[]).findIndex((d: DomainShape) => d.id === domainId);
          const domain = (domains as DomainShape[])[domainIndex];
          if (!domain) return null;
          const color = getDomainColor(domainIndex);
          const pickedCvId = pickedChallengeByDomain[domainId] ?? null;
          const pickedQuestions = getPickedQuestions(domain, pickedCvId);
          const showPicker = domain.challenges.length > 1;

          return (
            <div key={domainId} id={`section-domain-${domainId}`} className={`rounded-2xl ${color.cardBg} px-6 py-5 space-y-6 scroll-mt-24`}>
              <div className="flex items-center justify-between">
                <h3 className={`font-heading text-sm font-bold uppercase tracking-wider ${color.text}`}>
                  {domain.name} Questions
                </h3>
                <button
                  onClick={() => toggleDomain(domainId)}
                  aria-label={`Remove ${domain.name}`}
                  className="w-6 h-6 rounded-full flex items-center justify-center text-muted-foreground hover:text-red-500 hover:bg-red-50 transition"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>

              {showPicker && (
                <div>
                  <p className="text-xs font-semibold text-dark-blue mb-2">
                    Choose your {domain.name} challenge <span className="text-accent-coral">*</span>
                  </p>
                  <div className="space-y-2">
                    {domain.challenges.map(c => (
                      <label key={c.challengeVersionId} className="flex items-start gap-2 text-sm cursor-pointer">
                        <input
                          type="radio"
                          name={`challenge-${domainId}`}
                          value={c.challengeVersionId}
                          checked={pickedCvId === c.challengeVersionId}
                          onChange={() => handleChallengePick(domainId, c.challengeVersionId)}
                          className="mt-0.5"
                        />
                        <span className="text-dark-blue">{c.challengeName}</span>
                      </label>
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
                    return !isEmptyDoc(pickedChallenge?.description) ? (
                      <div className="text-dark-blue">
                        <RichTextViewer content={pickedChallenge!.description} />
                      </div>
                    ) : null;
                  })()}
                  {pickedQuestions.map((q: Question) => (
                    <div key={q.key} id={`question-${q.key}`}>
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
                      {wordCountErrors[q.key] && (
                        <p className="text-xs text-red-500 mt-1">
                          Over the {wordCountErrors[q.key].maxWords}-word limit ({wordCountErrors[q.key].wordCount} words).
                        </p>
                      )}
                    </div>
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
          const afterQuestions = (formQuestions as Question[]).filter(q => q.data.afterDomains);
          return afterQuestions.length > 0 ? (
            <div id="section-general-after" className="rounded-2xl bg-[#E8F4FA] px-6 py-5 space-y-6 scroll-mt-24">
              <h3 className="font-heading text-sm font-bold text-dark-blue uppercase tracking-wider">Anything Else</h3>
              {afterQuestions.map(q => (
                <div key={q.key} id={`question-${q.key}`}>
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
                  />
                  {wordCountErrors[q.key] && (
                    <p className="text-xs text-red-500 mt-1">
                      Over the {wordCountErrors[q.key].maxWords}-word limit ({wordCountErrors[q.key].wordCount} words).
                    </p>
                  )}
                </div>
              ))}
            </div>
          ) : null;
        })()}

        {error && <p className="text-sm text-red-500">{error}</p>}

        {/* Word-count errors banner — hard error, blocks submission */}
        {Object.keys(wordCountErrors).length > 0 && (
          <div ref={warningBannerRef} className="rounded-xl border border-red-200 bg-red-50 px-5 py-4">
            <p className="text-sm font-semibold text-red-800 mb-1">Some answers exceed the word limit</p>
            <p className="text-xs text-red-700">
              The following answers are over the allowed word count. Trim them down before submitting.
            </p>
            <ul className="text-xs text-red-700 mt-2 list-disc list-inside space-y-0.5">
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
          <div ref={Object.keys(wordCountErrors).length > 0 ? undefined : warningBannerRef} className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
            <p className="text-sm font-semibold text-amber-800 mb-1">Some URLs may have issues</p>
            <p className="text-xs text-amber-700">
              One or more of your submitted links appear to be private or inaccessible. You can still submit, but reviewers may not be able to view them.
            </p>
          </div>
        )}

        {/* Actions */}
        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={() => openReviewIfValid()}
            disabled={submitting || checkingUrls}
            className="px-6 py-2.5 rounded-full bg-accent-coral text-white text-sm font-semibold hover:bg-accent-coral/90 transition disabled:opacity-50 flex items-center gap-2"
          >
            {checkingUrls && (
              <span className="inline-block w-3.5 h-3.5 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            )}
            {submitting
              ? "Submitting..."
              : checkingUrls
                ? "Checking links..."
                : isAlreadySubmitted
                  ? "Review Updates"
                  : "Review Application"}
          </button>
          <span className="text-xs text-muted-foreground/70 flex items-center gap-1.5">
            {saving ? (
              <>
                <span className="inline-block w-3 h-3 border-2 border-border border-t-accent-coral rounded-full animate-spin" />
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
        containerClassName="bg-card rounded-2xl shadow-xl max-w-2xl w-full mx-4 max-h-[85vh] overflow-y-auto p-6"
      >
        <h3 id="review-modal-title" className="font-heading text-base font-bold text-dark-blue mb-1">
          {isAlreadySubmitted ? "Review your changes" : "Review your application"}
        </h3>
        <p className="text-sm text-muted-foreground mb-5">
          Take one last look at your answers before {isAlreadySubmitted ? "updating" : "submitting"}. You can still go back to edit.
        </p>

        <div className="space-y-5">
          {(() => {
            const beforeQuestions = (formQuestions as Question[]).filter(q => !q.data.afterDomains);
            return beforeQuestions.length > 0 ? (
              <div className="rounded-2xl bg-[#E8F4FA] px-5 py-4">
                <h4 className="font-heading text-xs font-bold text-dark-blue uppercase tracking-wider mb-4">
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
            if (pickedQuestions.length === 0) return null;
            const pickedName = domain.challenges.find(c => c.challengeVersionId === pickedCvId)?.challengeName;
            const color = getDomainColor(domainIndex);
            return (
              <div key={domainId} className={`rounded-2xl ${color.cardBg} px-5 py-4`}>
                <h4 className={`font-heading text-xs font-bold uppercase tracking-wider mb-1 ${color.text}`}>
                  {domain.name}
                </h4>
                {pickedName && domain.challenges.length > 1 && (
                  <p className="text-xs text-muted-foreground mb-3">Challenge: {pickedName}</p>
                )}
                <QuestionList
                  questions={pickedQuestions}
                  answers={domainAnswers[domainId] ?? {}}
                  presigned={false}
                />
              </div>
            );
          })}

          {(() => {
            const afterQuestions = (formQuestions as Question[]).filter(q => q.data.afterDomains);
            return afterQuestions.length > 0 ? (
              <div className="rounded-2xl bg-[#E8F4FA] px-5 py-4">
                <h4 className="font-heading text-xs font-bold text-dark-blue uppercase tracking-wider mb-4">
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
            className="px-5 py-2 rounded-full border-2 border-border text-sm font-semibold text-muted-foreground hover:border-accent-coral hover:text-accent-coral transition disabled:opacity-50"
          >
            Go Back and Edit
          </button>
          <button
            type="button"
            onClick={() => { setShowReviewModal(false); doSubmit(acceptedUrlWarnings); }}
            disabled={submitting}
            className="px-5 py-2 rounded-full bg-accent-coral text-white text-sm font-semibold hover:bg-accent-coral/90 transition disabled:opacity-50"
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
        <h3 id="url-warning-modal-title" className="font-heading text-base font-bold text-dark-blue mb-2">Some links may be inaccessible</h3>
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
              <li key={key} className="text-sm text-yellow-700 bg-yellow-50 rounded-lg px-3 py-2">
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
            className="px-5 py-2 rounded-full border-2 border-border text-sm font-semibold text-muted-foreground hover:border-accent-coral hover:text-accent-coral transition"
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
            className="px-5 py-2 rounded-full bg-accent-coral text-white text-sm font-semibold hover:bg-accent-coral/90 transition disabled:opacity-50"
          >
            Submit Anyway
          </button>
        </div>
      </Modal>

      {/* Confirm challenge switch — wipes domain answers */}
      <Modal
        open={pendingChallengeChange !== null}
        onClose={() => setPendingChallengeChange(null)}
        labelledBy="challenge-switch-title"
      >
        <h3 id="challenge-switch-title" className="font-heading text-base font-bold text-dark-blue mb-2">
          Switch challenge?
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          Switching to a different challenge will clear the answers you've already written
          for this domain, since each challenge has its own questions. This can't be undone.
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={() => setPendingChallengeChange(null)}
            className="px-5 py-2 rounded-full border-2 border-border text-sm font-semibold text-muted-foreground hover:border-accent-coral hover:text-accent-coral transition"
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
            className="px-5 py-2 rounded-full bg-accent-coral text-white text-sm font-semibold hover:bg-accent-coral/90 transition"
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
