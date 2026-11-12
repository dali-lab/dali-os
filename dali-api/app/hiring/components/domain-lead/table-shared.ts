
export const OS_TABLE_HEAD = "text-os-grey text-xs";

export const OS_TABLE_ROW = "border-t border-os-container hover:bg-os-card-hover transition-colors";

export function personName(u: any): string | undefined {
  return (u?.firstName && u?.lastName ? `${u.firstName} ${u.lastName}` : u?.daliEmail) ?? undefined;
}
