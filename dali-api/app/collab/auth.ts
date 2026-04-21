import { auth } from "~/lib/auth";

export async function verifyCollabToken(token: string): Promise<{ sub: string; email: string; type: string } | null> {
  try {
    const session = await auth.api.getSession({
      headers: new Headers({ cookie: `better-auth.session_token=${token}` }),
    });
    if (!session) return null;
    return {
      sub: session.user.id,
      email: session.user.email,
      type: (session.user as any).type ?? "partner",
    };
  } catch {
    return null;
  }
}
