import { useState, useEffect, useCallback } from "react";
import { redirect, useLoaderData, useRevalidator, useSearchParams, Link } from "react-router";
import type { Route } from "./+types/portal";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { getActiveCycle } from "~/hiring/lib/cycles";
import {
  inferDomainApplicationStatus,
  domainApplicationStatusInclude,
} from "~/hiring/lib/domain-application-status";
import type { DomainApplicationStatus } from "~/types";
import type { ApplicationCycleStatus } from "~/generated/prisma/enums";
import { InterviewSlotPicker } from "~/hiring/components/InterviewSlotPicker";
import { ApplicantErrorBoundary } from "~/components/ApplicantErrorBoundary";
import { Confetti } from "~/components/Confetti";
import { formatInterviewDate, formatInterviewTimeRange } from "~/hiring/lib/interview-time";

export const meta: Route.MetaFunction = () => [{ title: "Applicant portal · DALI OS" }];

// ─── Loader ──────────────────────────────────────────────────────────────────

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return withAuth(auth, redirect("/login"));

  const emptyResult = {
    cycleName: null as string | null,
    cycleId: null as string | null,
    cycleStatus: null as string | null,
    closeDate: null as string | null,
    domainApplications: [] as any[],
    slotDurationMinutes: 30,
    hasApplication: false,
    applicationStatus: null as string | null,
  };

  // Try the active cycle first (same as reviewer/interviewer dashboards).
  // If no active cycle, fall back to the user's most recent application's
  // cycle — this keeps the portal visible after a cycle moves to Completed.
  const active = await getActiveCycle();
  let cycleId: string;
  let cycleName: string;
  let cycleStatus: ApplicationCycleStatus;
  let closeDate: string | null = null;

  if (active) {
    cycleId = active.id;
    cycleName = active.name;
    cycleStatus = active.currentStatus as ApplicationCycleStatus;
    closeDate = active.closeDate ? active.closeDate.toISOString() : null;
  } else {
    const recentApp = await prisma.application.findFirst({
      where: { userId: auth.user.sub },
      include: {
        applicationCycle: {
          include: { statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 } },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    if (!recentApp) return withAuth(auth, emptyResult);

    cycleId = recentApp.applicationCycleId;
    cycleName = recentApp.applicationCycle.name;
    cycleStatus = (recentApp.applicationCycle.statusUpdates[0]?.newStatus ?? "Draft") as ApplicationCycleStatus;
    closeDate = recentApp.applicationCycle.closeDate ? recentApp.applicationCycle.closeDate.toISOString() : null;
  }

  const application = await prisma.application.findFirst({
    where: { userId: auth.user.sub, applicationCycleId: cycleId },
    include: {
      statusUpdates: true,
      domainApplications: {
        where: { selected: true },
        include: {
          ...domainApplicationStatusInclude,
          challengeVersion: { include: { domain: true } },
        },
      },
    },
  });

  const config = await prisma.interviewConfig.findUnique({
    where: { applicationCycleId: cycleId },
  });

  // Use the most recent status update so Withdrawn (which always follows Submitted)
  // takes precedence over the earlier Submitted/Draft entries.
  const latestStatus = application?.statusUpdates
    .slice()
    .sort((a: any, b: any) => b.createdAt.getTime() - a.createdAt.getTime())[0]?.newStatus;
  const appStatus = latestStatus === "Withdrawn"
    ? "Withdrawn"
    : application?.statusUpdates.some((u: any) => u.newStatus === "Submitted")
      ? "Submitted"
      : application
        ? "Draft"
        : null;

  // Compute per-domain-application status using inferDomainApplicationStatus
  const domainApplications = (application?.domainApplications ?? []).map((da: any) => {
    const inferredStatus = inferDomainApplicationStatus(
      { ...da, application: { statusUpdates: application!.statusUpdates } } as any,
      cycleStatus,
    );

    // Find active interview for this DA (filtered to Scheduled/Completed by the include)
    const activeInterview = da.interviews?.find(
      (i: any) => i.status === "Scheduled",
    );

    return {
      id: da.id,
      domainName: da.challengeVersion?.domain?.name ?? "Unknown",
      domainId: da.challengeVersion?.domainId,
      inferredStatus,
      interview: activeInterview
        ? { id: activeInterview.id, startTime: activeInterview.startTime, endTime: activeInterview.endTime, status: activeInterview.status, location: activeInterview.location, zoomJoinUrl: activeInterview.zoomJoinUrl }
        : null,
    };
  });

  return withAuth(auth, {
      cycleName,
      cycleId,
      cycleStatus,
      closeDate,
      domainApplications,
      slotDurationMinutes: config?.slotDurationMinutes ?? 30,
      hasApplication: !!application,
      applicationStatus: appStatus,
    });
}

// ─── Types ───────────────────────────────────────────────────────────────────

interface DomainAppData {
  id: string;
  domainName: string;
  domainId: string;
  inferredStatus: DomainApplicationStatus;
  interview: { id: string; startTime: string; endTime: string; status: string; location?: string; zoomJoinUrl?: string | null } | null;
}

interface TimeSlot {
  id: string;
  date: string;
  time: string;
  isoStart: string;
  isoEnd: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function apiSlotToTimeSlot(slot: { startTime: string; endTime: string }, index: number): TimeSlot {
  return {
    id: `slot-${index}`,
    date: formatInterviewDate(slot.startTime),
    time: formatInterviewTimeRange(slot.startTime, slot.endTime),
    isoStart: slot.startTime,
    isoEnd: slot.endTime,
  };
}

function groupSlotsByDate(slots: TimeSlot[]): { date: string; slots: TimeSlot[] }[] {
  const map = new Map<string, TimeSlot[]>();
  for (const s of slots) {
    const group = map.get(s.date) ?? [];
    group.push(s);
    map.set(s.date, group);
  }
  return Array.from(map.entries()).map(([date, slots]) => ({ date, slots }));
}

function formatInterviewLocation(location?: string): string {
  if (location === "PodAppa") return "Pod Appa, DALI Lab";
  if (location === "PodMomo") return "Pod Momo, DALI Lab";
  return "Online";
}

function formatDeadline(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: "America/New_York",
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function formatRemaining(iso: string): { label: string; tone: "urgent" | "warn" | "ok" } | null {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  if (ms > 7 * 86_400_000) return null;
  const days = Math.floor(ms / 86_400_000);
  const hours = Math.floor(ms / 3_600_000);
  if (days >= 2) return { label: `${days} days remaining`, tone: "ok" };
  if (hours >= 24) return { label: "1 day remaining", tone: "warn" };
  if (hours >= 1) return { label: `Closes in ${hours} hour${hours === 1 ? "" : "s"}`, tone: "urgent" };
  const mins = Math.max(1, Math.floor(ms / 60_000));
  return { label: `Closes in ${mins} minute${mins === 1 ? "" : "s"}`, tone: "urgent" };
}

// Deadline rendering happens after hydration so toLocaleString uses the
// browser's locale/timezone without producing an SSR/CSR text mismatch.
function DeadlineLine({ closeDate }: { closeDate: string }) {
  const [label, setLabel] = useState<string>("");
  const [remaining, setRemaining] = useState<{ label: string; tone: "urgent" | "warn" | "ok" } | null>(null);
  useEffect(() => {
    setLabel(formatDeadline(closeDate));
    const tick = () => setRemaining(formatRemaining(closeDate));
    tick();
    const id = setInterval(tick, 60_000);
    return () => clearInterval(id);
  }, [closeDate]);
  if (!label) return null;
  const toneStyles: Record<"urgent" | "warn" | "ok", string> = {
    urgent: "text-red-700",
    warn: "text-yellow-800",
    ok: "text-muted-foreground",
  };
  return (
    <div className={`text-sm mt-2 flex items-center gap-2 flex-wrap ${remaining ? toneStyles[remaining.tone] : "text-muted-foreground"}`}>
      <span>Applications close on {label}</span>
      {remaining && (
        <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${
          remaining.tone === "urgent" ? "bg-red-100 text-red-700" :
          remaining.tone === "warn" ? "bg-yellow-100 text-yellow-800" :
          "bg-blue-100 text-blue-700"
        }`}>
          {remaining.label}
        </span>
      )}
    </div>
  );
}

// ─── Shared UI ───────────────────────────────────────────────────────────────

const cardBg = "bg-[#E8F4FA]";

function StatusBadge({ label, variant }: { label: string; variant: "blue" | "green" | "yellow" | "red" | "gray" }) {
  const styles: Record<string, string> = {
    blue: "bg-blue-100 text-blue-700",
    green: "bg-green-100 text-green-700",
    yellow: "bg-yellow-100 text-yellow-800",
    red: "bg-red-100 text-red-700",
    gray: "bg-muted text-muted-foreground",
  };
  return (
    <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold ${styles[variant]}`}>
      {label}
    </span>
  );
}

function PulsingDot({ color }: { color: string }) {
  return <span className={`w-2 h-2 rounded-full ${color} animate-pulse`} />;
}

function StageIndicator({ stage }: { stage: DomainApplicationStatus | "ApplicationsClosed" }) {
  const steps: { label: string; keys: (DomainApplicationStatus | "ApplicationsClosed")[] }[] = [
    { label: "Applied", keys: ["ApplicationOpen"] },
    { label: "Review", keys: ["Pending"] },
    { label: "Interview", keys: ["InvitedToInterview", "InterviewScheduled", "PostInterviewPending", "Withdrawn"] },
    { label: "Decision", keys: ["Accepted", "Rejected", "Waitlisted"] },
  ];

  const currentStep = steps.find(s => s.keys.includes(stage));
  if (!currentStep) return null;

  return (
    <div className="px-2.5 py-1 rounded-full text-xs font-medium bg-accent-teal text-white">
      {currentStep.label}
    </div>
  );
}

// ─── Stage Views ─────────────────────────────────────────────────────────────

function ApplicationOpenView({ cycleName, closeDate }: { cycleName: string; closeDate: string | null }) {
  return (
    <div className="max-w-2xl mx-auto text-center py-16">
      <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-accent-green/30 flex items-center justify-center">
        <svg className="w-8 h-8 text-accent-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </div>
      <h2 className="font-heading text-2xl font-bold text-dark-blue mb-3">Applications Are Open</h2>
      <p className="text-muted-foreground mb-8 leading-relaxed">
        The {cycleName} application cycle is now accepting applications. Start yours to join the DALI Lab!
      </p>
      <Link to="/portal/apply" className="px-8 py-3 rounded-full bg-accent-coral text-white font-semibold font-heading tracking-wider hover:bg-accent-coral/90 transition shadow-lg hover:shadow-xl">
        Start Application
      </Link>
    </div>
  );
}

function ApplicationDraftView({ cycleName, closeDate }: { cycleName: string; closeDate: string | null }) {
  return (
    <div className="max-w-2xl mx-auto text-center py-16">
      <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-accent-green/30 flex items-center justify-center">
        <svg className="w-8 h-8 text-accent-teal" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      </div>
      <h2 className="font-heading text-2xl font-bold text-dark-blue mb-3">Application In Progress</h2>
      <p className="text-muted-foreground mb-8 leading-relaxed">
        You have a draft application for {cycleName}. Complete and submit it to be considered!
      </p>
      <Link to="/portal/apply" className="px-8 py-3 rounded-full bg-accent-coral text-white font-semibold font-heading tracking-wider hover:bg-accent-coral/90 transition shadow-lg hover:shadow-xl">
        Continue Application
      </Link>
    </div>
  );
}

function WithdrawnView({ cycleName }: { cycleName: string }) {
  return (
    <div className="max-w-2xl mx-auto py-12">
      <div className="text-center mb-6">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-muted flex items-center justify-center">
          <svg className="w-8 h-8 text-muted-foreground/70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </div>
        <h2 className="font-heading text-2xl font-bold text-dark-blue mb-3">Application Withdrawn</h2>
        <p className="text-muted-foreground leading-relaxed">
          You withdrew your application for {cycleName}. If you change your mind, contact the DALI team.
        </p>
        <div className="mt-4">
          <Link to="/portal/application" className="text-sm text-accent-coral hover:underline">
            View your submission →
          </Link>
        </div>
      </div>
    </div>
  );
}

function PendingView({ cycleName }: { cycleName: string }) {
  return (
    <div className="max-w-2xl mx-auto py-12">
      <div className="text-center mb-10">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-yellow-100 flex items-center justify-center">
          <svg className="w-8 h-8 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="font-heading text-2xl font-bold text-dark-blue mb-3">Application Pending Review</h2>
        <p className="text-muted-foreground leading-relaxed">
          Your application is being reviewed by the DALI team. We'll update you here once a decision has been made.
        </p>
        <div className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-full bg-yellow-50 text-sm text-yellow-700">
          <PulsingDot color="bg-yellow-500" />
          Pending
        </div>
      </div>
    </div>
  );
}

function RejectedView({ cycleName }: { cycleName: string }) {
  const [feedbackRequested, setFeedbackRequested] = useState(false);

  return (
    <div className="max-w-2xl mx-auto py-12">
      <div className="text-center mb-10">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-muted flex items-center justify-center">
          <svg className="w-8 h-8 text-muted-foreground/70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 12H4" />
          </svg>
        </div>
        <h2 className="font-heading text-2xl font-bold text-dark-blue mb-3">Thank You for Applying</h2>
        <p className="text-muted-foreground leading-relaxed max-w-lg mx-auto">
          Unfortunately, we are unable to move your application forward for {cycleName}. The applicant pool was extremely competitive this cycle.
        </p>
      </div>

      <div className={`px-6 py-5 rounded-2xl ${cardBg}`}>
        <h3 className="font-heading text-sm font-bold text-dark-blue uppercase tracking-wider mb-2">
          Want to know more?
        </h3>
        <p className="text-sm text-muted-foreground mb-4">
          You can request feedback on your application. A member of the DALI team will follow up with you via email.
        </p>
        {feedbackRequested ? (
          <div className="flex items-center gap-2 text-sm text-green-600 font-medium">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Feedback requested — we'll be in touch soon.
          </div>
        ) : (
          <button
            onClick={() => setFeedbackRequested(true)}
            className="px-5 py-2 rounded-full border-2 border-accent-coral text-accent-coral text-sm font-semibold hover:bg-accent-coral hover:text-white transition"
          >
            Request Feedback
          </button>
        )}
      </div>
    </div>
  );
}

function InvitedToInterviewView({
  domainApp,
  cycleId,
  cycleName,
  onBooked,
}: {
  domainApp: DomainAppData;
  cycleId: string;
  cycleName: string;
  onBooked: () => void;
}) {
  const [slots, setSlots] = useState<TimeSlot[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!domainApp.domainId) return;
    setLoadingSlots(true);
    fetch(`/api/hiring/cycles/${cycleId}/available-slots?domainId=${domainApp.domainId}&mode=in-person`, {
      credentials: "include",
    })
      .then(r => r.ok ? r.json() : [])
      .then((apiSlots: { startTime: string; endTime: string }[]) => {
        setSlots(apiSlots.map(apiSlotToTimeSlot));
      })
      .catch(() => {})
      .finally(() => setLoadingSlots(false));
  }, [cycleId, domainApp.domainId]);

  const grouped = groupSlotsByDate(slots);
  const slot = slots.find(s => s.id === selectedSlot);

  async function handleConfirm() {
    if (!slot) return;
    setBooking(true);
    setError(null);
    try {
      const res = await fetch(`/api/hiring/domain-applications/${domainApp.id}/schedule-interview`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startTime: slot.isoStart, mode: "in-person" }),
      });
      if (res.ok) {
        onBooked();
      } else {
        const body = await res.json().catch(() => ({}));
        setError(body.error ?? "Failed to book this slot. It may have been taken.");
        // Re-fetch slots since they may have changed
        const slotsRes = await fetch(`/api/hiring/cycles/${cycleId}/available-slots?domainId=${domainApp.domainId}&mode=in-person`, { credentials: "include" });
        if (slotsRes.ok) {
          const freshSlots = await slotsRes.json();
          setSlots(freshSlots.map(apiSlotToTimeSlot));
          setSelectedSlot(null);
        }
      }
    } finally {
      setBooking(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto py-12">
      <div className="text-center mb-10">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-accent-green/30 flex items-center justify-center">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
        <h2 className="font-heading text-2xl font-bold text-dark-blue mb-3">You're Invited to Interview!</h2>
        <p className="text-muted-foreground leading-relaxed">
          Congratulations! The DALI team would like to interview you for <span className="font-medium text-dark-blue">{domainApp.domainName}</span>. Please select a time slot below.
        </p>
      </div>

      {error && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {loadingSlots ? (
        <div className={`px-6 py-8 rounded-2xl ${cardBg} text-center`}>
          <p className="text-muted-foreground">Loading available times...</p>
        </div>
      ) : slots.length === 0 ? (
        <div className={`px-6 py-8 rounded-2xl ${cardBg} text-center`}>
          <p className="text-muted-foreground">No interview slots are available yet. The DALI team is still setting up interview times — check back soon.</p>
        </div>
      ) : (
        <>
          <div className="mb-8">
            <InterviewSlotPicker
              groups={grouped}
              variant="selectable"
              selectedSlotId={selectedSlot}
              onSelect={(s) => setSelectedSlot(s.id)}
            />
          </div>

          <button
            onClick={handleConfirm}
            disabled={!selectedSlot || booking}
            className="px-6 py-2.5 rounded-full bg-accent-coral text-white text-sm font-semibold hover:bg-accent-coral/90 transition disabled:opacity-50"
          >
            {booking ? "Booking..." : "Confirm Time"}
          </button>
        </>
      )}

      <p className="text-sm text-muted-foreground mt-6">
        Can't attend in-person?{" "}
        <a href="mailto:applications@dali.dartmouth.edu" className="underline text-dark-blue hover:text-accent-coral">
          Email applications@dali.dartmouth.edu
        </a>{" "}
        to request an online interview.
      </p>
    </div>
  );
}

function InterviewScheduledView({
  domainApp,
  cycleId,
  cycleName,
  slotDurationMinutes,
  onCancelled,
  onRescheduled,
}: {
  domainApp: DomainAppData;
  cycleId: string;
  cycleName: string;
  slotDurationMinutes: number;
  onCancelled: () => void;
  onRescheduled: () => void;
}) {
  const interview = domainApp.interview!;
  const slot = apiSlotToTimeSlot(interview, 0);
  const [rescheduling, setRescheduling] = useState(false);
  const [rescheduleSlots, setRescheduleSlots] = useState<TimeSlot[]>([]);
  const [loadingRescheduleSlots, setLoadingRescheduleSlots] = useState(false);
  const [selectedRescheduleSlotId, setSelectedRescheduleSlotId] = useState<string | null>(null);
  const [confirmingReschedule, setConfirmingReschedule] = useState(false);
  const [rescheduleError, setRescheduleError] = useState<string | null>(null);
  const [declining, setDeclining] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  useEffect(() => {
    if (!rescheduling) return;
    setLoadingRescheduleSlots(true);
    const mode = interview.location === "Online" ? "online" : "in-person";
    fetch(`/api/hiring/cycles/${cycleId}/available-slots?domainId=${domainApp.domainId}&mode=${mode}`, { credentials: "include" })
      .then(r => r.ok ? r.json() : [])
      .then((apiSlots: { startTime: string; endTime: string }[]) => {
        setRescheduleSlots(
          apiSlots.map(apiSlotToTimeSlot).filter(s => s.isoStart !== slot.isoStart),
        );
      })
      .catch(() => {})
      .finally(() => setLoadingRescheduleSlots(false));
  }, [rescheduling, cycleId, domainApp.domainId, slot.isoStart]);

  async function handleCancel() {
    setCancelling(true);
    const res = await fetch("/api/hiring/my-interview/cancel", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ domainApplicationId: domainApp.id }),
    });
    if (res.ok) {
      onCancelled();
    } else {
      const body = await res.json().catch(() => ({}));
      setCancelError(body.error ?? "Failed to cancel interview.");
      setDeclining(false);
    }
    setCancelling(false);
  }

  function exitRescheduling() {
    setRescheduling(false);
    setSelectedRescheduleSlotId(null);
    setRescheduleError(null);
  }

  async function handleConfirmReschedule() {
    const newSlot = rescheduleSlots.find(s => s.id === selectedRescheduleSlotId);
    if (!newSlot) return;
    setConfirmingReschedule(true);
    setRescheduleError(null);
    const mode = interview.location === "Online" ? "online" : "in-person";
    try {
      const newEnd = new Date(new Date(newSlot.isoStart).getTime() + slotDurationMinutes * 60_000).toISOString();
      const res = await fetch("/api/hiring/my-interview/reschedule", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ domainApplicationId: domainApp.id, newStart: newSlot.isoStart, newEnd, mode }),
      });
      if (res.ok) {
        setSelectedRescheduleSlotId(null);
        setRescheduling(false);
        onRescheduled();
      } else {
        const body = await res.json().catch(() => ({}));
        setRescheduleError(body.error ?? "Failed to reschedule. The slot may have been taken.");
        const slotsRes = await fetch(`/api/hiring/cycles/${cycleId}/available-slots?domainId=${domainApp.domainId}&mode=${mode}`, { credentials: "include" });
        if (slotsRes.ok) {
          const freshSlots = await slotsRes.json();
          setRescheduleSlots(
            freshSlots.map(apiSlotToTimeSlot).filter((s: TimeSlot) => s.isoStart !== slot.isoStart),
          );
          setSelectedRescheduleSlotId(null);
        }
      }
    } finally {
      setConfirmingReschedule(false);
    }
  }

  if (rescheduling) {
    const grouped = groupSlotsByDate(rescheduleSlots);
    return (
      <div className="max-w-2xl mx-auto py-12">
        <h2 className="font-heading text-xl font-bold text-dark-blue mb-2">Reschedule Interview</h2>
        <p className="text-sm text-muted-foreground mb-6">
          Currently scheduled: <strong>{slot.date}, {slot.time}</strong> ({formatInterviewLocation(interview.location)}). Choose a format and new time.
        </p>

        {rescheduleError && (
          <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
            {rescheduleError}
          </div>
        )}

        {loadingRescheduleSlots ? (
          <div className="px-6 py-8 rounded-2xl bg-muted/30 text-center mb-8">
            <p className="text-muted-foreground">Loading available times...</p>
          </div>
        ) : rescheduleSlots.length === 0 ? (
          <div className="px-6 py-8 rounded-2xl bg-muted/30 text-center mb-8">
            <p className="text-muted-foreground">No slots available. Check back later.</p>
          </div>
        ) : (
          <>
            <div className="mb-8">
              <InterviewSlotPicker
                groups={grouped}
                variant="selectable"
                selectedSlotId={selectedRescheduleSlotId}
                onSelect={(s) => setSelectedRescheduleSlotId(s.id)}
              />
            </div>

            <button
              onClick={handleConfirmReschedule}
              disabled={!selectedRescheduleSlotId || confirmingReschedule}
              className="px-6 py-2.5 rounded-full bg-accent-coral text-white text-sm font-semibold hover:bg-accent-coral/90 transition disabled:opacity-50 mr-3"
            >
              {confirmingReschedule ? "Rescheduling..." : "Confirm Reschedule"}
            </button>
          </>
        )}
        <button onClick={exitRescheduling} className="text-sm font-semibold text-muted-foreground hover:underline">
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto py-12">
      <div className="text-center mb-10">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-accent-green/30 flex items-center justify-center">
          <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2 className="font-heading text-2xl font-bold text-dark-blue mb-3">Interview Confirmed</h2>
        <p className="text-muted-foreground leading-relaxed">
          You're all set for your <span className="font-medium text-dark-blue">{domainApp.domainName}</span> interview!
        </p>
      </div>

      <div className={`px-6 py-6 rounded-2xl ${cardBg} mb-6`}>
        <div className="flex items-start justify-between mb-4">
          <div>
            <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Date & Time</span>
            <p className="text-lg font-bold text-dark-blue mt-1">{slot.date}</p>
            <p className="text-sm text-dark-blue">{slot.time}</p>
          </div>
          <StatusBadge label="Scheduled" variant="green" />
        </div>
        <div className="pt-4 border-t border-border/60">
          <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Location</span>
          <p className="text-sm text-dark-blue mt-1">{formatInterviewLocation(interview.location)}</p>
        </div>
        {interview.location === "Online" && interview.zoomJoinUrl && (
          <div className="pt-4 border-t border-border/60">
            <span className="text-xs text-muted-foreground uppercase tracking-wider font-medium">Meeting Link</span>
            <a href={interview.zoomJoinUrl} target="_blank" rel="noopener noreferrer"
               className="flex items-center gap-1.5 text-sm text-accent-coral hover:underline mt-1">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
              </svg>
              Join Meeting
            </a>
          </div>
        )}
      </div>

      <p className="text-sm text-muted-foreground mb-4">A calendar invite has been sent to your Dartmouth email.</p>

      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => setRescheduling(true)} className="px-5 py-2.5 rounded-full border-2 border-border text-sm font-semibold text-muted-foreground hover:border-accent-coral hover:text-accent-coral transition">
          Reschedule
        </button>
        {declining ? (
          <div className="rounded-xl border-2 border-red-200 bg-red-50 px-4 py-3 text-left space-y-2">
            <p className="text-sm font-semibold text-red-700">This action is final</p>
            <p className="text-xs text-red-600/80">Cancelling your interview will withdraw you from the interview process for this domain. You will not be able to rebook.</p>
            <div className="flex items-center gap-3 pt-1">
              <button onClick={handleCancel} disabled={cancelling} className="px-4 py-1.5 rounded-full bg-red-600 text-white text-sm font-semibold hover:bg-red-700 transition disabled:opacity-50">
                {cancelling ? "Cancelling..." : "Yes, withdraw"}
              </button>
              <button onClick={() => setDeclining(false)} className="text-sm font-semibold text-muted-foreground hover:underline">Go back</button>
            </div>
          </div>
        ) : (
          <button onClick={() => setDeclining(true)} className="text-sm font-semibold text-muted-foreground hover:text-red-500 transition">
            Cancel Interview
          </button>
        )}
        {cancelError && (
          <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {cancelError}
          </div>
        )}
      </div>
    </div>
  );
}

