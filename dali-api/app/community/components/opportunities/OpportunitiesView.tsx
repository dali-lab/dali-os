import { useState } from "react";
import { Link } from "react-router";
import { ExternalLink, Plus } from "lucide-react";
import type { OpportunityFeedPost, OpportunityShow } from "~/community/lib/opportunities-feed.server";
import type { loadOpportunitiesPage } from "~/community/lib/opportunities-feed.server";
import { OpportunityPostCard } from "~/community/components/opportunities/OpportunityPostCard";
import { OpportunityComposer, type ComposerKind } from "~/community/components/opportunities/OpportunityComposer";
import { REFERRAL_STATUS_LABEL } from "~/partners/lib/referral-status";
import { cn } from "~/lib/cn";
import { fetchCursorPage } from "~/hooks/useLoadMore";
import { useRefreshedLoadMore } from "~/hooks/useRefreshedLoadMore";
import { OPPORTUNITY_IDS_MAX } from "~/community/lib/opportunities";
import { LoadMore } from "~/components/ui/Pager";
import { useOsChrome } from "~/components/os-chrome";
import { Avatar } from "~/components/ui/Avatar";
import { Button } from "~/components/ui/Button";
import { useFeatureFlag } from "~/components/FeatureFlags";

export type OpportunitiesPageData = Awaited<ReturnType<typeof loadOpportunitiesPage>> & { canPostJob: boolean };

const FEED_URL = "/api/opportunities/posts";

function Feed({ data }: { data: OpportunitiesPageData }) {
  const { show, items, nextCursor } = data;
  const { bodyText } = useOsChrome();
  const query = (params: string) => `${FEED_URL}?${params}${show === "all" ? "" : `&show=${show}`}`;
  const { items: posts, pager } = useRefreshedLoadMore<OpportunityFeedPost>({
    items,
    nextCursor,
    fetchPage: (cursor) => fetchCursorPage<OpportunityFeedPost>(query(`cursor=${encodeURIComponent(cursor)}`)),
    fetchByIds: async (ids) => {
      const chunks: string[][] = [];
      for (let i = 0; i < ids.length; i += OPPORTUNITY_IDS_MAX) chunks.push(ids.slice(i, i + OPPORTUNITY_IDS_MAX));
      const pages = await Promise.all(
        chunks.map((chunk) => fetchCursorPage<OpportunityFeedPost>(query(`ids=${encodeURIComponent(chunk.join(","))}`))),
      );
      return pages.flatMap((page) => page.items);
    },
  });
  const empty = posts.length === 0 && data.pinned.length === 0;
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {data.pinned.length > 0 && (
        <section aria-label="Asks for you" className="flex flex-col gap-4">
          {data.pinned.map((post) => (
            <OpportunityPostCard key={post.id} post={post} />
          ))}
        </section>
      )}
      {empty ? (
        <p className={bodyText}>Nothing here yet. Share a job or ask for a coffee chat to start.</p>
      ) : (
        <>
          {posts.map((post) => (
            <OpportunityPostCard key={post.id} post={post} />
          ))}
          <LoadMore {...pager} />
        </>
      )}
    </div>
  );
}

const SHOW_OPTIONS: Array<{ value: OpportunityShow; label: string; to: string }> = [
  { value: "all", label: "Everything", to: "?" },
  { value: "jobs", label: "Jobs", to: "?show=jobs" },
  { value: "chats", label: "Coffee chats", to: "?show=chats" },
];

function SideColumn({ data }: { data: OpportunitiesPageData }) {
  const { card, panelPad, heading } = useOsChrome();
  const canRefer = useFeatureFlag("refer-a-partner");
  const counts = { all: data.counts.all, jobs: data.counts.jobs, chats: data.counts.chats };
  return (
    <aside className="flex flex-col gap-4 lg:w-[340px]">
      <nav aria-label="Show" className={cn(card, panelPad, "flex flex-col gap-1")}>
        <h2 className={cn(heading, "mb-2")}>Show</h2>
        {SHOW_OPTIONS.map((option) => (
          <Link
            key={option.value}
            to={option.to}
            replace
            aria-current={data.show === option.value ? "page" : undefined}
            className={cn(
              "flex items-center justify-between rounded-os-item px-3 py-1.5 text-sm transition-colors",
              data.show === option.value ? "bg-os-accent/15 text-os-accent" : "text-os-grey hover:bg-muted hover:text-foreground",
            )}
          >
            <span>{option.label}</span>
            <span className="text-xs">{counts[option.value]}</span>
          </Link>
        ))}
      </nav>
      {data.referrals.length > 0 && (
        <section aria-label="Your referrals" className={cn(card, panelPad, "flex flex-col gap-3")}>
          <h2 className={heading}>Your referrals</h2>
          <ul className="flex flex-col gap-2">
            {data.referrals.map((referral) => (
              <li key={referral.id} className="flex items-baseline justify-between gap-3 text-sm">
                <span className="min-w-0 truncate text-foreground">{referral.partnerName}</span>
                {referral.status === "Project" && referral.projectId ? (
                  <Link to={`/projects/${referral.projectId}`} className="shrink-0 text-xs text-os-accent hover:underline">
                    {REFERRAL_STATUS_LABEL.Project}
                  </Link>
                ) : (
                  <span className="shrink-0 text-xs text-os-grey">{REFERRAL_STATUS_LABEL[referral.status]}</span>
                )}
              </li>
            ))}
          </ul>
          {canRefer && (
            <Link to="/refer" className="text-sm text-os-accent hover:underline">
              Refer a partner
            </Link>
          )}
        </section>
      )}
    </aside>
  );
}

export function OpportunitiesView({ data }: { data: OpportunitiesPageData }) {
  const { pageTitle, card, panelPad } = useOsChrome();
  const canRefer = useFeatureFlag("refer-a-partner");
  const [composing, setComposing] = useState<ComposerKind | null>(null);
  const defaultKind: ComposerKind = data.canPostJob ? "Job" : "ChatAsk";
  const chip =
    "rounded-full border border-os-container px-3 py-1 text-sm text-os-grey transition-colors hover:border-os-container-hi hover:text-foreground";
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-4">
        <h1 className={pageTitle}>Opportunities</h1>
        <Button className="shrink-0" onClick={() => setComposing(defaultKind)}>
          <Plus className="h-4 w-4" aria-hidden />
          Share
        </Button>
      </div>
      <div className={cn(card, panelPad, "flex flex-wrap items-center gap-3 lg:max-w-[744px]")}>
        <Avatar size="md" name={data.me.name} photoUrl={data.me.photoUrl} />
        <span className="mr-auto text-sm text-os-grey">Hiring, or open to a chat?</span>
        {data.canPostJob && (
          <button type="button" className={chip} onClick={() => setComposing("Job")}>
            Job
          </button>
        )}
        <button type="button" className={chip} onClick={() => setComposing("ChatAsk")}>
          Coffee chat
        </button>
        {canRefer && (
          <Link to="/refer" className={cn(chip, "inline-flex items-center gap-1")}>
            Refer a partner
            <ExternalLink className="h-3 w-3" aria-hidden />
          </Link>
        )}
      </div>
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        <div className="order-2 min-w-0 flex-1 lg:order-1 lg:max-w-[744px]">
          <Feed key={data.show} data={data} />
        </div>
        <div className="order-1 lg:order-2">
          <SideColumn data={data} />
        </div>
      </div>
      {composing && (
        <OpportunityComposer open onClose={() => setComposing(null)} initialKind={composing} canPostJob={data.canPostJob} />
      )}
    </div>
  );
}
