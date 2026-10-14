CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TABLE "cbf"."team_contact" (
	"team_id" integer NOT NULL,
	"user_id" integer NOT NULL,
	"role" text NOT NULL,
	"group_id" integer,
	"first_name" text,
	"last_name" text,
	"degree_prefix" text,
	"degree_suffix" text,
	"is_male" boolean,
	"birth_date" date,
	"street" text,
	"house_number" text,
	"city" text,
	"zip" text,
	"phones" text[],
	"email" text,
	"valid_from" date,
	"valid_to" date,
	"extra" jsonb,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "team_contact_team_id_user_id_role_pk" PRIMARY KEY("team_id","user_id","role")
);
--> statement-breakpoint
CREATE TABLE "app"."session" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."user" (
	"id" serial PRIMARY KEY NOT NULL,
	"official_id" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_official_id_unique" UNIQUE("official_id")
);
--> statement-breakpoint
ALTER TABLE "app"."session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."user" ADD CONSTRAINT "user_official_id_official_id_fk" FOREIGN KEY ("official_id") REFERENCES "cbf"."official"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "team_contact_user_idx" ON "cbf"."team_contact" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_idx" ON "app"."session" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "cbf"."game_official" DROP COLUMN "ratings";