import { useEffect, useRef, useState } from "react";
import { Form, Link } from "react-router";
import { Select } from "~/components/ui/floating";
import {
  CalendarX,
  ChevronRight,
  ChevronDown,
  Unlink,
  MoreHorizontal,
  ExternalLink,
  Mail,
} from "lucide-react";
import { useOsChrome } from "~/components/os-chrome";
import { OS_DETAIL_CARD } from "~/components/os-page";
import { useConfirmSubmit } from "~/components/ui/dialog";
import { Tooltip } from "~/components/ui/floating";
import { formatDateShort } from "~/lib/display";
import { useUserTimeZone } from "~/hooks/useUserTimeZone";
import { Avatar } from "~/components/ui/Avatar";
import { DriveBrowser } from "~/components/drive/DriveBrowser";
import { type LoaderData } from "~/projects/components/detail/types";

// Per-contact "⋯" menu in the os Partners view: email the person, or (Core)
// jump to their organization in the CRM.
function PartnerContactMenu({
  name,
  email,
  orgId,
  canManage,
}: {
  name: string;
  email: string | null;
  orgId: string;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const itemClass =
    "flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm text-foreground transition-colors hover:bg-os-container";
  return (
    <div ref={ref} className="relative flex-shrink-0">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Actions for ${name}`}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center justify-center rounded-md p-1.5 text-os-grey transition-colors hover:bg-os-container hover:text-foreground"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-[calc(100%+6px)] z-[100] min-w-[184px] rounded-xl border border-os-container bg-os-card p-1.5 shadow-[0_12px_32px_var(--color-os-shadow)]"
        >
          {email && (
            <a role="menuitem" href={`mailto:${email}`} className={itemClass} onClick={() => setOpen(false)}>
              <Mail className="h-4 w-4 text-os-grey" /> Email
            </a>
          )}
          {canManage && (
            <Link role="menuitem" to={`/core/partners/orgs/${orgId}`} className={itemClass} onClick={() => setOpen(false)}>
              <ExternalLink className="h-4 w-4 text-os-grey" /> View organization
            </Link>
          )}
          {!email && !canManage && (
            <span className="block px-2.5 py-2 text-sm text-os-muted">No actions</span>
          )}
        </div>
      )}
    </div>
  );
}
// The os Partners view: the people (contacts across the linked orgs) up front,
// with org lifecycle management (end / unlink) folded behind a Core-only
// "Organizations" disclosure so the capability isn't lost.
function PartnersContactsOs({
  partners,
  canManage,
  tz,
  confirmSubmit,
}: {
  partners: LoaderData["project"]["partners"];
  canManage: boolean;
  tz: string;
  confirmSubmit: ReturnType<typeof useConfirmSubmit>;
}) {
  const [showOrgs, setShowOrgs] = useState(false);
  const contacts = partners
    .filter((p) => !p.endedAt)
    .flatMap((p) =>
      p.org.contacts.map((c) => ({ ...c, orgId: p.org.id, orgName: p.org.name })),
    );

  return (
    // The design's partner directory: one surface, a row per contact. The
    // section around it carries no border of its own, so this is where the
    // list gets its ground.
    <div className={OS_DETAIL_CARD}>
      {contacts.length === 0 ? (
        <p className="py-4 text-sm text-os-muted italic">No partner contacts yet.</p>
      ) : (
        <div className="flex flex-col divide-y divide-os-container">
          {contacts.map((c) => (
            <div key={c.id} className="flex items-center gap-3 py-2.5">
              <Avatar name={c.name} size="sm" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-foreground">{c.name}</div>
                <div className="truncate text-xs text-os-grey">
                  {c.displayRole ?? "Partner contact"}
                </div>
              </div>
              <PartnerContactMenu
                name={c.name}
                email={c.email}
                orgId={c.orgId}
                canManage={canManage}
              />
            </div>
          ))}
        </div>
      )}

      {canManage && partners.length > 0 && (
        <div className="border-t border-os-container pt-1 pb-1">
          <button
            type="button"
            onClick={() => setShowOrgs((v) => !v)}
            aria-expanded={showOrgs}
            className="flex w-full items-center gap-1.5 py-1.5 text-xs font-medium text-os-grey transition-colors hover:text-foreground"
          >
            {showOrgs ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
            Organizations ({partners.length})
          </button>
          {showOrgs && (
            <div className="flex flex-col divide-y divide-os-container">
              {partners.map((p) => (
                <div key={p.id} className="flex items-center gap-2 py-2">
                  <Link
                    to={`/core/partners/orgs/${p.org.id}`}
                    className="min-w-0 flex-1 truncate text-sm text-foreground hover:underline"
                  >
                    {p.org.name}
                  </Link>
                  {p.endedAt ? (
                    <span className="text-[10px] px-1.5 py-0.5 rounded border border-border bg-muted/50 text-muted-foreground">
                      Ended {formatDateShort(p.endedAt, tz)}
                    </span>
                  ) : p.startedAt ? (
                    <span className="text-xs text-muted-foreground">
                      since {formatDateShort(p.startedAt, tz)}
                    </span>
                  ) : null}
                  {!p.endedAt && (
                    <Form
                      method="post"
                      onSubmit={confirmSubmit({
                        title: `End the partnership with ${p.org.name}?`,
                        description:
                          "The record and its dates are kept — this only marks the partnership as ended today.",
                        confirmLabel: "End partnership",
                        tone: "destructive",
                      })}
                    >
                      <input type="hidden" name="intent" value="partner-end" />
                      <input type="hidden" name="projectPartnerId" value={p.id} />
                      <Tooltip content="End partnership (keeps the record)">
                        <button
                          type="submit"
                          aria-label="End partnership"
                          className="inline-flex items-center justify-center p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/40 flex-shrink-0"
                        >
                          <CalendarX className="w-3.5 h-3.5" />
                        </button>
                      </Tooltip>
                    </Form>
                  )}
                  <Form
                    method="post"
                    onSubmit={confirmSubmit({
                      title: `Unlink ${p.org.name}?`,
                      description:
                        'This erases the partnership record entirely — use "End partnership" instead to keep the history.',
                      confirmLabel: "Unlink",
                      tone: "destructive",
                    })}
                  >
                    <input type="hidden" name="intent" value="partner-unlink" />
                    <input type="hidden" name="projectPartnerId" value={p.id} />
                    <Tooltip content="Unlink organization (erases the record)">
                      <button
                        type="submit"
                        aria-label="Unlink organization"
                        className="inline-flex items-center justify-center p-1.5 rounded-md text-destructive hover:bg-destructive/10 flex-shrink-0"
                      >
                        <Unlink className="w-3.5 h-3.5" />
                      </button>
                    </Tooltip>
                  </Form>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
export function PartnersSection({
  partners,
  linkablePartnerOrgs,
  canManage,
}: {
  partners: LoaderData["project"]["partners"];
  linkablePartnerOrgs: LoaderData["linkablePartnerOrgs"];
  canManage: boolean;
}) {
  const confirmSubmit = useConfirmSubmit();
  const [linking, setLinking] = useState(false);
  const tz = useUserTimeZone();
  const { sectionShell, sectionTitle } = useOsChrome();

  return (
    <section className={sectionShell}>
      <div className="flex items-center justify-between">
        <h2 className={sectionTitle}>
          Partners
        </h2>
        {canManage && linkablePartnerOrgs.length > 0 && (
          <button
            type="button"
            onClick={() => setLinking((v) => !v)}
            className="text-xs font-medium text-os-accent hover:underline"
          >
            + Link organization
          </button>
        )}
      </div>

      {linking && canManage && (
        <Form method="post" className="flex flex-wrap items-end gap-3 bg-muted/20 rounded-lg p-3">
          <input type="hidden" name="intent" value="partner-link" />
          <Select
            name="partnerOrgId"
            required
            placeholder="Select an organization…"
            options={[
              { value: "", label: "Select an organization…" },
              ...linkablePartnerOrgs.map((o) => ({ value: o.id, label: o.name })),
            ]}
            buttonClassName="h-9 flex-1 min-w-[220px] rounded-lg border border-border bg-background px-3 text-sm inline-flex items-center justify-between gap-1 transition-colors hover:bg-muted/40"
          />
          <button
            type="submit"
            className="h-9 rounded-lg bg-os-accent text-os-bg text-sm font-medium px-4 hover:opacity-90 transition"
          >
            Link
          </button>
        </Form>
      )}

      <PartnersContactsOs
        partners={partners}
        canManage={canManage}
        tz={tz}
        confirmSubmit={confirmSubmit}
      />
    </section>
  );
}
