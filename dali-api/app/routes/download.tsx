// Public, shareable desktop-download page. No auth, no app layout (like
// /privacy and /terms) so the link works anywhere. Detects the visitor's OS
// client-side and surfaces the macOS build. The download target is derived from
// the live updater feed (latest.json), so it always points at the current
// release with no per-release edit here. Not linked from anywhere yet — reachable
// only by visiting /download directly.

import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import type { Route } from "./+types/download";

const RELEASES_BASE = "https://dali-os-desktop-releases.s3.us-east-1.amazonaws.com";
// Stable, version-less artifact published by the release workflow each release —
// the download link never has to know the version or filename, so it can't drift.
const STABLE_DMG_URL = `${RELEASES_BASE}/DALI-OS-macos.dmg`;
const VERSION_TTL_MS = 5 * 60 * 1000;

// Small server-side memo so a popular share link doesn't hit S3 on every render.
let versionCache: { version: string | null; at: number } | null = null;

async function getLatestVersion(): Promise<string | null> {
  const now = Date.now();
  if (versionCache && now - versionCache.at < VERSION_TTL_MS) {
    return versionCache.version;
  }
  let version: string | null = null;
  try {
    const res = await fetch(`${RELEASES_BASE}/latest.json`, {
      signal: AbortSignal.timeout(4000),
    });
    if (res.ok) {
      const data = (await res.json()) as { version?: string };
      if (typeof data.version === "string") version = data.version;
    }
  } catch {
    // Feed unavailable — render the page without a live download link.
  }
  versionCache = { version, at: now };
  return version;
}

export const meta: Route.MetaFunction = () => {
  const title = "Download DALI OS for Mac";
  const description =
    "The DALI OS desktop app — a native window with menu bar, dock, and background notifications even when it's closed.";
  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
  ];
};

export async function loader(_: Route.LoaderArgs) {
  // Version is cosmetic (a label); the download target is the stable URL.
  const version = await getLatestVersion();
  return { version, dmgUrl: STABLE_DMG_URL };
}

export default function DownloadPage({ loaderData }: Route.ComponentProps) {
  const { version, dmgUrl } = loaderData;
  const [os, setOs] = useState<"mac" | "windows" | "other" | null>(null);

  useEffect(() => {
    const ua = navigator.userAgent;
    if (/Mac/i.test(ua)) setOs("mac");
    else if (/Windows/i.test(ua)) setOs("windows");
    else setOs("other");
  }, []);

  const notMac = os === "windows" || os === "other";

  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center px-4 py-12">
      <main className="w-full max-w-lg text-center">
        <img src="/logo-blue.svg" alt="DALI Lab" className="mx-auto h-12 w-auto" />
        <h1 className="mt-8 text-3xl font-semibold text-zinc-900">
          DALI OS for desktop
        </h1>
        <p className="mt-3 text-zinc-600">
          A native window for DALI OS — menu bar, dock, and background
          notifications even when it&apos;s closed.
        </p>

        <div className="mt-8 rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
          <a
            href={dmgUrl}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-900 px-6 py-3.5 text-base font-semibold text-white transition hover:bg-zinc-700"
          >
            <Download className="h-5 w-5" />
            Download for macOS
          </a>
          {version ? (
            <p className="mt-3 text-xs text-zinc-500">
              Version {version} · Universal (Apple Silicon &amp; Intel)
            </p>
          ) : null}
          {notMac ? (
            <p className="mt-4 rounded-lg bg-amber-50 px-4 py-2 text-xs text-amber-800">
              DALI OS desktop is macOS-only for now. Windows is coming later.
            </p>
          ) : null}

          <div className="mt-6 border-t border-zinc-100 pt-5 text-left">
            <p className="text-xs font-semibold text-zinc-700">Installing</p>
            <p className="mt-1 text-xs text-zinc-500">
              Open the downloaded{" "}
              <code className="rounded bg-zinc-100 px-1">.dmg</code> and drag DALI
              OS to your Applications folder, then open it from there.
            </p>
          </div>
        </div>

        <p className="mt-6 text-xs text-zinc-400">Requires macOS 12 or later.</p>
      </main>
    </div>
  );
}
