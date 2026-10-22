import { colors } from '../theme';

const ROLE_COLORS = [colors.teal, colors.yellow, colors.lightPurple, colors.green, colors.coral, colors.navy];

/** A role's color is its place in the member's role list, so it stays put across the Time tab. */
export function roleColor(roleRefIds: string[], roleRefId: string | null): string {
  const i = roleRefId ? roleRefIds.indexOf(roleRefId) : -1;
  return i === -1 ? colors.slate300 : ROLE_COLORS[i % ROLE_COLORS.length];
}
