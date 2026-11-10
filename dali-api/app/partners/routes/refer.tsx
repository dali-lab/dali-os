// Member-facing hub for the Partner Bounty program. First-time visitors see
// a short quiz on referral best practices — they must get every answer right
// to unlock the tier picker. Repeat visitors skip the quiz straight to the
// three tier cards.
//
// See referral-quiz.ts for the quiz content and payouts, and
// referrals.server.ts for the persistence helpers.

import { useMemo, useState } from "react";
import { Form, redirect, useLoaderData } from "react-router";
import {
  ArrowRight,
  Check,
  Handshake,
  Megaphone,
  Rocket,
  Sparkles,
  Snowflake,
  X,
} from "lucide-react";
import type { Route } from "./+types/refer";
import { requireAuth, redirectNonMemberToPortal } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import {
  REFERRAL_QUIZ,
  REFERRAL_QUIZ_QUESTION_IDS,
  REFERRAL_TIER_BLURB,
  REFERRAL_TIER_LABEL,
  REFERRAL_TIER_PAYOUT_USD,
  gradeReferralQuiz,
} from "~/partners/lib/referral-quiz";
import {
  hasPassedReferralQuiz,
  recordReferralQuizPass,
  requireReferralsEnabled,
} from "~/partners/lib/referrals.server";
import { cn } from "~/lib/cn";

export const meta: Route.MetaFunction = () => [{ title: "Refer a partner · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const redirectResp = await redirectNonMemberToPortal(auth, request);
  if (redirectResp) return redirectResp;
  await requireReferralsEnabled(auth.user.sub, request);
  const quizPassed = await hasPassedReferralQuiz(auth.user.sub);
  return { quizPassed };
}

type ActionData =
  | { ok: true; passed: true }
  | { ok: false; wrong: string[]; attempts: number }
  | { ok: false; error: string };

export async function action({ request }: Route.ActionArgs): Promise<Response | ActionData> {
  const auth = await requireAuth(request);
  if (!auth.ok) return auth.response;
  await requireReferralsEnabled(auth.user.sub, request);
  const form = await request.formData();
  if (form.get("intent") !== "submit-quiz") {
    return { ok: false, error: "Unknown intent." };
  }
  const answers: Record<string, string> = {};
  for (const id of REFERRAL_QUIZ_QUESTION_IDS) {
    const val = form.get(`q:${id}`);
    if (typeof val === "string") answers[id] = val;
  }
  const { passed, wrongQuestionIds } = gradeReferralQuiz(answers);
  const attempts = Number(form.get("attempts") ?? "1") || 1;
  if (!passed) {
    return { ok: false, wrong: wrongQuestionIds, attempts: attempts + 1 };
  }
  await recordReferralQuizPass({ userId: auth.user.sub, attempts });
  return redirect("/refer");
}

export default function ReferHub({ actionData }: Route.ComponentProps) {
  const { quizPassed } = useLoaderData<typeof loader>();
  if (!quizPassed) return <Quiz actionData={actionData as ActionData | undefined} />;
  return <TierPicker />;
}

// ─── Tier picker ─────────────────────────────────────────────────────────────

type TierKey = "Cold" | "Warm" | "FullPitch";

const TIER_ORDER: TierKey[] = ["Cold", "Warm", "FullPitch"];

const TIER_ICON: Record<TierKey, typeof Snowflake> = {
  Cold: Snowflake,
  Warm: Handshake,
  FullPitch: Rocket,
};

function TierPicker() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm text-os-grey">
          <Megaphone className="h-4 w-4" />
          Partner bounty
        </div>
        <h1 className="text-2xl font-semibold text-foreground">Refer a partner</h1>
        <p className="text-sm text-muted-foreground">
          Help the lab find great projects. Pick the tier that fits your lead —
          each pays out when the partner signs on with DALI.
        </p>
      </header>

      <div className="flex flex-col gap-3">
        {TIER_ORDER.map((tier) => {
          const Icon = TIER_ICON[tier];
          return (
            <a
              key={tier}
              href={`/refer/new?tier=${tier}`}
              className={cn(
                "group flex items-center gap-4 rounded-os-card bg-os-card px-5 py-4 transition",
                "hover:bg-os-card-hover",
              )}
            >
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-os-container text-os-ink">
                <Icon className="h-5 w-5" />
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-foreground">
                    {REFERRAL_TIER_LABEL[tier]}
                  </span>
                  <span className="rounded-full bg-os-container px-2 py-0.5 text-xs text-os-grey">
                    ${REFERRAL_TIER_PAYOUT_USD[tier]}
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {REFERRAL_TIER_BLURB[tier]}
                </p>
              </div>
              <ArrowRight className="h-4 w-4 text-os-grey transition group-hover:translate-x-0.5" />
            </a>
          );
        })}
      </div>

      <aside className="rounded-os-card border border-os-container px-5 py-4 text-sm text-muted-foreground">
        <p>
          When you reach out to anyone, remember that you're representing the
          lab. Be kind and clear. If you're not sure whether to reach out, check
          with Partner Relations first.
        </p>
      </aside>
    </div>
  );
}

