import { Link } from "react-router";
import { Cake } from "lucide-react";
import { formatBirthdayMonthDay } from "~/members/lib/warmth";

export type BirthdayMember = {
  id: string;
  firstName: string;
  lastName: string;
  /** ISO string; month/day only is displayed — year is never shown. */
  birthday: string;
  isToday: boolean;
};

/** Home card listing active members with a birthday this week.
 *  Returns null when the list is empty (card is not mounted). */
export function BirthdaysCard({ members }: { members: BirthdayMember[] }) {
  if (members.length === 0) return null;

  return (
    <section className="bg-card border border-border shadow-brand-1 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <Cake className="w-4 h-4 text-accent-coral" />
        <span className="font-heading font-semibold text-sm text-foreground">
          {members.length === 1 ? "Birthday this week" : "Birthdays this week"}
        </span>
      </div>
      <div className="flex flex-col gap-1">
        {members.map((m) => (
          <Link
            key={m.id}
            to={`/members/${m.id}`}
            className="flex items-center gap-2 px-2 py-1 rounded-md text-sm text-foreground hover:bg-muted/50 transition-colors"
          >
            <span className="flex-1 truncate font-medium">
              {m.firstName} {m.lastName}
            </span>
            <span className="text-xs text-muted-foreground flex-shrink-0">
              {formatBirthdayMonthDay(new Date(m.birthday))}
            </span>
            {m.isToday && (
              <span role="img" aria-label="Birthday today" className="text-sm leading-none flex-shrink-0">
                🎂
              </span>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}
