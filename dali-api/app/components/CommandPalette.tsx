import { useEffect, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Search,
  Home,
  ListTodo,
  Calendar,
  ClipboardList,
  Briefcase,
  FolderKanban,
  Folder,
  Users2,
  UsersRound,
  Handshake,
  GraduationCap,
  Workflow,
  Settings,
  HelpCircle,
  Heart,
  FileText,
  FileQuestion,
  ClipboardCheck,
  Mail,
  ShieldCheck,
  CalendarRange,
  PanelLeftClose,
  PanelLeftOpen,
  PanelTop,
  Square,
  Compass,
  LogOut,
  CornerDownLeft,
} from "lucide-react";
import { Modal } from "~/components/Modal";
import { Avatar } from "~/components/ui/Avatar";
import { setTablessPreference } from "~/lib/tabless";
import { setFocusPreference } from "~/lib/focus-mode";
import type { SearchResult, SearchResultType } from "~/lib/search";

export interface CommandPaletteRoles {
  isCore?: boolean;
  canViewForms?: boolean;
  canViewStaffing?: boolean;
  hasHiringAccess?: boolean;
  isLabMentor?: boolean;
}

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  /** Current workspace mode — drives the "switch mode" command + how results open. */
  tabless: boolean;
  /** Whether the sidebar is hidden — drives the focus-mode command. */
  focusMode: boolean;
  roles: CommandPaletteRoles;
  /** Open a result. `toSide` = ⌘/Ctrl+Enter (split pane in tab mode, new browser tab in tabless). */
  onOpen: (url: string, label: string, toSide: boolean) => void;
}

type PaletteAction =
  | { kind: "navigate"; url: string; label: string }
  | { kind: "run"; run: () => void };

interface PaletteItem {
  id: string;
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  /** Present for entity results; drives the avatar-vs-icon leading slot. */
  type?: SearchResultType;
  photoUrl?: string | null;
  /** Custom emoji for `project` results; shown instead of the type glyph. */
  iconEmoji?: string | null;
  action: PaletteAction;
}

// Each result type maps to an icon and a display section. Multiple types can
// share a section (forms + folders, or the hiring-library artifacts) so the
// palette doesn't sprout one section per entity kind.
const TYPE_META: Record<SearchResultType, { icon: LucideIcon; section: string }> = {
  person: { icon: UsersRound, section: "People" },
  project: { icon: FolderKanban, section: "Projects" },
  education: { icon: GraduationCap, section: "Education" },
  partner: { icon: Handshake, section: "Partners" },
  document: { icon: FileText, section: "Documents" },
  application: { icon: Briefcase, section: "Applicants" },
  form: { icon: ClipboardList, section: "Forms" },
  formFolder: { icon: Folder, section: "Forms" },
  challenge: { icon: FileQuestion, section: "Hiring library" },
  rubric: { icon: ClipboardCheck, section: "Hiring library" },
  emailTemplate: { icon: Mail, section: "Hiring library" },
  confidentialityAgreement: { icon: ShieldCheck, section: "Hiring library" },
  cycle: { icon: CalendarRange, section: "Hiring cycles" },
  partnerApplication: { icon: Handshake, section: "Partner applications" },
};

const SECTION_ORDER = [
  "People",
  "Projects",
  "Education",
  "Partners",
  "Documents",
  "Applicants",
  "Forms",
  "Hiring library",
  "Hiring cycles",
  "Partner applications",
];

