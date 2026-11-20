export async function verifyCollabToken(rawToken: string): Promise<{ sub: string }> {
  try {
    const { verifyBetterAuthBearerToken } = await import("~/lib/betterauth-compat.server");
    const sub = await verifyBetterAuthBearerToken(rawToken);
    if (sub) return { sub };
  } catch {
    // a BetterAuth fault must read as an invalid token, not a 500
  }
  throw new Error("Invalid session");
}
