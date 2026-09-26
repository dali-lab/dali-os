import { useRef, useState } from "react";
import { cn } from "~/lib/cn";

// Email HTML is untrusted. It renders in a sandboxed frame with scripts off
// (no allow-scripts) and a CSP that also blocks them, so the only thing
// same-origin grants is letting us measure the content height.
const CSP =
  "default-src 'none'; img-src https: data: cid:; style-src 'unsafe-inline' https:; font-src https: data:";

const FONT_CSS = "https://fonts.googleapis.com/css2?family=Mulish:wght@400;600;700&display=swap";

// Newsletters and other designed mail paint their own colours and assume a
// white page, so they keep the white card. Everything else (ordinary replies)
// takes the app's ink and font so it doesn't read as a pasted-in document.
function isDesigned(html: string): boolean {
  return /bgcolor|background|<style|color\s*[:=]/i.test(html);
}

function frameDoc(html: string, themed: boolean): string {
  const body = themed
    ? `body{margin:0;font:14px/1.55 "Mulish",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:transparent;overflow-wrap:anywhere}a{color:inherit}`
    : `body{margin:0;font:14px/1.55 system-ui,-apple-system,sans-serif;color:#1f1f1f;overflow-wrap:anywhere}`;
  const font = themed ? `<link rel="stylesheet" href="${FONT_CSS}">` : "";
  return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><base target="_blank">${font}<style>${body}img{max-width:100%;height:auto}</style></head><body>${html}</body></html>`;
}

export function MailBody({ html, text }: { html: string | null; text: string | null }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState(120);

  if (!html) {
    return (
      <div className="whitespace-pre-wrap break-words rounded-os-item bg-os-well p-4 text-sm leading-relaxed text-foreground">
        {text ?? ""}
      </div>
    );
  }

  const themed = !isDesigned(html);

  const measure = () => {
    const frame = ref.current;
    const body = frame?.contentDocument?.body;
    if (!frame || !body) return;
    if (themed) {
      // The ink flips with the shell's light/dark mode, so it's read from the
      // page rather than baked into the frame document.
      const { color, colorScheme } = getComputedStyle(frame);
      body.style.color = color;
      body.parentElement!.style.colorScheme = colorScheme;
    }
    setHeight(body.scrollHeight + 8);
  };

  return (
    <div className={cn("overflow-hidden", themed ? "rounded-os-item bg-os-well p-4" : "rounded-[10px] bg-white p-3")}>
      <iframe
        ref={ref}
        title="Email message"
        sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox"
        srcDoc={frameDoc(html, themed)}
        onLoad={measure}
        style={{ height }}
        className="w-full border-0 text-foreground"
      />
    </div>
  );
}
