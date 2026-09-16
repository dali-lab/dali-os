import type { Prisma } from "~/generated/prisma/client";

// Minimal "name card" — user:{ select:{ id, firstName, lastName }}
export const USER_NAME_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
} satisfies Prisma.UserSelect;

// Name card + avatar. Raw photoUrl still needs resolvePhotoUrl() in the loader
// before it reaches a component.
export const USER_NAME_PHOTO_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  photoUrl: true,
} satisfies Prisma.UserSelect;

// Name + both Dartmouth emails
export const USER_NAME_AND_EMAIL_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  daliEmail: true,
  dartmouthEmail: true,
} satisfies Prisma.UserSelect;

// "Is a DALI lab member" predicate — includes alumni. Use it only where the
// historical roster is what you want (e.g. the Alumni directory tab, admin
// tooling that must still reach graduated members).
export const LAB_MEMBER_WHERE = {
  daliMember: { isNot: null },
} satisfies Prisma.UserWhereInput;

// "Is a CURRENT DALI lab member" — a lab member who hasn't graduated. This is
// the right predicate for anything describing the lab as it stands today:
// directory/roster views, recipient pickers, domain + level membership.
// membershipStatus is authoritative and stored (app/lib/membership-status.ts
// folds the manual override into it), so there is nothing to derive here.
export const ACTIVE_LAB_MEMBER_WHERE = {
  daliMember: { isNot: null },
  membershipStatus: "Active",
} satisfies Prisma.UserWhereInput;

// Canonical sort for any list of members
export const MEMBER_LIST_ORDER_BY = [
  { lastName: "asc" },
  { firstName: "asc" },
] satisfies Prisma.UserOrderByWithRelationInput[];

// Nested domain pill shape
export const DOMAIN_DISPLAY_SELECT = {
  id: true,
  displayName: true,
} satisfies Prisma.DomainSelect;

// Lab member with role badges + domain eligibilities
export const STAFFING_MEMBER_SELECT = {
  id: true,
  firstName: true,
  lastName: true,
  daliEmail: true,
  dartmouthEmail: true,
  photoUrl: true,
  adminMembership: { select: { id: true } },
  coreAssignments: { select: { leadTitle: true } },
  domainEligibilities: {
    select: {
      level: true,
      domain: { select: { id: true, displayName: true } },
    },
  },
} satisfies Prisma.UserSelect;
