export async function getCollabToken(request: Request): Promise<string | null> {
  try {
    const { getBetterAuthCollabToken } = await import("~/lib/betterauth-compat.server");
    return await getBetterAuthCollabToken(request);
  } catch {
    return null;
  }
}
