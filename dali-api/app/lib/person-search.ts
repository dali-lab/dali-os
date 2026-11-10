import type { Prisma } from "~/generated/prisma/client";

const MAX_WORDS = 4;

type UserTextField =
  | "firstName"
  | "lastName"
  | "name"
  | "handle"
  | "email"
  | "daliEmail"
  | "dartmouthEmail"
  | "personalEmail"
  | "netId";

export function searchWords(q: string): string[] {
  return q.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, MAX_WORDS);
}

export function userTextWhere(
  q: string,
  fields: readonly UserTextField[],
  extra?: (word: string) => Prisma.UserWhereInput[],
): Prisma.UserWhereInput {
  return {
    AND: searchWords(q).map((word) => ({
      OR: [
        ...fields.map((f) => ({ [f]: { contains: word, mode: "insensitive" } }) as Prisma.UserWhereInput),
        ...(extra?.(word) ?? []),
      ],
    })),
  };
}

export function matchesAllWords(text: string, q: string): boolean {
  const t = text.toLowerCase();
  return searchWords(q).every((word) => t.includes(word));
}
