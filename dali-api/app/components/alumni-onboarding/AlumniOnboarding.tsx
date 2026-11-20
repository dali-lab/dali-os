import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useFetcher } from "react-router";
import { X } from "lucide-react";
import { AuthShellV2 } from "~/components/auth/v2";
import { Avatar } from "~/components/ui/Avatar";
import { Button, buttonClasses } from "~/components/ui/Button";
import { DateField } from "~/components/ui/DateField";
import { FormField } from "~/components/ui/FormField";
import { Toggle } from "~/components/ui/Toggle";
import { ToggleChip } from "~/components/ui/ToggleChip";
import { useOsChrome } from "~/components/os-chrome";
import { BasedInField, structuredPlace } from "~/members/components/BasedInField";
import { cn } from "~/lib/cn";
import type { AuthTile } from "~/components/auth/auth-tiles";
import { BlockTile, BlockWall } from "~/components/alumni-onboarding/Wall";
import { ContactEmailPicker } from "~/components/contact-email/ContactEmailPicker";
import {
  ASK_ME_ABOUT_SUGGESTIONS,
  blockById,
  pluralize,
  wallFilledForStep,
} from "~/alumni/lib/alumni-onboarding";
import { OPEN_TO_CHOICES, type OpenToChoices } from "~/members/lib/open-to";
import {
  MAX_ASK_ME_ABOUT,
  MAX_ASK_ME_ABOUT_LENGTH,
  MAX_STUDY_ITEMS,
  MAX_STUDY_LENGTH,
} from "~/members/lib/profile-limits";
import type { OnboardingData } from "~/alumni/lib/alumni-onboarding.server";
import type { ContactEmailOptions } from "~/members/lib/contact-email.server";

export type OnboardingView = OnboardingData & { contactEmail: ContactEmailOptions };

type ActionData = { ok?: boolean; error?: string };

const BRAND: Record<1 | 2 | 3 | 4, { sub: string }> = {
  1: { sub: "Once DALI, always DALI. Your profile takes about two minutes." },
  2: { sub: "This is what students see when they look you up." },
  3: { sub: "Any mix works, and each choice can change later on your profile." },
  4: { sub: "Your block sits on the corner of your profile photo." },
};

function brandLines(step: 1 | 2 | 3 | 4, firstName: string): [string, string] {
  if (step === 1) return ["Welcome back,", firstName];
  if (step === 2) return ["Give students", "a way in"];
  if (step === 3) return ["How you'd", "like to help"];
  return ["You're all set,", firstName];
}

function StepHeader({ eyebrow, title, sub }: { eyebrow: string; title: string; sub: string }) {
  return (
    <div className="mb-6 flex flex-col gap-2">
      <div className="text-sm font-bold text-os-muted">{eyebrow}</div>
      <h1 className="font-os text-[28px] font-extrabold leading-[34px] tracking-tight text-foreground">{title}</h1>
      <p className="text-[15px] leading-normal text-os-grey">{sub}</p>
    </div>
  );
}

function RowTile({ id, size = 28 }: { id: string; size?: number }) {
  return (
    <div className="shrink-0" style={{ width: size, height: size }} aria-hidden>
      <BlockTile tile={blockById(id)} />
    </div>
  );
}

function useRowSave(onSaved: () => void) {
  const fetcher = useFetcher<ActionData>();
  const saved = fetcher.state === "idle" && fetcher.data?.ok === true;
  useEffect(() => {
    if (saved) onSaved();
  }, [saved]);
  return fetcher;
}

function EditorActions({ saving, onCancel, label = "Save" }: { saving: boolean; onCancel: () => void; label?: string }) {
  return (
    <div className="flex items-center gap-2">
      <Button type="submit" size="sm" disabled={saving}>
        {label}
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </div>
  );
}

function EditorError({ error }: { error?: string }) {
  return error ? (
    <p role="alert" className="text-sm text-[var(--os-danger-ink)]">
      {error}
    </p>
  ) : null;
}

