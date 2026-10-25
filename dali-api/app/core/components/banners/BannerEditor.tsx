import { useLayoutEffect, useRef, useState, type ChangeEvent, type ReactNode } from "react";
import { Link, useActionData, useNavigation, useSubmit } from "react-router";
import { ChevronLeft, Image as ImageIcon, Maximize2, RectangleVertical, Trash2, Type, Upload, Video, X } from "lucide-react";
import { Segmented } from "~/components/ui/Segmented";
import { Toggle } from "~/components/ui/Toggle";
import { Radio } from "~/components/ui/Radio";
import { DateField } from "~/components/ui/DateField";
import { IconButton } from "~/components/ui/IconButton";
import { ToggleChip } from "~/components/ui/ToggleChip";
import { Combobox, Select } from "~/components/ui/floating";
import { useDialog } from "~/components/ui/dialog";
import { useToast } from "~/components/ui/toast";
import { useOsChrome } from "~/components/os-chrome";
import { BANNER_CARD_WIDTH, BannerContent, BannerFooter, BannerOverlay } from "~/components/banners/BannerContent";
import { Pill } from "~/hiring/components/cycle-setup/SetupCard";
import { uploadFileToS3 } from "~/lib/upload-client";
import { rawUploadUrl } from "~/components/doc/upload";
import { cn } from "~/lib/cn";
import {
  BANNER_PAGES,
  BANNER_ROLES,
  BANNER_ROLE_LABELS,
  BANNER_UPLOAD_PREFIX,
  FREQUENCY_HELP,
  STATUS_DOT,
  STATUS_LABEL,
  bannerStatus,
  pageLabel,
  snoozeOffered,
  validateForPublish,
  type BannerErrors,
  type BannerFrequency,
  type BannerInput,
  type BannerKind,
  type BannerTone,
} from "~/core/lib/banners";
import type { BannerDTO } from "~/core/lib/banners.server";

type EditorData = {
  banner: BannerDTO | null;
  author: string;
  groups: { id: string; name: string; memberCount: number }[];
  recentMedia: string[];
};

/** A banner as the form edits it: times as datetime-local wall clock in the browser's zone. */
type Draft = Omit<BannerInput, "startsAt" | "endsAt"> & { startsAt: string; endsAt: string };

