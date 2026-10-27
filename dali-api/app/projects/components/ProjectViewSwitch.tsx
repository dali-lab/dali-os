import { Link } from "react-router";
import { Building2, Globe, Handshake } from "lucide-react";
import { PageBarMenuItems, usePageBarSlot } from "~/components/shell/page-bar-slot";
import { Menu } from "~/components/ui/floating";

// A project has three read surfaces — the internal hub, the partner preview,
// and the public showcase preview — and each one's header offers the other
// two. Keeping the set in one place means adding a fourth view later is a
// one-line change here rather than an edit to three route `handle`s that
// silently drift apart.

const VIEWS = {
  internal: { label: "Internal view", icon: Building2, href: (id: string) => `/projects/${id}` },
  partner: {
    label: "Partner view",
    icon: Handshake,
    href: (id: string) => `/projects/${id}/partner-view`,
  },
  public: {
    label: "Public view",
    icon: Globe,
    href: (id: string) => `/projects/${id}/public-view`,
  },
} as const;

export type ProjectViewKey = keyof typeof VIEWS;

// Renders links to every view except the one currently open, so the header
// control reads as a toggle in place rather than a "back" link.
export function ProjectViewSwitch({
  projectId,
  current,
}: {
  projectId: string;
  current: ProjectViewKey;
}) {
  const others = (Object.keys(VIEWS) as ProjectViewKey[]).filter((k) => k !== current);
  const inPageBar = usePageBarSlot();
  if (inPageBar) {
    return (
      <PageBarMenuItems>
        {others.map((key) => {
          const { label, icon: Icon, href } = VIEWS[key];
          return (
            <Menu.LinkItem key={key} to={href(projectId)} icon={<Icon className="h-3.5 w-3.5" />}>
              {label}
            </Menu.LinkItem>
          );
        })}
      </PageBarMenuItems>
    );
  }
  return (
    <div className="flex items-center gap-2.5">
      {others.map((key) => {
        const { label, icon: Icon, href } = VIEWS[key];
        return (
          <Link key={key} to={href(projectId)} className="os-edit-btn">
            <Icon className="w-4 h-4" />
            {label}
          </Link>
        );
      })}
    </div>
  );
}