function AddChip({
  label,
  maxLength,
  disabled,
  onAdd,
}: {
  label: string;
  maxLength: number;
  disabled?: boolean;
  onAdd: (value: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [value, setValue] = useState("");
  const commit = () => {
    const v = value.trim().replace(/\s+/g, " ");
    if (v) onAdd(v);
    setValue("");
    setAdding(false);
  };
  if (!adding) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => setAdding(true)}
        className="inline-flex items-center rounded-lg border border-dashed border-os-container-hi px-3 py-1.5 text-sm text-os-muted transition-colors hover:text-foreground disabled:opacity-50"
      >
        + {label}
      </button>
    );
  }
  return (
    <span className="flex items-center gap-2">
      <input
        autoFocus
        aria-label={label}
        value={value}
        maxLength={maxLength}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          }
          if (e.key === "Escape") setAdding(false);
        }}
        className="h-8 w-44"
      />
      <Button type="button" size="sm" onClick={commit}>
        Add
      </Button>
    </span>
  );
}

function ListField({ label, name, initial, addLabel }: { label: string; name: string; initial: string[]; addLabel: string }) {
  const [items, setItems] = useState(initial);
  const add = (v: string) =>
    setItems((cur) => (cur.some((c) => c.toLowerCase() === v.toLowerCase()) ? cur : [...cur, v]));
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-sm font-semibold text-foreground">{label}</span>
      <input type="hidden" name={name} value={JSON.stringify(items)} />
      <div className="flex flex-wrap items-center gap-2">
        {items.map((item) => (
          <ToggleChip key={item} on onToggle={() => setItems((cur) => cur.filter((c) => c !== item))}>
            <span className="inline-flex items-center gap-1.5">
              {item}
              <X className="size-3" aria-label={`Remove ${item}`} />
            </span>
          </ToggleChip>
        ))}
        <AddChip label={addLabel} maxLength={MAX_STUDY_LENGTH} disabled={items.length >= MAX_STUDY_ITEMS} onAdd={add} />
      </div>
    </div>
  );
}

function ClassEditor({ data, close }: { data: OnboardingView; close: () => void }) {
  const fetcher = useRowSave(close);
  const { formClass } = useOsChrome();
  return (
    <fetcher.Form method="post" className={cn(formClass, "flex flex-col gap-3")}>
      <input type="hidden" name="intent" value="save-class" />
      <FormField label="Class year" name="classYear" defaultValue={data.classYear?.toString() ?? ""} />
      <ListField label="Majors" name="majors" initial={data.majors} addLabel="Add a major" />
      <ListField label="Minors" name="minors" initial={data.minors} addLabel="Add a minor" />
      <EditorError error={fetcher.data?.error} />
      <EditorActions saving={fetcher.state !== "idle"} onCancel={close} />
    </fetcher.Form>
  );
}

function HometownEditor({ data, close }: { data: OnboardingView; close: () => void }) {
  const fetcher = useRowSave(close);
  const { formClass } = useOsChrome();
  return (
    <fetcher.Form method="post" className={cn(formClass, "flex flex-col gap-2")}>
      <input type="hidden" name="intent" value="save-hometown" />
      <FormField label="Hometown" name="hometown" defaultValue={data.hometown ?? ""} />
      <EditorError error={fetcher.data?.error} />
      <EditorActions saving={fetcher.state !== "idle"} onCancel={close} />
    </fetcher.Form>
  );
}

function BasedInEditor({ data, close }: { data: OnboardingView; close: () => void }) {
  const fetcher = useRowSave(close);
  const { formClass } = useOsChrome();
  return (
    <fetcher.Form method="post" className={cn(formClass, "flex flex-col gap-2")}>
      <input type="hidden" name="intent" value="save-based-in" />
      <BasedInField value={data.basedIn} />
      <EditorError error={fetcher.data?.error} />
      <EditorActions saving={fetcher.state !== "idle"} onCancel={close} />
    </fetcher.Form>
  );
}

