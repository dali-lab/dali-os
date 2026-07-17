// Slack channel names: lowercase, no spaces/periods, ≤80 chars, hyphens ok.
// Pure string function — kept out of slack-client.ts so client components can
// import it without dragging @slack/web-api into the browser bundle.
export function sanitizeChannelName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
