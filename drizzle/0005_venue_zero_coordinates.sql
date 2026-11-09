-- ČBF sends 0.00000000 for halls without GPS; trips routed to such a point went to the Gulf of
-- Guinea. Unknown coordinates make trips locate the hall by its address instead.
UPDATE "cbf"."venue" SET "lat" = NULL, "lon" = NULL
WHERE ("lat" IS NOT NULL OR "lon" IS NOT NULL)
	AND NOT coalesce("lat" BETWEEN 45 AND 56 AND "lon" BETWEEN 5 AND 25, false);
--> statement-breakpoint
-- default trips computed to such a hall are dropped; "Spočítat nevyplněné dny" computes them again
DELETE FROM "app"."trip" t
WHERE t."status" = 'auto'
	AND jsonb_typeof(t."stops") = 'array'
	AND EXISTS (
		SELECT 1 FROM jsonb_array_elements(t."stops") s
		WHERE s->>'kind' = 'venue'
			AND jsonb_typeof(s->'lat') = 'number'
			AND jsonb_typeof(s->'lon') = 'number'
			AND NOT ((s->>'lat')::float8 BETWEEN 45 AND 56 AND (s->>'lon')::float8 BETWEEN 5 AND 25)
	);
