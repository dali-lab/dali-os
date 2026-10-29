interface InterviewWhereInput {
  room: { name: string } | null;
  videoUrl: string | null;
  zoomJoinUrl: string | null;
}

// A row can keep a stale videoUrl after moving to a pod (the Meet teardown is
// best-effort), so the room decides whether a link goes out, not the URL.
export function interviewJoinUrl(iv: InterviewWhereInput): string | undefined {
  if (iv.room) return undefined;
  return iv.videoUrl ?? iv.zoomJoinUrl ?? undefined;
}

// The calendar invite appends the join URL itself, so its location is the bare
// place name.
export function interviewPlace(iv: Pick<InterviewWhereInput, "room">): string {
  return iv.room ? `${iv.room.name}, DALI Lab` : "Online";
}

// Templates have no conditionals, so {{location}} carries the link for online
// interviews and one body serves both kinds.
export function interviewLocationVars(iv: InterviewWhereInput): { location: string; meetingUrl?: string } {
  const meetingUrl = interviewJoinUrl(iv);
  return meetingUrl ? { location: `Online: ${meetingUrl}`, meetingUrl } : { location: interviewPlace(iv) };
}
