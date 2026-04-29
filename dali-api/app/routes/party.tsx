import { useCallback, useEffect, useRef, useState } from "react";
import { Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/party";
import { requireAuth } from "~/lib/auth";
import {
  DINO_REWARD_THRESHOLD,
  EXTERNAL_CODE,
  INTERNAL_CODE,
  hydrateRetroClass,
  isDinoRewardEarned,
  isExternalCodeUnlocked,
  isInternalCodeUnlocked,
  setDinoRewardEarned,
  setExternalCodeUnlocked,
  setInternalCodeUnlocked,
  trackPartyEvent,
  useRetro,
} from "~/lib/party";
import {
  DIGIT_SUM_CORAL_EXTERNAL_SLOT4,
  DigitSumClue,
} from "~/components/DigitSumClue";

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

  useEffect(() => {
    if (typeof window === "undefined") return;
    const VISIT_KEY = "dali:party:visit-tracked";
    if (window.sessionStorage.getItem(VISIT_KEY) === "1") return;
    window.sessionStorage.setItem(VISIT_KEY, "1");
    trackPartyEvent("PARTY_VISIT", { audience: partyAudience });
  }, [partyAudience]);

  const [unlocked, setUnlocked] = useState(false);
  const [celebrate, setCelebrate] = useState(false);
  const [retroOn, setRetroOn] = useRetro();

  useEffect(() => {
    setUnlocked(
      isMember ? isInternalCodeUnlocked() : isExternalCodeUnlocked(),
    );
  }, [isMember]);

  const codeLabel = isMember ? "Lab code" : "Party code";
  const codeTarget = isMember ? INTERNAL_CODE : EXTERNAL_CODE;
  const dinoSlot = 4;

  return (
    <div className="min-h-screen bg-section-bg relative overflow-hidden flex flex-col items-center justify-center px-6 py-16">
      <Confetti />

      <Link
        to="/"
        className="absolute top-4 left-4 z-10 text-xs text-muted-foreground hover:text-foreground transition"
      >
        ← back
      </Link>

      <div className="relative z-10 text-center max-w-md w-full">
        <p className="text-xs uppercase tracking-widest text-accent-coral font-semibold mb-3">
          Launch Party
        </p>
        <h1 className="font-heading text-3xl md:text-4xl font-bold text-dark-blue mb-10">
          Welcome, {handle}.
        </h1>

        {retroOn && (
          <div className="mb-6 flex items-center justify-between rounded-2xl border border-border bg-card/80 backdrop-blur-sm px-4 py-3 text-sm">
            <span className="text-dark-blue">
              Retro mode: <span className="font-semibold">on</span>
            </span>
            <button
              type="button"
              onClick={() => setRetroOn(false)}
              className="text-xs font-semibold text-accent-coral hover:underline"
            >
              turn off
            </button>
          </div>
        )}

        <DinoGame isMember={isMember} rewardSlot={dinoSlot} />

        <CodeRow
          label={codeLabel}
          target={codeTarget}
          unlocked={unlocked}
          audience={partyAudience}
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
            "Meet us at the DALI Lab at 3PM May 8th."
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
  audience,
  onSuccess,
}: {
  label: string;
  target: string;
  unlocked: boolean;
  audience: "member" | "applicant";
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
      trackPartyEvent("CODE_UNLOCK_SUCCESS", { audience });
      onSuccess();
      return;
    }
    trackPartyEvent("CODE_UNLOCK_FAILURE", { audience });
    setShake(true);
    window.setTimeout(() => setShake(false), 450);
  }, [chars, onSuccess, target, audience]);

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
            placeholder={String(i + 1)}
            aria-label={`${label} code character ${i + 1}`}
            onChange={(e) => {
              const v = e.target.value.replace(/[^a-zA-Z0-9]/g, "").slice(-1);
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
              const t = e.clipboardData.getData("text").replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, n);
              const arr = t.split("");
              setChars((prev) => {
                const next = [...prev];
                for (let j = 0; j < n; j++) next[j] = arr[j] ?? "";
                return next;
              });
              const focusIdx = Math.min(arr.length, n - 1);
              window.requestAnimationFrame(() => inputsRef.current[focusIdx]?.focus());
            }}
            className="w-11 h-12 text-center font-mono text-lg font-semibold uppercase rounded-lg border border-border bg-background text-dark-blue placeholder:!text-[#888888] placeholder:!font-light placeholder:!text-xs focus:outline-none focus:ring-2 focus:ring-accent-coral/60"
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

