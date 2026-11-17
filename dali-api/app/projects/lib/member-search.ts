import type { Prisma } from "~/generated/prisma/client";

// Members whose name or email contains every word of q, so "ada o" matches
// "Ada O'Brien". Members only: the staffable pool.
export function memberSearchWhere(q: string): Prisma.UserWhereInput {
  const tokens = q.trim().split(/\s+/).filter(Boolean).slice(0, 4);
  return {
    daliMember: { isNot: null },
    AND: tokens.map((t) => ({
      OR: [
        { firstName: { contains: t, mode: "insensitive" as const } },
        { lastName: { contains: t, mode: "insensitive" as const } },
        { daliEmail: { contains: t, mode: "insensitive" as const } },
        { dartmouthEmail: { contains: t, mode: "insensitive" as const } },
      ],
    })),
  };
}
