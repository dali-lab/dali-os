import { useEffect, useMemo, useState } from "react";
import { Link, useLoaderData, useNavigate, useNavigation, useSearchParams } from "react-router";
import {
  ArrowLeft,
  FileText,
  Inbox,
  Maximize2,
  Minimize2,
  PanelLeftClose,
  PanelLeftOpen,
  PenSquare,
  Settings2,
  Sparkles,
  X,
} from "lucide-react";
import type { Route } from "./+types/email";
import { loadEmailPage, submitEmailAction } from "~/email/lib/email.server";
import { useOsChrome } from "~/components/os-chrome";
import { Button, buttonClasses } from "~/components/ui/Button";
import { IconButton } from "~/components/ui/IconButton";
import { Tooltip } from "~/components/ui/floating";
import { SearchInput } from "~/components/ui/SearchInput";
import { useToast } from "~/components/ui/toast";
import { cn } from "~/lib/cn";
import { AccountsModal, connectHref } from "~/email/components/AccountsModal";
import { UnreadBadge } from "~/email/components/UnreadBadge";
import { Composer } from "~/email/components/Composer";
import { ThreadView } from "~/email/components/ThreadView";
import { inboxDot, recipientDirectory, senderName, shortDate } from "~/email/lib/format";

export const meta: Route.MetaFunction = () => [{ title: "Email · DALI OS" }];

export const handle = { fitViewport: true, flushPane: true };

export async function loader({ request }: Route.LoaderArgs) {
  return loadEmailPage(request);
}

export async function action({ request }: Route.ActionArgs) {
  return submitEmailAction(request);
}

const RAIL_COLLAPSED_KEY = "email.railCollapsed";

const CONNECT_ERRORS: Record<string, string> = {
  wrong_account: "That's a different Google account than the inbox you picked.",
  scope_denied: "Gmail access wasn't granted. Try again and allow it.",
  forbidden: "You can't connect that inbox.",
};