function WorkEditor({
  slot,
  job,
  close,
}: {
  slot: "now" | "before";
  job: OnboardingView["now"];
  close: () => void;
}) {
  const fetcher = useRowSave(close);
  const { formClass } = useOsChrome();
  return (
    <fetcher.Form method="post" className={cn(formClass, "flex flex-col gap-2")}>
      <input type="hidden" name="intent" value="save-work" />
      <input type="hidden" name="slot" value={slot} />
      <input type="hidden" name="id" value={job?.id ?? ""} />
      <FormField label="Role" name="position" defaultValue={job?.position ?? ""} />
      <FormField label="Company" name="company" defaultValue={job?.company ?? ""} />
      {slot === "before" && (
        <FormField label="Year you left" name="year" defaultValue={job?.year?.toString() ?? ""} />
      )}
      <EditorError error={fetcher.data?.error} />
      <EditorActions saving={fetcher.state !== "idle"} onCancel={close} />
    </fetcher.Form>
  );
}

function DetailRow({
  tileId,
  label,
  value,
  detail,
  editor,
  editLabel = "Edit",
  last,
  labelWidth = "w-[110px]",
}: {
  tileId: string;
  label: string;
  value: string;
  detail?: string | null;
  editor?: (close: () => void) => ReactNode;
  editLabel?: string;
  last?: boolean;
  labelWidth?: string;
}) {
  const [editing, setEditing] = useState(false);
  return (
    <div className={cn("flex flex-col py-[11px]", !last && "border-b border-os-well")}>
      <div className="flex items-center gap-3.5">
        <RowTile id={tileId} />
        <div className={cn(labelWidth, "shrink-0 text-sm text-os-muted")}>{label}</div>
        <div className="flex min-w-0 grow flex-col gap-px">
          <div className="text-[15px] font-semibold leading-[18px] text-foreground">{value}</div>
          {detail ? <div className="text-sm text-os-grey">{detail}</div> : null}
        </div>
        {editor ? (
          <button
            type="button"
            className="text-sm font-bold text-os-accent hover:text-os-accent-hover"
            onClick={() => setEditing((v) => !v)}
            aria-expanded={editing}
          >
            {editing ? "Close" : editLabel}
          </button>
        ) : null}
      </div>
      {editing && editor ? <div className="mt-3 pl-[28px] sm:pl-[42px]">{editor(() => setEditing(false))}</div> : null}
    </div>
  );
}

function workLine(job: OnboardingView["now"], withYear: boolean): string {
  if (!job) return "Not added yet";
  const base = `${job.position} at ${job.company}`;
  return withYear && job.year ? `${base}, ${job.year}` : base;
}

function ContactStep({ data, next }: { data: OnboardingView; next: () => void }) {
  return (
    <>
      <StepHeader
        eyebrow="First, a quick one"
        title="Your email"
        sub="Sign-in codes and DALI OS updates go to this address. It can be changed later in settings."
      />
      <div className="pb-8">
        <ContactEmailPicker data={data.contactEmail} onDone={next} />
      </div>
    </>
  );
}

function studyLine(data: OnboardingView): string | null {
  const majors = data.majors.join(" and ");
  const minors = data.minors.length > 0 ? `${data.minors.join(" and ")} ${data.minors.length === 1 ? "minor" : "minors"}` : "";
  return [majors, minors].filter(Boolean).join(", ") || null;
}

