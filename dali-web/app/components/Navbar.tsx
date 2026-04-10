import { useState, useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router';
import { getUser } from '@/lib/auth';
import type { UserInfo } from '@/lib/auth';

interface NavbarProps {
  className?: string;
}

interface SessionAccount extends UserInfo {
  name?: string;
  picture?: string;
}

function getSession(): { account: SessionAccount } | null {
  if (typeof window === 'undefined') return null;
  const user = getUser();
  if (!user) return null;
  return { account: user as SessionAccount };
}

const navLinks = [
  { label: 'About', path: '/about' },
  { label: 'Projects', path: '/projects' },
  { label: 'Education', path: '/education' },
  { label: 'People', path: '/team' },
  { label: 'For Students', path: '/apply' },
  { label: 'For Partners', path: '/partners' },
];

export default function Navbar({ className = '' }: NavbarProps) {
  const [showNav, setShowNav] = useState(true);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  // Must start as null: SSR has no sessionStorage; syncing in useEffect matches
  // server HTML and avoids hydration mismatch (client-only getSession differs).
  const [session, setSession] = useState<ReturnType<typeof getSession>>(null);
  const lastScrollY = useRef(0);
  const location = useLocation();

  // After mount + on navigation: read session (client-only)
  useEffect(() => {
    setSession(getSession());
  }, [location.pathname]);

  // Hide on scroll down, show on scroll up
  useEffect(() => {
    let ticking = false;
    const controlNavbar = () => {
      const currentScrollY = window.scrollY;
      if (!ticking) {
        window.requestAnimationFrame(() => {
          if (currentScrollY > lastScrollY.current && currentScrollY > 80) {
            setShowNav(false);
            setMobileMenuOpen(false);
          } else if (currentScrollY < lastScrollY.current) {
            setShowNav(true);
          }
          lastScrollY.current = currentScrollY;
          ticking = false;
        });
        ticking = true;
      }
    };
    window.addEventListener('scroll', controlNavbar);
    return () => window.removeEventListener('scroll', controlNavbar);
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

  const isActive = (path: string) => location.pathname === path;

  const displayName = session
    ? session.account.firstName
      ? `${session.account.firstName} ${session.account.lastName ?? ''}`.trim()
      : session.account.name ?? session.account.email
    : null;

  return (
    <>
      <nav
        className={`fixed top-0 left-0 right-0 z-50 flex justify-between items-center pl-3 pr-6 md:pl-6 md:pr-12 py-4 md:py-5 bg-background dark:bg-[hsl(210,45%,20%)] shadow-lg transition-transform duration-300 ease-in-out ${showNav ? 'translate-y-0' : '-translate-y-full'} ${className}`}
      >
        {/* Logo */}
        <Link
          to="/"
          className="flex items-center gap-3 text-nav-primary dark:text-white hover:opacity-80 transition"
          onClick={() => window.scrollTo(0, 0)}
        >
          <svg className="h-12" viewBox="0 0 120 40" xmlns="http://www.w3.org/2000/svg">
            <g fill="currentColor">
              <path d="M10 8h8c6 0 10 4 10 10s-4 10-10 10h-8V8zm8 16c3 0 5-2 5-6s-2-6-5-6h-3v12h3z" />
              <path d="M35 8h5l8 20h-5l-1.5-4h-7l-1.5 4h-5l8-20zm0 12h4l-2-6-2 6z" />
              <path d="M50 8h5v16h8v4h-13V8z" />
              <path d="M67 8h5v20h-5V8z" />
            </g>
          </svg>
        </Link>

        {/* Desktop Navigation */}
        <div className="hidden md:flex items-center space-x-6 lg:space-x-8 font-heading font-medium text-sm lg:text-base">
          {navLinks.map((link) => (
            <Link
              key={link.path}
              to={link.path}
              className={`transition-colors tracking-wider font-medium ${
                isActive(link.path)
                  ? 'text-accent-coral dark:text-accent-coral'
                  : 'text-nav-primary dark:text-white hover:text-accent-coral'
              }`}
              onClick={() => window.scrollTo(0, 0)}
            >
              {link.label}
            </Link>
          ))}

          {session ? (
            <Link
              to="/account"
              className="flex items-center gap-2 pl-1 pr-3 py-1 rounded-full bg-[#E8F4FA] dark:bg-[#0d2133] hover:opacity-80 transition-opacity min-h-9"
              onClick={() => window.scrollTo(0, 0)}
            >
              {session.account.picture ? (
                <img
                  src={session.account.picture}
                  alt={displayName ?? ''}
                  className="w-7 h-7 rounded-full object-cover bg-muted shrink-0"
                  decoding="async"
                />
              ) : (
                <div className="w-7 h-7 rounded-full bg-accent-coral flex items-center justify-center text-white text-xs font-bold">
                  {(displayName ?? session.account.email)[0].toUpperCase()}
                </div>
              )}
              <span className="text-sm font-semibold text-nav-primary dark:text-white max-w-[120px] truncate">
                {displayName}
              </span>
            </Link>
          ) : (
            <Link
              to="/login"
              className="inline-flex items-center justify-center min-h-9 min-w-[7.5rem] px-4 py-1.5 rounded-full bg-accent-coral text-white font-semibold tracking-wider hover:bg-opacity-90 transition-opacity"
              onClick={() => window.scrollTo(0, 0)}
            >
              Login
            </Link>
          )}
        </div>

        {/* Mobile Menu Button */}
        <button
          className="md:hidden text-nav-primary dark:text-white p-2"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Toggle menu"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            {mobileMenuOpen ? (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            )}
          </svg>
        </button>
      </nav>

      {/* Mobile Menu */}
      {mobileMenuOpen && (
        <div className="fixed top-[4rem] left-0 right-0 bg-background dark:bg-[hsl(210,45%,20%)] shadow-lg z-40 md:hidden">
          <div className="flex flex-col space-y-4 px-6 py-6 font-heading font-medium">
            {navLinks.map((link) => (
              <Link
                key={link.path}
                to={link.path}
                className={`transition-colors tracking-wider font-medium ${
                  isActive(link.path)
                    ? 'text-accent-coral dark:text-accent-coral'
                    : 'text-nav-primary dark:text-white hover:text-accent-coral'
                }`}
                onClick={() => { setMobileMenuOpen(false); window.scrollTo(0, 0); }}
              >
                {link.label}
              </Link>
            ))}

            {session ? (
              <Link
                to="/account"
                className="flex items-center gap-3 pt-4 border-t border-gray-100 dark:border-gray-700"
                onClick={() => { setMobileMenuOpen(false); window.scrollTo(0, 0); }}
              >
                {session.account.picture ? (
                  <img src={session.account.picture} alt="" className="w-8 h-8 rounded-full object-cover" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-accent-coral flex items-center justify-center text-white text-sm font-bold">
                    {(displayName ?? session.account.email)[0].toUpperCase()}
                  </div>
                )}
                <span className="text-sm font-semibold text-nav-primary dark:text-white">{displayName}</span>
              </Link>
            ) : (
              <Link
                to="/login"
                className="self-start px-4 py-1.5 rounded-full bg-accent-coral text-white font-semibold tracking-wider hover:bg-opacity-90 transition"
                onClick={() => { setMobileMenuOpen(false); window.scrollTo(0, 0); }}
              >
                Login
              </Link>
            )}
          </div>
        </div>
      )}
    </>
  );
}
