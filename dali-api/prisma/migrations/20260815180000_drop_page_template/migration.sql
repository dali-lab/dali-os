-- Retire the vestigial PageTemplate model. Document ("page") templates are now
-- ordinary Lab Page rows flagged isTemplate (the live create-from-template path
-- and the Drive Templates gallery both read Page.isTemplate). PageTemplate rows
-- were only ever written by the seeders and read by the previously-orphaned
-- drive-templates loader — no product data lives here, so this drop is safe.
DROP TABLE "PageTemplate";
