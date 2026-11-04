import { afterEach, describe, expect, it } from "vitest";
import { integrationDatabaseUrl } from "./database-url";

const original = process.env.DATABASE_URL;
afterEach(() => {
  process.env.DATABASE_URL = original;
});

describe("integrationDatabaseUrl", () => {
  it("requires DATABASE_URL", () => {
    delete process.env.DATABASE_URL;
    expect(() => integrationDatabaseUrl()).toThrow(/need DATABASE_URL/);
  });

  it.each(["localhost", "127.0.0.1", "postgres"])("accepts a local host (%s)", (host) => {
    process.env.DATABASE_URL = `postgresql://dali:dali@${host}:5432/dali_test`;
    expect(integrationDatabaseUrl()).toBe(process.env.DATABASE_URL);
  });

  it("refuses a remote host so a real database is never truncated", () => {
    process.env.DATABASE_URL = "postgresql://u:p@ep-cool-name.us-east-2.aws.neon.tech/neondb";
    expect(() => integrationDatabaseUrl()).toThrow(/Refusing .*neon\.tech/);
  });
});
