import { useState } from "react";
import { redirect, useLoaderData, Link } from "react-router";
import type { Route } from "./+types/applicant.schedule-interview";
import { prisma } from "~/lib/db";
import { requireAuth } from "~/lib/auth";
import { getActiveCycle } from "~/lib/cycles";
import { computeAvailableSlots } from "~/lib/scheduling";
import { inferDomainApplicationStatus } from "~/lib/domain-application-status";
import type { ApplicationCycleStatus } from "~/generated/prisma/enums";
import { Calendar, Check, Clock } from "lucide-react";
import { InterviewSlotPicker } from "~/components/InterviewSlotPicker";
import type { Slot } from "~/components/InterviewSlotPicker";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");

  const active = await getActiveCycle();
  if (!active) return { domainAppsToSchedule: [], slots: [], cycleId: null };

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

  if (!application) return { domainAppsToSchedule: [], slots: [], cycleId: active.id };

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

  let slots: { startTime: string; endTime: string }[] = [];
  if (domainAppsToSchedule.length > 0) {
    const domainIds = domainAppsToSchedule
      .map((da: any) => da.challengeVersion.domainId)
      .filter((id: string | null): id is string => id !== null);
    slots = await computeAvailableSlots(active.id, domainIds);
  }

  return { domainAppsToSchedule, slots, cycleId: active.id };
}

export default function ScheduleInterview() {
  const { domainAppsToSchedule, slots, cycleId } = useLoaderData<typeof loader>() as any;
  const [booking, setBooking] = useState<string | null>(null);
  const [booked, setBooked] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      body: JSON.stringify({ startTime }),
    });
    if (res.ok) {
      setBooked(startTime);
    } else {
      const body = await res.json().catch(() => ({}));
      setError(body.error ?? "Failed to book this slot. It may have been taken.");
    }
    setBooking(null);
  }

  if (booked) {
    const bookedDate = new Date(booked);
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
      </div>
    );
  }

  // Convert raw API slots into picker-compatible shape and group by date
  const pickerSlots: Slot[] = slots.map((s: any, i: number) => {
    const start = new Date(s.startTime);
    const end = new Date(s.endTime);
    return {
      id: s.startTime,
      date: start.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" }),
      time: `${start.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} – ${end.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}`,
    };
  });

  const groupMap = new Map<string, Slot[]>();
  for (const s of pickerSlots) {
    const group = groupMap.get(s.date) ?? [];
    group.push(s);
    groupMap.set(s.date, group);
  }
  const groups = Array.from(groupMap.entries()).map(([date, slots]) => ({ date, slots }));

  const domainApp = domainAppsToSchedule[0];

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Schedule Your Interview</h1>
        <p className="text-muted-foreground mt-1">
          You've been invited to interview for{" "}
          <span className="font-medium text-foreground">{domainApp.challengeVersion.domain.name}</span>.
          Pick a time that works for you.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {slots.length === 0 ? (
        <div className="bg-card border border-border rounded-lg p-8 text-center">
          <Clock className="w-8 h-8 text-muted-foreground/70 mx-auto mb-3" />
          <p className="text-muted-foreground">No available interview slots right now. Please check back later.</p>
        </div>
      ) : (
        <InterviewSlotPicker
          groups={groups}
          variant="schedule"
          onSelect={(slot) => bookSlot(domainApp.id, slot.id)}
          loadingSlotId={booking}
          disabled={!!booking}
        />
      )}
    </div>
  );
}
