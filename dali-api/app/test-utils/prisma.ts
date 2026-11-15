import type { Mock } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";
import { prisma } from "~/lib/db.server";

type ModelKeys = Exclude<keyof PrismaClient, `$${string}` | symbol>;

type Fn = (...a: never[]) => unknown;

type MockModel<M> = { [Op in keyof M as M[Op] extends Fn ? Op : never]: Mock<Extract<M[Op], Fn>> };

export type MockPrisma = { [M in ModelKeys]: MockModel<PrismaClient[M]> } & {
  $transaction: Mock;
  $queryRaw: Mock;
};

export function mockedPrisma(): MockPrisma {
  return prisma as unknown as MockPrisma;
}
