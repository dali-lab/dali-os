import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { motion } from "framer-motion";
import Navbar from "@/components/Navbar";
import { generateCodeVerifier, computeCodeChallenge, generateState } from "@/lib/pkce";
import { exchangeAndStoreUser } from "@/lib/auth";

type AccountType = "member" | "dartmouth" | "partner" | null;

const DALI_DB_URL = import.meta.env.VITE_DALI_DB_URL ?? "http://localhost:3001";
const FRONTEND_URL = import.meta.env.VITE_FRONTEND_URL ?? "http://localhost:5173";
const LAST_LOGIN_KEY = "last_login_type";

// ── OAuth 2.0 + PKCE ────────────────────────────────────────────────────────

async function startOAuthFlow(provider: "google" | "cas", accountType?: string) {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await computeCodeChallenge(codeVerifier);
  const state = generateState();

  sessionStorage.setItem("pkce_code_verifier", codeVerifier);
  sessionStorage.setItem("oauth_state", state);

  const params = new URLSearchParams({
    response_type: "code",
    client_id: "dali-web",
    redirect_uri: `${FRONTEND_URL}/login`,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    provider,
  });
  if (accountType) {
    params.set("account_type", accountType);
  }

  window.location.href = `${DALI_DB_URL}/oauth/authorize?${params}`;
}

