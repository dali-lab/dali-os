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

// "Is a DALI lab member" predicate
export const LAB_MEMBER_WHERE = {
  daliMember: { isNot: null },
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
