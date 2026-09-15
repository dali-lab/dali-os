// A scavenger-hunt code parked in the UI (specs/activities.md §8). Codes are
// found out in the app and typed back into the activity modal, so the treatment
// is deliberately quiet: small, wide-tracked, low-contrast — easy to walk past,
// legible once you're looking for it.
//
// Two details this centralizes, both easy to get wrong on the next drop:
//   • The 🕵️ marks the string as one of the hunt's codes rather than stray
//     text, and is aria-hidden — it is decoration, not part of the code.
//   • `select-all` sits on the code span alone, so copying the code can't drag
//     the emoji along with it.
//
// Where a code appears, and what unlocks it, is the caller's business; this
// only renders one. Positioning comes in via className (the drop sites park
// these in a corner rather than in the flow).

import { cn } from "~/lib/cn";

export function HuntCode({ code, className }: { code: string; className?: string }) {
  return (
    <p
      className={cn(
        "text-[10px] font-medium tracking-[0.3em] text-muted-foreground/30",
        className,
      )}
    >
      <span aria-hidden>🕵️</span> <span className="select-all">{code}</span>
    </p>
  );
}