// ─── Quiz ────────────────────────────────────────────────────────────────────

function Quiz({ actionData }: { actionData: ActionData | undefined }) {
  const failure = actionData && !actionData.ok && "wrong" in actionData ? actionData : null;
  const [picked, setPicked] = useState<Record<string, string>>({});
  const attempts = failure?.attempts ?? 1;

  const wrongIds = useMemo(() => new Set(failure?.wrong ?? []), [failure]);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-6 py-10">
      <header className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm text-os-grey">
          <Sparkles className="h-4 w-4" />
          Quick quiz first
        </div>
        <h1 className="text-2xl font-semibold text-foreground">
          Before you refer a partner
        </h1>
        <p className="text-sm text-muted-foreground">
          One time only. A quick quiz so your referrals are intentional. Get all
          five right and the referral form unlocks for good.
        </p>
      </header>

      {failure && (
        <div className="rounded-os-card border border-os-amber/40 bg-os-amber/10 px-4 py-3 text-sm text-os-amber">
          Not quite — review the highlighted questions and try again.
        </div>
      )}

      <Form method="post" className="flex flex-col gap-5">
        <input type="hidden" name="intent" value="submit-quiz" />
        <input type="hidden" name="attempts" value={attempts} />
        {REFERRAL_QUIZ.map((q, i) => {
          const isWrong = wrongIds.has(q.id);
          return (
            <fieldset
              key={q.id}
              className={cn(
                "rounded-os-card bg-os-card px-5 py-4",
                isWrong && "ring-1 ring-os-amber/60",
              )}
            >
              <legend className="mb-1 text-xs font-medium text-os-grey">
                Question {i + 1} of {REFERRAL_QUIZ.length}
              </legend>
              {q.context && (
                <p className="mb-2 text-sm text-muted-foreground">{q.context}</p>
              )}
              <p className="mb-3 font-medium text-foreground">{q.prompt}</p>
              <div className="flex flex-col gap-2">
                {q.choices.map((c) => {
                  const selected = picked[q.id] === c.id;
                  const wasWrong = isWrong && selected;
                  return (
                    <label
                      key={c.id}
                      className={cn(
                        "flex cursor-pointer items-start gap-3 rounded-md border border-os-container px-3 py-2 transition hover:bg-os-container/30",
                        selected && "bg-os-container/40",
                      )}
                    >
                      <input
                        type="radio"
                        name={`q:${q.id}`}
                        value={c.id}
                        required
                        checked={selected}
                        onChange={() =>
                          setPicked((p) => ({ ...p, [q.id]: c.id }))
                        }
                        className="mt-1"
                      />
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="text-sm text-foreground">{c.label}</span>
                        {wasWrong && c.explanation && (
                          <span className="mt-1 flex items-start gap-1 text-xs text-os-amber">
                            <X className="mt-0.5 h-3 w-3 shrink-0" />
                            {c.explanation}
                          </span>
                        )}
                      </div>
                    </label>
                  );
                })}
              </div>
            </fieldset>
          );
        })}
        <div className="flex items-center justify-end gap-3">
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background hover:opacity-90"
          >
            <Check className="h-4 w-4" />
            Submit answers
          </button>
        </div>
      </Form>
    </div>
  );
}
