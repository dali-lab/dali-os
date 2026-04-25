import { useState, useEffect } from "react";
import { redirect, useLoaderData, Link } from "react-router";
import type { Route } from "./+types/applicant.schedule-interview";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { getActiveCycle } from "~/lib/cycles";
import { inferDomainApplicationStatus } from "~/lib/domain-application-status";
import type { ApplicationCycleStatus } from "~/generated/prisma/enums";
import { Building2, Calendar, Check, Clock, Video } from "lucide-react";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");

  const active = await getActiveCycle();
  if (!active) return { domainAppsToSchedule: [], cycleId: null };

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

  if (!application) return { domainAppsToSchedule: [], cycleId: active.id };

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

  return { domainAppsToSchedule, cycleId: active.id };
}

const LOCATION_LABELS: Record<string, string> = {
  PodAppa: "Pod Appa, DALI Lab",
  PodMomo: "Pod Momo, DALI Lab",
  Online: "Online",
};

export default function ScheduleInterview() {
  const { domainAppsToSchedule, cycleId } = useLoaderData<typeof loader>() as any;
  const [mode, setMode] = useState<"in-person" | "online" | null>(null);
  const [slots, setSlots] = useState<{ startTime: string; endTime: string }[]>([]);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [booking, setBooking] = useState<string | null>(null);
  const [booked, setBooked] = useState<{ startTime: string; location: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const domainApp = domainAppsToSchedule?.[0];

  // Fetch slots when mode is selected
  useEffect(() => {
    if (!mode || !cycleId || !domainApp) return;
    setLoadingSlots(true);
    setSlots([]);
    setError(null);

    const domainIds = domainAppsToSchedule
      .map((da: any) => da.challengeVersion.domainId)
      .filter((id: string | null): id is string => id !== null);

    const params = new URLSearchParams();
    domainIds.forEach((id: string) => params.append("domainId", id));
    params.set("mode", mode);

    fetch(`/api/cycles/${cycleId}/available-slots?${params}`, { credentials: "include" })
      .then((res) => res.json())
      .then((data) => setSlots(data))
      .catch(() => setError("Failed to load available slots."))
      .finally(() => setLoadingSlots(false));
  }, [mode, cycleId, domainApp]);

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

  async function bookSlot(domainAppId: string, startTime: string) {
    setBooking(startTime);
    setError(null);
    const res = await fetch(`/api/domain-applications/${domainAppId}/schedule-interview`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startTime, mode }),
    });
    if (res.ok) {
      const interview = await res.json();
      setBooked({ startTime, location: interview.location });
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed to book this slot. It may have been taken.");
    }
    setBooking(null);
  }

  if (booked) {
    const bookedDate = new Date(booked.startTime);
    return (
      <div className="max-w-2xl mx-auto py-16 text-center">
        <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
          <Check className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-bold text-foreground mb-2">Interview Scheduled!</h1>
        <p className="text-muted-foreground">
          Your interview is booked for{" "}
          <span className="font-medium text-foreground">
            {bookedDate.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </span>{" "}
          at{" "}
          <span className="font-medium text-foreground">
            {bookedDate.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
          </span>
          .
        </p>
        <p className="text-muted-foreground mt-2">
          Location:{" "}
          <span className="font-medium text-foreground">
            {LOCATION_LABELS[booked.location] ?? booked.location}
          </span>
        </p>
      </div>
    );
  }

  // Group slots by date
  const slotsByDate = new Map<string, typeof slots>();
  for (const slot of slots) {
    const dateKey = new Date(slot.startTime).toLocaleDateString(undefined, {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    if (!slotsByDate.has(dateKey)) slotsByDate.set(dateKey, []);
    slotsByDate.get(dateKey)!.push(slot);
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Schedule Your Interview</h1>
        <p className="text-muted-foreground mt-1">
          You've been invited to interview for{" "}
          <span className="font-medium text-foreground">{domainApp.challengeVersion.domain.name}</span>.
          {mode ? " Pick a time that works for you." : " Choose how you'd like to interview."}
        </p>
      </div>

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
          {loadingSlots ? (
            <div className="bg-card border border-border rounded-lg p-8 text-center">
              <Clock className="w-8 h-8 text-muted-foreground/70 mx-auto mb-3 animate-pulse" />
              <p className="text-muted-foreground">Loading available times...</p>
            </div>
          ) : slots.length === 0 ? (
            <div className="bg-card border border-border rounded-lg p-8 text-center">
              <Clock className="w-8 h-8 text-muted-foreground/70 mx-auto mb-3" />
              <p className="text-muted-foreground">No available interview slots right now. Please check back later.</p>
            </div>
          ) : (
            <div className="space-y-6">
              {Array.from(slotsByDate.entries()).map(([dateLabel, dateSlots]) => (
                <div key={dateLabel}>
                  <h3 className="text-sm font-bold text-foreground/80 uppercase tracking-wider mb-3">{dateLabel}</h3>
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2">
                    {dateSlots.map((slot: any) => {
                      const start = new Date(slot.startTime);
                      const end = new Date(slot.endTime);
                      const isBooking = booking === slot.startTime;
                      return (
                        <button
                          key={slot.startTime}
                          onClick={() => bookSlot(domainApp.id, slot.startTime)}
                          disabled={!!booking}
                          className="px-3 py-3 text-sm font-medium rounded-lg border border-border bg-card hover:border-blue-400 hover:bg-blue-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                          {isBooking ? (
                            "Booking..."
                          ) : (
                            <>
                              {start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                              {" – "}
                              {end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                            </>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
