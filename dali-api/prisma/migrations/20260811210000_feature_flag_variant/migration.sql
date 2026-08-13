-- Multi-value feature flags: which option targeted users get. Null (every
-- existing row) means "use the registry's defaultVariant", so plain on/off
-- flags are unaffected.
ALTER TABLE "FeatureFlag" ADD COLUMN "variant" TEXT;