export default function EmailPage() {
  const data = useLoaderData<typeof loader>();
  const { pageTitle } = useOsChrome();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const navigation = useNavigation();
  const toast = useToast();
  const [accountsOpen, setAccountsOpen] = useState(false);
  const [composing, setComposing] = useState<string | null>(null);
  const [search, setSearch] = useState(data.ask || data.query);
  const [searching, setSearching] = useState(false);
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [readerExpanded, setReaderExpanded] = useState(false);

  const inboxes = data.accounts.filter((a) => !a.archived);
  const connected = inboxes.filter((a) => a.connected);
  const dotFor = (accountId: string) => inboxDot(data.accounts.findIndex((a) => a.id === accountId));
  const labelFor = (accountId: string) => data.accounts.find((a) => a.id === accountId)?.label ?? "";
  const selectedRef = params.get("t");
  const openDraft = data.drafts.find((d) => d.id === composing);
  const readerOpen = Boolean(composing || selectedRef);
  const expanded = readerOpen && readerExpanded;
  const totalUnread = Object.values(data.unread).reduce((sum, n) => sum + n, 0);
  const openInbox = data.accounts.find((a) => a.id === data.inbox);

  const directory = useMemo(() => {
    const selectedMessages = data.selected && !data.selected.error ? data.selected.messages : [];
    return recipientDirectory(
      [
        ...data.feed.threads.map((t) => t.from),
        ...selectedMessages.flatMap((m) => [m.from, m.to, m.cc]),
        ...data.drafts.flatMap((d) => [d.to, d.cc, d.bcc]),
      ],
      data.accounts.map((a) => a.address),
    );
  }, [data.feed.threads, data.selected, data.drafts, data.accounts]);

  useEffect(() => {
    try {
      setRailCollapsed(window.localStorage.getItem(RAIL_COLLAPSED_KEY) === "1");
    } catch {}
  }, []);

  const expandButton = (
    <IconButton
      label={expanded ? "Show message list" : "Expand message"}
      icon={expanded ? Minimize2 : Maximize2}
      className="hidden md:inline-flex"
      onClick={() => setReaderExpanded((v) => !v)}
    />
  );

  const toggleRail = () => {
    const next = !railCollapsed;
    setRailCollapsed(next);
    try {
      if (next) window.localStorage.setItem(RAIL_COLLAPSED_KEY, "1");
      else window.localStorage.removeItem(RAIL_COLLAPSED_KEY);
    } catch {}
  };

  useEffect(() => {
    const error = params.get("mail_error");
    if (error) toast.error(CONNECT_ERRORS[error] ?? "Couldn't connect that inbox. Try again.");
    if (params.get("mail_connected")) toast.success("Inbox connected");
    if (error || params.get("mail_connected")) {
      const next = new URLSearchParams(params);
      next.delete("mail_error");
      next.delete("mail_connected");
      navigate({ search: next.toString() }, { replace: true });
    }
  }, [params, navigate, toast]);

  const withParams = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(changes)) {
      if (v === null) next.delete(k);
      else next.set(k, v);
    }
    return `?${next.toString()}`;
  };

  const runSearch = async () => {
    const text = search.trim();
    if (!text) {
      navigate(withParams({ q: null, ask: null, in: null, t: null }));
      return;
    }
    if (!data.aiEnabled) {
      navigate(withParams({ q: text, ask: null, in: null, t: null, view: null }));
      return;
    }
    setSearching(true);
    try {
      const res = await fetch("/api/ai/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ task: "search", text }),
      });
      const result = (await res.json()) as { query?: string; accounts?: string[]; error?: string };
      if (!res.ok || !result.query) {
        if (result.error) toast.error(result.error);
        navigate(withParams({ q: text, ask: null, in: null, t: null, view: null }));
        return;
      }
      const picked = result.accounts?.length ? result.accounts.join(",") : null;
      navigate(
        withParams({
          q: result.query,
          ask: text,
          in: picked,
          ...(picked ? { inbox: null } : {}),
          t: null,
          view: null,
        }),
      );
    } finally {
      setSearching(false);
    }
  };

  const railItem = (active: boolean) =>
    cn(
      "flex w-full items-center gap-2.5 rounded-full px-3 py-2 text-left text-sm transition-colors",
      active ? "bg-os-container font-semibold text-foreground" : "text-os-muted hover:bg-os-hover hover:text-foreground",
    );

  const loadingList = navigation.state === "loading" && navigation.location?.pathname === "/email";

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 p-4 md:p-6">
      <div className="flex items-center gap-3">
        <h1 className={pageTitle}>Email</h1>
        <div className="ml-auto flex items-center gap-2">
          <IconButton label="Inboxes" icon={Settings2} onClick={() => setAccountsOpen(true)} />
          <Button size="sm" onClick={() => setComposing("new")} disabled={connected.length === 0}>
            <PenSquare className="h-3.5 w-3.5" />
            Compose
          </Button>
        </div>
      </div>

      {data.mailHidden && (
        <div className="shrink-0 rounded-md border border-border bg-muted px-3 py-2 text-xs text-muted-foreground">
          Mail is hidden while you are impersonating this member. Their inboxes are listed but no
          messages are loaded.
        </div>
      )}

      {inboxes.length === 0 ? (
        <div className="mx-auto mt-10 flex max-w-md flex-col items-center gap-3 rounded-os-card bg-os-card p-8 text-center">
          <Inbox className="h-8 w-8 text-os-muted" />
          <p className="font-heading text-xl font-medium text-foreground">One inbox for all your mail</p>
          <p className="text-sm text-os-muted">
            Your project inboxes show up here while you&apos;re staffed, along with any shared inboxes you join.
          </p>
          <Button onClick={() => setAccountsOpen(true)}>Connect an inbox</Button>
          {import.meta.env.DEV && (
            <Link to="?demo=1" className="text-xs text-os-muted underline hover:text-foreground">
              Preview with sample mail
            </Link>
          )}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 gap-4">
          <nav
            className={cn(
              "hidden shrink-0 flex-col gap-1 overflow-y-auto",
              !expanded && "md:flex",
              railCollapsed ? "w-auto" : "w-56",
            )}
            aria-label="Inboxes"
          >
            <div className={cn("mb-1 flex h-9 shrink-0 items-center gap-2", !railCollapsed && "pl-3")}>
              {!railCollapsed && <span className="text-xs font-semibold uppercase tracking-wide text-os-muted">Mailboxes</span>}
              <IconButton
                label={railCollapsed ? "Show inboxes" : "Hide inboxes"}
                icon={railCollapsed ? PanelLeftOpen : PanelLeftClose}
                className="ml-auto"
                onClick={toggleRail}
              />
            </div>
            {!railCollapsed && (
              <>
                <Link to={withParams({ inbox: null, view: null, t: null })} className={railItem(!data.inbox && data.view === "inbox")}>
                  <Inbox className="h-4 w-4" />
                  All inboxes
                  <UnreadBadge count={totalUnread} className="ml-auto" />
                </Link>
                {inboxes.map((a) => (
                  <Link
                    key={a.id}
                    to={withParams({ inbox: a.id, view: null, t: null, in: null })}
                    className={railItem(data.inbox === a.id)}
                    title={a.address}
                  >
                    <span className={cn("h-2 w-2 shrink-0 rounded-full", a.connected ? dotFor(a.id) : "bg-os-grey")} />
                    <span className="truncate">{a.label}</span>
                    <UnreadBadge count={data.unread[a.id] ?? 0} className="ml-auto" />
                  </Link>
                ))}
                <Link to={withParams({ view: "drafts", t: null })} className={railItem(data.view === "drafts")}>
                  <FileText className="h-4 w-4" />
                  Drafts
                  {data.drafts.length > 0 && <span className="ml-auto text-xs">{data.drafts.length}</span>}
                </Link>
              </>
            )}
          </nav>

          <section
            className={cn(
              "min-h-0 w-full min-w-0 flex-col gap-3",
              !readerOpen ? "flex flex-1" : expanded ? "hidden" : "hidden md:flex md:w-[360px] md:shrink-0",
            )}
            aria-label="Messages"
          >
            <form
              className="relative"
              onSubmit={(e) => {
                e.preventDefault();
                runSearch();
              }}
            >
              <SearchInput
                size="sm"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  // Emptying the box drops the search; no Enter needed.
                  if (!e.target.value.trim() && data.query) {
                    navigate(withParams({ q: null, ask: null, in: null, t: null }), { replace: true });
                  }
                }}
                placeholder={data.aiEnabled ? "Search in plain English" : "Search mail"}
                aria-label="Search mail"
                // The Gmail query an AI search turned into, for the curious.
                title={data.ask ? `Searching: ${data.query}` : undefined}
                className="pr-9 [&::-webkit-search-cancel-button]:hidden"
                disabled={searching}
              />
              {searching ? (
                <Sparkles
                  aria-label="Searching"
                  className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-pulse text-os-accent"
                />
              ) : (
                (data.query || search) && (
                  <IconButton
                    label="Clear search"
                    icon={X}
                    className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1"
                    onClick={() => {
                      setSearch("");
                      if (data.query) navigate(withParams({ q: null, ask: null, in: null, t: null }));
                    }}
                  />
                )
              )}
            </form>
            {data.feed.errors.length > 0 && (
              <p className="rounded-[10px] bg-os-container px-3 py-2 text-xs text-foreground">
                Couldn't load {data.feed.errors.map(labelFor).join(", ")}. Reconnect it from Inboxes.
              </p>
            )}

            <div className={cn("min-h-0 flex-1 overflow-y-auto rounded-os-card bg-os-card py-2 pl-2 pr-3", loadingList && "opacity-60")}>
              {data.view === "drafts" ? (
                data.drafts.length === 0 ? (
                  <p className="p-6 text-center text-sm text-os-muted">No drafts</p>
                ) : (
                  data.drafts.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      onClick={() =>
                        d.threadId ? navigate(withParams({ t: `${d.accountId}~${d.threadId}` })) : setComposing(d.id)
                      }
                      className="flex w-full flex-col gap-0.5 border-b border-os-container px-3 py-3 first:rounded-t-os-item last:rounded-b-os-item last:border-b-0 text-left hover:bg-os-hover"
                    >
                      <span className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Tooltip content={labelFor(d.accountId)}>
                          <span className={cn("h-2 w-2 shrink-0 rounded-full", dotFor(d.accountId))} />
                        </Tooltip>
                        <span className="truncate">{d.subject || (d.threadId ? "Reply" : "(no subject)")}</span>
                        <span className="ml-auto shrink-0 text-xs font-normal text-os-muted">{shortDate(d.updatedAt)}</span>
                      </span>
                      <span className="truncate text-xs text-os-muted">
                        {d.shared ? `Shared · ${d.mine ? "you" : d.author}` : "Only you"} · {d.body.slice(0, 80)}
                      </span>
                    </button>
                  ))
                )
              ) : openInbox && !openInbox.connected ? (
                <div className="flex flex-col items-center gap-3 p-6 text-center">
                  <p className="text-sm text-os-muted">Sign in to {openInbox.address} to see its mail here.</p>
                  <a
                    className={buttonClasses("secondary", "sm")}
                    href={connectHref(
                      openInbox.kind === "Shared" ? `shared:${openInbox.id}` : `project:${openInbox.projectId}`,
                    )}
                  >
                    Sign in
                  </a>
                </div>
              ) : data.feed.threads.length === 0 ? (
                <p className="p-6 text-center text-sm text-os-muted">
                  {connected.length === 0 ? "Connect an inbox to see mail" : "Nothing here"}
                </p>
              ) : (
                data.feed.threads.map((t) => {
                  const ref = `${t.accountId}~${t.id}`;
                  return (
                    <Link
                      key={ref}
                      to={withParams({ t: ref })}
                      preventScrollReset
                      className={cn(
                        "flex flex-col gap-0.5 border-b border-os-container px-3 py-3 first:rounded-t-os-item last:rounded-b-os-item last:border-b-0 hover:bg-os-hover",
                        selectedRef === ref && "bg-os-hover",
                      )}
                    >
                      <span className="flex items-center gap-2">
                        <Tooltip content={labelFor(t.accountId)}>
                          <span className={cn("h-2 w-2 shrink-0 rounded-full", dotFor(t.accountId))} />
                        </Tooltip>
                        <span className={cn("truncate text-sm text-foreground", t.unread && "font-semibold")}>
                          {senderName(t.from)}
                          {t.messageCount > 1 && <span className="ml-1 text-xs font-normal text-os-muted">{t.messageCount}</span>}
                        </span>
                        <span className="ml-auto shrink-0 text-xs text-os-muted">{shortDate(t.date)}</span>

                      </span>
                      <span className={cn("truncate text-sm", t.unread ? "font-semibold text-foreground" : "text-foreground")}>
                        {t.subject}
                      </span>
                      <span className="truncate text-xs text-os-muted">{t.snippet}</span>
                    </Link>
                  );
                })
              )}
            </div>
          </section>

          <section className={cn("min-h-0 min-w-0 flex-1 overflow-y-auto", !readerOpen && "hidden")} aria-label="Reader">
            {readerOpen && (
              <Button
                variant="ghost"
                size="sm"
                className="mb-2 md:hidden"
                onClick={() => (composing ? setComposing(null) : navigate(withParams({ t: null })))}
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </Button>
            )}
            {composing ? (
              <div className="flex flex-col gap-3">
                <div className="flex items-start gap-3">
                  <h2 className="flex-1 font-heading text-2xl font-medium text-foreground">
                    {openDraft ? "Draft" : "New message"}
                  </h2>
                  {expandButton}
                </div>
                <Composer
                  key={composing}
                  accounts={inboxes}
                  accountId={openDraft?.accountId ?? data.inbox ?? connected[0]?.id ?? ""}
                  threadId={null}
                  draft={openDraft}
                  aiEnabled={data.aiEnabled}
                  directory={directory}
                  onDone={() => setComposing(null)}
                />
              </div>
            ) : data.selected ? (
              data.selected.error ? (
                <p className="p-6 text-sm text-os-muted">Couldn't open this thread. Try again.</p>
              ) : (
                <ThreadView
                  key={selectedRef}
                  thread={data.selected}
                  accounts={inboxes}
                  drafts={data.drafts}
                  aiEnabled={data.aiEnabled}
                  directory={directory}
                  expandButton={expandButton}
                  onClose={() => navigate(withParams({ t: null }))}
                />
              )
            ) : null}
          </section>
        </div>
      )}

      {accountsOpen && <AccountsModal data={data} onClose={() => setAccountsOpen(false)} />}
    </div>
  );
}
