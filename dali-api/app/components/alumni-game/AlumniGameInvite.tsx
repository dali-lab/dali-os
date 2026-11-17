import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Modal } from "~/components/Modal";
import { Button } from "~/components/ui/Button";

const DISMISS_KEY = "dalios-alumni-game-invite-dismissed-v1";

const COPY = {
  game: {
    body: "The lab saved you a spot. Build your pixel avatar, then finish your alumni profile your way: fill it in directly, or walk around a pixel DALI lab and chat with Tim.",
    cta: "Create my avatar",
    to: "/alumni/welcome",
  },
  onboarding: {
    body: "The lab saved you a spot. Check your details, add a few interests and choose what you're open to. It takes about two minutes.",
    cta: "Get started",
    to: "/alumni/onboarding",
  },
} as const;

// First-login invite for alumni: shown by the layout until they've finished the
// flow it points at; "Maybe later" quiets it for the browser session only.
export function AlumniGameInvite({
  firstName,
  variant = "game",
}: {
  firstName: string;
  variant?: keyof typeof COPY;
}) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const copy = COPY[variant];

  useEffect(() => {
    try {
      if (sessionStorage.getItem(DISMISS_KEY)) return;
    } catch {
      // Storage unavailable: still show the invite.
    }
    setOpen(true);
  }, []);

  const dismiss = () => {
    setOpen(false);
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Best effort only.
    }
  };

  return (
    <Modal open={open} onClose={dismiss} labelledBy="alumni-game-invite-title">
      <div className="flex flex-col items-center gap-4 p-6 text-center">
        <h2 id="alumni-game-invite-title" className="font-heading text-xl font-bold text-foreground">
          Welcome back{firstName ? `, ${firstName}` : ""}!
        </h2>
        <p className="text-sm text-muted-foreground">{copy.body}</p>
        <div className="flex gap-2">
          <Button onClick={() => navigate(copy.to)}>{copy.cta}</Button>
          <Button variant="secondary" onClick={dismiss}>
            Maybe later
          </Button>
        </div>
      </div>
    </Modal>
  );
}
