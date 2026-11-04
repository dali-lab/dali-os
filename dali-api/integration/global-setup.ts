import { execSync } from "node:child_process";
import { integrationDatabaseUrl } from "./database-url";

export default function setup() {
  const url = integrationDatabaseUrl();
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: url, DIRECT_URL: process.env.DIRECT_URL ?? url },
  });
}
