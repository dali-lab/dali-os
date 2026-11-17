import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useFetcher } from "react-router";
import { AuthShellV2 } from "~/components/auth/v2";
import { Avatar } from "~/components/ui/Avatar";
import { Button, buttonClasses } from "~/components/ui/Button";
import { FormField } from "~/components/ui/FormField";
import { Toggle } from "~/components/ui/Toggle";
import { ToggleChip } from "~/components/ui/ToggleChip";
import { useOsChrome } from "~/components/os-chrome";
import { cn } from "~/lib/cn";
import type { AuthTile } from "~/components/auth/auth-tiles";
import { BlockTile, BlockWall } from "~/components/alumni-onboarding/Wall";
import { ContactEmailPicker } from "~/components/contact-email/ContactEmailPicker";
import {
  ASK_ME_ABOUT_SUGGESTIONS,
  OPEN_TO_CHOICES,
  blockById,
  pluralize,
  wallFilledForStep,
  type OpenToChoices,
} from "~/lib/alumni-onboarding";
import { MAX_ASK_ME_ABOUT, MAX_ASK_ME_ABOUT_LENGTH } from "~/members/lib/profile-limits";
import type { OnboardingData } from "~/lib/alumni-onboarding.server";
import type { ContactEmailOptions } from "~/lib/contact-email.server";

export type OnboardingView = OnboardingData & { gameOn: boolean; contactEmail: ContactEmailOptions };

type ActionData = { ok?: boolean; error?: string };

const BRAND: Record<1 | 2 | 3 | 4, { sub: string }> = {
  1: { sub: "Once DALI, always DALI. Your profile takes about two minutes." },
  2: { sub: "This shows on your profile for students." },
  3: { sub: "Pick as many or as few as you want." },
  4: { sub: "This block is yours. It sits on the corner of your photo." },
};

