import { Form, useNavigate } from "react-router";
import { Plus } from "lucide-react";
import { SegmentedTabButtons } from "~/components/AreaPillNav";
import { SearchInput } from "~/components/ui/SearchInput";

const FEED = "/community/gallery";

function feedHref(mine: boolean, q: string) {
  const params = new URLSearchParams();
  if (mine) params.set("show", "mine");
  if (q) params.set("q", q);
  const qs = params.toString();
  return qs ? `${FEED}?${qs}` : FEED;
}

/** The gallery's one nav row: All · Mine, search, and Post. Same on the feed and a post page. */
export function GalleryNavRow({
  mine = false,
  q = "",
  onPost,
}: {
  mine?: boolean;
  q?: string;
  onPost: () => void;
}) {
  const navigate = useNavigate();

  return (
    <div className="flex flex-wrap items-center gap-3">
      <SegmentedTabButtons
        label="Show"
        items={[
          { label: "All", active: !mine, onClick: () => navigate(feedHref(false, q)) },
          { label: "Mine", active: mine, onClick: () => navigate(feedHref(true, q)) },
        ]}
      />
      <Form method="get" action={FEED} role="search" className="min-w-[200px] max-w-md flex-1">
        {mine && <input type="hidden" name="show" value="mine" />}
        <SearchInput
          key={q}
          name="q"
          defaultValue={q}
          placeholder="Search posts and people"
          aria-label="Search posts and people"
        />
      </Form>
      <button type="button" onClick={onPost} className="os-add-btn ml-auto">
        <Plus className="h-[17px] w-[17px]" strokeWidth={3} aria-hidden />
        Post
      </button>
    </div>
  );
}