const pad = (n: number) => String(n).padStart(2, "0");
function toLocal(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function initialDraft(b: BannerDTO | null): Draft {
  if (b) {
    const { id: _id, author: _a, ...rest } = b;
    return { ...rest, startsAt: toLocal(new Date(b.startsAt)), endsAt: toLocal(new Date(b.endsAt)) };
  }
  const start = new Date();
  start.setMinutes(0, 0, 0);
  start.setHours(start.getHours() + 1);
  const end = new Date(start.getTime() + 7 * 86_400_000);
  return {
    name: "",
    kind: "Image",
    mediaUrl: null,
    videoUrl: null,
    headline: "",
    body: "",
    ctaLabel: "",
    ctaUrl: "",
    tone: "Accent",
    everyone: false,
    roles: ["isLabMember"],
    groupIds: [],
    trigger: "AppOpen",
    triggerPath: null,
    frequency: "EveryOpen",
    allowSnooze: true,
    startsAt: toLocal(start),
    endsAt: toLocal(end),
    published: false,
  };
}

function toInput(d: Draft, published: boolean): BannerInput {
  const iso = (v: string) => (v ? new Date(v).toISOString() : new Date(0).toISOString());
  return { ...d, published, startsAt: iso(d.startsAt), endsAt: iso(d.endsAt) };
}

const FORMATS: { value: BannerKind; label: string; help: string; icon: typeof ImageIcon }[] = [
  { value: "Image", label: "Image", help: "Wide image with text below", icon: ImageIcon },
  { value: "Poster", label: "Poster", help: "Tall poster beside text", icon: RectangleVertical },
  { value: "Video", label: "Video", help: "Plays muted, with controls", icon: Video },
  { value: "Text", label: "Text", help: "A bold block of words", icon: Type },
];

const TONES: { value: BannerTone; label: string; swatch: string }[] = [
  { value: "Accent", label: "Sky", swatch: "bg-os-accent" },
  { value: "Amber", label: "Amber", swatch: "bg-os-amber" },
  { value: "Card", label: "Neutral", swatch: "bg-os-container" },
];

export function BannerEditor({ data }: { data: EditorData }) {
  const os = useOsChrome();
  const toast = useToast();
  const dialog = useDialog();
  const submit = useSubmit();
  const nav = useNavigation();
  const actionData = useActionData<{ ok: false; error: string; errors?: BannerErrors }>();
  const existing = data.banner;
  const [draft, setDraft] = useState<Draft>(() => initialDraft(existing));
  const [errors, setErrors] = useState<BannerErrors>({});
  const [fullPreview, setFullPreview] = useState(false);
  const busy = nav.state !== "idle";
  const shownError = useRef<unknown>(null);
  if (actionData && shownError.current !== actionData) {
    shownError.current = actionData;
    queueMicrotask(() => {
      toast.error(actionData.error);
      if (actionData.errors) setErrors(actionData.errors);
    });
  }

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));
  const view = { ...draft, author: existing?.author ?? data.author, name: draft.name || draft.headline || "Untitled banner" };
  const startsLater = draft.startsAt && new Date(draft.startsAt) > new Date();

  const persist = (published: boolean) => {
    const input = toInput(draft, published);
    const e = published ? validateForPublish(input) : {};
    setErrors(e);
    if (Object.keys(e).length) {
      toast.error("Fix the highlighted sections before publishing");
      return;
    }
    submit({ intent: "save", banner: JSON.stringify(input) }, { method: "post" });
  };

  const remove = async () => {
    const ok = await dialog.confirm({
      title: "Delete this banner?",
      description: "It stops showing right away and its view counts are removed.",
      confirmLabel: "Delete banner",
      tone: "destructive",
    });
    if (ok) submit({ intent: "delete" }, { method: "post" });
  };

  const status = existing ? bannerStatus(existing) : null;
  const when = (v: string) =>
    v ? new Date(v).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "not set";

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <Link to="/core/communications/banners" className={os.iconBtn} aria-label="Back to banners">
            <ChevronLeft className="h-5 w-5" />
          </Link>
          <h2 className="truncate font-heading text-2xl font-semibold text-foreground">
            {draft.name || (existing ? "Untitled banner" : "New banner")}
          </h2>
          {status && <Pill dot={STATUS_DOT[status]}>{STATUS_LABEL[status]}</Pill>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {existing && <IconButton label="Delete banner" icon={Trash2} tone="destructive" onClick={remove} disabled={busy} />}
          <button type="button" className={os.actionBtn()} disabled={busy} onClick={() => persist(false)}>
            {existing?.published ? "Unpublish" : "Save draft"}
          </button>
          <button type="button" className={os.actionBtnPrimary} disabled={busy} onClick={() => persist(true)}>
            {existing?.published ? "Save changes" : startsLater ? "Schedule" : "Publish now"}
          </button>
        </div>
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className={cn(os.formClass, "flex flex-col gap-6")}>
          <Panel title="Content" error={errors.content}>
            <label className={os.fieldLabel}>
              Name (only Core sees this)
              <input value={draft.name} onChange={(e) => patch({ name: e.target.value })} maxLength={120} placeholder="For example, Technigala reminder" />
            </label>

            <div role="radiogroup" aria-label="Format" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {FORMATS.map((f) => {
                const on = draft.kind === f.value;
                return (
                  <button
                    key={f.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => patch({ kind: f.value })}
                    className={cn(
                      "flex flex-col gap-1.5 rounded-os-item border bg-os-well p-3 text-left transition-colors",
                      on ? "border-os-accent" : "border-os-container hover:border-os-container-hi",
                    )}
                  >
                    <f.icon className={cn("h-5 w-5", on ? "text-os-accent" : "text-os-grey")} />
                    <span className="text-sm font-semibold text-foreground">{f.label}</span>
                    <span className="text-xs leading-snug text-os-muted">{f.help}</span>
                  </button>
                );
              })}
            </div>

            {draft.kind === "Video" && (
              <MediaField
                label="Video (MP4)"
                accept="video/mp4"
                value={draft.videoUrl}
                onChange={(videoUrl) => patch({ videoUrl })}
              />
            )}

            {draft.kind !== "Text" ? (
              <div className="flex flex-col gap-2">
                <MediaField
                  label={draft.kind === "Video" ? "Cover image (optional)" : draft.kind === "Poster" ? "Poster" : "Image"}
                  accept="image/*"
                  value={draft.mediaUrl}
                  onChange={(mediaUrl) => patch({ mediaUrl })}
                />
                {data.recentMedia.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-os-muted">Recent</span>
                    {data.recentMedia.map((url) => (
                      <button
                        key={url}
                        type="button"
                        onClick={() => patch({ mediaUrl: url })}
                        aria-label="Use this image"
                        className={cn(
                          "overflow-hidden rounded-md border-2 transition-colors",
                          draft.mediaUrl === url ? "border-os-accent" : "border-transparent hover:border-os-container-hi",
                        )}
                      >
                        <img src={url} alt="" className="h-10 w-14 object-cover" />
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-2">
                <span className="text-sm text-os-grey">Color</span>
                <div role="radiogroup" aria-label="Color" className="flex flex-wrap gap-2">
                  {TONES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      role="radio"
                      aria-checked={draft.tone === t.value}
                      onClick={() => patch({ tone: t.value })}
                      className={cn(
                        "flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors",
                        draft.tone === t.value ? "border-os-accent text-foreground" : "border-os-container text-os-grey hover:border-os-container-hi",
                      )}
                    >
                      <span className={cn("h-3.5 w-3.5 rounded-full", t.swatch)} />
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            <label className={os.fieldLabel}>
              {draft.kind === "Text" ? "Headline" : "Headline (optional)"}
              <input value={draft.headline} onChange={(e) => patch({ headline: e.target.value })} maxLength={200} placeholder="What should people know?" />
            </label>
            <label className={os.fieldLabel}>
              Message (optional)
              <textarea value={draft.body} onChange={(e) => patch({ body: e.target.value })} rows={3} maxLength={2000} className="resize-y" />
            </label>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
              <label className={os.fieldLabel}>
                Button label (optional)
                <input value={draft.ctaLabel} onChange={(e) => patch({ ctaLabel: e.target.value })} maxLength={60} placeholder="Learn more" />
              </label>
              <label className={os.fieldLabel}>
                Button link
                <input
                  value={draft.ctaUrl}
                  onChange={(e) => patch({ ctaUrl: e.target.value })}
                  placeholder="/projects or https://"
                  disabled={!draft.ctaLabel}
                />
              </label>
            </div>
          </Panel>

          <Panel title="Who sees it" error={errors.audience}>
            <div className="flex flex-col gap-2">
              <p className="text-xs text-os-muted">Roles</p>
              <div className="flex flex-wrap gap-2">
                <ToggleChip on={draft.everyone} onToggle={() => patch({ everyone: !draft.everyone })}>
                  Everyone
                </ToggleChip>
                {BANNER_ROLES.map((r) => (
                  <ToggleChip
                    key={r}
                    on={!draft.everyone && draft.roles.includes(r)}
                    disabled={draft.everyone}
                    onToggle={() =>
                      patch({ roles: draft.roles.includes(r) ? draft.roles.filter((x) => x !== r) : [...draft.roles, r] })
                    }
                  >
                    {BANNER_ROLE_LABELS[r]}
                  </ToggleChip>
                ))}
              </div>
            </div>
            {!draft.everyone && (
              <div className="flex flex-col gap-2">
                <p className="text-xs text-os-muted">Groups</p>
                {draft.groupIds.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {draft.groupIds.map((id) => (
                      <ToggleChip key={id} on onToggle={() => patch({ groupIds: draft.groupIds.filter((x) => x !== id) })}>
                        {data.groups.find((g) => g.id === id)?.name ?? "Group"}
                      </ToggleChip>
                    ))}
                  </div>
                )}
                <div className="sm:w-72">
                  <Combobox
                    value=""
                    ariaLabel="Add a group"
                    placeholder="Add a group"
                    options={data.groups
                      .filter((g) => !draft.groupIds.includes(g.id))
                      .map((g) => ({ value: g.id, label: g.name, description: `${g.memberCount} members` }))}
                    onChange={(id) => id && patch({ groupIds: [...draft.groupIds, id] })}
                  />
                </div>
              </div>
            )}
          </Panel>

          <Panel title="When it appears" error={errors.trigger}>
            <div role="radiogroup" aria-label="Trigger" className="flex flex-col gap-3">
              <Radio
                name="banner-trigger"
                checked={draft.trigger === "AppOpen"}
                onChange={() => patch({ trigger: "AppOpen" })}
                label="When they open DALI OS"
              />
              <div className="flex flex-wrap items-center gap-3">
                <Radio
                  name="banner-trigger"
                  checked={draft.trigger === "Page"}
                  onChange={() => patch({ trigger: "Page", triggerPath: draft.triggerPath ?? BANNER_PAGES[0].path })}
                  label="When they visit a page"
                />
                {draft.trigger === "Page" && (
                  <Select
                    value={draft.triggerPath ?? undefined}
                    ariaLabel="Page"
                    buttonClassName={os.formTrigger}
                    options={BANNER_PAGES.map((p) => ({ value: p.path, label: p.label }))}
                    onChange={(triggerPath) => patch({ triggerPath })}
                  />
                )}
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm text-os-grey">How often</span>
              <Segmented<BannerFrequency>
                ariaLabel="How often"
                size="md"
                value={draft.frequency}
                onChange={(frequency) => patch({ frequency })}
                options={[
                  { value: "EveryOpen", label: "Every time" },
                  { value: "Daily", label: "Once a day" },
                  { value: "Once", label: "Once per person" },
                ]}
              />
              <p className="text-xs text-os-muted">{FREQUENCY_HELP[draft.frequency]}</p>
            </div>

            <div className="flex items-center justify-between gap-6 rounded-os-item bg-os-well px-4 py-3">
              <div>
                <p className="text-sm text-foreground">Offer "Don't show again today"</p>
                <p className="text-xs text-os-muted">
                  {draft.frequency === "EveryOpen"
                    ? "A checkbox beside Close hides it until tomorrow."
                    : "Not needed. This banner already shows at most once a day."}
                </p>
              </div>
              <Toggle
                tone="os"
                aria-label="Offer don't show again today"
                checked={snoozeOffered(draft)}
                disabled={draft.frequency !== "EveryOpen"}
                onChange={(e) => patch({ allowSnooze: e.target.checked })}
              />
            </div>
          </Panel>

          <Panel title="Schedule" error={errors.schedule}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className={os.fieldLabel}>
                Starts showing
                <DateField mode="datetime-local" value={draft.startsAt} onChange={(startsAt) => patch({ startsAt })} ariaLabel="Starts showing" buttonClassName={os.formTrigger} />
              </div>
              <div className={os.fieldLabel}>
                Stops showing
                <DateField mode="datetime-local" value={draft.endsAt} onChange={(endsAt) => patch({ endsAt })} ariaLabel="Stops showing" buttonClassName={os.formTrigger} />
              </div>
            </div>
          </Panel>
        </div>

        <aside className="lg:sticky lg:top-8 lg:self-start">
          <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className={os.sectionTitle}>Preview</h2>
              <button type="button" className={os.actionBtn()} onClick={() => setFullPreview(true)}>
                <Maximize2 className={os.actionIcon} /> Full size
              </button>
            </div>
            <BannerPreview banner={view} />
            <p className="text-sm text-os-grey">
              {draft.trigger === "AppOpen" ? "Opens over DALI OS" : `Opens over ${pageLabel(draft.triggerPath)}`} for the chosen
              audience, {when(draft.startsAt)} to {when(draft.endsAt)}.
            </p>
          </div>
        </aside>
      </div>

      {fullPreview && <BannerOverlay banner={view} preview onClose={() => setFullPreview(false)} />}
    </div>
  );
}

function Panel({ title, error, children }: { title: string; error?: string; children: ReactNode }) {
  const os = useOsChrome();
  return (
    <section className={cn(os.panel, "flex flex-col gap-5 p-6")} aria-label={title}>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={os.sectionTitle}>{title}</h2>
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>
      {children}
    </section>
  );
}

/** Upload a file or paste an https:// link. */
function MediaField({
  label,
  accept,
  value,
  onChange,
}: {
  label: string;
  accept: string;
  value: string | null;
  onChange: (url: string | null) => void;
}) {
  const os = useOsChrome();
  const toast = useToast();
  const [uploading, setUploading] = useState(false);
  const isUpload = value?.startsWith("/api/upload/raw") ?? false;

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    try {
      const meta = await uploadFileToS3(file, BANNER_UPLOAD_PREFIX, accept);
      onChange(rawUploadUrl(meta.s3Key));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className={os.fieldLabel}>
      {label}
      <div className="flex items-center gap-2">
        <input
          className="min-w-0 flex-1"
          value={isUpload ? "Uploaded file" : (value ?? "")}
          readOnly={isUpload}
          onChange={(e) => onChange(e.target.value || null)}
          placeholder="https://"
        />
        {value ? (
          <IconButton label="Remove" icon={X} onClick={() => onChange(null)} />
        ) : (
          <label className={cn(os.actionBtn(), "cursor-pointer", uploading && "pointer-events-none opacity-50")}>
            <Upload className={os.actionIcon} /> {uploading ? "Uploading…" : "Upload"}
            <input type="file" accept={accept} className="sr-only" onChange={onFile} />
          </label>
        )}
      </div>
    </div>
  );
}

const PAD = 24;

/** A scaled-down picture of what a viewer sees: the banner card over a dimmed DALI OS. */
function BannerPreview({ banner }: { banner: Parameters<typeof BannerContent>[0]["banner"] }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  const [cardHeight, setCardHeight] = useState(500);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    const card = cardRef.current;
    if (!frame || !card) return;
    const ro = new ResizeObserver(() => {
      setScale(Math.min(1, (frame.clientWidth - PAD * 2) / BANNER_CARD_WIDTH));
      setCardHeight(card.offsetHeight);
    });
    ro.observe(frame);
    ro.observe(card);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={frameRef}
      className="relative w-full overflow-hidden rounded-os-item border border-os-container bg-os-bg"
      style={{ height: cardHeight * scale + PAD * 2 }}
      aria-label="Banner preview"
    >
      <div className="absolute inset-0 flex" aria-hidden>
        <div className="w-[18%] bg-os-nav p-3">
          <div className="h-2 w-2/3 rounded-full bg-os-accent/50" />
          <div className="mt-4 flex flex-col gap-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-1.5 rounded-full bg-os-container" />
            ))}
          </div>
        </div>
        <div className="flex flex-1 flex-col gap-3 p-5">
          <div className="h-3 w-1/3 rounded-full bg-os-container" />
          <div className="grid flex-1 grid-cols-3 gap-3">
            <div className="rounded-lg bg-os-card" />
            <div className="rounded-lg bg-os-card" />
            <div className="rounded-lg bg-os-card" />
          </div>
        </div>
      </div>
      <div className="absolute inset-0 bg-black/70" aria-hidden />
      <div
        ref={cardRef}
        inert
        className="absolute left-1/2 top-6 overflow-hidden rounded-os-card border border-os-container bg-os-card"
        style={{ width: BANNER_CARD_WIDTH, transform: `translateX(-50%) scale(${scale})`, transformOrigin: "top center" }}
      >
        <span className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-full bg-black/50 text-white">
          <X className="h-4 w-4" />
        </span>
        <BannerContent banner={banner} inert />
        <BannerFooter banner={banner} />
      </div>
    </div>
  );
}
