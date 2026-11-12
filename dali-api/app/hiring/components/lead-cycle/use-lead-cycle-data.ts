import { useState, useEffect, useCallback } from "react";
import { useToast } from "~/components/ui/toast";
import { useDialog } from "~/components/ui/dialog";
import { zonedDayStartUtc, APPLICATION_TZ } from "~/lib/timezone";
import { STATUS_LABELS } from "~/hiring/lib/labels";
import type { InterviewConfig, RoomHoldConflict, CycleReviewer, CycleInterviewer, InterviewRow, PendingInviteRow } from "~/hiring/lib/lead-cycle-types";
import type { CoverageData } from "~/hiring/components/lead-cycle/InterviewCoverage";

export const STATUS_FLOW = ["Draft", "Open", "UnderReview", "Completed"] as const;

const DEFAULT_CONFIG: InterviewConfig = {
  slotDurationMinutes: 30,
  bufferMinutes: 15,
  dayStartHour: 9,
  dayEndHour: 18,
  interviewStartDate: "",
  interviewEndDate: "",
  rescheduleNoticeHours: 12,
  cancelNoticeHours: 0,
  bookingNoticeHours: 12,
  timezone: APPLICATION_TZ,
  roomIds: [],
  holdRooms: false,
};

const personLabel = (
  user: { firstName: string | null; lastName: string | null; daliEmail: string | null } | null | undefined,
  fallback: string,
) => (user?.firstName && user?.lastName ? `${user.firstName} ${user.lastName}` : user?.daliEmail ?? fallback);

