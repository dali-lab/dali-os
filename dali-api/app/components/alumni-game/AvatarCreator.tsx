import { useEffect, useRef, useState } from "react";
import { Pipette } from "lucide-react";
import { ColorField } from "~/components/ui/ColorField";
import {
  SKIN_TONES,
  EYE_COLORS,
  HAIR_COLORS,
  HAIRSTYLES,
  DEFAULT_AVATAR,
  buildAvatarSprite,
  avatarPaletteMap,
  swapPalette,
  SPRITE,
  type AvatarAssets,
  type AvatarConfig,
} from "./pixel-avatar";

const HEX = /^#[0-9a-f]{6}$/i;

function SpritePreview({
  config,
  assets,
  width,
}: {
  config: AvatarConfig;
  assets: AvatarAssets;
  width: number;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    let blinkTimer: ReturnType<typeof setTimeout> | undefined;
    buildAvatarSprite(config, assets)
      .then((sprites) => {
        const canvas = ref.current;
        const ctx = canvas?.getContext("2d");
        if (cancelled || !canvas || !ctx) return;
        const paint = (img: HTMLCanvasElement) => {
          ctx.imageSmoothingEnabled = false;
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        };
        paint(sprites.open);
        const reducedMotion =
          typeof matchMedia === "function" &&
          matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (reducedMotion) return;
        const blink = () => {
          if (cancelled) return;
          paint(sprites.closed);
          blinkTimer = setTimeout(() => {
            if (cancelled) return;
            paint(sprites.open);
            blinkTimer = setTimeout(blink, 2200 + Math.random() * 2800);
          }, 140);
        };
        blinkTimer = setTimeout(blink, 2200);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      clearTimeout(blinkTimer);
    };
  }, [config, assets]);
  const height = Math.round((width * SPRITE.height) / SPRITE.width);
  return (
    <canvas
      ref={ref}
      width={SPRITE.width}
      height={SPRITE.height}
      style={{ width, height, imageRendering: "pixelated" }}
      aria-hidden
    />
  );
}

// A hairstyle swatch: just the hair sheet, cropped to its visible pixels,
// centered in a square and tinted with the chosen hair color.
function HairPreview({ src, size, hairColor }: { src: string; size: number; hairColor: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      const canvas = ref.current;
      if (cancelled || !canvas) return;
      const off = document.createElement("canvas");
      off.width = img.naturalWidth;
      off.height = img.naturalHeight;
      const octx = off.getContext("2d")!;
      octx.drawImage(img, 0, 0);
      const { data, width, height } = octx.getImageData(0, 0, off.width, off.height);
      let minX = width;
      let minY = height;
      let maxX = 0;
      let maxY = 0;
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          if (data[(y * width + x) * 4 + 3] > 0) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxX < minX) return;
      const w = maxX - minX + 1;
      const h = maxY - minY + 1;
      const side = Math.max(w, h);
      canvas.width = side;
      canvas.height = side;
      const ctx = canvas.getContext("2d")!;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(off, minX - (side - w) / 2, minY - (side - h) / 2, side, side, 0, 0, side, side);
      const tinted = ctx.getImageData(0, 0, side, side);
      swapPalette(tinted.data, avatarPaletteMap({ ...DEFAULT_AVATAR, hairColor }));
      ctx.putImageData(tinted, 0, 0);
    };
    img.src = src;
    return () => {
      cancelled = true;
    };
  }, [src, hairColor]);
  return (
    <canvas ref={ref} style={{ width: size, height: size, imageRendering: "pixelated" }} aria-hidden />
  );
}

// Preset swatches plus a custom color well (the shared ColorField popover).
function ColorRow({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string;
  options: { key: string; label: string; swatch: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  const custom = HEX.test(value);
  return (
    <fieldset>
      <legend>{legend}</legend>
      <div className="ag-choice-row" role="radiogroup" aria-label={legend}>
        {options.map((o) => (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={value === o.key}
            aria-label={o.label}
            title={o.label}
            className="ag-swatch"
            data-selected={value === o.key || undefined}
            style={{ background: o.swatch }}
            onClick={() => onChange(o.key)}
          />
        ))}
        <span
          className="ag-custom"
          data-selected={custom || undefined}
          style={custom ? { background: value } : undefined}
        >
          <ColorField
            value={custom ? value : (options.find((o) => o.key === value)?.swatch ?? "#888888")}
            onChange={onChange}
            label={`Custom ${legend.toLowerCase()}`}
            className="h-full w-full border-0"
            icon={<Pipette className="h-4 w-4" style={{ color: custom ? "#fff8e9" : "#3a2b1c" }} />}
          />
        </span>
      </div>
    </fieldset>
  );
}

export function AvatarCreator({
  initial,
  assets,
  saving,
  error,
  onSave,
}: {
  initial?: AvatarConfig | null;
  assets: AvatarAssets;
  saving: boolean;
  error?: string | null;
  onSave: (config: AvatarConfig) => void;
}) {
  const [config, setConfig] = useState<AvatarConfig>(initial ?? DEFAULT_AVATAR);
  const set = (patch: Partial<AvatarConfig>) => setConfig((c) => ({ ...c, ...patch }));

  return (
    <div className="ag-creator">
      <div className="ag-creator-stage">
        <SpritePreview config={config} assets={assets} width={360} />
      </div>
      <div className="ag-creator-options">
        <ColorRow
          legend="Skin color"
          options={SKIN_TONES.map((s) => ({ key: s.key, label: s.label, swatch: s.base }))}
          value={config.skinTone}
          onChange={(skinTone) => set({ skinTone })}
        />
        <ColorRow
          legend="Eye color"
          options={EYE_COLORS.map((e) => ({ key: e.key, label: e.label, swatch: e.light }))}
          value={config.eyeColor}
          onChange={(eyeColor) => set({ eyeColor })}
        />
        <ColorRow
          legend="Hair color"
          options={HAIR_COLORS.map((h) => ({ key: h.key, label: h.label, swatch: h.base }))}
          value={config.hairColor}
          onChange={(hairColor) => set({ hairColor })}
        />
        <fieldset>
          <legend>Hairstyle</legend>
          <div className="ag-choice-row" role="radiogroup" aria-label="Hairstyle">
            {HAIRSTYLES.map((h) => (
              <button
                key={h.key}
                type="button"
                role="radio"
                aria-checked={config.hairstyle === h.key}
                aria-label={h.label}
                className="ag-hair"
                data-selected={config.hairstyle === h.key || undefined}
                onClick={() => set({ hairstyle: h.key })}
              >
                <HairPreview src={assets.hair[h.asset]} size={52} hairColor={config.hairColor} />
              </button>
            ))}
          </div>
        </fieldset>
        {error ? <p className="ag-error">{error}</p> : null}
        <button type="button" className="ag-button" onClick={() => onSave(config)} disabled={saving}>
          {saving ? "Saving..." : initial ? "Save changes" : "That's me!"}
        </button>
      </div>
    </div>
  );
}
