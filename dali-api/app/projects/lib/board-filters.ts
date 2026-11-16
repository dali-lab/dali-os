import { filterRows } from "~/hooks/useFilteredList";
import {
  applicableFilters,
  matchesFilters,
  readFilterParams,
  type FilterCells,
} from "./submission-filters";

// The response a board's detail drawer has open, by member id.
export const OPEN_PARAM = "open";

// The rows a slot board shows for its URL's search, domain and column filters.
// The board applies the same three client side as you type; the CSV export
// applies them here so the file matches the table.
export function filterBoardRows<
  R extends { name: string; email: string | null; domainIds: string[]; cells: FilterCells },
>(rows: readonly R[], columnKeys: readonly string[], params: URLSearchParams): R[] {
  const domain = params.get("domain") ?? "";
  const filters = applicableFilters(readFilterParams(params), columnKeys);
  return filterRows(rows, params.get("q") ?? "", (r) => [r.name, r.email], [
    (r) => !domain || r.domainIds.includes(domain),
    (r) => matchesFilters(r.cells, filters),
  ]);
}
