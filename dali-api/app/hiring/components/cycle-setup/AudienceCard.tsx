import { useFetcher } from "react-router";
import { Select } from "~/components/ui/floating";
import { Toggle } from "~/components/ui/Toggle";
import { useDialog } from "~/components/ui/dialog";
import { useOsChrome } from "~/components/os-chrome";
import { APPLICANT_GROUPS, APPLICANTS_LABELS } from "~/hiring/lib/applicant-groups";
import type { CycleApplicants } from "~/generated/prisma/enums";
import { SetupCard } from "./SetupCard";

// Who the cycle is for (its `applicants` group). Switching resets the stages
// to the new group's defaults, and into or out of Lab members swaps the whole
// domain setup, so it's confirmed first and only allowed while in Draft.
export function AudienceCard({
  applicants,
  hasChallenges,
  cycleStatus,
  viewerIsAdmin,
}: {
  applicants: CycleApplicants;
  hasChallenges: boolean;
  cycleStatus: string;
  /** Lab members cycles are Admin-only, so only Admins may switch into one. */
  viewerIsAdmin: boolean;
}) {
  const { formTrigger } = useOsChrome();
  const dialog = useDialog();
  const fetcher = useFetcher<{ error?: string }>();
  const challengeFetcher = useFetcher();
  const locked = cycleStatus !== "Draft";
  const groups = APPLICANT_GROUPS.filter((g) => g !== "LabMembers" || viewerIsAdmin || applicants === "LabMembers");

  async function change(next: string) {
    if (next === applicants) return;
    const swapsDomains = next === "LabMembers" || applicants === "LabMembers";
    const ok = await dialog.confirm({
      title: "Change audience?",
      description: swapsDomains
        ? "This resets the stages and removes the domains and reviewers."
        : "This resets the stages to the new audience's defaults.",
      confirmLabel: "Change",
      tone: swapsDomains ? "destructive" : "default",
    });
    if (ok) fetcher.submit({ intent: "set-applicants", applicants: next }, { method: "post" });
  }

  return (
    <SetupCard title="Audience">
      <div className="max-w-xs">
        <Select
          ariaLabel="Audience"
          value={applicants}
          onChange={change}
          disabled={locked || fetcher.state !== "idle"}
          options={groups.map((g) => ({ value: g, label: APPLICANTS_LABELS[g] }))}
          buttonClassName={formTrigger}
        />
      </div>
      {/* Whether applying to a domain means doing its challenge. Part of who
          can apply and how, so it sits with the audience rather than the timeline. */}
      <Toggle
        tone="os"
        label="Require a domain challenge"
        checked={hasChallenges}
        disabled={locked || challengeFetcher.state !== "idle"}
        onChange={(e) =>
          challengeFetcher.submit(
            { intent: "set-stages", stage: "hasChallenges", value: String(e.currentTarget.checked) },
            { method: "post" },
          )
        }
      />
      {fetcher.data?.error && <p className="text-xs text-red-700">{fetcher.data.error}</p>}
    </SetupCard>
  );
}
