// Side-effect-only import barrel: every feature area's CSV export
// registrations, pulled in once so the generic export route
// (app/routes/api.export.$exportId.export.csv.ts) has the full registry
// populated regardless of which table's button was clicked.
import "~/admin/lib/csv-exports.server";
import "~/members/lib/csv-exports.server";
import "~/partners/lib/csv-exports.server";
import "~/education/lib/csv-exports.server";
import "~/projects/lib/csv-exports.server";
import "~/hiring/lib/csv-exports.server";