function DaliRecord({ data }: { data: OnboardingView }) {
  const { dali } = data;
  const [open, setOpen] = useState(false);
  const fetcher = useFetcher<ActionData>();
  const sent = fetcher.state === "idle" && fetcher.data?.ok === true;
  const { formClass } = useOsChrome();
  return (
    <div className="mt-4 flex flex-col rounded-os-card bg-os-card px-4 pb-3 pt-3.5">
      <div className="flex items-center justify-between pb-1">
        <span className="text-sm font-bold text-os-muted">On record at DALI</span>
        {sent ? null : (
          <button
            type="button"
            className="text-sm font-bold text-os-accent hover:text-os-accent-hover"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
          >
            {open ? "Close" : "Anything off?"}
          </button>
        )}
      </div>
      <DetailRow
        tileId="t8"
        label="At DALI"
        labelWidth="w-[94px]"
        value={
          dali.projectCount > 0
            ? `${pluralize(dali.projectCount, "project")}, ${pluralize(dali.termCount, "term")}`
            : "No projects on record"
        }
        detail={dali.projectNames.join(", ") || null}
      />
      <DetailRow tileId="t9" label="Roles" labelWidth="w-[94px]" value={dali.rolesLine || "No roles on record"} last />
      {sent ? (
        <p role="status" className="border-t border-os-well pt-2.5 text-sm text-os-grey">
          Sent to DALI staff, who update the record.
        </p>
      ) : open ? (
        <fetcher.Form method="post" className={cn(formClass, "flex flex-col gap-2 border-t border-os-well pt-2.5")}>
          <input type="hidden" name="intent" value="report-history" />
          <FormField
            label="What's wrong or missing?"
            name="note"
            multiline
            rows={3}
            maxLength={1000}
            placeholder="Also on Rauner Archive in 24W, as a designer."
          />
          <EditorError error={fetcher.data?.error} />
          <div className="flex items-center justify-between gap-3">
            <span className="text-sm text-os-muted">This goes to DALI staff, who update the record.</span>
            <Button type="submit" size="sm" disabled={fetcher.state !== "idle"}>
              Send
            </Button>
          </div>
        </fetcher.Form>
      ) : null}
    </div>
  );
}

function DetailsStep({ data, next }: { data: OnboardingView; next: () => void }) {
  const place = structuredPlace(data.basedIn);
  return (
    <>
      <StepHeader
        eyebrow="Step 1 of 3"
        title="Check your details"
        sub="These come from your time at DALI, and anything out of date can be changed here."
      />
      <div className="flex flex-col pb-7">
        <DetailRow
          tileId="t4"
          label="Class"
          value={data.classYear ? `Class of ${data.classYear}` : "Not added yet"}
          detail={studyLine(data)}
          editor={(close) => <ClassEditor data={data} close={close} />}
        />
        <DetailRow
          tileId="t5"
          label="Hometown"
          value={data.hometown || "Not added yet"}
          editor={(close) => <HometownEditor data={data} close={close} />}
        />
        <DetailRow
          tileId="t14"
          label="Based in"
          value={place || "Not added yet"}
          editLabel={place ? "Edit" : "Add"}
          editor={(close) => <BasedInEditor data={data} close={close} />}
        />
        <DetailRow
          tileId="t12"
          label="Now"
          value={workLine(data.now, false)}
          detail={data.now?.location}
          editLabel={data.now ? "Edit" : "Add"}
          editor={(close) => <WorkEditor slot="now" job={data.now} close={close} />}
        />
        <DetailRow
          tileId="t15"
          label="Before that"
          value={workLine(data.before, true)}
          editLabel={data.before ? "Edit" : "Add"}
          editor={(close) => <WorkEditor slot="before" job={data.before} close={close} />}
          last
        />
        <DaliRecord data={data} />
      </div>
      <div className="flex items-center gap-2.5">
        <Button onClick={next}>Looks good</Button>
      </div>
    </>
  );
}

function FieldLabel({ tileId, children }: { tileId: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <RowTile id={tileId} size={16} />
      <span className="text-base font-bold text-foreground">{children}</span>
    </div>
  );
}

export type AboutDraft = {
  funFact: string;
  outsideOfWork: string;
  askMeAbout: string[];
  linkedinUrl: string;
  personalSite: string;
  birthday: string;
  dietaryRestrictions: string;
};

