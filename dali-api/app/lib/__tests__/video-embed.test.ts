import { describe, expect, it } from "vitest";
import { parseVideoEmbed, VIDEO_EMBED_ORIGINS } from "../video-embed";

const ID = "OY8fr2E96lg";
const EMBED = { provider: "YouTube", embedUrl: `https://www.youtube-nocookie.com/embed/${ID}` };

describe("parseVideoEmbed", () => {
  it.each([
    `https://www.youtube.com/watch?v=${ID}`,
    `https://youtube.com/watch?v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `http://www.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/watch?list=PL123&v=${ID}&t=42s`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc123`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}/`,
    `  https://youtu.be/${ID}  `,
  ])("resolves %s to the privacy-enhanced player", (url) => {
    expect(parseVideoEmbed(url)).toEqual(EMBED);
  });

  it.each([
    "",
    "not a url",
    "/api/upload/raw?key=uploads/doc-images/demo.mp4",
    "https://cdn.example.com/demo.mp4",
    "https://www.youtube.com/",
    "https://www.youtube.com/watch",
    "https://www.youtube.com/watch?v=short",
    "https://www.youtube.com/@dali",
    "https://www.youtube.com/playlist?list=PL123",
    `https://www.youtube.com/watch?v=${ID}"onload="alert(1)`,
    `https://youtube.com.example.com/watch?v=${ID}`,
    `https://example.com/watch?v=${ID}`,
    `javascript:alert("https://youtu.be/${ID}")`,
  ])("leaves %s alone", (url) => {
    expect(parseVideoEmbed(url)).toBeNull();
  });

  it("only ever points at an origin the CSP allows", () => {
    const { origin } = new URL(parseVideoEmbed(`https://youtu.be/${ID}`)!.embedUrl);
    expect(VIDEO_EMBED_ORIGINS).toContain(origin);
  });
});
