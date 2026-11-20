import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Modal } from "~/components/Modal";
import { Button } from "~/components/ui/Button";
import type { AlumniInvite } from "~/alumni/lib/alumni-onboarding";

const DISMISS_KEY = "dalios-alumni-game-invite-dismissed-v1";

const FORM_PATH = "/alumni/onboarding";
const GAME_PATH = "/alumni/welcome";

const BODY: Record<AlumniInvite, string> = {
  choice:
    "Your alumni profile is already started from your time at DALI. The rest takes a few minutes, in three short steps or in a pixel version of the lab with Tim.",
  onboarding:
    "Your alumni profile is already started from your time at DALI, and the rest takes a few minutes.",
  game: "Your alumni profile is already started from your time at DALI. The rest happens in a pixel version of the lab, chatting with Tim.",
};

function ChoiceCard({
  title,
  detail,
  primary,
  onClick,
}: {
  title: string;
  detail: string;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        primary
          ? "dali-btn--primary flex flex-1 flex-col gap-1 rounded-os-card p-4 text-left transition-colors"
          : "flex flex-1 flex-col gap-1 rounded-os-card border border-os-container p-4 text-left text-os-fg transition-colors hover:bg-os-hover"
      }
    >
      <span className="text-base font-bold">{title}</span>
      <span className={primary ? "text-sm" : "text-sm text-os-grey"}>{detail}</span>
    </button>
  );
}

// First-login invite for alumni: shown by the layout until they've finished
// onboarding; Later quiets it for the browser session only.
export function AlumniGameInvite({ firstName, variant = "game" }: { firstName: string; variant?: AlumniInvite }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

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
          Welcome back{firstName ? `, ${firstName}` : ""}
        </h2>
        <p className="text-sm text-muted-foreground">{BODY[variant]}</p>
        {variant === "choice" ? (
          <div className="flex w-full flex-col gap-2">
            <div className="flex w-full flex-col gap-2 sm:flex-row">
              <ChoiceCard primary title="Fill it in" detail="Three short steps" onClick={() => navigate(FORM_PATH)} />
              <ChoiceCard title="Walk the pixel lab" detail="Chat with Tim as you go" onClick={() => navigate(GAME_PATH)} />
            </div>
            <Button variant="ghost" onClick={dismiss}>
              Later
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button onClick={() => navigate(variant === "game" ? GAME_PATH : FORM_PATH)}>
              {variant === "game" ? "Walk the pixel lab" : "Finish my profile"}
            </Button>
            <Button variant="secondary" onClick={dismiss}>
              Later
            </Button>
          </div>
        )}
      </div>
    </Modal>
  );
}
