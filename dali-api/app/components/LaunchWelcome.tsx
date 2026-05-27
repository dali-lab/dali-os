import { useEffect, useId, useState } from "react";
import { Sparkles, ArrowRight, ArrowLeft, PartyPopper } from "lucide-react";
import { Modal } from "./Modal";

const STORAGE_KEY = "dalios-launch-welcome-seen-v1";

type Step = {
  icon: React.ReactNode;
  eyebrow: string;
  title: string;
  body: React.ReactNode;
};

function buildSteps(firstName: string): Step[] {
  return [
    {
      icon: <Sparkles className="w-6 h-6 text-accent-coral" />,
      eyebrow: "Welcome",
      title: `Hey ${firstName} — welcome to DALIos`,
      body: (
        <>
          This is the new home for everything DALI: projects, staffing,
          mentorship, the calendar, your profile, and more. Take a quick tour —
          it&apos;s short, promise.
        </>
      ),
    },
    {
      icon: <Sparkles className="w-6 h-6 text-accent-coral" />,
      eyebrow: "Your home",
      title: "Start here every day",
      body: (
        <>
          The home tab surfaces what needs your attention: open tasks, meeting
          invites, and the lab&apos;s week at a glance. If something is on fire,
          it shows up here first.
        </>
      ),
    },
    {
      icon: <Sparkles className="w-6 h-6 text-accent-coral" />,
      eyebrow: "Explore",
      title: "Projects, profiles, and more",
      body: (
        <>
          Use the sidebar to jump between projects, the calendar, and your
          profile. Hover any project to see its team — click in to see sprints,
          tasks, and updates.
        </>
      ),
    },
    {
      icon: <PartyPopper className="w-6 h-6 text-accent-coral" />,
      eyebrow: "Launch party",
      title: "Come celebrate with us",
      body: (
        <>
          We&apos;re throwing a launch party to christen the new site. Food,
          demos, and a few surprises. Keep an eye on the calendar for the
          invite — we&apos;d love to see you there.
        </>
      ),
    },
  ];
}

export function LaunchWelcome({ firstName }: { firstName: string }) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const titleId = useId();

  useEffect(() => {
    try {
      if (window.localStorage.getItem(STORAGE_KEY)) return;
    } catch {
      return;
    }
    setOpen(true);
  }, []);

  const steps = buildSteps(firstName);
  const current = steps[step];
  const isLast = step === steps.length - 1;
  const isFirst = step === 0;

  function close() {
    try {
      window.localStorage.setItem(STORAGE_KEY, new Date().toISOString());
    } catch {
      // ignore — worst case the modal re-opens, which is harmless
    }
    setOpen(false);
  }

  return (
    <Modal open={open} onClose={close} labelledBy={titleId}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-accent-coral">
            {current.icon}
            {current.eyebrow}
          </span>
          <button
            type="button"
            onClick={close}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Skip
          </button>
        </div>

        <div>
          <h2
            id={titleId}
            className="font-heading text-xl font-bold text-foreground"
          >
            {current.title}
          </h2>
          <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
            {current.body}
          </p>
        </div>

        <div
          className="flex items-center justify-center gap-1.5 pt-1"
          aria-hidden="true"
        >
          {steps.map((_, i) => (
            <span
              key={i}
              className={
                "h-1.5 rounded-full transition-all " +
                (i === step
                  ? "w-6 bg-accent-coral"
                  : "w-1.5 bg-muted-foreground/30")
              }
            />
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 pt-2">
          <button
            type="button"
            onClick={() => setStep((s) => Math.max(0, s - 1))}
            disabled={isFirst}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground disabled:opacity-0 disabled:pointer-events-none"
          >
            <ArrowLeft className="w-4 h-4" />
            Back
          </button>
          <button
            type="button"
            onClick={() => (isLast ? close() : setStep((s) => s + 1))}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent-coral px-4 py-2 text-sm font-semibold text-white hover:bg-accent-coral/90"
          >
            {isLast ? "Let's go" : "Next"}
            {!isLast && <ArrowRight className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </Modal>
  );
}
