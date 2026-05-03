import { useState, useEffect } from "react";
import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/applicant.schedule-interview";
import { prisma } from "~/lib/db";
import { requireAuth, withAuth } from "~/lib/auth";
import { getActiveCycle } from "~/hiring/lib/cycles";
import { inferDomainApplicationStatus } from "~/hiring/lib/domain-application-status";
import type { ApplicationCycleStatus } from "~/generated/prisma/enums";
import { Building2, Calendar, Check, Clock, Video } from "lucide-react";
import { InterviewSlotPicker } from "~/hiring/components/InterviewSlotPicker";
import type { Slot } from "~/hiring/components/InterviewSlotPicker";
import {
  formatInterviewDate,
  formatInterviewTime,
  formatInterviewTimeRange,
} from "~/hiring/lib/interview-time";

type RawSlot = { startTime: string; endTime: string };

export const meta: Route.MetaFunction = () => [{ title: "Schedule interview · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return withAuth(auth, redirect("/login"));

  const active = await getActiveCycle();
  if (!active) return withAuth(auth, { domainAppsToSchedule: [], cycleId: null });

  const application = await prisma.application.findFirst({
    where: { userId: auth.user.sub, applicationCycleId: active.id },
    include: {
      statusUpdates: true,
      domainApplications: {
        include: {
          challengeVersion: { include: { domain: true } },
          decisions: { orderBy: { createdAt: "desc" } },
          interviews: { where: { status: { in: ["Scheduled", "Completed"] } } },
        },
      },
    },
  });

  if (!application) return withAuth(auth, { domainAppsToSchedule: [], cycleId: active.id });

  const cycleStatus = active.currentStatus as ApplicationCycleStatus;

  const domainAppsToSchedule = application.domainApplications
    .map((da: any) => ({
      ...da,
      inferredStatus: inferDomainApplicationStatus(
        { ...da, application: { statusUpdates: application.statusUpdates } } as any,
        cycleStatus,
      ),
    }))
    .filter((da: any) => da.inferredStatus === "InvitedToInterview");

  return withAuth(auth, { domainAppsToSchedule, cycleId: active.id });
}

const LOCATION_LABELS: Record<string, string> = {
  PodAppa: "Pod Appa, DALI Lab",
  PodMomo: "Pod Momo, DALI Lab",
  Online: "Online",
};

export default function ScheduleInterview() {
  const { domainAppsToSchedule, cycleId } = useLoaderData<typeof loader>() as any;
  const [mode, setMode] = useState<"in-person" | "online" | null>(null);
  const [slotsByDomainAppId, setSlotsByDomainAppId] = useState<Record<string, RawSlot[]>>({});
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [booking, setBooking] = useState<string | null>(null);
  const [booked, setBooked] = useState<Record<string, { startTime: string; location: string }>>({});
  const [error, setError] = useState<string | null>(null);
  const [selectedDomainAppId, setSelectedDomainAppId] = useState<string | null>(
    domainAppsToSchedule?.[0]?.id ?? null,
  );

  // Fetch slots when mode is selected
  useEffect(() => {
    if (!mode || !cycleId || !domainAppsToSchedule?.length) return;
    setLoadingSlots(true);
    setSlotsByDomainAppId({});
    setError(null);

    Promise.all(
      domainAppsToSchedule.map(async (da: any) => {
        const domainId = da.challengeVersion?.domainId ?? null;
        if (!domainId) return [da.id, [] as RawSlot[]] as const;

        const params = new URLSearchParams();
        params.append("domainId", domainId);
        params.set("mode", mode);

        const res = await fetch(`/api/hiring/cycles/${cycleId}/available-slots?${params}`, { credentials: "include" });
        const slots = await res.json();
        return [da.id, slots] as const;
      }),
    )
      .then((results) => setSlotsByDomainAppId(Object.fromEntries(results)))
      .catch(() => setError("Failed to load available slots."))
      .finally(() => setLoadingSlots(false));
  }, [mode, cycleId]);

  if (!domainAppsToSchedule || domainAppsToSchedule.length === 0) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <div className="w-12 h-12 bg-muted text-muted-foreground/70 rounded-full flex items-center justify-center mx-auto mb-4">
          <Calendar className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-bold text-foreground mb-2">No Interviews to Schedule</h1>
        <p className="text-muted-foreground">You don't have any pending interview invitations right now.</p>
      </div>
    );
  }

  const allBooked = domainAppsToSchedule.every((da: any) => booked[da.id]);

  async function bookSlot(domainAppId: string, startTime: string) {
    setBooking(startTime);
    setError(null);
    const res = await fetch(`/api/hiring/domain-applications/${domainAppId}/hiring/schedule-interview`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startTime, mode }),
    });
    if (res.ok) {
      const interview = await res.json();
      const nextBooked = { ...booked, [domainAppId]: { startTime, location: interview.location } };
      setBooked(nextBooked);
      const nextUnbooked = domainAppsToSchedule.find((da: any) => !nextBooked[da.id]);
      if (nextUnbooked) setSelectedDomainAppId(nextUnbooked.id);
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed to book this slot. It may have been taken.");
    }
    setBooking(null);
  }

  if (allBooked) {
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <Check className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-bold text-foreground mb-2">
          {domainAppsToSchedule.length > 1 ? "Interviews Scheduled!" : "Interview Scheduled!"}
        </h1>
        <ul className="text-muted-foreground space-y-1">
          {domainAppsToSchedule.map((da: any) => {
            const entry = booked[da.id];
            return (
              <li key={da.id}>
                <span className="font-medium text-foreground">{da.challengeVersion.domain.name}</span>
                {": "}
                {formatInterviewDate(entry.startTime)} at {formatInterviewTime(entry.startTime)}
                <br />
                <span className="text-sm">
                  Location: {LOCATION_LABELS[entry.location] ?? entry.location}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    );
  }

  const selectedDomainApp =
    domainAppsToSchedule.find((da: any) => da.id === selectedDomainAppId) ??
    domainAppsToSchedule.find((da: any) => !booked[da.id]) ??
    domainAppsToSchedule[0];

  const slotsForSelected: RawSlot[] = slotsByDomainAppId[selectedDomainApp.id] ?? [];

  const pickerSlots: Slot[] = slotsForSelected.map((s) => ({
    id: s.startTime,
    date: formatInterviewDate(s.startTime),
    time: formatInterviewTimeRange(s.startTime, s.endTime, " – "),
  }));
  const groupMap = new Map<string, Slot[]>();
  for (const s of pickerSlots) {
    const group = groupMap.get(s.date) ?? [];
    group.push(s);
    groupMap.set(s.date, group);
  }
  const groups = Array.from(groupMap.entries()).map(([date, slots]) => ({ date, slots }));

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Schedule Your Interview</h1>
        <p className="text-muted-foreground mt-1">
          {domainAppsToSchedule.length > 1 ? (
            <>
              You've been invited to interview for{" "}
              <span className="font-medium text-foreground">{domainAppsToSchedule.length} domains</span>.
              {mode ? " Pick a time for each." : " Choose how you'd like to interview."}
            </>
          ) : (
            <>
              You've been invited to interview for{" "}
              <span className="font-medium text-foreground">
                {selectedDomainApp.challengeVersion.domain.name}
              </span>
              .{mode ? " Pick a time that works for you." : " Choose how you'd like to interview."}
            </>
          )}
        </p>
      </div>

      {domainAppsToSchedule.length > 1 && (
        <div
          role="tablist"
          aria-label="Domain interviews"
          className="flex flex-wrap gap-2 border-b border-border"
        >
          {domainAppsToSchedule.map((da: any) => {
            const isSelected = da.id === selectedDomainApp.id;
            const isBooked = !!booked[da.id];
            return (
              <button
                key={da.id}
                role="tab"
                aria-selected={isSelected}
                onClick={() => setSelectedDomainAppId(da.id)}
                disabled={!!booking}
                className={`px-4 py-2 -mb-px text-sm font-medium border-b-2 transition disabled:opacity-50 disabled:cursor-not-allowed ${
                  isSelected
                    ? "border-blue-500 text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {da.challengeVersion.domain.name}
                {isBooked && (
                  <Check
                    className="inline-block w-4 h-4 ml-1.5 text-green-600 align-text-bottom"
                    aria-label="scheduled"
                  />
                )}
              </button>
            );
          })}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* Mode selector */}
      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => setMode("in-person")}
          className={`flex flex-col items-center gap-2 p-5 rounded-lg border-2 transition ${
            mode === "in-person"
              ? "border-blue-500 bg-blue-50"
              : "border-border bg-card hover:border-blue-300 hover:bg-blue-50/50"
          }`}
        >
          <Building2 className={`w-6 h-6 ${mode === "in-person" ? "text-blue-600" : "text-muted-foreground"}`} />
          <span className={`font-medium ${mode === "in-person" ? "text-blue-700" : "text-foreground"}`}>
            In-Person
          </span>
          <span className="text-xs text-muted-foreground">DALI Lab</span>
        </button>
        <button
          onClick={() => setMode("online")}
          className={`flex flex-col items-center gap-2 p-5 rounded-lg border-2 transition ${
            mode === "online"
              ? "border-blue-500 bg-blue-50"
              : "border-border bg-card hover:border-blue-300 hover:bg-blue-50/50"
          }`}
        >
          <Video className={`w-6 h-6 ${mode === "online" ? "text-blue-600" : "text-muted-foreground"}`} />
          <span className={`font-medium ${mode === "online" ? "text-blue-700" : "text-foreground"}`}>
            Online
          </span>
          <span className="text-xs text-muted-foreground">Video call</span>
        </button>
      </div>

      {/* Slots */}
      {mode && (
        <>
          {booked[selectedDomainApp.id] ? (
            <div className="bg-card border border-border rounded-lg p-8 text-center">
              <Check className="w-8 h-8 text-green-600 mx-auto mb-3" />
              <p className="text-foreground font-medium">
                {selectedDomainApp.challengeVersion.domain.name} interview booked for{" "}
                {formatInterviewDate(booked[selectedDomainApp.id].startTime)} at{" "}
                {formatInterviewTime(booked[selectedDomainApp.id].startTime)}.
              </p>
              <p className="text-muted-foreground mt-2">
                Location:{" "}
                <span className="font-medium text-foreground">
                  {LOCATION_LABELS[booked[selectedDomainApp.id].location] ?? booked[selectedDomainApp.id].location}
                </span>
              </p>
              <p className="text-muted-foreground text-sm mt-2">
                Pick another tab above to schedule your remaining interviews.
              </p>
            </div>
          ) : loadingSlots ? (
            <div className="bg-card border border-border rounded-lg p-8 text-center">
              <Clock className="w-8 h-8 text-muted-foreground/70 mx-auto mb-3 animate-pulse" />
              <p className="text-muted-foreground">Loading available times...</p>
            </div>
          ) : slotsForSelected.length === 0 ? (
            <div className="bg-card border border-border rounded-lg p-8 text-center">
              <Clock className="w-8 h-8 text-muted-foreground/70 mx-auto mb-3" />
              <p className="text-muted-foreground">No available interview slots right now. Please check back later.</p>
            </div>
          ) : (
            <InterviewSlotPicker
              groups={groups}
              variant="schedule"
              onSelect={(slot) => bookSlot(selectedDomainApp.id, slot.id)}
              loadingSlotId={booking}
              disabled={!!booking}
            />
          )}
        </>
      )}
    </div>
  );
}

