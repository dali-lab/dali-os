import { createContext, useContext, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { BarChart3, Code2, Play } from "lucide-react";
import { CODE_SANDBOX } from "~/components/doc/components/kinds";
import { parseVideoEmbed } from "~/lib/video-embed";
import { ChartSvg } from "./ChartSvg";
import { chartColors } from "./content";
import { htmlSrcDoc } from "./html-element";
import { useHtmlReloads } from "./html-reload";
import { ICONS } from "./icon-set";
import { useCustomCodePaused } from "./pause-custom-code";
import type { Placed } from "./freeform";
import type { FillId } from "./model";
import type { RenderElement } from "./snapshot";
import type { ThemeDef } from "./themes";
import { placedStyle, u } from "./units";

const FILL_VAR: Record<FillId, string> = {
  accent: "var(--slide-accent)",
  fg: "var(--slide-fg)",
  muted: "var(--slide-muted)",
  surface: "var(--slide-surface)",
  rule: "var(--slide-rule)",
};

export const fillVar = (fill: FillId | undefined): string => FILL_VAR[fill ?? "accent"];

function Placeholder({ placed, dataKey, label, icon }: { placed: Placed; dataKey: Record<string, string>; label: string; icon: ReactNode }) {
  return (
    <div
      {...dataKey}
      style={{
        ...placedStyle(placed),
        background: "var(--slide-surface)",
        color: "var(--slide-muted)",
        borderRadius: u(24),
        display: "grid",
        placeItems: "center",
        fontSize: u(32),
        fontFamily: "var(--slide-font-body)",
      }}
    >
      <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: u(16) }}>
        {icon}
        {label}
      </span>
    </div>
  );
}

export function ChartBox({ placed, element, theme }: { placed: Placed; element: RenderElement; theme: ThemeDef }) {
  const dataKey = { "data-element": element.id, "data-kind": "chart" };
  if (!element.chart) return <Placeholder placed={placed} dataKey={dataKey} label="Chart data is missing" icon={<BarChart3 style={{ width: u(72), height: u(72) }} aria-hidden />} />;
  return (
    <div {...dataKey} style={placedStyle(placed)}>
      <ChartSvg chart={element.chart} colors={chartColors(theme)} w={Math.round(placed.w)} h={Math.round(placed.h)} />
    </div>
  );
}

export function HtmlBox({ placed, element, label = "Custom HTML" }: { placed: Placed; element: RenderElement; label?: string }) {
  return <Placeholder placed={placed} dataKey={{ "data-element": element.id, "data-kind": "html" }} label={label} icon={<Code2 style={{ width: u(72), height: u(72) }} aria-hidden />} />;
}

export const HTML_DEBOUNCE_MS = 300;

/** A custom HTML element running in the sandbox, laid out at its size in stage units and scaled to fit, so 1px of its HTML is one stage unit. */
export function HtmlFrame({ placed, element, theme, interactive = true }: { placed: Placed; element: RenderElement; theme: ThemeDef; interactive?: boolean }) {
  const [paused] = useCustomCodePaused();
  const reloadKey = useHtmlReloads(element.id);
  const box = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  const [width, setWidth] = useState(0);
  const source = element.html ?? "";
  const [shown, setShown] = useState(source);
  useEffect(() => {
    setMounted(true);
  }, []);
  useEffect(() => {
    if (source === shown) return;
    const timer = setTimeout(() => setShown(source), HTML_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [source, shown]);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => observer?.disconnect();
  }, [paused, mounted]);
  if (paused) return <HtmlBox placed={placed} element={element} label="Custom code paused" />;
  const scale = width > 0 ? width / placed.w : 1;
  return (
    <div
      ref={box}
      data-element={element.id}
      data-kind="html"
      data-html-live
      style={{ ...placedStyle(placed), overflow: "hidden", borderRadius: u(24) }}
      onClick={(e) => e.stopPropagation()}
    >
      {mounted && (
        <iframe
          key={reloadKey}
          title="Custom HTML"
          sandbox={CODE_SANDBOX}
          referrerPolicy="no-referrer"
          srcDoc={htmlSrcDoc(shown, theme)}
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            width: placed.w,
            height: placed.h,
            border: 0,
            background: "transparent",
            transformOrigin: "0 0",
            transform: `scale(${scale})`,
            pointerEvents: interactive ? "auto" : "none",
          }}
        />
      )}
    </div>
  );
}

