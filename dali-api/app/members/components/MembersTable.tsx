import { useNavigate } from "react-router";
import { fullName } from "~/lib/display";
import { Avatar } from "~/components/ui/Avatar";
import { LoadMore } from "~/components/ui/Pager";
import { useClientSlice } from "~/hooks/useClientSlice";
import { isNewMember, isBirthdayToday } from "~/members/lib/warmth";
import { NewDot, BirthdayBadge } from "~/members/components/WarmthBadges";
import { MoreHorizontal } from "lucide-react";
import { Menu, MenuItem } from "~/components/ui/floating";

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

function RoleTag({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className="inline-flex items-center rounded-md border border-border/60 px-1.5 py-px text-[11px] leading-4 text-muted-foreground"
    >
      {children}
    </span>
  );
}

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
  const open = (m: MemberRow) => navigate(`/members/${m.id}`);
  return (
    <div className="max-w-5xl overflow-x-auto">
      <table className="w-full min-w-[520px] table-fixed text-sm">
        <colgroup>
          <col className="w-[46%]" />
          <col />
          <col className="w-12" />
        </colgroup>
        <thead>
          <tr className="border-b border-border/40 text-[11px] font-medium text-muted-foreground/80">
            <th className="px-3 py-2 text-left font-medium">Member</th>
            <th className="px-3 py-2 text-left font-medium">{showClass ? "Class" : "Roles"}</th>
            <th className="px-3 py-2">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {visible.map((m) => {
            const name = fullName(m) || "Member";
            const isNew =
              status === "active" &&
              isNewMember(
                {
                  onboardedAt: m.onboardedAt ? new Date(m.onboardedAt) : null,
                  createdAt: new Date(m.createdAt),
                },
                new Date(),
              );
            return (
              <tr
                key={m.id}
                onClick={() => open(m)}
                className="cursor-pointer border-t border-border/30 first:border-t-0 transition-colors hover:bg-muted/30"
              >
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-3">
                    <Avatar photoUrl={m.photoUrl} name={name} size="sm" userId={m.id} className="flex-shrink-0" />
                    <div className="flex min-w-0 flex-col leading-tight">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-sm font-medium text-foreground">
                          {m.firstName} {m.lastName}
                        </span>
                        {isNew && <NewDot />}
                        {m.birthday && isBirthdayToday(new Date(m.birthday), new Date()) && <BirthdayBadge />}
                        {m.isStaff && <RoleTag>Staff</RoleTag>}
                      </span>
                      {m.email && <span className="truncate text-xs text-muted-foreground">{m.email}</span>}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-1.5">
                  {showClass ? (
                    <span className="text-xs text-muted-foreground">
                      {m.classYear ? `Class of ${m.classYear}` : (m.gradProgram ?? "—")}
                    </span>
                  ) : m.coreTitles.length === 0 && m.domainRoles.length === 0 ? (
                    <span className="text-xs text-muted-foreground">—</span>
                  ) : (
                    <span className="flex flex-wrap gap-1">
                      {m.coreTitles.map((t) => (
                        <RoleTag key={`core-${t}`} title={`Core role: ${t}`}>
                          {t}
                        </RoleTag>
                      ))}
                      {m.domainRoles.map((r, i) => (
                        <RoleTag
                          key={`domain-${r.domainName}-${i}`}
                          title={r.level ? `Domain Lead for ${r.domainName} (Level ${r.level})` : `Domain Lead for ${r.domainName}`}
                        >
                          {r.domainName}
                        </RoleTag>
                      ))}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                  <Menu
                    align="right"
                    ariaLabel={`Actions for ${name}`}
                    trigger={
                      <button
                        type="button"
                        aria-label={`Actions for ${name}`}
                        className="rounded-md p-1 text-muted-foreground/70 transition-colors hover:bg-muted/60 hover:text-foreground"
                      >
                        <MoreHorizontal className="h-4 w-4" aria-hidden />
                      </button>
                    }
                  >
                    <MenuItem onSelect={() => open(m)}>View profile</MenuItem>
                    {m.email && (
                      <MenuItem onSelect={() => void navigator.clipboard?.writeText(m.email!)}>Copy email</MenuItem>
                    )}
                  </Menu>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <LoadMore {...pager} />
    </div>
  );
}
