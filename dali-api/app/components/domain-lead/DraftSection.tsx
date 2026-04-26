import { Form } from "react-router";
import { CheckCircle } from "lucide-react";
import { ChallengeSelector } from "./ChallengeSelector";

export function DraftSection({ cycle, domainId, challengeVersionOptions, selectedChallengeVersionId, isChallengeReady, currentRubricVersionId }: {
  cycle: any;
  domainId: string;
  challengeVersionOptions: any[];
  selectedChallengeVersionId: string | null;
  isChallengeReady: boolean;
  currentRubricVersionId: string | null;
}) {
  const selectedVersion = challengeVersionOptions.find((cv: any) => cv.id === selectedChallengeVersionId);
  const questionCount: number = selectedVersion?.questions?.length ?? 0;

  if (selectedChallengeVersionId && isChallengeReady) {
    return (
      <div className="bg-card border border-border rounded-xl p-8 flex flex-col items-center text-center space-y-6">
        <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
          <CheckCircle className="w-8 h-8 text-green-600" />
        </div>
        <div className="space-y-1">
          <h3 className="text-xl font-bold text-foreground">Challenge Questions Finalized</h3>
          <p className="text-muted-foreground text-sm max-w-sm">
            Your {selectedVersion?.challenge?.name ?? "challenge"} has {questionCount} question{questionCount !== 1 ? "s" : ""} configured and is ready for applicants.
          </p>
        </div>

        <div className="w-full max-w-sm bg-muted/50 border border-border rounded-xl p-4 text-left space-y-3">
          <div className="grid grid-cols-2 divide-x divide-gray-200">
            <div className="pr-4">
              <p className="text-xs text-muted-foreground">Challenge Selected</p>
              <p className="font-bold text-foreground mt-0.5">Yes</p>
            </div>
            <div className="pl-4">
              <p className="text-xs text-muted-foreground">Questions Configured</p>
              <p className="font-bold text-foreground mt-0.5">{questionCount}</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-green-600 text-sm font-medium pt-1 border-t border-border">
            <CheckCircle className="w-4 h-4" />
            Ready for applications
          </div>
        </div>

        <Form method="post">
          <input type="hidden" name="intent" value="unmark-ready" />
          <input type="hidden" name="cycleId" value={cycle.id} />
          <input type="hidden" name="domainId" value={domainId} />
          <button
            type="submit"
            className="px-4 py-2 text-sm font-medium text-foreground/80 bg-card border border-gray-300 rounded-lg hover:bg-muted/50"
          >
            Edit Challenge
          </button>
        </Form>
      </div>
    );
  }

  if (selectedChallengeVersionId && !isChallengeReady) {
    return (
      <div className="space-y-4">
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-6 space-y-4">
          <div className="flex gap-3">
            <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center shrink-0 mt-0.5">
              <CheckCircle className="w-5 h-5 text-blue-600" />
            </div>
            <div className="space-y-1">
              <h3 className="font-bold text-blue-900">Ready to finalize?</h3>
              <p className="text-sm text-blue-700 leading-relaxed">
                Once you mark your challenge as ready, your challenge questions will be locked in and visible to applicants when applications open. You can still return here to make edits before the application deadline.
              </p>
            </div>
          </div>
          <Form method="post">
            <input type="hidden" name="intent" value="mark-ready" />
            <input type="hidden" name="cycleId" value={cycle.id} />
            <input type="hidden" name="domainId" value={domainId} />
            <button
              type="submit"
              className="flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white text-sm font-semibold rounded-lg hover:bg-blue-700"
            >
              <CheckCircle className="w-4 h-4" />
              Mark Configuration as Ready
            </button>
          </Form>
        </div>

        <ChallengeSelector
          cycleId={cycle.id}
          domainId={domainId}
          options={challengeVersionOptions}
          selectedId={selectedChallengeVersionId}
        />
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-lg p-6 space-y-4">
      <div>
        <h3 className="font-semibold text-foreground">Configure Challenge</h3>
        <p className="text-sm text-muted-foreground mt-0.5">Select the challenge version applicants will complete for {cycle.name}.</p>
      </div>
      <ChallengeSelector
        cycleId={cycle.id}
        domainId={domainId}
        options={challengeVersionOptions}
        selectedId={selectedChallengeVersionId}
      />
    </div>
  );
}
