import { useNavigate } from "react-router";
import { requestOpenTabIfEmbedded } from "~/components/workspace-link";
import { fullName } from "~/lib/display";
import { Avatar } from "~/components/ui/Avatar";
import { LoadMore } from "~/components/ui/Pager";
import { RolePills } from "~/components/ui/RolePills";
import { useClientSlice } from "~/hooks/useClientSlice";
import { isNewMember, isBirthdayToday } from "~/members/lib/warmth";
import { NewBadge, BirthdayBadge } from "~/members/components/WarmthBadges";
import { cn } from "~/lib/cn";

export type MemberStatus = "active" | "alumni";

export type MemberRow = {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  pronouns: string | null;
  classYear: number | null;
  // Grad/professional school label ("Thayer" etc.) shown in place of a class
  // year for enrolled grad students; null for undergrads and employees.
  gradProgram: string | null;
  photoUrl: string | null;
  // Full-time staff (AdminMembership.isStaff) — shown as a Staff badge.
  isStaff: boolean;
  coreTitles: string[];
  // Each domain the member is eligible for, with their level — rendered as
  // pills in the Roles column. Same source as the staffing boards.
  domainRoles: { domainName: string; level: string }[];
  // Warmth surfaces: "New" pill (recently joined) + 🎂 on the day.
  createdAt: string;
  onboardedAt: string | null;
  birthday: string | null;
  // What the filter builder matches against, keyed by FILTER_COLUMNS.
  cells: Record<string, string | string[]>;
};

export function MembersTable({
  rows,
  status,
  resetKey,
}: {
  rows: MemberRow[];
  status: MemberStatus;
  resetKey: string;
}) {
  const { visible, pager } = useClientSlice(rows, { resetKey });
  const navigate = useNavigate();
  // Alumni view swaps the Roles column for Class — roles are largely historical
  // for alumni, and class year is the more useful axis.
  const showClass = status === "alumni";
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full min-w-[640px]", "text-base")}>
        <thead className="bg-muted/30 text-muted-foreground text-xs">
          <tr>
            <th className="text-left font-medium px-4 py-2">Name</th>
            <th className="text-left font-medium px-4 py-2">Email</th>
            <th className="text-left font-medium px-4 py-2">{showClass ? "Class" : "Roles"}</th>
          </tr>
        </thead>
        <tbody>
          {visible.map((m) => (
            <tr
              key={m.id}
              onClick={() => {
                const url = `/members/${m.id}`;
                const label = fullName(m) || "Member";
                if (!requestOpenTabIfEmbedded(url, label)) navigate(url);
              }}
              className="border-t border-border hover:bg-muted/20 cursor-pointer"
            >
              <td className="px-4 py-2 text-foreground">
                <div className="flex items-center gap-2.5">
                  <Avatar
                    photoUrl={m.photoUrl}
                    name={fullName(m) || "Member"}
                    size="sm"
                    userId={m.id}
                    className="flex-shrink-0"
                  />
                  <span>
                    {m.firstName} {m.lastName}
                  </span>
                  {status === "active" &&
                    isNewMember(
                      {
                        onboardedAt: m.onboardedAt ? new Date(m.onboardedAt) : null,
                        createdAt: new Date(m.createdAt),
                      },
                      new Date(),
                    ) && <NewBadge />}
                  {m.birthday && isBirthdayToday(new Date(m.birthday), new Date()) && (
                    <BirthdayBadge />
                  )}
                  {m.isStaff && (
                    <span
                      className={cn(
                        "inline-flex items-center px-1.5 py-0.5 rounded-full font-semibold bg-os-accent/15 text-os-accent flex-shrink-0",
                        "text-xs",
                      )}
                    >
                      Staff
                    </span>
                  )}
                </div>
              </td>
              <td className="px-4 py-2 text-muted-foreground">{m.email ?? "—"}</td>
              <td className="px-4 py-2">
                {showClass ? (
                  <span className="text-muted-foreground">
                    {m.classYear
                      ? `Class of ${m.classYear}`
                      : (m.gradProgram ?? "—")}
                  </span>
                ) : m.coreTitles.length === 0 && m.domainRoles.length === 0 ? (
                  <span className={cn("text-muted-foreground", "text-sm")}>—</span>
                ) : (
                  <RolePills
                    coreTitles={m.coreTitles}
                    domainRoles={m.domainRoles}
                    size="md"
                  />
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <LoadMore {...pager} />
    </div>
  );
}
