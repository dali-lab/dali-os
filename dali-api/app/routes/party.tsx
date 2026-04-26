import { useCallback, useEffect, useRef, useState } from "react";
import { redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/party";
import { requireAuth } from "~/lib/auth";
import {
  EXTERNAL_CODE,
  INTERNAL_CODE,
  hydrateRetroClass,
  isExternalCodeUnlocked,
  isInternalCodeUnlocked,
  setExternalCodeUnlocked,
  setInternalCodeUnlocked,
} from "~/lib/party";

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirect("/login");
  const partyAudience =
    auth.user.type === "member" ? ("member" as const) : ("applicant" as const);
  return { email: auth.user.email, partyAudience };
}

export default function Party() {
  const { email, partyAudience } = useLoaderData<typeof loader>();
  const handle = email.split("@")[0];
  const isMember = partyAudience === "member";

  useEffect(() => {
    hydrateRetroClass();
  }, []);

  const [unlocked, setUnlocked] = useState(false);
  const [celebrate, setCelebrate] = useState(false);

  useEffect(() => {
    setUnlocked(
      isMember ? isInternalCodeUnlocked() : isExternalCodeUnlocked(),
    );
  }, [isMember]);

  const codeLabel = isMember ? "Lab code" : "Party code";
  const codeTarget = isMember ? INTERNAL_CODE : EXTERNAL_CODE;

  return (
    <div className="min-h-screen bg-section-bg relative overflow-hidden flex flex-col items-center justify-center px-6 py-16">
      <Confetti />

      <div className="relative z-10 text-center max-w-md w-full">
        <p className="text-xs uppercase tracking-widest text-accent-coral font-semibold mb-3">
          Launch Party
        </p>
        <h1 className="font-heading text-3xl md:text-4xl font-bold text-dark-blue mb-10">
          Welcome, {handle}.
        </h1>

        <CodeRow
          label={codeLabel}
          target={codeTarget}
          unlocked={unlocked}
          onSuccess={() => {
            if (isMember) setInternalCodeUnlocked(true);
            else setExternalCodeUnlocked(true);
            setUnlocked(true);
            setCelebrate(true);
          }}
        />
      </div>

      {celebrate && (
        <PayoffOverlay
          title="Unlocked"
          subtitle={
            isMember ? `Lab crew, ${handle}.` : `Nice work, ${handle}.`
          }
          body={
            isMember
              ? "Show this screen at the party for the insider treat."
              : "Bring this energy to the party table for a sticker."
          }
          onDismiss={() => setCelebrate(false)}
        />
      )}
    </div>
  );
}

function CodeRow({
  label,
  target,
  unlocked,
  onSuccess,
}: {
  label: string;
  target: string;
  unlocked: boolean;
  onSuccess: () => void;
}) {
  const n = target.length;
  const [chars, setChars] = useState<string[]>(() => Array(n).fill(""));
  const [shake, setShake] = useState(false);
  const inputsRef = useRef<(HTMLInputElement | null)[]>([]);

  const setAt = (i: number, c: string) => {
    setChars((prev) => {
      const next = [...prev];
      next[i] = c;
      return next;
    });
  };

  const tryUnlock = useCallback(() => {
    const got = chars.join("").toUpperCase();
    if (got === target) {
      onSuccess();
      return;
    }
    setShake(true);
    window.setTimeout(() => setShake(false), 450);
  }, [chars, onSuccess, target]);

  if (unlocked) {
    return (
      <div className="rounded-2xl border border-accent-teal/50 bg-accent-teal/10 px-4 py-3 text-sm text-dark-blue">
        <span className="font-semibold">{label}</span> —{" "}
        <span className="font-mono tracking-widest">{target}</span> ✓
      </div>
    );
  }

  return (
    <div
      className={`rounded-2xl border border-border bg-card/80 backdrop-blur-sm px-4 py-5 transition-[border-color,box-shadow] ${
        shake ? "border-red-500/80 shadow-[0_0_0_3px_rgba(239,68,68,0.25)] dali-party-code-shake" : ""
      }`}
    >
      <p className="text-xs uppercase tracking-wider text-muted-foreground mb-3 text-left">
        {label}
      </p>
      <div className="flex gap-2 justify-center mb-4">
        {Array.from({ length: n }, (_, i) => (
          <input
            key={i}
            ref={(el) => {
              inputsRef.current[i] = el;
            }}
            type="text"
            inputMode="text"
            autoCapitalize="characters"
            maxLength={1}
            value={chars[i]}
            aria-label={`${label} code character ${i + 1}`}
            onChange={(e) => {
              const v = e.target.value.replace(/[^a-zA-Z]/g, "").slice(-1);
              setAt(i, v.toUpperCase());
              if (v && i < n - 1) inputsRef.current[i + 1]?.focus();
            }}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !chars[i] && i > 0) {
                inputsRef.current[i - 1]?.focus();
              }
              if (e.key === "Enter") tryUnlock();
            }}
            onPaste={(e) => {
              e.preventDefault();
              const t = e.clipboardData.getData("text").replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, n);
              const arr = t.split("");
              setChars((prev) => {
                const next = [...prev];
                for (let j = 0; j < n; j++) next[j] = arr[j] ?? "";
                return next;
              });
              const focusIdx = Math.min(arr.length, n - 1);
              window.requestAnimationFrame(() => inputsRef.current[focusIdx]?.focus());
            }}
            className="w-11 h-12 text-center font-mono text-lg font-semibold uppercase rounded-lg border border-border bg-background text-dark-blue focus:outline-none focus:ring-2 focus:ring-accent-coral/60"
          />
        ))}
      </div>
      <button
        type="button"
        onClick={tryUnlock}
        className="w-full rounded-xl bg-accent-coral text-white text-sm font-semibold py-2.5 hover:opacity-95 transition"
      >
        Unlock
      </button>
    </div>
  );
}

function PayoffOverlay({
  title,
  subtitle,
  body,
  onDismiss,
}: {
  title: string;
  subtitle: string;
  body: string;
  onDismiss: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6 bg-dark-blue/75 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="party-payoff-title"
    >
      <div className="max-w-md w-full rounded-2xl bg-card border-2 border-accent-teal shadow-xl p-8 text-center space-y-4">
        <p id="party-payoff-title" className="font-heading text-2xl font-bold text-dark-blue">
          {title}
        </p>
        <p className="text-lg text-dark-blue/90">{subtitle}</p>
        <p className="text-sm text-muted-foreground leading-relaxed border border-dashed border-border rounded-xl py-4 px-3 font-mono">
          {body}
        </p>
        <button
          type="button"
          onClick={onDismiss}
          className="mt-2 text-sm font-semibold text-accent-coral hover:underline"
        >
          Close
        </button>
      </div>
    </div>
  );
}

function Confetti() {
  const pieces = Array.from({ length: 60 }).map((_, i) => {
    const left = Math.random() * 100;
    const delay = Math.random() * 2;
    const duration = 3 + Math.random() * 3;
    const colors = [
      "hsl(354 70% 61%)",
      "hsl(177 45% 51%)",
      "hsl(51 100% 75%)",
      "hsl(344 64% 79%)",
      "hsl(97 49% 67%)",
    ];
    const bg = colors[i % colors.length];
    return (
      <span
        key={i}
        className="dali-confetti-piece"
        style={{
          left: `${left}%`,
          backgroundColor: bg,
          animationDelay: `${delay}s`,
          animationDuration: `${duration}s`,
        }}
      />
    );
  });
  return <>{pieces}</>;
}
