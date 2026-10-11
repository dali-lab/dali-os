export const UNTITLED_EVENT = "(No title)";

// A blank title isn't a reason to block saving (Google Calendar doesn't either);
// the event just gets the placeholder name.
export function eventTitleOrDefault(title: string): string {
  const t = title.trim();
  return t === "" ? UNTITLED_EVENT : t;
}
