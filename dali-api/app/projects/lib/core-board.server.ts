import { prisma } from "~/lib/db.server";

const CORE_BOARD_SELECT = { id: true, name: true } as const;

export async function getCoreBoardProject(): Promise<{ id: string; name: string }> {
  const existing = await prisma.project.findFirst({ where: { kind: "CoreBoard" }, select: CORE_BOARD_SELECT });
  if (existing) return existing;
  try {
    return await prisma.project.create({ data: { name: "Core", kind: "CoreBoard" }, select: CORE_BOARD_SELECT });
  } catch (err) {
    if ((err as { code?: string } | null)?.code !== "P2002") throw err;
    const raced = await prisma.project.findFirst({ where: { kind: "CoreBoard" }, select: CORE_BOARD_SELECT });
    if (!raced) throw err;
    return raced;
  }
}
