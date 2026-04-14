import { useState, useEffect, useRef } from "react";
import { Menu, X } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DaliHeaderProps {
  activeItem?: "team" | "projects" | "events" | "education" | "dali" | "students" | "partners";
}

export default function DaliHeader({ activeItem }: DaliHeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [showNav, setShowNav] = useState(true);
  const lastScrollY = useRef(0);

  // Scroll detection for navbar
  useEffect(() => {
    const controlNavbar = () => {
      const currentScrollY = window.scrollY;

      if (currentScrollY < lastScrollY.current) {
        // Scrolling up
        setShowNav(true);
      } else if (currentScrollY > lastScrollY.current && currentScrollY > 100) {
        // Scrolling down
        setShowNav(false);
      }

      lastScrollY.current = currentScrollY;
    };

    window.addEventListener('scroll', controlNavbar);

    return () => {
      window.removeEventListener('scroll', controlNavbar);
    };
  }, []);

  return (
    <header className={`fixed left-0 right-0 z-50 bg-white shadow-md transition-transform duration-700 ease-in-out ${showNav ? 'top-0 translate-y-0' : '-translate-y-full'}`}>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex h-16 items-center justify-between">
          {/* Left Navigation */}
          <nav className="hidden md:flex items-center space-x-8 flex-1 justify-start">
            <a
              href="https://dali.dartmouth.edu"
              className={`text-sm font-medium transition-colors ${
                activeItem === "dali"
                  ? "text-dali-teal font-semibold"
                  : "text-dali-teal/80 hover:text-dali-teal"
              }`}
            >
              Dali
            </a>
            <a
              href="https://dali.dartmouth.edu/events"
              className={`text-sm font-medium transition-colors ${
                activeItem === "events"
                  ? "text-dali-teal font-semibold"
                  : "text-dali-teal/80 hover:text-dali-teal"
              }`}
            >
              Events
            </a>
            <a
              href="https://dali.dartmouth.edu/education"
              className={`text-sm font-medium transition-colors ${
                activeItem === "education"
                  ? "text-dali-teal font-semibold"
                  : "text-dali-teal/80 hover:text-dali-teal"
              }`}
            >
              Education
            </a>
            <a
              href="/projects"
              className={`text-sm font-medium transition-colors ${
                activeItem === "projects"
                  ? "text-dali-teal font-semibold"
                  : "text-dali-teal/80 hover:text-dali-teal"
              }`}
            >
              Projects
            </a>
          </nav>

          {/* Centered Logo */}
          <div className="flex items-center justify-center flex-1">
            <a
              href="https://dali.dartmouth.edu"
              className="hover:opacity-80 transition-opacity"
            >
              <img
                src="/DALI_tealLogo.webp"
                alt="DALI Lab"
                className="h-8 w-auto"
              />
            </a>
          </div>

          {/* Right Navigation */}
          <nav className="hidden md:flex items-center space-x-8 flex-1 justify-end">
            <a
              href="/team"
              className={`text-sm font-medium transition-colors ${
                activeItem === "team"
                  ? "text-dali-teal font-semibold"
                  : "text-dali-teal/80 hover:text-dali-teal"
              }`}
            >
              Team
            </a>
            <a
              href="https://dali.dartmouth.edu/apply"
              className={`text-sm font-medium transition-colors ${
                activeItem === "students"
                  ? "text-dali-teal font-semibold"
                  : "text-dali-teal/80 hover:text-dali-teal"
              }`}
            >
              For students
            </a>
            <a
              href="https://dali.dartmouth.edu/partners"
              className={`text-sm font-medium transition-colors ${
                activeItem === "partners"
                  ? "text-dali-teal font-semibold"
                  : "text-dali-teal/80 hover:text-dali-teal"
              }`}
            >
              For partners
            </a>
          </nav>

          {/* Mobile menu button */}
          <div className="md:hidden">
            <Button
              variant="ghost"
              size="sm"
              className="text-dali-teal hover:bg-dali-teal/10"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            >
              {mobileMenuOpen ? (
                <X className="h-5 w-5" />
              ) : (
                <Menu className="h-5 w-5" />
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Mobile Navigation */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-dali-teal/20 bg-white">
          <div className="px-4 py-2 space-y-1">
            <a
              href="https://dali.dartmouth.edu"
              className={`block px-3 py-2 text-base font-medium ${
                activeItem === "dali"
                  ? "text-dali-teal font-semibold"
                  : "text-dali-teal/80 hover:text-dali-teal"
              }`}
            >
              Dali
            </a>
            <a
              href="https://dali.dartmouth.edu/events"
              className={`block px-3 py-2 text-base font-medium ${
                activeItem === "events"
                  ? "text-dali-teal font-semibold"
                  : "text-dali-teal/80 hover:text-dali-teal"
              }`}
            >
              Events
            </a>
            <a
              href="https://dali.dartmouth.edu/education"
              className={`block px-3 py-2 text-base font-medium ${
                activeItem === "education"
                  ? "text-dali-teal font-semibold"
                  : "text-dali-teal/80 hover:text-dali-teal"
              }`}
            >
              Education
            </a>
            <a
              href="/projects"
              className={`block px-3 py-2 text-base font-medium ${
                activeItem === "projects"
                  ? "text-dali-teal font-semibold"
                  : "text-dali-teal/80 hover:text-dali-teal"
              }`}
            >
              Projects
            </a>
            <a
              href="/team"
              className={`block px-3 py-2 text-base font-medium ${
                activeItem === "team"
                  ? "text-dali-teal font-semibold"
                  : "text-dali-teal/80 hover:text-dali-teal"
              }`}
            >
              Team
            </a>
            <a
              href="https://dali.dartmouth.edu/for-students"
              className={`block px-3 py-2 text-base font-medium ${
                activeItem === "students"
                  ? "text-dali-teal font-semibold"
                  : "text-dali-teal/80 hover:text-dali-teal"
              }`}
            >
              For students
            </a>
            <a
              href="https://dali.dartmouth.edu/for-partners"
              className={`block px-3 py-2 text-base font-medium ${
                activeItem === "partners"
                  ? "text-dali-teal font-semibold"
                  : "text-dali-teal/80 hover:text-dali-teal"
              }`}
            >
              For partners
            </a>
          </div>
        </div>
      )}
    </header>
  );
}