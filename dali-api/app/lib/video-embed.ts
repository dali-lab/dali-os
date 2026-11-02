export interface VideoEmbed {
  provider: string;
  embedUrl: string;
}

interface VideoProvider {
  name: string;
  /** The only origin its player loads from; becomes the CSP frame-src entry. */
  embedOrigin: string;
  embedUrl(url: URL): string | null;
}

const YOUTUBE_ID = /^[\w-]{11}$/;
const YOUTUBE_ID_PATHS = new Set(["embed", "shorts", "live", "v"]);

function youtubeId(url: URL): string | null {
  const host = url.hostname.replace(/^(www|m)\./, "");
  const segments = url.pathname.split("/").filter(Boolean);
  if (host === "youtu.be") return segments[0] ?? null;
  if (host !== "youtube.com" && host !== "youtube-nocookie.com") return null;
  if (segments[0] === "watch") return url.searchParams.get("v");
  return YOUTUBE_ID_PATHS.has(segments[0] ?? "") ? (segments[1] ?? null) : null;
}

const YOUTUBE_EMBED_ORIGIN = "https://www.youtube-nocookie.com";

// Adding a provider is one entry here: the block render, exports and CSP all
// read from this list.
const PROVIDERS: VideoProvider[] = [
  {
    name: "YouTube",
    embedOrigin: YOUTUBE_EMBED_ORIGIN,
    embedUrl(url) {
      const id = youtubeId(url);
      return id && YOUTUBE_ID.test(id) ? `${YOUTUBE_EMBED_ORIGIN}/embed/${id}` : null;
    },
  },
];

export const VIDEO_EMBED_ORIGINS = PROVIDERS.map((provider) => provider.embedOrigin);

/** A link to a hosted video, resolved to its provider's player. Null for
 * anything else, including direct video files, which play in <video>. */
export function parseVideoEmbed(raw: string): VideoEmbed | null {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  for (const provider of PROVIDERS) {
    const embedUrl = provider.embedUrl(url);
    if (embedUrl) return { provider: provider.name, embedUrl };
  }
  return null;
}