function brandLines(step: 1 | 2 | 3 | 4, firstName: string): [string, string] {
  if (step === 1) return ["Welcome back,", firstName];
  if (step === 2) return ["A bit more", "about you"];
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

function EditorActions({ saving, onCancel }: { saving: boolean; onCancel: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <Button type="submit" size="sm" disabled={saving}>
        Save
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

function ClassEditor({ data, close }: { data: OnboardingView; close: () => void }) {
  const fetcher = useRowSave(close);
  const { formClass } = useOsChrome();
  return (
    <fetcher.Form method="post" className={cn(formClass, "flex flex-col gap-2")}>
      <input type="hidden" name="intent" value="save-class" />
      <FormField label="Class year" name="classYear" defaultValue={data.classYear?.toString() ?? ""} />
      <FormField label="Major" name="major" defaultValue={data.major ?? ""} />
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
  editHref,
  editLabel = "Edit",
  last,
}: {
  tileId: string;
  label: string;
  value: string;
  detail?: string | null;
  editor?: (close: () => void) => ReactNode;
  editHref?: string;
  editLabel?: string;
  last?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const linkClass = "text-sm font-bold text-os-accent hover:text-os-accent-hover";
  return (
    <div className={cn("flex flex-col py-[11px]", !last && "border-b border-os-well")}>
      <div className="flex items-center gap-3.5">
        <RowTile id={tileId} />
        <div className="w-[110px] shrink-0 text-sm text-os-muted">{label}</div>
        <div className="flex min-w-0 grow flex-col gap-px">
          <div className="text-[15px] font-semibold leading-[18px] text-foreground">{value}</div>
          {detail ? <div className="text-sm text-os-grey">{detail}</div> : null}
        </div>
        {editHref ? (
          <a href={editHref} target="_blank" rel="noreferrer" className={linkClass}>
            {editLabel}
          </a>
        ) : editor ? (
          <button type="button" className={linkClass} onClick={() => setEditing((v) => !v)} aria-expanded={editing}>
            {editing ? "Close" : editLabel}
          </button>
        ) : null}
      </div>
      {editing && editor ? <div className="mt-3 pl-[28px] sm:pl-[152px]">{editor(() => setEditing(false))}</div> : null}
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

function DetailsStep({ data, next }: { data: OnboardingView; next: () => void }) {
  const classLine = [data.classYear, data.major].filter(Boolean).join(", ");
  const { dali } = data;
  return (
    <>
      <StepHeader
        eyebrow="Step 1 of 3"
        title="Check your details"
        sub="Filled in from your DALI history and LinkedIn. Edit anything that's out of date."
      />
      <div className="flex flex-col pb-7">
        <DetailRow
          tileId="t4"
          label="Class"
          value={classLine || "Not added yet"}
          editor={(close) => <ClassEditor data={data} close={close} />}
        />
        <DetailRow
          tileId="t5"
          label="Hometown"
          value={data.hometown || "Not added yet"}
          editor={(close) => <HometownEditor data={data} close={close} />}
        />
        <DetailRow
          tileId="t8"
          label="At DALI"
          value={
            dali.projectCount > 0
              ? `${pluralize(dali.projectCount, "project")}, ${pluralize(dali.termCount, "term")}`
              : "No projects on record"
          }
          detail={dali.projectNames.join(", ") || null}
          editHref="/profile"
        />
        <DetailRow
          tileId="t9"
          label="Roles"
          value={dali.rolesLine || "No roles on record"}
          editHref="/profile"
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
      </div>
      <div className="flex items-center gap-2.5">
        <Button onClick={next}>Looks good</Button>
        <Button variant="ghost" onClick={next}>
          Skip for now
        </Button>
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

export type AboutDraft = { funFact: string; outsideOfWork: string; askMeAbout: string[] };

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
  const [adding, setAdding] = useState(false);
  const [custom, setCustom] = useState("");

  const suggestions: string[] = [...ASK_ME_ABOUT_SUGGESTIONS];
  const chips = [...suggestions, ...topics.filter((t) => !suggestions.includes(t))];
  const toggle = (topic: string) =>
    setTopics((cur) => (cur.includes(topic) ? cur.filter((t) => t !== topic) : [...cur, topic]));
  const addCustom = () => {
    const topic = custom.trim().replace(/\s+/g, " ");
    if (topic && !topics.some((t) => t.toLowerCase() === topic.toLowerCase())) setTopics((cur) => [...cur, topic]);
    setCustom("");
    setAdding(false);
  };
  const full = topics.length >= MAX_ASK_ME_ABOUT;

  return (
    <>
      <StepHeader eyebrow="Step 2 of 3" title="Interests" sub="A few words each is fine." />
      <div className={cn(formClass, "flex flex-col gap-[22px] pb-8")}>
        <div className="flex flex-col gap-2">
          <FieldLabel tileId="t5">A fun fact</FieldLabel>
          <FormField label="A fun fact" labelHidden value={funFact} onChange={setFunFact} placeholder="I have biked every road in Hanover" />
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
            {adding ? (
              <form
                className="flex items-center gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  addCustom();
                }}
              >
                <input
                  autoFocus
                  aria-label="Add your own topic"
                  value={custom}
                  maxLength={MAX_ASK_ME_ABOUT_LENGTH}
                  onChange={(e) => setCustom(e.target.value)}
                  className="h-8 w-44"
                />
                <Button type="submit" size="sm">
                  Add
                </Button>
              </form>
            ) : (
              <button
                type="button"
                disabled={full}
                onClick={() => setAdding(true)}
                className="inline-flex items-center rounded-lg border border-dashed border-os-container-hi px-3 py-1.5 text-sm text-os-muted transition-colors hover:text-foreground disabled:opacity-50"
              >
                + Add your own
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <FieldLabel tileId="t12">Outside of work</FieldLabel>
          <FormField label="Outside of work" labelHidden value={outside} onChange={setOutside} placeholder="Climbing, film photography, bad puns" />
        </div>
      </div>
      {error ? (
        <p role="alert" className="mb-3 text-sm text-[var(--os-danger-ink)]">
          {error}
        </p>
      ) : null}
      <div className="flex items-center gap-2.5">
        <Button disabled={saving} onClick={() => onNext({ funFact, outsideOfWork: outside, askMeAbout: topics })}>
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
        sub="Students and DALI staff will only ask you for what you turn on. You can change this later on your profile."
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
      <StepHeader
        eyebrow="Done"
        title="Worth a look"
        sub="Based on what you told us. All of it is also in the sidebar."
      />
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
      {data.gameOn ? (
        <p className="mt-6 text-base text-os-grey">
          Want to see the lab?{" "}
          <Link to="/alumni/welcome" className="font-bold text-os-accent hover:text-os-accent-hover">
            Walk around the pixel lab
          </Link>
        </p>
      ) : null}
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
    <AuthShellV2 title="Welcome back" stepKey={`step-${step}`} brand={brand} header={<></>} wide hideLegal>
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
