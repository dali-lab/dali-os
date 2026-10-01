// Views for the component library (kinds.ts). Hook-free and browser-free on
// purpose: the editor renders them live, and the server renders the SAME
// markup to a string for export and the public site (blocknote-server.ts).
// Styling is plain `dali-cmp-*` CSS in ../theme.css, not utility classes, so
// that markup stays stylable wherever it lands.

import type { ReactNode } from "react";
import {
  CODE_SANDBOX,
  codeHeight,
  codeSrcDoc,
  safeHref,
  toneOf,
  type ComponentData,
} from "./kinds";

type Item = Record<string, string>;

function LinkOrDiv({ href, className, children }: { href?: string; className: string; children: ReactNode }) {
  const safe = safeHref(href);
  if (!safe) return <div className={className}>{children}</div>;
  const external = !safe.startsWith("/");
  return (
    <a
      className={className}
      href={safe}
      {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
    >
      {children}
    </a>
  );
}

const tone = (item: Item | Record<string, string>) => `dali-cmp-tone--${toneOf(item.tone)}`;

function Heading({ title, subtitle }: { title?: string; subtitle?: string }) {
  if (!title && !subtitle) return null;
  return (
    <div className="dali-cmp-head">
      {title && <div className="dali-cmp-title">{title}</div>}
      {subtitle && <div className="dali-cmp-sub">{subtitle}</div>}
    </div>
  );
}

function Chips({ fields, items }: ComponentData) {
  return (
    <div className="dali-cmp-chips">
      {fields.label && <span className="dali-cmp-eyebrow">{fields.label}</span>}
      {items.map((it, i) => (
        <LinkOrDiv key={i} href={it.href} className="dali-cmp-chip">
          {it.label}
        </LinkOrDiv>
      ))}
    </div>
  );
}

function Cards({ fields, items }: ComponentData) {
  return (
    <div>
      <Heading title={fields.title} />
      <div className="dali-cmp-grid">
        {items.map((it, i) => (
          <LinkOrDiv key={i} href={it.href} className={`dali-cmp-card ${tone(it)}`}>
            {it.tag && <span className="dali-cmp-tag">{it.tag}</span>}
            <span className="dali-cmp-card__title">{it.title}</span>
            {it.meta && <span className="dali-cmp-meta">{it.meta}</span>}
          </LinkOrDiv>
        ))}
      </div>
    </div>
  );
}

function Timeline({ fields, items }: ComponentData) {
  const current = Number.parseInt(fields.current ?? "", 10);
  return (
    <div className="dali-cmp-panel">
      <Heading title={fields.title} subtitle={fields.note} />
      <ol className="dali-cmp-steps">
        {items.map((it, i) => {
          const n = i + 1;
          const state = n < current ? "done" : n === current ? "current" : "next";
          return (
            <li key={i} className={`dali-cmp-step dali-cmp-step--${state} ${tone(it)}`}>
              <span className="dali-cmp-step__num">{n}</span>
              <span className="dali-cmp-step__label">{it.label}</span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Links({ fields, items }: ComponentData) {
  return (
    <div className="dali-cmp-panel dali-cmp-panel--flush">
      <Heading title={fields.title} subtitle={fields.subtitle} />
      {items.map((it, i) => (
        <LinkOrDiv key={i} href={it.href} className="dali-cmp-row">
          <span className="dali-cmp-row__main">
            <span className="dali-cmp-row__title">{it.title}</span>
            {it.description && <span className="dali-cmp-sub">{it.description}</span>}
          </span>
          {it.meta && <span className="dali-cmp-meta">{it.meta}</span>}
        </LinkOrDiv>
      ))}
    </div>
  );
}

function Stats({ items }: ComponentData) {
  return (
    <div className="dali-cmp-grid">
      {items.map((it, i) => (
        <div key={i} className={`dali-cmp-stat ${tone(it)}`}>
          <span className="dali-cmp-stat__value">{it.value}</span>
          <span className="dali-cmp-sub">{it.label}</span>
        </div>
      ))}
    </div>
  );
}

function Bars({ fields, items }: ComponentData) {
  const values = items.map((it) => Math.max(0, Number.parseFloat(it.value) || 0));
  const max = Math.max(...values, 1);
  return (
    <div className="dali-cmp-panel">
      <Heading title={fields.title} />
      <div className="dali-cmp-bars">
        {items.map((it, i) => (
          <div key={i} className={`dali-cmp-bar ${tone(it)}`}>
            <span className="dali-cmp-bar__label">{it.label}</span>
            <span className="dali-cmp-bar__track">
              <span className="dali-cmp-bar__fill" style={{ width: `${(values[i]! / max) * 100}%` }} />
            </span>
            <span className="dali-cmp-bar__value">{it.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Gallery({ fields, items }: ComponentData) {
  return (
    <div>
      <Heading title={fields.title} subtitle={fields.subtitle} />
      <div className="dali-cmp-grid">
        {items.map((it, i) => (
          <LinkOrDiv key={i} href={it.href} className={`dali-cmp-piece ${tone(it)}`}>
            {it.image ? (
              <img className="dali-cmp-piece__art" src={it.image} alt="" />
            ) : (
              <span className="dali-cmp-piece__art" />
            )}
            <span className="dali-cmp-row__title">{it.title}</span>
            {it.byline && <span className="dali-cmp-sub">{it.byline}</span>}
          </LinkOrDiv>
        ))}
      </div>
    </div>
  );
}

function Feature({ fields }: ComponentData) {
  const cta = safeHref(fields.href);
  return (
    <div className={`dali-cmp-feature ${tone(fields)}`}>
      {fields.image ? (
        <img className="dali-cmp-feature__art" src={fields.image} alt="" />
      ) : (
        <span className="dali-cmp-feature__art" />
      )}
      <div className="dali-cmp-feature__body">
        {fields.eyebrow && <span className="dali-cmp-eyebrow">{fields.eyebrow}</span>}
        <div className="dali-cmp-feature__title">{fields.title}</div>
        {fields.body && <p className="dali-cmp-sub">{fields.body}</p>}
        {cta && fields.cta && (
          <LinkOrDiv href={cta} className="dali-cmp-cta">
            {fields.cta}
          </LinkOrDiv>
        )}
      </div>
    </div>
  );
}

function Code({ fields }: ComponentData) {
  return (
    <iframe
      className="dali-cmp-code"
      title="Custom component"
      sandbox={CODE_SANDBOX}
      srcDoc={codeSrcDoc(fields.html ?? "")}
      style={{ height: codeHeight(fields.height) }}
      loading="lazy"
    />
  );
}

const VIEWS: Record<string, (data: ComponentData) => ReactNode> = {
  chips: Chips,
  cards: Cards,
  timeline: Timeline,
  links: Links,
  stats: Stats,
  bars: Bars,
  gallery: Gallery,
  feature: Feature,
  code: Code,
};

/** `forExport` drops custom code: member-written scripts stay inside the app
 * and are never handed to an export or the public site. */
export function ComponentView({
  kind,
  data,
  forExport = false,
}: {
  kind: string;
  data: ComponentData;
  forExport?: boolean;
}) {
  const View = VIEWS[kind];
  if (!View || (forExport && kind === "code")) return null;
  return <View {...data} />;
}
