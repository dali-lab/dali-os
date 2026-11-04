import { afterAll, beforeEach } from "vitest";
import { integrationDatabaseUrl } from "./database-url";
import { prisma, resetDatabase } from "./db";

integrationDatabaseUrl();

beforeEach(async () => {
  await resetDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});
