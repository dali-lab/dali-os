// Why a domain's applicants see no bookable interview slot. The scheduler
// reports the first blocker in this order; the hiring lead page turns it
// into a sentence.
export const SLOT_BLOCKERS = [
  "no-config",
  "no-rooms",
  "no-candidates",
  "no-interviewers",
  "no-in-domain-interviewer",
  "no-cross-domain-interviewer",
  "in-domain-never-free",
  "cross-domain-never-free",
  "no-pair",
  "rooms-busy",
  "booking-notice",
] as const;

export type SlotBlocker = (typeof SLOT_BLOCKERS)[number];

export function slotBlockerMessage(
  blocker: SlotBlocker,
  opts: { bookingNoticeHours: number },
): string {
  switch (blocker) {
    case "no-config":
      return "The interview window is not set up yet.";
    case "no-rooms":
      return "No interview rooms are selected. Applicants book in-person slots, and those need a room.";
    case "no-candidates":
      return "The interview window has no upcoming weekday hours.";
    case "no-interviewers":
      return "No interviewers are on this cycle.";
    case "no-in-domain-interviewer":
      return "No interviewer from this domain is on the cycle.";
    case "no-cross-domain-interviewer":
      return "No interviewer from another domain is on the cycle. Every interview pairs one in-domain and one cross-domain interviewer.";
    case "in-domain-never-free":
      return "No interviewer from this domain is free during interview hours.";
    case "cross-domain-never-free":
      return "No interviewer from another domain is free during interview hours.";
    case "no-pair":
      return "An in-domain and a cross-domain interviewer are never free at the same time.";
    case "rooms-busy":
      return "Every time a pair is free, all interview rooms are booked.";
    case "booking-notice":
      return `The only open times are inside the ${opts.bookingNoticeHours} hour booking notice.`;
  }
}
