import { useEffect, useState } from "react";
import { Download } from "lucide-react";
import type { Route } from "./+types/download";
import { requireAuth } from "~/lib/auth";
import { redirectToLogin } from "~/lib/login-next";

const RELEASES_BASE = "https://dali-os-desktop-releases.s3.us-east-1.amazonaws.com";
// Stable, version-less artifacts published by the release workflow each release —
// the download links never have to know the version or filename, so they can't drift.
const STABLE_DMG_URL = `${RELEASES_BASE}/DALI-OS-macos.dmg`;
const STABLE_APPIMAGE_URL = `${RELEASES_BASE}/DALI-OS-linux.AppImage`;
const STABLE_WINDOWS_URL = `${RELEASES_BASE}/DALI-OS-windows.exe`;
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
  const title = "Download DALI OS";
  const description = "The DALI Lab desktop app.";
  return [
    { title },
    { name: "description", content: description },
    { property: "og:title", content: title },
    { property: "og:description", content: description },
  ];
};

export async function loader({ request }: Route.LoaderArgs) {
  const auth = await requireAuth(request);
  if (!auth.ok) return redirectToLogin(request);
  const version = await getLatestVersion();
  return { version, dmgUrl: STABLE_DMG_URL, appImageUrl: STABLE_APPIMAGE_URL, windowsUrl: STABLE_WINDOWS_URL };
}

export default function DownloadPage({ loaderData }: Route.ComponentProps) {
  const { version, dmgUrl, appImageUrl, windowsUrl } = loaderData;
  const [os, setOs] = useState<"mac" | "linux" | "windows" | "other" | null>(null);

  useEffect(() => {
    const ua = navigator.userAgent;
    if (/Mac/i.test(ua)) setOs("mac");
    else if (/Linux/i.test(ua)) setOs("linux");
    else if (/Windows/i.test(ua)) setOs("windows");
    else setOs("other");
  }, []);

  const isLinux = os === "linux";
  const isWindows = os === "windows";
  const isUnknown = os === "other";

  return (
    <div className="min-h-screen bg-zinc-50 flex items-center justify-center px-4 py-12">
      <main className="w-full max-w-lg text-center">
        <img src="/logo-blue.svg" alt="DALI Lab" className="mx-auto h-12 w-auto" />
        <h1 className="mt-8 text-3xl font-semibold text-zinc-900">
        A better experience on DALI OS Desktop.
        </h1>
        <p className="mt-2 text-zinc-500">Fast, minimal, and browser-free.</p>

        <div className="mt-8 rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm">
          {isUnknown ? (
            <p className="rounded-lg bg-amber-50 px-4 py-2 text-xs text-amber-800">
              DALI OS desktop is available for macOS, Linux, and Windows.
            </p>
          ) : (
            <>
              <a
                href={isLinux ? appImageUrl : isWindows ? windowsUrl : dmgUrl}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-zinc-900 px-6 py-3.5 text-base font-semibold text-white transition hover:bg-zinc-700"
              >
                <Download className="h-5 w-5" />
                {isLinux ? "Download for Linux" : isWindows ? "Download for Windows" : "Download for macOS"}
              </a>
              {version ? (
                <p className="mt-3 text-xs text-zinc-500">
                  {isLinux
                    ? `Version ${version} · x86_64 AppImage`
                    : isWindows
                    ? `Version ${version} · Windows (x64)`
                    : `Version ${version} · Universal (Apple Silicon & Intel)`}
                </p>
              ) : null}

              <div className="mt-6 border-t border-zinc-100 pt-5 text-left">
                <p className="text-xs font-semibold text-zinc-700">Installing</p>
                {isLinux ? (
                  <p className="mt-1 text-xs text-zinc-500">
                    Make the downloaded{" "}
                    <code className="rounded bg-zinc-100 px-1">.AppImage</code>{" "}
                    executable (<code className="rounded bg-zinc-100 px-1">chmod +x</code>
                    ), then run it directly or move it to{" "}
                    <code className="rounded bg-zinc-100 px-1">~/.local/bin</code>.
                  </p>
                ) : isWindows ? (
                  <p className="mt-1 text-xs text-zinc-500">
                    Run the downloaded{" "}
                    <code className="rounded bg-zinc-100 px-1">.exe</code> and follow
                    the setup wizard. If Windows SmartScreen warns about an unknown
                    publisher, click <strong>More info</strong> then{" "}
                    <strong>Run anyway</strong>.
                  </p>
                ) : (
                  <p className="mt-1 text-xs text-zinc-500">
                    Open the downloaded{" "}
                    <code className="rounded bg-zinc-100 px-1">.dmg</code> and drag DALI
                    OS to your Applications folder, then open it from there.
                  </p>
                )}
              </div>
            </>
          )}
        </div>

        <p className="mt-6 text-xs text-zinc-400">
          {isLinux
            ? "Requires a Linux desktop with Secret Service support (GNOME Keyring or KWallet)."
            : isWindows
            ? "Requires Windows 10 or later with WebView2 (pre-installed on most systems)."
            : "Requires macOS 12 or later."}
        </p>
      </main>
    </div>
  );
}
