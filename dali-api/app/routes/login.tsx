import { randomBytes } from "node:crypto";
import { Form, redirect, useSearchParams } from "react-router";
import type { Route } from "./+types/login";
import { requireAuth } from "~/lib/auth";

const OAUTH_STATE_COOKIE = "__dali_oauth_state";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (auth.ok) return redirect("/admin");
  return {};
}

export async function action({ request }: Route.ActionArgs) {
  const state = randomBytes(32).toString("base64url");
  const apiBase = process.env.API_BASE_URL ?? "http://localhost:3001";

  const stateCookie = [
    `${OAUTH_STATE_COOKIE}=${state}`,
    "Path=/auth/callback/google",
    "Max-Age=600",
    "HttpOnly",
    "SameSite=Lax",
    ...(process.env.NODE_ENV === "production" ? ["Secure"] : []),
  ].join("; ");

  const googleParams = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${apiBase}/auth/callback/google`,
    response_type: "code",
    scope: "openid email profile",
    hd: "dali.dartmouth.edu",
    state,
  });

  return new Response(null, {
    status: 302,
    headers: {
      "Set-Cookie": stateCookie,
      Location: `https://accounts.google.com/o/oauth2/v2/auth?${googleParams}`,
    },
  });
}

export default function Login() {
  const [searchParams] = useSearchParams();
  const error = searchParams.get("error");

  const errorMessages: Record<string, string> = {
    access_denied: "Only @dali.dartmouth.edu accounts are allowed.",
    google_auth_failed: "Google sign-in failed. Please try again.",
    session_expired: "Session expired. Please try again.",
    server_error: "Something went wrong. Please try again.",
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-100 p-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-1">DALI Admin</h1>
        <p className="text-sm text-gray-500 mb-8">Sign in with your DALI Google account.</p>

        {error && (
          <p className="mb-6 text-sm text-red-600 bg-red-50 rounded-lg px-4 py-3">
            {errorMessages[error] ?? "Sign-in failed. Please try again."}
          </p>
        )}

        <Form method="post">
          <button
            type="submit"
            className="w-full flex items-center justify-center gap-3 px-4 py-3 rounded-xl bg-gray-900 text-white text-sm font-semibold hover:bg-gray-700 transition"
          >
            <svg viewBox="0 0 24 24" className="w-5 h-5" aria-hidden="true">
              <path
                fill="#fff"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#fff"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#fff"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
              />
              <path
                fill="#fff"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
              />
            </svg>
            Sign in with Google
          </button>
        </Form>
      </div>
    </div>
  );
}