async function exchangeCodeForTokens(code: string): Promise<void> {
  const codeVerifier = sessionStorage.getItem("pkce_code_verifier");
  if (!codeVerifier) throw new Error("Missing PKCE code_verifier");

  const res = await fetch(`${DALI_DB_URL}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({
      grant_type: "authorization_code",
      code,
      code_verifier: codeVerifier,
      redirect_uri: `${FRONTEND_URL}/login`,
      client_id: "dali-web",
    }),
  });

  // Clean up PKCE state
  sessionStorage.removeItem("pkce_code_verifier");
  sessionStorage.removeItem("oauth_state");

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error_description ?? err.error ?? "Token exchange failed");
  }

  await exchangeAndStoreUser(res);
}

// ── Component ────────────────────────────────────────────────────────────────

export default function Login() {
  const [error, setError] = useState<string | null>(null);
  const [lastLogin, setLastLogin] = useState<AccountType>(null);

  useEffect(() => {
    setLastLogin(localStorage.getItem(LAST_LOGIN_KEY) as AccountType);
  }, []);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Handle OAuth callback: ?code=...&state=...
  useEffect(() => {
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const oauthError = searchParams.get("error");
    const errorDescription = searchParams.get("error_description");

    if (oauthError) {
      setError(errorDescription ?? oauthError);
      return;
    }

    if (code && state) {
      // Verify state (CSRF protection)
      const savedState = sessionStorage.getItem("oauth_state");
      if (state !== savedState) {
        setError("Invalid state parameter — possible CSRF attack");
        return;
      }

      (async () => {
        try {
          await exchangeCodeForTokens(code);
          navigate("/portal", { replace: true });
        } catch (err: any) {
          setError(err.message);
        }
      })();
    }
  }, [searchParams, navigate]);

  const handleLogin = (provider: "google" | "cas", accountType?: string) => {
    if (accountType) localStorage.setItem(LAST_LOGIN_KEY, accountType);
    else if (provider === "cas") localStorage.setItem(LAST_LOGIN_KEY, "dartmouth");
    startOAuthFlow(provider, accountType);
  };

  return (
    <div className="min-h-screen bg-background overflow-x-clip">
      <Navbar />

      <section className="pt-[72px] min-h-[calc(100vh-72px)] flex relative overflow-visible">
        {/* Left decorative panel */}
        <div className="hidden md:flex w-1/2 min-h-[calc(100vh-72px)] bg-[#E8F4FA] dark:bg-[#061825] flex-col justify-center px-12 lg:px-16 relative overflow-visible">
          <svg
            viewBox="0 0 290 77"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="absolute top-12 left-4 w-[220px] lg:w-[290px] h-auto pointer-events-none z-10"
            style={{ overflow: "visible" }}
          >
            <motion.rect
              y="0.276825"
              width="76.3096"
              height="76.3096"
              fill="#FFF3B5"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{
                delay: 0,
                duration: 0.5,
                ease: [0.34, 1.56, 0.64, 1],
              }}
              style={{ transformOrigin: "38.15px 38.43px" }}
            />
            <motion.circle
              cx="37.3235"
              cy="38.1549"
              r="19.0774"
              fill="#CA60AC"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{
                delay: 0.1,
                duration: 0.4,
                ease: [0.34, 1.56, 0.64, 1],
              }}
            />
            <motion.circle
              cx="114.373"
              cy="37.9701"
              r="19.0774"
              fill="#FFA89C"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{
                delay: 0.2,
                duration: 0.4,
                ease: [0.34, 1.56, 0.64, 1],
              }}
            />
            <motion.rect
              x="152.711"
              width="76.3096"
              height="76.3096"
              fill="#8CE0D6"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{
                delay: 0.3,
                duration: 0.5,
                ease: [0.34, 1.56, 0.64, 1],
              }}
              style={{ transformOrigin: "190.87px 38.15px" }}
            />
            <motion.circle
              cx="190.312"
              cy="37.9701"
              r="19.0774"
              fill="#404040"
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{
                delay: 0.4,
                duration: 0.4,
                ease: [0.34, 1.56, 0.64, 1],
              }}
            />
          </svg>

          <motion.div
            initial={{ opacity: 0, x: -30 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, ease: "easeOut" }}
            className="relative z-10"
          >
            <h2 className="font-heading text-4xl lg:text-5xl font-bold text-nav-primary dark:text-white leading-tight mb-6">
              Welcome to
              <br />
              <span className="text-accent-coral">DALI Lab</span>
            </h2>
            <p className="text-gray-600 dark:text-gray-300 text-lg leading-relaxed max-w-sm">
              Dartmouth's premier experiential learning lab — where students
              build real products for real partners.
            </p>
          </motion.div>

          <motion.div
            className="absolute bottom-16 right-8 w-32 h-32 rounded-full bg-[#8CE0D6] opacity-30 dark:opacity-20 pointer-events-none"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{
              delay: 0.5,
              duration: 0.6,
              ease: [0.34, 1.56, 0.64, 1],
            }}
          />
          <motion.div
            className="absolute bottom-32 right-24 w-16 h-16 rounded-full bg-accent-coral opacity-20 pointer-events-none"
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{
              delay: 0.65,
              duration: 0.5,
              ease: [0.34, 1.56, 0.64, 1],
            }}
          />
        </div>

        {/* Right form panel */}
        <div className="w-full md:w-1/2 min-h-[calc(100vh-72px)] flex items-center justify-center px-6 md:px-12 lg:px-16 bg-background">
          <div className="w-full max-w-sm">
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, ease: "easeOut" }}
            >
              <h1 className="font-heading text-3xl font-bold text-nav-primary dark:text-white mb-2">
                Sign in
              </h1>
              <p className="text-gray-500 dark:text-gray-400 mb-10">
                Select how you'd like to continue
              </p>
              <div className="flex flex-col gap-4">
                {/* DALI Member */}
                <button
                  onClick={() => handleLogin("google", "member")}
                  className="flex items-center gap-4 p-5 rounded-2xl border-2 border-transparent bg-[#E8F4FA] dark:bg-[#0d2133] hover:border-accent-coral transition group text-left"
                >
                  <div className="w-10 h-10 rounded-full dark:bg-[#1a3347] flex items-center justify-center flex-shrink-0 shadow-sm">
                    <svg
                      className="w-5 h-5 text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z"
                      />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-heading font-semibold text-nav-primary dark:text-white group-hover:text-accent-coral transition">
                        DALI Member
                      </span>
                      {lastLogin === "member" && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent-coral/20 text-accent-coral font-semibold tracking-wide">
                          last used
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      @dali.dartmouth.edu Google account
                    </div>
                  </div>
                  <svg
                    className="w-4 h-4 text-gray-400 group-hover:text-accent-coral transition flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </button>

                {/* Dartmouth Student — CAS */}
                <button
                  onClick={() => handleLogin("cas")}
                  className="flex items-center gap-4 p-5 rounded-2xl border-2 border-transparent bg-[#E8F4FA] dark:bg-[#0d2133] hover:border-accent-coral transition group text-left"
                >
                  <div className="w-10 h-10 rounded-full bg-white dark:bg-[#1a3347] flex items-center justify-center flex-shrink-0 shadow-sm">
                    <svg
                      className="w-5 h-5 text-nav-primary dark:text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 14l9-5-9-5-9 5 9 5z"
                      />
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z"
                      />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-heading font-semibold text-nav-primary dark:text-white group-hover:text-accent-coral transition">
                        Dartmouth Student
                      </span>
                      {lastLogin === "dartmouth" && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent-coral/20 text-accent-coral font-semibold tracking-wide">
                          last used
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Dartmouth CAS single sign-on
                    </div>
                  </div>
                  <svg
                    className="w-4 h-4 text-gray-400 group-hover:text-accent-coral transition flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </button>

                {/* Partner */}
                <button
                  onClick={() => handleLogin("google", "partner")}
                  className="flex items-center gap-4 p-5 rounded-2xl border-2 border-transparent bg-[#E8F4FA] dark:bg-[#0d2133] hover:border-accent-coral transition group text-left"
                >
                  <div className="w-10 h-10 rounded-full bg-white dark:bg-[#1a3347] flex items-center justify-center flex-shrink-0 shadow-sm">
                    <svg
                      className="w-5 h-5 text-nav-primary dark:text-white"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                      />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-heading font-semibold text-nav-primary dark:text-white group-hover:text-accent-coral transition">
                        Partner
                      </span>
                      {lastLogin === "partner" && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent-coral/20 text-accent-coral font-semibold tracking-wide">
                          last used
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Organization, company, or individual
                    </div>
                  </div>
                  <svg
                    className="w-4 h-4 text-gray-400 group-hover:text-accent-coral transition flex-shrink-0"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M9 5l7 7-7 7"
                    />
                  </svg>
                </button>
              </div>

              {error && (
                <p className="mt-6 text-sm text-red-500 text-center">
                  {error}
                </p>
              )}
            </motion.div>
          </div>
        </div>
      </section>
    </div>
  );
}
