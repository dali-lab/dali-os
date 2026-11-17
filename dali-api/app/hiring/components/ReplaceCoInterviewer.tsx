import { useEffect, useId, useMemo, useState } from "react";
import { useRevalidator } from "react-router";
import { Repeat2 } from "lucide-react";
import { Modal, ModalHeader, ModalFooter } from "~/components/Modal";
import { Button } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { Select } from "~/components/ui/floating";
import { useToast } from "~/components/ui/toast";
import {
  seatEligible,
  canOverrideAvailability,
  type InterviewerAvailability,
} from "~/hiring/lib/interviewer-pool";

export type ReplaceableSeat = {
  assignmentId: string;
  role: "InDomain" | "CrossDomain";
  interviewerName: string;
  interviewerUserId: string;
};

type RosterRow = {
  id: string;
  userId: string;
  domainId: string;
  user: { firstName: string | null; lastName: string | null };
  domain: { name: string };
};

// "Replace co-interviewer" on an interview the viewer sits on: pick a
// replacement from the round's roster, then a confirm stage before anything
// is sent — the swap emails both interviewers and rewrites the Meet invite.
export function ReplaceCoInterviewer({
  interviewId,
  cycleId,
  interviewRoundId,
  applicantDomainId,
  seats,
  seatedUserIds,
}: {
  interviewId: string;
  cycleId: string;
  interviewRoundId: string;
  applicantDomainId: string;
  /** The active seats the viewer may hand off (everyone's but their own). */
  seats: ReplaceableSeat[];
  /** Everyone currently on the interview, viewer included. */
  seatedUserIds: string[];
}) {
  const titleId = useId();
  const toast = useToast();
  const revalidator = useRevalidator();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"pick" | "confirm">("pick");
  const [roster, setRoster] = useState<RosterRow[] | null>(null);
  const [seatId, setSeatId] = useState(seats[0]?.assignmentId ?? "");
  const [candidateId, setCandidateId] = useState("");
  const [busy, setBusy] = useState(false);
  const [needsOverride, setNeedsOverride] = useState(false);

  useEffect(() => {
    if (!open || roster != null) return;
    let cancelled = false;
    fetch(`/api/hiring/cycles/${cycleId}/interviewers?round=${encodeURIComponent(interviewRoundId)}`, {
      credentials: "include",
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((rows: RosterRow[]) => {
        if (!cancelled) setRoster(rows);
      })
      .catch(() => {
        if (!cancelled) {
          toast.error("Couldn't load interviewers");
          setOpen(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open, roster, cycleId, interviewRoundId, toast]);

  const seat = seats.find((s) => s.assignmentId === seatId) ?? seats[0];
  const candidates = useMemo(() => {
    if (!roster || !seat) return [];
    return seatEligible(roster, {
      role: seat.role,
      applicantDomainId,
      seatedUserIds,
    });
  }, [roster, seat, applicantDomainId, seatedUserIds]);
  const candidate = candidates.find((c) => c.id === candidateId);
  const candidateName = (c: RosterRow) =>
    [c.user.firstName, c.user.lastName].filter(Boolean).join(" ").trim() || "Interviewer";

  const close = () => {
    setOpen(false);
    setStep("pick");
    setCandidateId("");
    setNeedsOverride(false);
  };

  const submit = async (override: boolean) => {
    if (!seat || !candidate) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/hiring/interviews/${interviewId}/reassign`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assignmentId: seat.assignmentId,
          newCycleInterviewerId: candidate.id,
          ...(override && { override: true }),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string; availability?: string };
      if (res.ok) {
        toast.success(`${candidateName(candidate)} is now on this interview`);
        close();
        revalidator.revalidate();
        return;
      }
      if (
        res.status === 409 &&
        body.availability &&
        canOverrideAvailability(body.availability as InterviewerAvailability) &&
        !override
      ) {
        setNeedsOverride(true);
        return;
      }
      toast.error(body.error ?? "Couldn't replace the interviewer");
    } finally {
      setBusy(false);
    }
  };

  if (seats.length === 0) return null;

  return (
    <>
      <IconButton label="Replace co-interviewer" icon={Repeat2} onClick={() => setOpen(true)} />
      <Modal open={open} onClose={close} labelledBy={titleId} disableEscape={busy}>
        <ModalHeader
          titleId={titleId}
          title="Replace co-interviewer"
          subtitle="For when your co-interviewer can't make it. They and the replacement both get an email."
          onClose={close}
        />
        {step === "pick" ? (
          <div className="flex flex-col gap-4">
            {seats.length > 1 && (
              <div>
                <div className="os-field-label">Who's not coming</div>
                <div className="mt-1">
                  <Select
                    value={seatId}
                    onChange={(v) => {
                      setSeatId(v);
                      setCandidateId("");
                    }}
                    ariaLabel="Interviewer to replace"
                    options={seats.map((s) => ({ value: s.assignmentId, label: s.interviewerName }))}
                  />
                </div>
              </div>
            )}
            <div>
              <div className="os-field-label">Replacement</div>
              <div className="mt-1">
                <Select
                  value={candidateId}
                  onChange={setCandidateId}
                  ariaLabel="Replacement interviewer"
                  placeholder={roster == null ? "Loading…" : "Pick an interviewer"}
                  disabled={roster == null}
                  options={candidates.map((c) => ({
                    value: c.id,
                    label: candidateName(c),
                    description: c.domain.name,
                  }))}
                />
              </div>
              {roster != null && candidates.length === 0 && (
                <p className="mt-2 text-sm text-os-grey">No eligible interviewers for this seat.</p>
              )}
            </div>
            <ModalFooter onCancel={close}>
              <Button disabled={!candidate} onClick={() => setStep("confirm")}>
                Continue
              </Button>
            </ModalFooter>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-sm text-foreground">
              Replace <span className="font-medium">{seat?.interviewerName}</span> with{" "}
              <span className="font-medium">{candidate ? candidateName(candidate) : ""}</span> on this
              interview?
            </p>
            {needsOverride && (
              <p className="rounded-os-item bg-os-amber/10 px-3 py-2 text-sm text-foreground">
                Their calendar doesn't show them free at this time. Replace anyway?
              </p>
            )}
            <ModalFooter onCancel={() => (busy ? undefined : setStep("pick"))} cancelLabel="Back" cancelDisabled={busy}>
              <Button disabled={busy} onClick={() => submit(needsOverride)}>
                {busy ? "Replacing…" : needsOverride ? "Replace anyway" : "Replace"}
              </Button>
            </ModalFooter>
          </div>
        )}
      </Modal>
    </>
  );
}
