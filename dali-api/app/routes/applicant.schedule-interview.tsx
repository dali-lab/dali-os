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
        <div className="w-12 h-12 bg-gray-100 text-gray-400 rounded-full flex items-center justify-center mx-auto mb-4">
          <Calendar className="w-6 h-6" />
        </div>
        <h1 className="text-xl font-bold text-gray-900 mb-2">No Interviews to Schedule</h1>
        <p className="text-gray-500">You don't have any pending interview invitations right now.</p>
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
        <h1 className="text-xl font-bold text-gray-900 mb-2">Interview Scheduled!</h1>
        <p className="text-gray-500">
          Your interview is booked for{" "}
          <span className="font-medium text-gray-900">
            {bookedDate.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}
          </span>{" "}
          at{" "}
          <span className="font-medium text-gray-900">
            {bookedDate.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
          </span>
          .
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

  const domainApp = domainAppsToSchedule[0];

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Schedule Your Interview</h1>
        <p className="text-gray-500 mt-1">
          You've been invited to interview for{" "}
          <span className="font-medium text-gray-900">{domainApp.challengeVersion.domain.name}</span>.
          Pick a time that works for you.
        </p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-800">
          {error}
        </div>
      )}

      {slots.length === 0 ? (
        <div className="bg-white border border-gray-200 rounded-lg p-8 text-center">
          <Clock className="w-8 h-8 text-gray-400 mx-auto mb-3" />
          <p className="text-gray-500">No available interview slots right now. Please check back later.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {Array.from(slotsByDate.entries()).map(([dateLabel, dateSlots]) => (
            <div key={dateLabel}>
              <h3 className="text-sm font-bold text-gray-700 uppercase tracking-wider mb-3">{dateLabel}</h3>
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
                      className="px-3 py-3 text-sm font-medium rounded-lg border border-gray-200 bg-white hover:border-blue-400 hover:bg-blue-50 transition disabled:opacity-50 disabled:cursor-not-allowed"
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
    </div>
  );
}
