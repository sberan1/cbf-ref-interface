CREATE SCHEMA "ingest";
--> statement-breakpoint
CREATE SCHEMA "cbf";
--> statement-breakpoint
CREATE TABLE "ingest"."fetch_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"request_key" text NOT NULL,
	"endpoint" text NOT NULL,
	"url" text NOT NULL,
	"reason" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"duration_ms" integer NOT NULL,
	"http_status" integer,
	"byte_size" integer,
	"outcome" text NOT NULL,
	"error" text,
	"raw_payload_id" bigint
);
--> statement-breakpoint
CREATE TABLE "ingest"."fetch_state" (
	"request_key" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"endpoint" text NOT NULL,
	"params" jsonb NOT NULL,
	"context" jsonb,
	"last_fetched_at" timestamp with time zone,
	"last_http_status" integer,
	"last_hash" text,
	"last_raw_payload_id" bigint,
	"last_changed_at" timestamp with time zone,
	"next_due_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"normalized_raw_payload_id" bigint,
	"normalizer_version" integer,
	"normalized_at" timestamp with time zone,
	"last_normalize_error" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingest"."raw_payload" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"endpoint" text NOT NULL,
	"params" jsonb NOT NULL,
	"request_key" text NOT NULL,
	"url" text NOT NULL,
	"http_status" integer NOT NULL,
	"content_type" text,
	"content_hash" text NOT NULL,
	"byte_size" integer NOT NULL,
	"body" text NOT NULL,
	"first_fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"fetch_count" integer DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cbf"."area" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cbf"."category" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cbf"."club" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cbf"."competition" (
	"id" integer PRIMARY KEY NOT NULL,
	"season_id" integer,
	"season_year" integer,
	"area_id" integer,
	"is_female" boolean,
	"category_id" integer,
	"league_id" integer,
	"league_name" text,
	"name" text,
	"flags" jsonb,
	"extra" jsonb,
	"extra_v1" jsonb,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cbf"."competition_team" (
	"competition_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"name" text,
	"abbr" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "competition_team_competition_id_team_id_pk" PRIMARY KEY("competition_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "cbf"."game" (
	"id" integer PRIMARY KEY NOT NULL,
	"phase_id" integer,
	"competition_id" integer,
	"round" text,
	"number" text,
	"scheduled_date" date,
	"scheduled_time" text,
	"starts_at" timestamp with time zone,
	"home_team_id" integer,
	"away_team_id" integer,
	"home_team_name" text,
	"away_team_name" text,
	"home_team_abbr" text,
	"away_team_abbr" text,
	"home_score" integer,
	"away_score" integer,
	"home_points" integer,
	"away_points" integer,
	"score_quarters_raw" text,
	"venue_id" integer,
	"url_live" text,
	"video_url" text,
	"is_tv" boolean,
	"result_checked" boolean,
	"attendance" integer,
	"extra" jsonb,
	"extra_v1" jsonb,
	"observed_at" timestamp with time zone,
	"detail_fetched_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cbf"."game_official" (
	"game_id" integer NOT NULL,
	"role" text NOT NULL,
	"official_id" integer NOT NULL,
	"first_name" text,
	"last_name" text,
	"ratings" jsonb,
	"source" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"raw_payload_id" bigint,
	CONSTRAINT "game_official_game_id_role_pk" PRIMARY KEY("game_id","role")
);
--> statement-breakpoint
CREATE TABLE "cbf"."game_official_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"role" text NOT NULL,
	"change_type" text NOT NULL,
	"official_id" integer,
	"previous_official_id" integer,
	"is_initial" boolean NOT NULL,
	"source" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"raw_payload_id" bigint
);
--> statement-breakpoint
CREATE TABLE "cbf"."game_score_quarter" (
	"game_id" integer NOT NULL,
	"period" integer NOT NULL,
	"home" integer,
	"away" integer,
	CONSTRAINT "game_score_quarter_game_id_period_pk" PRIMARY KEY("game_id","period")
);
--> statement-breakpoint
CREATE TABLE "cbf"."game_team_stats" (
	"game_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"is_guest" boolean,
	"stats" jsonb,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_team_stats_game_id_team_id_pk" PRIMARY KEY("game_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "cbf"."official" (
	"id" integer PRIMARY KEY NOT NULL,
	"group_id" integer,
	"first_name" text,
	"last_name" text,
	"last_seen_at" timestamp with time zone,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cbf"."phase" (
	"id" integer PRIMARY KEY NOT NULL,
	"competition_id" integer,
	"name" text,
	"type_id" integer,
	"type_name" text,
	"extra" jsonb,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cbf"."player" (
	"id" integer PRIMARY KEY NOT NULL,
	"group_id" integer,
	"first_name" text,
	"last_name" text,
	"height" integer,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cbf"."player_game_stats" (
	"game_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"team_id" integer,
	"jersey" text,
	"stats" jsonb,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "player_game_stats_game_id_player_id_pk" PRIMARY KEY("game_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "cbf"."season" (
	"id" integer PRIMARY KEY NOT NULL,
	"start_year" integer,
	"name" text,
	"short_name" text,
	"begins_on" date,
	"ends_on" date,
	"is_current" boolean,
	"extra" jsonb,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cbf"."standing" (
	"phase_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"competition_id" integer,
	"team_name" text,
	"team_abbr" text,
	"position" integer,
	"games_played" integer,
	"wins" integer,
	"losses" integer,
	"points_for" integer,
	"points_against" integer,
	"points" numeric,
	"extra" jsonb,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "standing_phase_id_team_id_pk" PRIMARY KEY("phase_id","team_id")
);
--> statement-breakpoint
CREATE TABLE "cbf"."team" (
	"id" integer PRIMARY KEY NOT NULL,
	"group_id" integer,
	"club_id" integer,
	"category_id" integer,
	"name" text,
	"short_name" text,
	"abbr" text,
	"is_female" boolean,
	"web" text,
	"email" text,
	"street" text,
	"city" text,
	"zip" text,
	"phones" text[],
	"extra" jsonb,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cbf"."team_player" (
	"competition_id" integer NOT NULL,
	"team_id" integer NOT NULL,
	"player_id" integer NOT NULL,
	"jersey" text,
	"stats" jsonb,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_player_competition_id_team_id_player_id_pk" PRIMARY KEY("competition_id","team_id","player_id")
);
--> statement-breakpoint
CREATE TABLE "cbf"."venue" (
	"id" serial PRIMARY KEY NOT NULL,
	"natural_key" text NOT NULL,
	"hall_id" integer,
	"name" text,
	"street" text,
	"city" text,
	"zip" text,
	"lat" double precision,
	"lon" double precision,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "venue_natural_key_unique" UNIQUE("natural_key")
);
--> statement-breakpoint
ALTER TABLE "ingest"."fetch_state" ADD CONSTRAINT "fetch_state_last_raw_payload_id_raw_payload_id_fk" FOREIGN KEY ("last_raw_payload_id") REFERENCES "ingest"."raw_payload"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cbf"."game" ADD CONSTRAINT "game_venue_id_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "cbf"."venue"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cbf"."game_official" ADD CONSTRAINT "game_official_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "cbf"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cbf"."game_official" ADD CONSTRAINT "game_official_official_id_official_id_fk" FOREIGN KEY ("official_id") REFERENCES "cbf"."official"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cbf"."game_score_quarter" ADD CONSTRAINT "game_score_quarter_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "cbf"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cbf"."game_team_stats" ADD CONSTRAINT "game_team_stats_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "cbf"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cbf"."player_game_stats" ADD CONSTRAINT "player_game_stats_game_id_game_id_fk" FOREIGN KEY ("game_id") REFERENCES "cbf"."game"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cbf"."player_game_stats" ADD CONSTRAINT "player_game_stats_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "cbf"."player"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cbf"."team_player" ADD CONSTRAINT "team_player_player_id_player_id_fk" FOREIGN KEY ("player_id") REFERENCES "cbf"."player"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fetch_log_started_at_idx" ON "ingest"."fetch_log" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "fetch_log_request_key_idx" ON "ingest"."fetch_log" USING btree ("request_key");--> statement-breakpoint
CREATE INDEX "fetch_state_endpoint_due_idx" ON "ingest"."fetch_state" USING btree ("endpoint","next_due_at");--> statement-breakpoint
CREATE UNIQUE INDEX "raw_payload_request_hash_uq" ON "ingest"."raw_payload" USING btree ("request_key","content_hash");--> statement-breakpoint
CREATE INDEX "raw_payload_endpoint_idx" ON "ingest"."raw_payload" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "competition_season_year_idx" ON "cbf"."competition" USING btree ("season_year");--> statement-breakpoint
CREATE INDEX "competition_area_idx" ON "cbf"."competition" USING btree ("area_id");--> statement-breakpoint
CREATE INDEX "competition_team_team_idx" ON "cbf"."competition_team" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "game_phase_idx" ON "cbf"."game" USING btree ("phase_id");--> statement-breakpoint
CREATE INDEX "game_competition_idx" ON "cbf"."game" USING btree ("competition_id");--> statement-breakpoint
CREATE INDEX "game_starts_at_idx" ON "cbf"."game" USING btree ("starts_at");--> statement-breakpoint
CREATE INDEX "game_home_team_idx" ON "cbf"."game" USING btree ("home_team_id");--> statement-breakpoint
CREATE INDEX "game_away_team_idx" ON "cbf"."game" USING btree ("away_team_id");--> statement-breakpoint
CREATE INDEX "game_official_official_idx" ON "cbf"."game_official" USING btree ("official_id");--> statement-breakpoint
CREATE INDEX "game_official_history_game_idx" ON "cbf"."game_official_history" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "game_official_history_official_idx" ON "cbf"."game_official_history" USING btree ("official_id");--> statement-breakpoint
CREATE INDEX "official_group_idx" ON "cbf"."official" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "phase_competition_idx" ON "cbf"."phase" USING btree ("competition_id");--> statement-breakpoint
CREATE INDEX "player_group_idx" ON "cbf"."player" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "player_game_stats_player_idx" ON "cbf"."player_game_stats" USING btree ("player_id");--> statement-breakpoint
CREATE INDEX "season_start_year_idx" ON "cbf"."season" USING btree ("start_year");--> statement-breakpoint
CREATE INDEX "team_club_idx" ON "cbf"."team" USING btree ("club_id");--> statement-breakpoint
CREATE INDEX "team_group_idx" ON "cbf"."team" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "team_player_player_idx" ON "cbf"."team_player" USING btree ("player_id");