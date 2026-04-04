import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import Navbar from '@/components/Navbar';

type AccountType = 'member' | 'dartmouth' | 'partner' | null;

const DALI_DB_URL = import.meta.env.VITE_DALI_DB_URL ?? 'http://localhost:3001';

const ENDPOINT: Record<'member' | 'dartmouth' | 'partner', string> = {
  member: '/auth/google/member',
  dartmouth: '/auth/google/user',
  partner: '/auth/google/partner',
};

async function exchangeGoogleToken(idToken: string, type: 'member' | 'dartmouth' | 'partner') {
  const endpoint = ENDPOINT[type];
  const res = await fetch(`${DALI_DB_URL}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include', // send/receive httpOnly refresh cookie
    body: JSON.stringify({ idToken }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? 'Authentication failed');
  }
  return res.json();
}

const LAST_LOGIN_KEY = 'last_login_type';

export default function Login() {
  const [accountType, setAccountType] = useState<AccountType>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastLogin = localStorage.getItem(LAST_LOGIN_KEY) as AccountType;
  const navigate = useNavigate();

  const handleGoogleSuccess = async (type: AccountType, idToken: string) => {
    if (!type) return;
    setLoading(true);
    setError(null);
    try {
      const data = await exchangeGoogleToken(idToken, type);
      sessionStorage.setItem('access_token', data.accessToken);
      sessionStorage.setItem('account_type', type);
      sessionStorage.setItem('account', JSON.stringify(type === 'partner' ? data.partner : data.user));
      localStorage.setItem(LAST_LOGIN_KEY, type);
      navigate('/');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
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
            style={{ overflow: 'visible' }}
          >
            <motion.rect y="0.276825" width="76.3096" height="76.3096" fill="#FFF3B5"
              initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
              style={{ transformOrigin: '38.15px 38.43px' }} />
            <motion.circle cx="37.3235" cy="38.1549" r="19.0774" fill="#CA60AC"
              initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.1, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }} />
            <motion.circle cx="114.373" cy="37.9701" r="19.0774" fill="#FFA89C"
              initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }} />
            <motion.rect x="152.711" width="76.3096" height="76.3096" fill="#8CE0D6"
              initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.3, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }}
              style={{ transformOrigin: '190.87px 38.15px' }} />
            <motion.circle cx="190.312" cy="37.9701" r="19.0774" fill="#404040"
              initial={{ scale: 0, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.4, duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }} />
          </svg>

          <motion.div
            initial={{ opacity: 0, x: -30 }} animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="relative z-10"
          >
            <h2 className="font-heading text-4xl lg:text-5xl font-bold text-nav-primary dark:text-white leading-tight mb-6">
              Welcome to<br />
              <span className="text-accent-coral">DALI Lab</span>
            </h2>
            <p className="text-gray-600 dark:text-gray-300 text-lg leading-relaxed max-w-sm">
              Dartmouth's premier experiential learning lab — where students build real products for real partners.
            </p>
          </motion.div>

          <motion.div className="absolute bottom-16 right-8 w-32 h-32 rounded-full bg-[#8CE0D6] opacity-30 dark:opacity-20 pointer-events-none"
            initial={{ scale: 0 }} animate={{ scale: 1 }}
            transition={{ delay: 0.5, duration: 0.6, ease: [0.34, 1.56, 0.64, 1] }} />
          <motion.div className="absolute bottom-32 right-24 w-16 h-16 rounded-full bg-accent-coral opacity-20 pointer-events-none"
            initial={{ scale: 0 }} animate={{ scale: 1 }}
            transition={{ delay: 0.65, duration: 0.5, ease: [0.34, 1.56, 0.64, 1] }} />
        </div>

        {/* Right form panel */}
        <div className="w-full md:w-1/2 min-h-[calc(100vh-72px)] flex items-center justify-center px-6 md:px-12 lg:px-16 bg-background">
          <div className="w-full max-w-sm">

            {/* Step 1: choose account type */}
            {!accountType && (
              <motion.div
                initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, ease: 'easeOut' }}
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
                    onClick={() => setAccountType('member')}
                    className="flex items-center gap-4 p-5 rounded-2xl border-2 border-transparent bg-[#E8F4FA] dark:bg-[#0d2133] hover:border-accent-coral transition group text-left"
                  >
                    <div className="w-10 h-10 rounded-full dark:bg-[#1a3347] flex items-center justify-center flex-shrink-0 shadow-sm">
                      <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-heading font-semibold text-nav-primary dark:text-white group-hover:text-accent-coral transition">
                          DALI Member
                        </span>
                        {lastLogin === 'member' && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent-coral/20 text-accent-coral font-semibold tracking-wide">
                            last used
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        @dali.dartmouth.edu Google account
                      </div>
                    </div>
                    <svg className="w-4 h-4 text-gray-400 group-hover:text-accent-coral transition flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>

                  {/* Dartmouth Student */}
                  <button
                    onClick={() => setAccountType('dartmouth')}
                    className="flex items-center gap-4 p-5 rounded-2xl border-2 border-transparent bg-[#E8F4FA] dark:bg-[#0d2133] hover:border-accent-coral transition group text-left"
                  >
                    <div className="w-10 h-10 rounded-full bg-white dark:bg-[#1a3347] flex items-center justify-center flex-shrink-0 shadow-sm">
                      <svg className="w-5 h-5 text-nav-primary dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l9-5-9-5-9 5 9 5z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 14l6.16-3.422a12.083 12.083 0 01.665 6.479A11.952 11.952 0 0012 20.055a11.952 11.952 0 00-6.824-2.998 12.078 12.078 0 01.665-6.479L12 14z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-heading font-semibold text-nav-primary dark:text-white group-hover:text-accent-coral transition">
                          Dartmouth Student
                        </span>
                        {lastLogin === 'dartmouth' && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent-coral/20 text-accent-coral font-semibold tracking-wide">
                            last used
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        @dartmouth.edu Google account
                      </div>
                    </div>
                    <svg className="w-4 h-4 text-gray-400 group-hover:text-accent-coral transition flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>

                  {/* Partner */}
                  <button
                    onClick={() => setAccountType('partner')}
                    className="flex items-center gap-4 p-5 rounded-2xl border-2 border-transparent bg-[#E8F4FA] dark:bg-[#0d2133] hover:border-accent-coral transition group text-left"
                  >
                    <div className="w-10 h-10 rounded-full bg-white dark:bg-[#1a3347] flex items-center justify-center flex-shrink-0 shadow-sm">
                      <svg className="w-5 h-5 text-nav-primary dark:text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-heading font-semibold text-nav-primary dark:text-white group-hover:text-accent-coral transition">
                          Partner
                        </span>
                        {lastLogin === 'partner' && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent-coral/20 text-accent-coral font-semibold tracking-wide">
                            last used
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        Organization, company, or individual
                      </div>
                    </div>
                    <svg className="w-4 h-4 text-gray-400 group-hover:text-accent-coral transition flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </button>
                </div>
              </motion.div>
            )}

            {/* Step 2: Google sign-in button */}
            {accountType && (
              <motion.div
                key={accountType}
                initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, ease: 'easeOut' }}
              >
                <button
                  onClick={() => { setAccountType(null); setError(null); }}
                  className="flex items-center gap-1 text-sm text-gray-500 hover:text-accent-coral transition mb-8 font-medium"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                  </svg>
                  Back
                </button>

                <h1 className="font-heading text-3xl font-bold text-nav-primary dark:text-white mb-1">
                  Sign in
                </h1>
                <p className="text-gray-500 dark:text-gray-400 mb-8">
                  as a{' '}
                  <span className="font-semibold text-accent-coral">
                    {accountType === 'member' ? 'DALI Member' : accountType === 'dartmouth' ? 'Dartmouth Student' : 'Partner'}
                  </span>
                </p>

                <p className="text-sm text-gray-500 dark:text-gray-400 bg-[#E8F4FA] dark:bg-[#0d2133] rounded-xl px-4 py-3 mb-6">
                  {accountType === 'member' && <>Use your <span className="font-semibold text-nav-primary dark:text-white">@dali.dartmouth.edu</span> Google account.</>}
                  {accountType === 'dartmouth' && <>Use your <span className="font-semibold text-nav-primary dark:text-white">@dartmouth.edu</span> Google account.</>}
                  {accountType === 'partner' && <>Use any Google account. Don't use a Dartmouth email.</>}
                </p>

                <GoogleSignInButton
                  loading={loading}
                  onCredential={(idToken) => handleGoogleSuccess(accountType, idToken)}
                  onError={(msg) => setError(msg)}
                />

                {error && (
                  <p className="mt-4 text-sm text-red-500 text-center">{error}</p>
                )}
              </motion.div>
            )}

          </div>
        </div>
      </section>
    </div>
  );
}

// ── Google Sign-In Button ─────────────────────────────────────────────────────
// Uses the One Tap / CredentialResponse flow which gives us an id_token directly

import { GoogleLogin } from '@react-oauth/google';

function GoogleSignInButton({
  loading,
  onCredential,
  onError,
}: {
  loading: boolean;
  onCredential: (idToken: string) => void;
  onError: (msg: string) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 w-full py-3 rounded-full border border-gray-200 dark:border-gray-700 text-gray-500 text-sm">
        <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
        </svg>
        Signing in…
      </div>
    );
  }

  return (
    <div className="flex justify-center">
      <GoogleLogin
        onSuccess={(credentialResponse) => {
          if (credentialResponse.credential) {
            onCredential(credentialResponse.credential);
          } else {
            onError('No credential returned from Google');
          }
        }}
        onError={() => onError('Google sign-in failed')}
        theme="outline"
        size="large"
        shape="pill"
        text="signin_with"
        width="320"
      />
    </div>
  );
}
