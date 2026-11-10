const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "postgres"]);

export function integrationDatabaseUrl(): string {
  const raw = process.env.DATABASE_URL;
  if (!raw) {
    throw new Error("Integration tests need DATABASE_URL pointing at a throwaway local Postgres database.");
  }
  const { hostname } = new URL(raw);
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(`Refusing to run integration tests against ${hostname}: every table is truncated between tests.`);
  }
  return raw;
}
