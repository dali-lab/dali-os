import { readFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

// Phase 2: contact-info fields (firstName, lastName, daliEmail, dartmouthEmail,
// did/netId) live on User. DALIMember is a thin "is a lab member" marker.
// Legacy MemberRole[] is gone — Admin → AdminMembership, HiringLead →
// CoreAssignment.
interface MemberSeed {
  firstName: string | null;
  lastName: string | null;
  daliEmail: string | null;
  dartmouthEmail: string | null;
  did: string | null;
  roles?: string[];
}

async function main() {
  const members: MemberSeed[] = JSON.parse(
    readFileSync(join(import.meta.dirname, "data/members.json"), "utf-8")
  );

  let seeded = 0;
  for (const { firstName, lastName, daliEmail, dartmouthEmail, did, roles } of members) {
    if (!daliEmail) continue;

    // Upsert User row with the contact info.
    const user = await prisma.user.upsert({
      where: { daliEmail },
      update: {
        firstName: firstName ?? "Unknown",
        lastName: lastName ?? "",
        dartmouthEmail: dartmouthEmail ?? undefined,
        netId: did ? did.toLowerCase() : undefined,
      },
      create: {
        daliEmail,
        firstName: firstName ?? "Unknown",
        lastName: lastName ?? "",
        dartmouthEmail: dartmouthEmail ?? undefined,
        netId: did ? did.toLowerCase() : undefined,
      },
    });

    // Mark as lab member.
    await prisma.dALIMember.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id },
    });

    // Translate legacy roles → AdminMembership / CoreAssignment.
    if (roles?.includes("Admin")) {
      await prisma.adminMembership.upsert({
        where: { userId: user.id },
        update: {},
        create: { userId: user.id },
      });
    }
    if (roles?.includes("HiringLead")) {
      const term = await prisma.term.findFirst({ orderBy: { sortKey: "desc" } });
      if (term) {
        const exists = await prisma.coreAssignment.findFirst({
          where: { userId: user.id, termId: term.id, leadTitle: "Hiring Lead" },
        });
        if (!exists) {
          await prisma.coreAssignment.create({
            data: { userId: user.id, termId: term.id, leadTitle: "Hiring Lead" },
          });
        }
      }
    }

    seeded++;
  }

  console.log(`Seeded ${seeded} members`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
