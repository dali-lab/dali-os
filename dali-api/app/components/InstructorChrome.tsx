import { Link, Outlet } from "react-router";
import { ArrowLeft } from "lucide-react";

// Shell for non-member (external Dartmouth) instructors. They live in /portal;
// this wraps the education-management routes they're allowed into with a
// lightweight, portal-consistent chrome — no member sidebar, no member-only
// affordances (favorites, ⌘K, liveness) that assume a DALIMember row. The
// root-layout loader only mounts this for a non-member on an /education/manage/*
// path (every other member-shell path is redirected to /portal).
export function InstructorChrome() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <span className="font-heading text-lg font-bold text-dark-blue">
            DALI Teaching
          </span>
          <Link
            to="/portal"
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
            Portal
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <Outlet />
      </main>
    </div>
  );
}