function PostInterviewPendingView() {
  return (
    <div className="max-w-2xl mx-auto py-12 text-center">
      <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-blue-100 flex items-center justify-center">
        <svg className="w-8 h-8 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
        </svg>
      </div>
      <h2 className="font-heading text-2xl font-bold text-dark-blue mb-3">Interview Complete</h2>
      <p className="text-muted-foreground leading-relaxed mb-4">
        Thanks for interviewing with us! The team is reviewing all candidates and will share a final decision soon.
      </p>
      <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-blue-50 text-sm text-blue-600">
        <PulsingDot color="bg-blue-500" />
        Decision pending
      </div>
    </div>
  );
}

function AcceptedView({ cycleName }: { cycleName: string }) {
  const CHECKLIST = [
    { id: "ob1", label: "Accept your offer", description: "Confirm your acceptance by clicking the button below." },
    { id: "ob2", label: "Complete the new member form", description: "Fill out the onboarding form sent to your email." },
    { id: "ob3", label: "Join the DALI Slack workspace", description: "Use the invite link in your acceptance email to join Slack." },
    { id: "ob4", label: "Set up your development environment", description: "Follow the setup guide pinned in #onboarding on Slack." },
    { id: "ob5", label: "Attend the kickoff meeting", description: "Check your email for date and location details." },
    { id: "ob6", label: "Complete intro training modules", description: "Finish the assigned training modules before Week 2." },
  ];

  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const completedCount = Object.values(checked).filter(Boolean).length;

  return (
    <div className="max-w-2xl mx-auto py-12">
      <div className="text-center mb-10">
        <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-accent-green/30 flex items-center justify-center">
          <svg className="w-10 h-10 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="font-heading text-3xl font-bold text-dark-blue mb-3">Congratulations!</h2>
        <p className="text-muted-foreground leading-relaxed text-lg">
          You've been accepted to DALI Lab for {cycleName}!
        </p>
      </div>

      <div className="mb-6">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-dark-blue">Onboarding Progress</span>
          <span className="text-sm text-muted-foreground">{completedCount}/{CHECKLIST.length}</span>
        </div>
        <div className="h-2 rounded-full bg-muted overflow-hidden">
          <div
            className="h-full rounded-full bg-accent-coral transition-all duration-400"
            style={{ width: `${(completedCount / CHECKLIST.length) * 100}%` }}
          />
        </div>
      </div>

      <div className="rounded-2xl border border-green-200 bg-gradient-to-br from-accent-green/5 to-accent-teal/5 overflow-hidden">
        <div className="px-6 py-4 border-b border-green-200/60">
          <h3 className="font-heading text-base font-bold text-dark-blue">Onboarding Checklist</h3>
        </div>
        <div className="divide-y divide-green-100">
          {CHECKLIST.map(item => (
            <label key={item.id} className="flex items-start gap-4 px-6 py-4 cursor-pointer hover:bg-green-50/50 transition">
              <input
                type="checkbox"
                checked={!!checked[item.id]}
                onChange={e => setChecked(prev => ({ ...prev, [item.id]: e.target.checked }))}
                className="mt-0.5 w-5 h-5 rounded accent-accent-coral flex-shrink-0"
              />
              <div>
                <span className={`text-sm font-semibold transition-colors ${checked[item.id] ? "text-muted-foreground/70 line-through" : "text-dark-blue"}`}>
                  {item.label}
                </span>
                <p className={`text-xs mt-0.5 transition-colors ${checked[item.id] ? "text-muted-foreground/50" : "text-muted-foreground"}`}>
                  {item.description}
                </p>
              </div>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}

function WaitlistedView({ cycleName }: { cycleName: string }) {
  return (
    <div className="max-w-2xl mx-auto py-12">
      <div className="text-center mb-10">
        <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-yellow-100 flex items-center justify-center">
          <svg className="w-8 h-8 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </div>
        <h2 className="font-heading text-2xl font-bold text-dark-blue mb-3">You're on the Waitlist</h2>
        <p className="text-muted-foreground leading-relaxed max-w-lg mx-auto">
          You performed well in the interview process and we'd love to have you at DALI. We've placed you on the waitlist for {cycleName} and will reach out if a spot becomes available.
        </p>
      </div>

      <div className={`px-6 py-5 rounded-2xl ${cardBg}`}>
        <h3 className="font-heading text-sm font-bold text-dark-blue uppercase tracking-wider mb-3">What this means</h3>
        <ul className="space-y-2 text-sm text-muted-foreground">
          <li className="flex items-start gap-2">
            <span className="text-accent-teal mt-0.5">-</span>
            <span>If a spot opens, we'll contact you by email. No action needed on your part.</span>
          </li>
          <li className="flex items-start gap-2">
            <span className="text-accent-teal mt-0.5">-</span>
            <span>Waitlisted candidates are often extended offers for the following cycle.</span>
          </li>
        </ul>
      </div>
    </div>
  );
}

// ─── Per-Domain Card ────────────────────────────────────────────────────────

function DomainApplicationCard({
  da,
  cycleId,
  cycleName,
  slotDurationMinutes,
  onRevalidate,
}: {
  da: DomainAppData;
  cycleId: string;
  cycleName: string;
  slotDurationMinutes: number;
  onRevalidate: () => void;
}) {
  const stage = da.inferredStatus;
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div className="rounded-2xl border border-gray-200 overflow-hidden">
      <button
        type="button"
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full bg-[#E8F4FA] px-6 py-4 flex items-center justify-between cursor-pointer"
      >
        <h3 className="font-heading text-base font-bold text-dark-blue">{da.domainName}</h3>
        <div className="flex items-center gap-3">
          <StageIndicator stage={stage} />
          <svg
            className={`w-5 h-5 text-gray-500 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>
      {isExpanded && (
        <div className="px-2">
          {stage === "Pending" && <PendingView cycleName={cycleName} />}
          {stage === "Rejected" && <RejectedView cycleName={cycleName} />}
          {stage === "InvitedToInterview" && (
            <InvitedToInterviewView domainApp={da} cycleId={cycleId} cycleName={cycleName} onBooked={onRevalidate} />
          )}
          {stage === "InterviewScheduled" && (
            <InterviewScheduledView
              domainApp={da}
              cycleId={cycleId}
              cycleName={cycleName}
              slotDurationMinutes={slotDurationMinutes}
              onCancelled={onRevalidate}
              onRescheduled={onRevalidate}
            />
          )}
          {stage === "Withdrawn" && <WithdrawnView cycleName={cycleName} />}
          {stage === "PostInterviewPending" && <PostInterviewPendingView />}
          {stage === "Accepted" && <AcceptedView cycleName={cycleName} />}
          {stage === "Waitlisted" && <WaitlistedView cycleName={cycleName} />}
        </div>
      )}
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function Portal() {
  const data = useLoaderData<typeof loader>() as any;
  const {
    cycleName,
    cycleId,
    cycleStatus,
    closeDate,
    domainApplications,
    slotDurationMinutes,
    hasApplication,
    applicationStatus,
  } = data;

  const revalidator = useRevalidator();
  const handleRevalidate = useCallback(() => {
    revalidator.revalidate();
  }, [revalidator]);

  const [searchParams, setSearchParams] = useSearchParams();
  const justSubmitted = searchParams.get("just-submitted") === "1";
  const handleConfettiFire = useCallback(() => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.delete("just-submitted");
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  if (!cycleId) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center px-6">
        <h2 className="font-heading text-2xl font-bold text-dark-blue mb-3">No Active Cycle</h2>
        <p className="text-muted-foreground">There is no active application cycle right now. Check back later!</p>
      </div>
    );
  }

  const das = domainApplications as DomainAppData[];

  // Determine top-level state when there are no domain applications yet
  let topLevelStage: "ApplicationOpen" | "ApplicationsClosed" | "Pending" | "Draft" | "Withdrawn" | null = null;
  if (applicationStatus === "Withdrawn") {
    // Withdrawal is terminal at the application level — short-circuit per-domain
    // cards regardless of how many DAs the applicant created.
    topLevelStage = "Withdrawn";
  } else if (das.length === 0) {
    if (applicationStatus === "Submitted") {
      topLevelStage = "Pending";
    } else if (!hasApplication && cycleStatus === "Open") {
      topLevelStage = "ApplicationOpen";
    } else if (!hasApplication) {
      topLevelStage = "ApplicationsClosed";
    }
  } else if (applicationStatus === "Draft") {
    topLevelStage = "Draft";
  }

  return (
    <div>
      <Confetti trigger={justSubmitted} onFire={handleConfettiFire} />
      {/* Header */}
      <div className="bg-[#E8F4FA] px-6 md:px-16 lg:px-24 py-10">
        <div className="max-w-3xl mx-auto">
          <h1 className="font-heading text-xl font-bold text-dark-blue">
            {cycleName} Application Portal
          </h1>
          {cycleStatus === "Open" && closeDate && <DeadlineLine closeDate={closeDate} />}
        </div>
      </div>

      {/* Content */}
      <div className="px-6 md:px-16 lg:px-24 py-10">
        {topLevelStage === "ApplicationsClosed" && (
          <div className="max-w-2xl mx-auto text-center py-16">
            <div className="w-16 h-16 mx-auto mb-6 rounded-full bg-muted flex items-center justify-center">
              <svg className="w-8 h-8 text-muted-foreground/70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="font-heading text-2xl font-bold text-dark-blue mb-3">Applications Closed</h2>
            <p className="text-muted-foreground leading-relaxed">
              The application window for {cycleName} has closed. Check back for future application cycles!
            </p>
          </div>
        )}
        {topLevelStage === "ApplicationOpen" && <ApplicationOpenView cycleName={cycleName} closeDate={closeDate} />}
        {topLevelStage === "Pending" && (
          <>
            <PendingView cycleName={cycleName} />
            {cycleStatus === "Open" && (
              <div className="max-w-2xl mx-auto mt-4 rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 flex items-center justify-between gap-4">
                <p className="text-sm text-blue-800">
                  The cycle is still open — you can still update your application.
                </p>
                <Link
                  to="/portal/apply"
                  className="shrink-0 px-4 py-2 rounded-full bg-accent-coral text-white text-sm font-semibold hover:bg-accent-coral/90 transition"
                >
                  Edit Application
                </Link>
              </div>
            )}
          </>
        )}
        {topLevelStage === "Draft" && <ApplicationDraftView cycleName={cycleName} closeDate={cycleStatus === "Open" ? closeDate : null} />}
        {topLevelStage === "Withdrawn" && <WithdrawnView cycleName={cycleName} />}

        {das.length > 0 && applicationStatus !== "Draft" && applicationStatus !== "Withdrawn" && (
          <div className="max-w-3xl mx-auto space-y-8">
            {cycleStatus === "Open" && applicationStatus === "Submitted" && (
              <div className="rounded-xl border border-blue-200 bg-blue-50 px-5 py-4 flex items-center justify-between gap-4">
                <p className="text-sm text-blue-800">
                  The cycle is still open — you can still update your application.
                </p>
                <Link
                  to="/portal/apply"
                  className="shrink-0 px-4 py-2 rounded-full bg-accent-coral text-white text-sm font-semibold hover:bg-accent-coral/90 transition"
                >
                  Edit Application
                </Link>
              </div>
            )}
            <div className="flex justify-end">
              <Link to="/portal/application" className="text-sm text-accent-coral hover:underline">
                View your submission →
              </Link>
            </div>
            {das.map(da => (
              <DomainApplicationCard
                key={da.id}
                da={da}
                cycleId={cycleId}
                cycleName={cycleName}
                slotDurationMinutes={slotDurationMinutes}
                onRevalidate={handleRevalidate}
              />
            ))}
          </div>
        )}
      </div>
      <div className="relative px-6 md:px-16 lg:px-24 py-6 text-center text-xs text-muted-foreground/70">
        Made with ❤️ at the DALI Lab.
        <span className="absolute right-2 bottom-2 text-section-bg select-all font-mono">1:f-2</span>
      </div>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  return <ApplicantErrorBoundary error={error} secondaryAction={{ kind: "reload" }} />;
}
