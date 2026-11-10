import { Play } from "lucide-react";
import { Button } from "~/components/ui/Button";
import { Segmented } from "~/components/ui/Segmented";
import { NumberField } from "~/components/ui/NumberField";
import {
  BACKGROUND_LABELS,
  BACKGROUND_TOKENS,
  DEFAULT_TRANSITION_MS,
  MAX_TRANSITION_MS,
  MIN_TRANSITION_MS,
  TRANSITION_KINDS,
  TRANSITION_LABELS,
  transitionDuration,
  type BackgroundFit,
  type SlideBackground,
  type SlideTransition,
  type TransitionKind,
} from "~/components/slides/deck/slide-meta";
import { themeById } from "~/components/slides/deck/themes";
import type { RenderSlide } from "~/components/slides/deck/snapshot";
import { cn } from "~/lib/cn";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-os-grey">{title}</h3>
      {children}
    </section>
  );
}

export function BackgroundSection({
  slide,
  themeId,
  editable,
  onChange,
  onPickImage,
}: {
  slide: RenderSlide;
  themeId: string;
  editable: boolean;
  onChange: (background: SlideBackground | null) => void;
  onPickImage: () => void;
}) {
  const theme = themeById(themeId);
  const bg = slide.background;
  return (
    <Section title="Background">
      <div role="group" aria-label="Background color" className="flex flex-wrap gap-1.5">
        {BACKGROUND_TOKENS.map((token) => {
          const active = token === "ground" ? !bg : bg?.kind === "color" && bg.token === token;
          return (
            <button
              key={token}
              type="button"
              disabled={!editable}
              aria-label={BACKGROUND_LABELS[token]}
              aria-pressed={active}
              onClick={() => onChange(token === "ground" ? null : { kind: "color", token })}
              className={cn("h-7 w-7 rounded-full border-2 transition-colors disabled:opacity-60", active ? "border-os-accent" : "border-os-container hover:border-os-grey")}
              style={{ background: theme.colors[token] }}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" size="sm" disabled={!editable} onClick={onPickImage}>
          {bg?.kind === "image" ? "Replace image" : "Image background"}
        </Button>
        {bg?.kind === "image" && (
          <Button variant="ghost" size="sm" disabled={!editable} onClick={() => onChange(null)}>
            Remove
          </Button>
        )}
      </div>
      {bg?.kind === "image" && (
        <Segmented
          ariaLabel="Image fit"
          fullWidth
          value={bg.fit}
          onChange={(fit: BackgroundFit) => onChange({ ...bg, fit })}
          options={[
            { value: "cover", label: "Fill", disabled: !editable },
            { value: "contain", label: "Fit", disabled: !editable },
          ]}
        />
      )}
    </Section>
  );
}

export function TransitionSection({
  slide,
  editable,
  onChange,
  onPreview,
}: {
  slide: RenderSlide;
  editable: boolean;
  onChange: (transition: SlideTransition | null) => void;
  onPreview: () => void;
}) {
  const t = slide.transition;
  const kind: TransitionKind = t?.kind ?? "none";
  return (
    <Section title="Transition">
      <Segmented
        ariaLabel="Transition"
        fullWidth
        value={kind}
        onChange={(next: TransitionKind) => onChange(next === "none" ? null : { kind: next, ...(t?.duration ? { duration: t.duration } : {}) })}
        options={TRANSITION_KINDS.map((value) => ({ value, label: TRANSITION_LABELS[value].replace(" Move", ""), disabled: !editable }))}
      />
      {t && (
        <>
          <NumberField
            label="ms"
            ariaLabel="Transition duration"
            value={transitionDuration(t)}
            min={MIN_TRANSITION_MS}
            max={MAX_TRANSITION_MS}
            disabled={!editable}
            onCommit={(duration) => onChange({ ...t, duration })}
          />
          <p className="text-xs text-os-grey">
            {kind === "magic"
              ? "Matching items glide to their new place. The rest fade."
              : `Plays when you arrive at this slide. About ${DEFAULT_TRANSITION_MS[kind] / 1000} seconds by default.`}
          </p>
          <Button variant="secondary" size="sm" onClick={onPreview}>
            <Play className="h-3.5 w-3.5" aria-hidden />
            Preview
          </Button>
        </>
      )}
    </Section>
  );
}
