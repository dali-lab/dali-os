import { PrismaClient } from "../app/generated/prisma/client.js";
import { PrismaPg } from "@prisma/adapter-pg";
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
const prisma = new PrismaClient({ adapter });

const cycles = await prisma.applicationCycle.findMany({ orderBy: { createdAt: "desc" } });
console.log("=== CYCLES ===");
for (const c of cycles) console.log(`${c.id} — ${c.name}`);

const apps = await prisma.application.findMany({
  include: {
    user: { select: { firstName: true, lastName: true, dartmouthEmail: true, daliEmail: true, netId: true } },
    statusUpdates: { orderBy: { createdAt: "desc" }, take: 1 },
    applicationCycle: { select: { name: true } },
  },
  orderBy: { createdAt: "desc" },
});
console.log("\n=== ALL APPLICATIONS ===");
for (const app of apps) {
  const status = app.statusUpdates[0]?.newStatus ?? "Draft";
  const email = app.user.daliEmail ?? app.user.dartmouthEmail ?? app.user.netId ?? "?";
  console.log(`${app.user.firstName} ${app.user.lastName} (${email}) — ${status} — ${app.applicationCycle.name}`);
}

await prisma.$disconnect();
