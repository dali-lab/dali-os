import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "~/lib/db";

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.API_BASE_URL ?? "http://localhost:3001",
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: {
    enabled: true,
  },
  trustedOrigins: [
    process.env.FRONTEND_URL ?? "http://localhost:5173",
  ],
  session: {
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5,
    },
  },
  user: {
    additionalFields: {
      firstName: { type: "string", required: true },
      lastName: { type: "string", required: true },
    },
  },
});

// auth middleware — used by every protected route

type AuthSuccess = {
  ok: true;
  user: { sub: string; email: string };
};
type AuthFailure = { ok: false; response: Response };
export type AuthResult = AuthSuccess | AuthFailure;

export async function requireAuth(request: Request): Promise<AuthResult> {
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session) {
    return {
      ok: false,
      response: new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }),
    };
  }

  return {
    ok: true,
    user: {
      sub: session.user.id,
      email: session.user.email,
    },
  };
}