/** Static markup for the PDF: the sandboxed frame at full size, with a hidden placeholder the exporter swaps in when the frame does not load in time. */
export function HtmlPrintFrame({ placed, element, theme }: { placed: Placed; element: RenderElement; theme: ThemeDef }) {
  return (
    <>
      <div data-element={element.id} data-kind="html" style={{ ...placedStyle(placed), overflow: "hidden", borderRadius: u(24) }}>
        <iframe
          data-html-print
          title="Custom HTML"
          sandbox={CODE_SANDBOX}
          referrerPolicy="no-referrer"
          srcDoc={htmlSrcDoc(element.html ?? "", theme)}
          style={{ position: "absolute", left: 0, top: 0, width: placed.w, height: placed.h, border: 0, background: "transparent" }}
        />
      </div>
      <div data-html-fallback style={{ display: "none" }}>
        <HtmlBox placed={placed} element={element} />
      </div>
    </>
  );
}

export function IconBox({ placed, element }: { placed: Placed; element: RenderElement }) {
  const Icon = element.icon ? ICONS[element.icon] : undefined;
  const dataKey = { "data-element": element.id, "data-kind": "icon" };
  if (!Icon) return <div {...dataKey} style={placedStyle(placed)} />;
  return (
    <div {...dataKey} data-icon={element.icon} style={{ ...placedStyle(placed), color: fillVar(element.fill) }}>
      <Icon style={{ width: "100%", height: "100%", display: "block" }} strokeWidth={1.5} aria-hidden />
    </div>
  );
}

export function VideoBox({ placed, element, bare = false }: { placed: Placed; element: RenderElement; bare?: boolean }) {
  const embed = element.videoUrl ? parseVideoEmbed(element.videoUrl) : null;
  const size = Math.max(64, Math.min(placed.w, placed.h) * 0.22);
  return (
    <div
      data-element={element.id}
      data-kind="video"
      style={{
        ...(bare ? { width: "100%", height: "100%" } : placedStyle(placed)),
        background: "var(--slide-surface)",
        color: "var(--slide-fg)",
        borderRadius: u(24),
        display: "grid",
        placeItems: "center",
        overflow: "hidden",
        fontFamily: "var(--slide-font-body)",
      }}
    >
      <span style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: u(20) }}>
        <span
          aria-hidden
          style={{ display: "grid", placeItems: "center", width: u(size), height: u(size), borderRadius: "50%", background: "var(--slide-accent)", color: "var(--slide-ground)" }}
        >
          <Play style={{ width: u(size * 0.45), height: u(size * 0.45), marginLeft: u(size * 0.06) }} fill="currentColor" />
        </span>
        <span style={{ fontSize: u(32), color: "var(--slide-muted)" }}>{embed ? `${embed.provider} video` : "Video"}</span>
      </span>
    </div>
  );
}

