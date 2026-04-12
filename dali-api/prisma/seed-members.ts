import { readFileSync } from "fs";
import { join } from "path";
import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

interface Member {
  firstName: string | null;
  lastName: string | null;
  daliEmail: string | null;
  dartmouthEmail: string | null;
  did: string | null;
}

async function main() {
  const members: Member[] = JSON.parse(
    readFileSync(join(import.meta.dirname, "data/members.json"), "utf-8")
  );

  let seeded = 0;
  for (const { firstName, lastName, daliEmail, dartmouthEmail, did } of members) {
    if (!daliEmail) continue;
    await prisma.dALIMember.upsert({
      where: { daliEmail },
      update: { firstName, lastName, dartmouthEmail, did },
      create: { firstName, lastName, daliEmail, dartmouthEmail, did },
    });
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