export function useLeadCycleData({
  cycleId,
  viewRoundId,
  isMemberCycle,
  hasInterviews,
  initialStatus,
  revalidateKey,
}: {
  cycleId: string | undefined;
  viewRoundId: string;
  isMemberCycle: boolean;
  hasInterviews: boolean;
  initialStatus: string;
  revalidateKey: unknown;
}) {
  const toast = useToast();
  const dialog = useDialog();

  const [config, setConfig] = useState<InterviewConfig>(DEFAULT_CONFIG);
  const [configSaved, setConfigSaved] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);
  const [availableRooms, setAvailableRooms] = useState<{ id: string; name: string }[]>([]);
  const [holdConflicts, setHoldConflicts] = useState<RoomHoldConflict[] | null>(null);
  const [reviewers, setReviewers] = useState<CycleReviewer[]>([]);
  const [interviewers, setInterviewers] = useState<CycleInterviewer[]>([]);
  const [interviews, setInterviews] = useState<InterviewRow[]>([]);
  const [pendingInvites, setPendingInvites] = useState<PendingInviteRow[]>([]);
  const [coverage, setCoverage] = useState<CoverageData | null>(null);
  const [cycleStatus, setCycleStatus] = useState<string>(initialStatus);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    if (!cycleId) return;
    try {
      const r = await fetch(`/api/hiring/cycles/${cycleId}/status`, { credentials: "include" });
      if (!r.ok) return;
      const data = await r.json();
      if (data) setCycleStatus(data.currentStatus);
    } catch {}
  }, [cycleId]);

  const loadConfig = useCallback(async () => {
    if (!cycleId) return;
    try {
      const r = await fetch(`/api/hiring/cycles/${cycleId}/interview-config?round=${viewRoundId}`, { credentials: "include" });
      if (!r.ok) return;
      const data = await r.json();
      if (data) {
        setConfig({
          ...data,
          interviewStartDate: data.interviewStartDate?.slice(0, 10) ?? "",
          interviewEndDate: data.interviewEndDate?.slice(0, 10) ?? "",
          roomIds: (data.rooms ?? []).map((room: { id: string }) => room.id),
          holdRooms: !!data.holdRooms,
        });
      }
    } catch {}
  }, [cycleId, viewRoundId]);

  const loadRooms = useCallback(async () => {
    try {
      const r = await fetch("/api/rooms", { credentials: "include" });
      if (!r.ok) return;
      const data = await r.json();
      setAvailableRooms(data?.rooms ?? []);
    } catch {}
  }, []);

  const loadReviewers = useCallback(async () => {
    if (!cycleId) return;
    try {
      const r = await fetch(`/api/hiring/cycles/${cycleId}/reviewers`, { credentials: "include" });
      setReviewers(r.ok ? await r.json() : []);
    } catch {}
  }, [cycleId]);

  const loadInterviewers = useCallback(async () => {
    if (!cycleId) return;
    try {
      const r = await fetch(`/api/hiring/cycles/${cycleId}/interviewers?round=${viewRoundId}`, { credentials: "include" });
      setInterviewers(r.ok ? await r.json() : []);
    } catch {}
  }, [cycleId, viewRoundId]);

  const loadInterviews = useCallback(async () => {
    if (!cycleId) return;
    try {
      const r = await fetch(`/api/hiring/cycles/${cycleId}/interviews?round=${viewRoundId}`, { credentials: "include" });
      if (!r.ok) {
        setInterviews([]);
        setPendingInvites([]);
        return;
      }
      const body = await r.json();
      setInterviews(Array.isArray(body) ? body : (body.interviews ?? []));
      setPendingInvites(Array.isArray(body) ? [] : (body.pending ?? []));
    } catch {}
  }, [cycleId, viewRoundId]);

  const loadCoverage = useCallback(async () => {
    if (!cycleId) return;
    try {
      const r = await fetch(`/api/hiring/cycles/${cycleId}/coverage?round=${viewRoundId}`, { credentials: "include" });
      setCoverage(r.ok ? await r.json() : null);
    } catch {}
  }, [cycleId, viewRoundId]);

  useEffect(() => {
    if (!cycleId) return;
    loadStatus();
    if (!isMemberCycle) loadReviewers();
    if (hasInterviews) {
      loadConfig();
      loadRooms();
      loadInterviewers();
      loadInterviews();
      loadCoverage();
    }
  }, [cycleId, isMemberCycle, hasInterviews, loadStatus, loadConfig, loadRooms, loadReviewers, loadInterviewers, loadInterviews, loadCoverage]);

  useEffect(() => {
    if (!cycleId) return;
    if (!isMemberCycle) loadReviewers();
    if (hasInterviews) loadInterviewers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revalidateKey]);

  async function advanceStatus(force = false) {
    if (!cycleId) return;
    const idx = STATUS_FLOW.findIndex((s) => s === cycleStatus);
    if (idx < 0 || idx >= STATUS_FLOW.length - 1) return;
    const next = STATUS_FLOW[idx + 1];
    setStatusUpdating(true);
    setStatusError(null);
    try {
      const res = await fetch(`/api/hiring/cycles/${cycleId}/status`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ newStatus: next, force }),
      });
      if (res.ok) {
        setCycleStatus(next);
        loadInterviews();
      } else {
        const body = await res.json().catch(() => ({}));
        setStatusError(body.error ?? `Couldn't advance to ${STATUS_LABELS[next] ?? next} (HTTP ${res.status}).`);
      }
    } catch (e) {
      setStatusError(e instanceof Error && e.message ? e.message : "Network error advancing status.");
    } finally {
      setStatusUpdating(false);
    }
  }

  async function saveConfig(overrideConflicts = false) {
    if (!cycleId) return;
    setConfigSaving(true);
    try {
      const toZonedMidnightIso = (ymd: string): string => {
        const [y, m, d] = ymd.split("-").map(Number);
        return zonedDayStartUtc(y, m, d, config.timezone).toISOString();
      };
      const payload = {
        ...config,
        interviewStartDate: config.interviewStartDate ? toZonedMidnightIso(config.interviewStartDate) : config.interviewStartDate,
        interviewEndDate: config.interviewEndDate ? toZonedMidnightIso(config.interviewEndDate) : config.interviewEndDate,
        overrideConflicts,
        interviewRoundId: viewRoundId,
      };
      const res = await fetch(`/api/hiring/cycles/${cycleId}/interview-config`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        setHoldConflicts(null);
        setConfigSaved(true);
        setTimeout(() => setConfigSaved(false), 2000);
        if (overrideConflicts) {
          const peopleCount = new Set(
            (holdConflicts ?? []).flatMap((c) => c.items.map((i) => `${i.organizer.firstName} ${i.organizer.lastName}`)),
          ).size;
          toast.success(`Rooms held. ${peopleCount} people were told.`);
        }
      } else if (res.status === 409) {
        const data = await res.json().catch(() => null);
        if (data?.conflicts) setHoldConflicts(data.conflicts);
      }
    } finally {
      setConfigSaving(false);
    }
  }

  function keepTheirBookings() {
    setHoldConflicts(null);
    toast.info("Hold not applied");
  }

  async function addReviewer(userId: string, domainId: string) {
    if (!cycleId) return;
    const res = await fetch(`/api/hiring/cycles/${cycleId}/reviewers`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, domainId }),
    });
    if (res.ok) await loadReviewers();
  }

  async function removeReviewer(reviewerId: string) {
    if (!cycleId) return;
    const reviewer = reviewers.find((r) => r.id === reviewerId);
    const name = reviewer ? personLabel(reviewer.user, "this reviewer") : "this reviewer";
    if (
      !(await dialog.confirm({
        title: `Remove ${name} as a reviewer?`,
        description: "They will no longer be assignable to applicants in this domain. Any reviews already submitted will be deleted.",
        confirmLabel: "Remove reviewer",
        tone: "destructive",
      }))
    )
      return;
    const res = await fetch(`/api/hiring/cycles/${cycleId}/reviewers/${reviewerId}`, {
      method: "DELETE",
      credentials: "include",
    });
    if (res.ok) setReviewers((prev) => prev.filter((r) => r.id !== reviewerId));
  }

  async function addInterviewer(userId: string, domainId: string) {
    if (!cycleId) return;
    const res = await fetch(`/api/hiring/cycles/${cycleId}/interviewers`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, domainId, interviewRoundId: viewRoundId }),
    });
    if (res.ok) await loadInterviewers();
  }

  async function removeInterviewer(interviewerId: string) {
    if (!cycleId) return;
    const interviewer = interviewers.find((i) => i.id === interviewerId);
    const name = interviewer ? personLabel(interviewer.user, "this interviewer") : "this interviewer";
    if (
      !(await dialog.confirm({
        title: `Remove ${name} as an interviewer?`,
        confirmLabel: "Remove interviewer",
        tone: "destructive",
      }))
    )
      return;
    const res = await fetch(`/api/hiring/cycles/${cycleId}/interviewers`, {
      method: "DELETE",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ interviewerId }),
    });
    if (res.ok) setInterviewers((prev) => prev.filter((i) => i.id !== interviewerId));
  }

  return {
    config,
    setConfig,
    configSaved,
    configSaving,
    availableRooms,
    holdConflicts,
    reviewers,
    interviewers,
    interviews,
    setInterviews,
    pendingInvites,
    coverage,
    cycleStatus,
    setCycleStatus,
    statusUpdating,
    statusError,
    setStatusError,
    loadInterviews,
    loadInterviewers,
    loadCoverage,
    advanceStatus,
    saveConfig,
    keepTheirBookings,
    addReviewer,
    removeReviewer,
    addInterviewer,
    removeInterviewer,
  };
}

export type LeadCycleDataState = ReturnType<typeof useLeadCycleData>;