export function CommandPalette({ open, onClose, tabless, focusMode, roles, onOpen }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Fresh palette each open.
  useEffect(() => {
    if (open) {
      setQuery("");
      setResults([]);
      setSelectedIndex(0);
    }
  }, [open]);

  // Debounced, abortable entity search. Aborting on each keystroke also drops
  // stale in-flight responses so a slow one can't overwrite a newer query.
  useEffect(() => {
    if (!open) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/search?q=${encodeURIComponent(q)}`, {
        credentials: "include",
        signal: ctrl.signal,
      })
        .then((r) => (r.ok ? r.json() : { results: [] }))
        .then((d) => setResults(d.results ?? []))
        .catch(() => {
          /* aborted or network error — leave prior results */
        });
    }, 150);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [open, query]);

  // Static "Go to" + "Commands" entries, built from role flags (no round-trip)
  // and filtered client-side by the current query.
  const staticSections = useMemo(() => {
    const nav: PaletteItem[] = [
      navItem("Home", "/", Home),
      navItem("My Tasks", "/notifications", ListTodo),
      navItem("Calendar", "/calendar", Calendar),
      roles.canViewForms ? navItem("Forms", "/forms", ClipboardList) : null,
      roles.hasHiringAccess ? navItem("Hiring", "/hiring", Briefcase) : null,
      navItem("Projects", "/projects", FolderKanban),
      roles.canViewStaffing ? navItem("Staffing", "/projects/staffing", Users2) : null,
      roles.isLabMentor || roles.isCore ? navItem("Mentorship", "/mentorship", Heart) : null,
      navItem("People", "/members", UsersRound),
      navItem("Partners", "/partners", Handshake),
      navItem("Education", "/education", GraduationCap),
      navItem("Lab Processes", "/internal-processes", Workflow),
      roles.isCore ? navItem("Admin", "/admin-console", Settings) : null,
      navItem("Settings", "/settings", Settings),
      navItem("Help", "/help", HelpCircle),
    ].filter((x): x is PaletteItem => x !== null);

    const commands: PaletteItem[] = [
      {
        id: "cmd-workspace",
        title: tabless ? "Switch to tabbed workspace" : "Switch to single-page mode",
        subtitle: "Command",
        icon: tabless ? PanelTop : Square,
        action: {
          kind: "run",
          run: () => {
            setTablessPreference(!tabless);
            window.location.reload();
          },
        },
      },
      {
        id: "cmd-focus",
        title: focusMode ? "Show sidebar" : "Hide sidebar (focus mode)",
        subtitle: "Command",
        icon: focusMode ? PanelLeftOpen : PanelLeftClose,
        action: {
          kind: "run",
          run: () => {
            setFocusPreference(!focusMode);
            window.location.reload();
          },
        },
      },
      {
        id: "cmd-tour",
        title: "Start the tour",
        subtitle: "Command",
        icon: Compass,
        action: { kind: "run", run: () => window.dispatchEvent(new Event("dali:start-tour")) },
      },
      {
        id: "cmd-logout",
        title: "Log out",
        subtitle: "Command",
        icon: LogOut,
        action: { kind: "run", run: () => window.location.assign("/logout") },
      },
    ];

    const q = query.trim().toLowerCase();
    const match = (i: PaletteItem) => !q || i.title.toLowerCase().includes(q);
    return { nav: nav.filter(match), commands: commands.filter(match) };
  }, [roles, tabless, focusMode, query]);

  const sections = useMemo(() => {
    const out: { key: string; label: string; items: PaletteItem[] }[] = [];
    if (staticSections.nav.length) out.push({ key: "nav", label: "Go to", items: staticSections.nav });
    if (staticSections.commands.length)
      out.push({ key: "cmd", label: "Commands", items: staticSections.commands });
    for (const section of SECTION_ORDER) {
      const items = results
        .filter((r) => TYPE_META[r.type].section === section)
        .map((r) => resultItem(r));
      if (items.length) out.push({ key: section, label: section, items });
    }
    return out;
  }, [staticSections, results]);

  const flatItems = useMemo(() => sections.flatMap((s) => s.items), [sections]);

  // Reset highlight to the top item as the visible set changes.
  useEffect(() => {
    setSelectedIndex(0);
  }, [query, results]);

  // Keep the highlighted row in view during arrow navigation.
  useEffect(() => {
    listRef.current
      ?.querySelector(`[data-idx="${selectedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  function select(item: PaletteItem, toSide: boolean) {
    if (item.action.kind === "navigate") onOpen(item.action.url, item.action.label, toSide);
    else item.action.run();
    onClose();
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      // Wrap around: past the last item jumps back to the first, and vice versa.
      if (flatItems.length) setSelectedIndex((i) => (i + 1) % flatItems.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (flatItems.length) setSelectedIndex((i) => (i - 1 + flatItems.length) % flatItems.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flatItems[selectedIndex];
      if (item) select(item, e.metaKey || e.ctrlKey);
    }
  }

  let runningIdx = -1;

  return (
    <Modal
      open={open}
      onClose={onClose}
      labelledBy="command-palette-title"
      initialFocusRef={inputRef}
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh] overflow-y-auto"
      containerClassName="bg-card rounded-2xl shadow-brand-2 max-w-xl w-full overflow-hidden"
    >
      <h2 id="command-palette-title" className="sr-only">
        Search and commands
      </h2>

      <div className="flex items-center gap-2.5 border-b border-border px-4">
        <Search className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search people, projects, docs… or run a command"
          className="flex-1 bg-transparent py-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          aria-label="Search and commands"
          autoComplete="off"
          spellCheck={false}
        />
      </div>

      <div ref={listRef} className="max-h-[60vh] overflow-y-auto py-2">
        {flatItems.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            {query.trim().length >= 2 ? "No matches" : "Type to search"}
          </p>
        ) : (
          sections.map((section) => (
            <div key={section.key} className="mb-1 last:mb-0">
              <p className="px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {section.label}
              </p>
              {section.items.map((item) => {
                runningIdx += 1;
                const idx = runningIdx;
                const active = idx === selectedIndex;
                const Icon = item.icon;
                const isPerson = item.type === "person";
                return (
                  <button
                    key={item.id}
                    type="button"
                    data-idx={idx}
                    // onMouseDown (not onClick) so the input doesn't blur first,
                    // and onMouseMove to sync the highlight to the pointer.
                    onMouseMove={() => setSelectedIndex(idx)}
                    onClick={(e) => select(item, e.metaKey || e.ctrlKey)}
                    className={`flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors ${
                      active ? "bg-accent-coral/10 text-foreground" : "text-foreground/80 hover:bg-muted/50"
                    }`}
                  >
                    {isPerson ? (
                      <Avatar photoUrl={item.photoUrl} name={item.title} size="xs" className="shrink-0" />
                    ) : item.iconEmoji ? (
                      <span
                        className="flex h-4 w-4 shrink-0 items-center justify-center text-sm leading-none"
                        aria-hidden
                      >
                        {item.iconEmoji}
                      </span>
                    ) : (
                      <Icon
                        className={`w-4 h-4 shrink-0 ${active ? "text-accent-coral" : "text-muted-foreground"}`}
                        aria-hidden
                      />
                    )}
                    <span className="truncate flex-1">{item.title}</span>
                    {item.subtitle && (
                      <span className="truncate text-xs text-muted-foreground max-w-[40%]">
                        {item.subtitle}
                      </span>
                    )}
                    {active && (
                      <CornerDownLeft className="w-3.5 h-3.5 shrink-0 text-muted-foreground" aria-hidden />
                    )}
                  </button>
                );
              })}
            </div>
          ))
        )}
      </div>
    </Modal>
  );
}

function navItem(title: string, url: string, icon: LucideIcon): PaletteItem {
  return { id: `nav-${url}`, title, subtitle: "Go to", icon, action: { kind: "navigate", url, label: title } };
}

function resultItem(r: SearchResult): PaletteItem {
  return {
    id: `${r.type}-${r.id}`,
    title: r.title,
    subtitle: r.subtitle,
    icon: TYPE_META[r.type].icon,
    type: r.type,
    photoUrl: r.photoUrl,
    iconEmoji: r.iconEmoji,
    action: { kind: "navigate", url: r.url, label: r.title },
  };
}
