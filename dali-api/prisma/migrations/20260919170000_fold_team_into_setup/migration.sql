-- The Team phase (reviewer and interviewer rosters, opening applications)
-- folds into Setup, which now runs through Week 5. Stored timelines lose
-- their "team" block and Setup's end week stretches to cover it, so every
-- existing timeline stays valid (app/hiring/lib/cycle-timeline.ts).

UPDATE "ApplicationCycle" AS c
SET "timeline" = folded.t
FROM (
  SELECT c2.id, (
    SELECT jsonb_agg(
      CASE WHEN b->>'key' = 'setup'
        THEN jsonb_set(b, '{weeks,1}', to_jsonb(GREATEST((b->'weeks'->>1)::int, team.team_end)))
        ELSE b
      END ORDER BY ord)
    FROM jsonb_array_elements(c2."timeline") WITH ORDINALITY AS e(b, ord)
    WHERE b->>'key' IS DISTINCT FROM 'team'
  ) AS t
  FROM "ApplicationCycle" AS c2,
  LATERAL (
    SELECT (tb->'weeks'->>1)::int AS team_end
    FROM jsonb_array_elements(c2."timeline") AS tb
    WHERE tb->>'key' = 'team'
    LIMIT 1
  ) AS team
  WHERE jsonb_typeof(c2."timeline") = 'array'
) AS folded
WHERE c.id = folded.id;