export function PlayableVideo({ element, placed }: { element: RenderElement; placed: Placed }) {
  const [playing, setPlaying] = useState(false);
  const embed = element.videoUrl ? parseVideoEmbed(element.videoUrl) : null;
  if (!embed) return <VideoBox placed={placed} element={element} />;
  if (playing) {
    return (
      <iframe
        data-element={element.id}
        data-kind="video"
        title={`${embed.provider} video`}
        src={`${embed.embedUrl}?autoplay=1&rel=0`}
        allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
        allowFullScreen
        referrerPolicy="strict-origin-when-cross-origin"
        style={{ ...placedStyle(placed), border: 0, borderRadius: u(24), background: "#000" }}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }
  return (
    <button
      type="button"
      aria-label={`Play ${embed.provider} video`}
      data-play-video
      onClick={(e) => (e.stopPropagation(), setPlaying(true))}
      style={{ ...placedStyle(placed), padding: 0, border: 0, background: "none", cursor: "pointer", borderRadius: u(24) }}
    >
      <VideoBox placed={placed} element={element} bare />
    </button>
  );
}

export interface PollResult {
  counts: number[];
  total: number;
  mine: number[];
  closed: boolean;
}

export interface PollContextValue {
  results: Record<string, PollResult>;
  onVote?: (pollId: string, choices: number[]) => void;
}

const EMPTY_POLL_RESULT: PollResult = { counts: [], total: 0, mine: [], closed: false };

export const PollContext = createContext<PollContextValue | null>(null);

export function toggleChoice(current: number[], index: number, multi: boolean): number[] {
  if (!multi) return current.length === 1 && current[0] === index ? [] : [index];
  return current.includes(index) ? current.filter((c) => c !== index) : [...current, index].sort((a, b) => a - b);
}

export function PollBox({ placed, element }: { placed: Placed; element: RenderElement }) {
  const ctx = useContext(PollContext);
  const poll = element.poll;
  const dataKey = { "data-element": element.id, "data-kind": "poll" };
  if (!poll) return <Placeholder placed={placed} dataKey={dataKey} label="Poll is missing" icon={<BarChart3 style={{ width: u(72), height: u(72) }} aria-hidden />} />;
  const result = ctx ? (ctx.results[element.id] ?? EMPTY_POLL_RESULT) : undefined;
  const total = result?.total ?? 0;
  const canVote = Boolean(ctx?.onVote && result && !result.closed);
  return (
    <div
      {...dataKey}
      data-poll-closed={result?.closed ? "" : undefined}
      style={{
        ...placedStyle(placed),
        background: "var(--slide-surface)",
        color: "var(--slide-fg)",
        borderRadius: u(24),
        padding: u(48),
        display: "flex",
        flexDirection: "column",
        gap: u(28),
        fontFamily: "var(--slide-font-body)",
        overflow: "hidden",
      }}
    >
      <div style={{ fontSize: u(56), fontWeight: 600, lineHeight: 1.15 }}>{poll.question}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: u(16), flex: 1, justifyContent: "center" }}>
        {poll.options.map((option, i) => {
          const count = result?.counts[i] ?? 0;
          const share = total > 0 ? count / total : 0;
          const picked = result?.mine.includes(i) ?? false;
          const row = (
            <>
              <span
                aria-hidden
                style={{ position: "absolute", inset: 0, width: `${Math.round(share * 100)}%`, background: "var(--slide-accent)", opacity: picked ? 0.55 : 0.3 }}
              />
              <span style={{ position: "relative", display: "flex", justifyContent: "space-between", gap: u(24), width: "100%" }}>
                <span>{option}</span>
                {result && <span data-poll-count>{count}</span>}
              </span>
            </>
          );
          const style: CSSProperties = {
            position: "relative",
            display: "flex",
            alignItems: "center",
            overflow: "hidden",
            padding: `${u(16)} ${u(28)}`,
            fontSize: u(40),
            borderRadius: u(16),
            border: `${u(3)} solid ${picked ? "var(--slide-accent)" : "var(--slide-rule)"}`,
            background: "transparent",
            color: "inherit",
            textAlign: "left",
            width: "100%",
          };
          return canVote ? (
            <button
              key={i}
              type="button"
              data-poll-option={i}
              aria-pressed={picked}
              onClick={(e) => {
                e.stopPropagation();
                ctx!.onVote!(element.id, toggleChoice(result!.mine, i, poll.multi === true));
              }}
              style={{ ...style, cursor: "pointer" }}
            >
              {row}
            </button>
          ) : (
            <div key={i} data-poll-option={i} style={style}>
              {row}
            </div>
          );
        })}
      </div>
      {result && (
        <div style={{ fontSize: u(28), color: "var(--slide-muted)" }}>
          {total} {total === 1 ? "vote" : "votes"}
          {result.closed ? " · Voting closed" : ""}
        </div>
      )}
    </div>
  );
}
