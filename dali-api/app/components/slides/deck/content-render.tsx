import { useState, type ReactNode } from "react";
import { BarChart3, Play } from "lucide-react";
import { parseVideoEmbed } from "~/lib/video-embed";
import { ChartSvg } from "./ChartSvg";
import { chartColors } from "./content";
import { ICONS } from "./icon-set";
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