function AboutStep({
  data,
  saving,
  error,
  onNext,
  onBack,
}: {
  data: OnboardingView;
  saving: boolean;
  error?: string;
  onNext: (draft: AboutDraft) => void;
  onBack: () => void;
}) {
  const { formClass } = useOsChrome();
  const [funFact, setFunFact] = useState(data.funFact);
  const [outside, setOutside] = useState(data.outsideOfWork);
  const [topics, setTopics] = useState<string[]>(data.askMeAbout);
  const [linkedinUrl, setLinkedinUrl] = useState(data.linkedinUrl);
  const [personalSite, setPersonalSite] = useState(data.personalSite);
  const [birthday, setBirthday] = useState(data.birthday);
  const [dietary, setDietary] = useState(data.dietaryRestrictions);

  const suggestions: string[] = [...ASK_ME_ABOUT_SUGGESTIONS];
  const chips = [...suggestions, ...topics.filter((t) => !suggestions.includes(t))];
  const toggle = (topic: string) =>
    setTopics((cur) => (cur.includes(topic) ? cur.filter((t) => t !== topic) : [...cur, topic]));
  const addCustom = (topic: string) => {
    if (!topics.some((t) => t.toLowerCase() === topic.toLowerCase())) setTopics((cur) => [...cur, topic]);
  };
  const full = topics.length >= MAX_ASK_ME_ABOUT;

  return (
    <>
      <StepHeader eyebrow="Step 2 of 3" title="A bit more about you" sub="Every field here is optional." />
      <div className={cn(formClass, "flex flex-col gap-[22px] pb-8")}>
        <div className="flex flex-col gap-2">
          <FieldLabel tileId="t5">A fun fact</FieldLabel>
          <FormField label="A fun fact" labelHidden value={funFact} onChange={setFunFact} placeholder="Biked every road in Hanover" />
        </div>
        <div className="flex flex-col gap-2">
          <FieldLabel tileId="t15">Ask me about</FieldLabel>
          <div className="flex flex-wrap gap-2">
            {chips.map((topic) => {
              const on = topics.includes(topic);
              return (
                <ToggleChip key={topic} on={on} onToggle={() => toggle(topic)} disabled={!on && full}>
                  {topic}
                </ToggleChip>
              );
            })}
            <AddChip label="Add your own" maxLength={MAX_ASK_ME_ABOUT_LENGTH} disabled={full} onAdd={addCustom} />
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <FieldLabel tileId="t12">Outside of work</FieldLabel>
          <FormField label="Outside of work" labelHidden value={outside} onChange={setOutside} placeholder="Climbing, film photography, bad puns" />
        </div>
        <div className="flex flex-col gap-2">
          <FieldLabel tileId="t9">Links</FieldLabel>
          <div className="flex flex-col gap-2.5 sm:flex-row">
            <FormField label="LinkedIn" labelHidden type="url" value={linkedinUrl} onChange={setLinkedinUrl} placeholder="LinkedIn URL" />
            <FormField label="Personal site" labelHidden type="url" value={personalSite} onChange={setPersonalSite} placeholder="Personal site" />
          </div>
        </div>
        <div className="flex flex-col gap-2 border-t border-os-well pt-[18px]">
          <FieldLabel tileId="t8">For DALI events</FieldLabel>
          <div className="flex flex-col gap-2.5 sm:flex-row">
            <DateField mode="date" value={birthday} onChange={setBirthday} ariaLabel="Birthday" placeholder="Birthday" />
            <FormField label="Dietary restrictions" labelHidden value={dietary} onChange={setDietary} placeholder="Dietary restrictions" />
          </div>
        </div>
      </div>
      {error ? (
        <p role="alert" className="mb-3 text-sm text-[var(--os-danger-ink)]">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-2.5">
        <Button
          disabled={saving}
          onClick={() =>
            onNext({
              funFact,
              outsideOfWork: outside,
              askMeAbout: topics,
              linkedinUrl,
              personalSite,
              birthday,
              dietaryRestrictions: dietary,
            })
          }
        >
          Next
        </Button>
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      </div>
    </>
  );
}

function OpenToStep({
  data,
  saving,
  error,
  onFinish,
  onBack,
}: {
  data: OnboardingView;
  saving: boolean;
  error?: string;
  onFinish: (choices: OpenToChoices) => void;
  onBack: () => void;
}) {
  const [choices, setChoices] = useState<OpenToChoices>(data.openTo);
  return (
    <>
      <StepHeader
        eyebrow="Step 3 of 3"
        title="What are you open to?"
        sub="Students and DALI staff only ask for what's turned on here, and your profile can change it later."
      />
      <div className="flex flex-col gap-2.5 pb-8">
        {OPEN_TO_CHOICES.map((c) => {
          const on = choices[c.key];
          return (
            <div
              key={c.key}
              className={cn(
                "flex items-center gap-3.5 rounded-os-card p-3",
                on ? "bg-os-card" : "border border-os-well",
              )}
            >
              <div className="size-11 shrink-0">
                {on ? (
                  <BlockTile tile={{ bg: c.bg, fg: c.fg, motif: c.motif }} />
                ) : (
                  <div className="h-full w-full p-[3px]">
                    <div className="h-full w-full rounded-sm border-[1.5px] border-dashed border-os-container-hi" />
                  </div>
                )}
              </div>
              <div className="flex min-w-0 grow flex-col gap-0.5">
                <div className={cn("text-[15px] font-bold leading-[18px]", on ? "text-foreground" : "text-os-grey")}>
                  {c.title}
                </div>
                <div className={cn("text-sm", on ? "text-os-grey" : "text-os-muted")}>{c.subtitle}</div>
              </div>
              <Toggle
                tone="os"
                aria-label={c.title}
                checked={on}
                onChange={(e) => setChoices((cur) => ({ ...cur, [c.key]: e.target.checked }))}
              />
            </div>
          );
        })}
      </div>
      {error ? (
        <p role="alert" className="mb-3 text-sm text-[var(--os-danger-ink)]">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-2.5">
        <Button disabled={saving} onClick={() => onFinish(choices)}>
          Finish
        </Button>
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      </div>
    </>
  );
}

function DoneStep({ data }: { data: OnboardingView }) {
  const { connect, peers } = data.worthALook;
  const rows: { tileId: string; title: string; detail: string; to: string }[] = [
    { tileId: "t8", title: "Opportunities", detail: "Jobs and internships shared by the DALI community", to: "/community/opportunities" },
    { tileId: "t14", title: connect.title, detail: connect.detail, to: "/community" },
    { tileId: "t16", title: "People like you", detail: peers.detail, to: "/community" },
  ];
  return (
    <>
      <StepHeader eyebrow="Done" title="Worth a look" sub="Picked from your answers, and all of it is in the sidebar too." />
      <div className="flex flex-col pb-8">
        {rows.map((row, i) => (
          <div
            key={row.title}
            className={cn("flex items-center gap-4 py-4", i < rows.length - 1 && "border-b border-os-well")}
          >
            <RowTile id={row.tileId} size={44} />
            <div className="flex min-w-0 grow flex-col gap-0.5">
              <div className="text-md font-bold text-foreground">{row.title}</div>
              <div className="text-sm leading-[19px] text-os-grey">{row.detail}</div>
            </div>
            <Link to={row.to} className="text-sm font-bold text-os-accent hover:text-os-accent-hover">
              Open
            </Link>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2.5">
        <Link to="/" className={buttonClasses("primary", "md")}>
          Go to DALI OS
        </Link>
        <Link to="/profile" className={buttonClasses("ghost", "md")}>
          Edit my profile
        </Link>
      </div>
    </>
  );
}

function FinishedBlock({ data }: { data: OnboardingView }) {
  const block: AuthTile = blockById(data.blockId);
  return (
    <div className="flex flex-col items-start gap-5">
      <div className="size-[204px]" data-testid="finished-block">
        <BlockTile tile={block} />
      </div>
      <div className="flex items-center gap-2.5 rounded-os-track bg-os-bg py-2 pl-2 pr-3.5 shadow-sm">
        <div className="relative size-8 shrink-0">
          <Avatar photoUrl={data.photoUrl} name={data.fullName} size="sm" />
          <div className="absolute bottom-0 right-0 size-[13px] border-[1.5px] border-os-bg">
            <BlockTile tile={block} />
          </div>
        </div>
        <span className="text-base font-bold text-foreground">{data.nameTag.name}</span>
        {data.nameTag.subtitle ? <span className="text-sm text-os-muted">{data.nameTag.subtitle}</span> : null}
      </div>
    </div>
  );
}

function FinishLater() {
  return (
    <Link to="/" className={buttonClasses("ghost", "md")}>
      Finish later
      <X className="size-4" aria-hidden />
    </Link>
  );
}

export function AlumniOnboarding({ data }: { data: OnboardingView }) {
  const [step, setStep] = useState<0 | 1 | 2 | 3 | 4>(0);
  const fetcher = useFetcher<ActionData>();
  const advanceTo = useRef<2 | 3 | 4 | null>(null);
  const handled = useRef<unknown>(null);
  const saving = fetcher.state !== "idle";

  useEffect(() => {
    if (fetcher.state !== "idle" || !fetcher.data || fetcher.data === handled.current) return;
    handled.current = fetcher.data;
    if (fetcher.data.ok && advanceTo.current) setStep(advanceTo.current);
    advanceTo.current = null;
  }, [fetcher.state, fetcher.data]);

  const send = (fields: Record<string, string>, to: 3 | 4) => {
    advanceTo.current = to;
    handled.current = fetcher.data;
    fetcher.submit(fields, { method: "post" });
  };

  const error = fetcher.data?.error;
  const brandStep = Math.max(step, 1) as 1 | 2 | 3 | 4;
  const brand = {
    lines: brandLines(brandStep, data.firstName),
    sub: BRAND[brandStep].sub,
    visual: step === 4 ? <FinishedBlock data={data} /> : <BlockWall filled={wallFilledForStep(step)} />,
  };

  return (
    <AuthShellV2
      title="Welcome back"
      stepKey={`step-${step}`}
      brand={brand}
      header={<></>}
      exit={step < 4 ? <FinishLater /> : undefined}
      wide
      hideLegal
    >
      {step === 0 && <ContactStep data={data} next={() => setStep(1)} />}
      {step === 1 && <DetailsStep data={data} next={() => setStep(2)} />}
      {step === 2 && (
        <AboutStep
          data={data}
          saving={saving}
          error={error}
          onBack={() => setStep(1)}
          onNext={(draft) =>
            send(
              {
                intent: "save-about",
                funFact: draft.funFact,
                outsideOfWork: draft.outsideOfWork,
                askMeAbout: JSON.stringify(draft.askMeAbout),
                linkedinUrl: draft.linkedinUrl,
                personalSite: draft.personalSite,
                birthday: draft.birthday,
                dietaryRestrictions: draft.dietaryRestrictions,
              },
              3,
            )
          }
        />
      )}
      {step === 3 && (
        <OpenToStep
          data={data}
          saving={saving}
          error={error}
          onBack={() => setStep(2)}
          onFinish={(c) =>
            send(
              {
                intent: "finish",
                ...Object.fromEntries(Object.entries(c).filter(([, v]) => v).map(([k]) => [k, "on"])),
              },
              4,
            )
          }
        />
      )}
      {step === 4 && <DoneStep data={data} />}
    </AuthShellV2>
  );
}
