import { useState } from "react";
import type { LoadMoreProps } from "~/components/ui/Pager";

export const CLIENT_SLICE_SIZE = 50;

export function useClientSlice<T>(
  items: readonly T[],
  { pageSize = CLIENT_SLICE_SIZE, resetKey = "" }: { pageSize?: number; resetKey?: string } = {},
): { visible: T[]; pager: LoadMoreProps } {
  const [state, setState] = useState({ key: resetKey, limit: pageSize });
  if (state.key !== resetKey) setState({ key: resetKey, limit: pageSize });
  const limit = state.key === resetKey ? state.limit : pageSize;

  return {
    visible: items.slice(0, limit),
    pager: {
      hasMore: items.length > limit,
      shown: Math.min(limit, items.length),
      total: items.length,
      onLoadMore: () => setState((s) => ({ ...s, limit: s.limit + pageSize })),
    },
  };
}