function DinoGame({ isMember, rewardSlot }: { isMember: boolean; rewardSlot: number }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [running, setRunning] = useState(false);
  const [score, setScore] = useState(0);
  const [hiScore, setHiScore] = useState(0);
  const [earned, setEarned] = useState(false);

  useEffect(() => {
    setEarned(isDinoRewardEarned());
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const GROUND_Y = H - 20;
    const DINO_X = 30;
    const DINO_W = 18;
    const DINO_H = 22;
    const GRAVITY = 0.6;
    const JUMP_V = -10;

    let dinoY = GROUND_Y - DINO_H;
    let velY = 0;
    let cacti: { x: number; w: number; h: number }[] = [];
    let frame = 0;
    let localScore = 0;
    let speed = 4;
    let alive = true;
    let raf = 0;

    const jump = () => {
      if (!running || !alive) return;
      if (dinoY >= GROUND_Y - DINO_H - 1) {
        velY = JUMP_V;
      }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.code === "ArrowUp") {
        e.preventDefault();
        jump();
      }
    };
    window.addEventListener("keydown", onKey);
    canvas.addEventListener("pointerdown", jump);

    const loop = () => {
      frame++;
      ctx.clearRect(0, 0, W, H);
      // ground
      ctx.fillStyle = "#999";
      ctx.fillRect(0, GROUND_Y, W, 1);

      if (running && alive) {
        // dino physics
        velY += GRAVITY;
        dinoY += velY;
        if (dinoY > GROUND_Y - DINO_H) {
          dinoY = GROUND_Y - DINO_H;
          velY = 0;
        }

        // spawn cacti
        if (frame % 90 === 0 || (cacti.length === 0 && frame > 60)) {
          if (Math.random() > 0.3) {
            const h = 14 + Math.floor(Math.random() * 14);
            cacti.push({ x: W + 10, w: 8, h });
          }
        }

        // move cacti
        for (const c of cacti) c.x -= speed;
        // remove offscreen + score
        const before = cacti.length;
        cacti = cacti.filter((c) => c.x + c.w > 0);
        localScore += before - cacti.length;
        if (frame % 6 === 0) localScore += 0; // pace
        if (frame % 10 === 0) localScore += 1; // distance score

        // collision
        for (const c of cacti) {
          const cy = GROUND_Y - c.h;
          if (
            DINO_X < c.x + c.w &&
            DINO_X + DINO_W > c.x &&
            dinoY < cy + c.h &&
            dinoY + DINO_H > cy
          ) {
            alive = false;
          }
        }

        // speed-up
        if (frame % 600 === 0) speed += 0.5;

        setScore(localScore);
      }

      // draw dino
      ctx.fillStyle = alive ? "#535353" : "#c33";
      ctx.fillRect(DINO_X, dinoY, DINO_W, DINO_H);
      // draw cacti
      ctx.fillStyle = "#3b8a3b";
      for (const c of cacti) {
        ctx.fillRect(c.x, GROUND_Y - c.h, c.w, c.h);
      }
      // score
      ctx.fillStyle = "#666";
      ctx.font = "12px monospace";
      ctx.fillText(`HI ${hiScore.toString().padStart(5, "0")}  ${localScore.toString().padStart(5, "0")}`, W - 130, 14);

      if (!alive) {
        ctx.fillStyle = "#c33";
        ctx.font = "bold 14px monospace";
        ctx.fillText("GAME OVER — click to restart", W / 2 - 110, H / 2);
        setRunning(false);
        if (localScore > hiScore) setHiScore(localScore);
        if (localScore >= DINO_REWARD_THRESHOLD && !isDinoRewardEarned()) {
          setDinoRewardEarned(true);
          setEarned(true);
          trackPartyEvent("DINO_REWARD_EARNED", { score: localScore });
        }
      }

      raf = window.requestAnimationFrame(loop);
    };
    raf = window.requestAnimationFrame(loop);

    return () => {
      window.cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKey);
      canvas.removeEventListener("pointerdown", jump);
    };
  }, [running, hiScore]);

  const start = () => {
    setScore(0);
    setRunning(true);
  };

  return (
    <div className="mb-6 rounded-2xl border border-border bg-card/80 backdrop-blur-sm px-4 py-4">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs uppercase tracking-wider text-muted-foreground">
          Jump game
        </p>
        {earned &&
          (isMember ? (
            <span className="text-xs font-mono text-accent-coral">
              {rewardSlot}:mc²
            </span>
          ) : (
            <DigitSumClue slot={rewardSlot} coralIndices={DIGIT_SUM_CORAL_EXTERNAL_SLOT4} className="text-xs" />
          ))}
      </div>
      <canvas
        ref={canvasRef}
        width={400}
        height={120}
        className="w-full bg-background rounded-lg border border-border cursor-pointer"
      />
      {!running && (
        <button
          type="button"
          onClick={start}
          className="mt-2 w-full rounded-lg bg-accent-teal/20 text-dark-blue text-xs font-semibold py-1.5 hover:bg-accent-teal/30 transition"
        >
          {score === 0 ? "start (space / click to jump)" : "restart"}
        </button>
      )}
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
