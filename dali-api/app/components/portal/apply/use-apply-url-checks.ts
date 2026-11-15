import { useCallback, useState } from "react";
import type { UrlCheckState } from "~/components/form-builder/QuestionField";
import { visibleQuestions } from "~/forms/lib/form-logic";
import { getPickedQuestions, type DomainShape } from "~/hiring/lib/apply-sections";
import type { SubmissionCheckResult } from "~/lib/submission-check";
import type { Question } from "~/types";

export type UrlQuestionType = "github_url" | "figma_url" | "drive_url";
export type UrlQuestion = { key: string; url: string; type: UrlQuestionType };

export function isUrlType(t: string): t is UrlQuestionType {
  return t === "github_url" || t === "figma_url" || t === "drive_url";
}

export type UrlQuestionSources = {
  formQuestions: Question[];
  answers: Record<string, string>;
  generalLocked: boolean;
  domains: DomainShape[];
  selectedDomainIds: string[];
  continuedFrom: Record<string, string>;
  continuedInterest: { questions: Question[] } | null;
  continuedAnswers: Record<string, Record<string, string>>;
  domainAnswers: Record<string, Record<string, string>>;
  pickedChallengeByDomain: Record<string, string>;
};

/** Every non-empty URL answer across the general form and each picked domain's questions. */
export function collectUrlQuestions(s: UrlQuestionSources): UrlQuestion[] {
  const urlQuestions: UrlQuestion[] = [];
  // Frozen waitlisted answers aren't re-checked: the applicant can't fix them.
  for (const q of s.generalLocked ? [] : visibleQuestions(s.formQuestions, s.answers)) {
    if (isUrlType(q.type) && s.answers[q.key]?.trim()) {
      urlQuestions.push({ key: q.key, url: s.answers[q.key], type: q.type });
    }
  }
  for (const domainId of s.selectedDomainIds) {
    const domain = s.domains.find((d) => d.id === domainId);
    if (!domain) continue;
    const [questions, source] = s.continuedFrom[domainId]
      ? [s.continuedInterest?.questions ?? [], s.continuedAnswers[domainId]]
      : [getPickedQuestions(domain, s.pickedChallengeByDomain[domainId]), s.domainAnswers[domainId]];
    for (const q of visibleQuestions(questions, source ?? {})) {
      if (isUrlType(q.type) && source?.[q.key]?.trim()) {
        urlQuestions.push({ key: q.key, url: source[q.key], type: q.type });
      }
    }
  }
  return urlQuestions;
}

/** A failed check is a result with status "error", never a throw, so it can only ever become a warning. */
export async function requestUrlCheck(url: string, type: UrlQuestionType): Promise<SubmissionCheckResult> {
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
      return { status: "error" as const, url, message };
    }
    return await res.json();
  } catch {
    return { status: "error", url, message: "Failed to check URL" };
  }
}

export function useApplyUrlChecks(sources: UrlQuestionSources) {
  const [urlChecks, setUrlChecks] = useState<Record<string, UrlCheckState>>({});

  const checkUrlField = useCallback(async (key: string, url: string, type: UrlQuestionType) => {
    if (!url.trim()) {
      setUrlChecks((prev) => ({ ...prev, [key]: { status: "idle" } }));
      return;
    }
    setUrlChecks((prev) => ({ ...prev, [key]: { status: "checking" } }));
    const result = await requestUrlCheck(url, type);
    setUrlChecks((prev) => ({ ...prev, [key]: { status: "done", result } }));
  }, []);

  /** Re-checks every URL answer, reusing the on-blur result when the value hasn't changed. Returns a warning message per link that isn't valid. */
  async function runUrlChecksForReview(): Promise<Record<string, string>> {
    const urlQuestions = collectUrlQuestions(sources);
    if (urlQuestions.length === 0) return {};

    const results = await Promise.all(
      urlQuestions.map(async (q) => {
        const cached = urlChecks[q.key];
        if (cached?.status === "done" && cached.result && cached.result.url === q.url) {
          return { key: q.key, result: cached.result };
        }
        return { key: q.key, result: await requestUrlCheck(q.url, q.type) };
      }),
    );

    setUrlChecks((prev) => {
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

  return { urlChecks, checkUrlField, collectUrlQuestions: () => collectUrlQuestions(sources), runUrlChecksForReview };
}
