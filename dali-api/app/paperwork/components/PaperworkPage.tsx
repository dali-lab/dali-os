import type { ReactNode } from "react";
import { Link } from "react-router";
import {
  Award,
  Check,
  ClipboardPen,
  CreditCard,
  FileCheck,
  FileSignature,
  GraduationCap,
  Handshake,
  Mail,
  MessageSquare,
  Monitor,
  Receipt,
  Shield,
  UserRound,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { useOsChrome } from "~/components/os-chrome";
import { buttonClasses } from "~/components/ui/Button";
import { Pill, type PillTone } from "~/components/ui/Pill";
import { cn } from "~/lib/cn";
import type { AnytimeTile, Paperwork, PaperworkStatus, SetupItem, TermRow, WaitingItem } from "../lib/paperwork";

const WAITING_ICONS: Record<WaitingItem["kind"], LucideIcon> = { expense: Receipt, signature: FileSignature };
const TERM_ICONS: Record<TermRow["kind"], LucideIcon> = { form: ClipboardPen, classes: GraduationCap, application: Shield };
const TILE_ICONS: Record<AnytimeTile["id"], LucideIcon> = {
  expense: Receipt,
  cards: CreditCard,
  refer: Handshake,
  feedback: MessageSquare,
  certificates: Award,
  signed: FileCheck,
};
const SETUP_ICONS: Record<SetupItem["id"], LucideIcon> = {
  wallet: Wallet,
  "graduation-email": Mail,
  onboarding: UserRound,
  desktop: Monitor,
};
const STATUS: Record<PaperworkStatus, { label: string; tone: PillTone }> = {
  todo: { label: "To do", tone: "warning" },
  open: { label: "Open", tone: "accent" },
  done: { label: "Done", tone: "success" },
};

function Section({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
  const { sectionShell, sectionTitle } = useOsChrome();
  return (
    <section className={sectionShell} aria-label={title}>
      <div className="flex items-baseline gap-2">
        <h2 className={sectionTitle}>{title}</h2>
        {meta && <span className="text-sm text-os-muted">{meta}</span>}
      </div>
      {children}
    </section>
  );
}

function Waiting({ items }: { items: WaitingItem[] }) {
  const { panel } = useOsChrome();
  return (
    <Section title="Waiting on you">
      <ul className="flex flex-col gap-2">
        {items.map((item, i) => {
          const Icon = WAITING_ICONS[item.kind];
          return (
            <li key={item.id} className={cn(panel, "flex items-center gap-4 p-4")}>
              <Icon className="h-5 w-5 shrink-0 text-os-grey" aria-hidden />
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-sm font-semibold text-foreground">{item.title}</span>
                <span className="text-sm text-os-grey">{item.detail}</span>
              </div>
              <Link to={item.action.href} className={buttonClasses(i === 0 ? "primary" : "secondary", "sm")}>
                {item.action.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function ThisTerm({ label, rows }: { label: string | null; rows: TermRow[] }) {
  const { panel } = useOsChrome();
  const done = rows.filter((r) => r.status === "done").length;
  const meta = [label, rows.length ? `${done} of ${rows.length} done` : null].filter(Boolean).join(" · ");
  return (
    <Section title="This term" meta={meta || undefined}>
      {rows.length === 0 ? (
        <div className="rounded-os-card border border-dashed border-os-container-hi p-5">
          <p className="text-sm font-semibold text-foreground">Nothing open for this term yet</p>
          <p className="text-sm text-os-grey">Staffing forms and applications appear here once Core opens them.</p>
        </div>
      ) : (
        <ul className={cn(panel, "divide-y divide-os-well")}>
          {rows.map((row) => {
            const Icon = TERM_ICONS[row.kind];
            const status = STATUS[row.status];
            return (
              <li key={row.id} className="flex items-center gap-4 px-4 py-3">
                <Icon className="h-4 w-4 shrink-0 text-os-grey" aria-hidden />
                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{row.title}</span>
                <span className="hidden w-44 shrink-0 text-sm text-os-grey sm:block">{row.detail}</span>
                <span className="w-24 shrink-0">
                  <Pill size="sm" dot={status.tone}>
                    {status.label}
                  </Pill>
                </span>
                <Link
                  to={row.action.href}
                  className={cn(
                    "w-24 shrink-0 text-right text-sm font-semibold hover:underline",
                    row.status === "done" ? "text-os-grey" : "text-os-accent",
                  )}
                >
                  {row.action.label}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Section>
  );
}

function Anytime({ tiles }: { tiles: AnytimeTile[] }) {
  const { panel } = useOsChrome();
  return (
    <Section title="Anytime">
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {tiles.map((tile) => {
          const Icon = TILE_ICONS[tile.id];
          return (
            <li key={tile.id}>
              <Link to={tile.href} className={cn(panel, "flex h-full flex-col gap-2 p-4 transition-colors hover:bg-os-card-hover")}>
                <Icon className="h-5 w-5 text-foreground" aria-hidden />
                <span className="text-sm font-semibold text-foreground">{tile.title}</span>
                <span className="text-sm text-os-grey">{tile.detail}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

function SetUpOnce({ items }: { items: SetupItem[] }) {
  const { panel } = useOsChrome();
  const done = items.filter((i) => i.done).length;
  return (
    <Section title="Set up once" meta={`${done} of ${items.length} done`}>
      <ul className="grid gap-3 sm:grid-cols-2">
        {items.map((item) => {
          const Icon = SETUP_ICONS[item.id];
          return (
            <li
              key={item.id}
              className={cn(
                "flex items-center gap-3 rounded-os-card p-4",
                item.done ? panel : "border border-os-container",
              )}
            >
              {item.done ? (
                <Check className="h-5 w-5 shrink-0 text-os-green" aria-label="Done" />
              ) : (
                <Icon className="h-5 w-5 shrink-0 text-os-grey" aria-hidden />
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                <span className={cn("text-sm font-semibold", item.done ? "text-os-grey" : "text-foreground")}>{item.title}</span>
                {!item.done && <span className="text-sm text-os-grey">{item.detail}</span>}
              </div>
              {!item.done && (
                <Link to={item.action.href} className="text-sm font-semibold text-os-accent hover:underline">
                  {item.action.label}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

export function PaperworkPage({ data }: { data: Paperwork }) {
  const { pageTitle } = useOsChrome();
  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className={pageTitle}>Paperwork</h1>
        {data.waiting.length === 0 && (
          <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
            <Check className="h-4 w-4 text-os-green" aria-hidden />
            Nothing is waiting on you.
          </p>
        )}
      </header>
      {data.waiting.length > 0 && <Waiting items={data.waiting} />}
      <ThisTerm label={data.termLabel} rows={data.term} />
      {data.anytime.length > 0 && <Anytime tiles={data.anytime} />}
      {data.setup.length > 0 && <SetUpOnce items={data.setup} />}
    </div>
  );
}
