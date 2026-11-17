import { useState } from "react";
import { Link, redirect, useLoaderData } from "react-router";
import type { Route } from "./+types/alumni.welcome";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";
import { prisma } from "~/lib/db.server";
import { readOnlyRoles } from "~/lib/read-only-roles.server";
import { isFeatureEnabled } from "~/lib/feature-flags.server";
import { AvatarCreator } from "~/components/alumni-game/AvatarCreator";
import { DaliTiles } from "~/components/alumni-game/DaliTiles";
import { AVATAR_ASSETS } from "~/components/alumni-game/assets";
import { isAvatarConfig, type AvatarConfig } from "~/components/alumni-game/pixel-avatar";
import "~/components/alumni-game/alumni-game.css";

export const meta: Route.MetaFunction = () => [{ title: "Welcome back · DALI OS" }];

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const userId = auth.user.sub;
  const roles = await readOnlyRoles(userId, request);
  if (!roles.isLabMemberOrAlum) return redirect("/");
  if (!(await isFeatureEnabled("alumni-game", userId, roles, request))) return redirect("/");

  const avatar = await prisma.pixelAvatar.findUnique({
    where: { userId },
    select: { skinTone: true, eyeColor: true, hairColor: true, hairstyle: true },
  });
  return { avatar: avatar && isAvatarConfig(avatar) ? avatar : null };
}

function PixelArrow({ color, delay }: { color: string; delay: number }) {
  return (
    <svg
      className="ag-arrow"
      style={{ animationDelay: `${delay}ms` }}
      viewBox="0 0 7 7"
      width="26"
      height="26"
      shapeRendering="crispEdges"
    >
      <g fill={color}>
        <rect x="2" y="0" width="3" height="3" />
        <rect x="0" y="3" width="7" height="1" />
        <rect x="1" y="4" width="5" height="1" />
        <rect x="2" y="5" width="3" height="1" />
        <rect x="3" y="6" width="1" height="1" />
      </g>
    </svg>
  );
}

export default function AlumniWelcome() {
  const { avatar } = useLoaderData<typeof loader>();
  const [step, setStep] = useState<"create" | "choice">(avatar ? "choice" : "create");
  const [saved, setSaved] = useState<AvatarConfig | null>(avatar);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(config: AvatarConfig) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/alumni-game/avatar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? "Couldn't save your avatar. Try again?");
        return;
      }
      setSaved(config);
      setStep("choice");
    } catch {
      setError("Couldn't save your avatar. Try again?");
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="ag-page">
      <DaliTiles corner="tr" />
      <DaliTiles corner="bl" />
      {step === "create" ? (
        <>
          <h1>Make your pixel self</h1>
          <AvatarCreator initial={saved} assets={AVATAR_ASSETS} saving={saving} error={error} onSave={save} />
        </>
      ) : (
        <>
          <h1>Next up: your profile</h1>
          <p className="ag-page-sub">
            The form is the quick way. The lab quest takes a little longer, but it's a lot more
            fun, and Tim is waiting for you.
          </p>
          <div className="ag-door-row">
            <div className="ag-door-wrap">
              <div className="ag-arrow-row" aria-hidden>
                <PixelArrow color="#E45768" delay={0} />
                <PixelArrow color="#FFCF88" delay={160} />
                <PixelArrow color="#0C4876" delay={320} />
              </div>
              <Link to="/alumni/lab" className="ag-door ag-door--teal ag-door--lab">
                <strong>Enter the lab</strong>
                <span>Walk around a pixel DALI lab and take Tim's onboarding quest</span>
                <em className="ag-door-time">~5 min</em>
              </Link>
            </div>
            <Link to="/profile" className="ag-door ag-door--muted">
              <strong>Fill in my profile</strong>
              <span>The classic way, on your profile page</span>
              <em className="ag-door-time">&lt;2 min</em>
            </Link>
          </div>
          <button type="button" className="ag-door ag-door--ghost" onClick={() => setStep("create")}>
            <span>← Back to my avatar</span>
          </button>
        </>
      )}
    </main>
  );
}
