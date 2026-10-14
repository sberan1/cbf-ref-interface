-- Passwordless pairings (PDR 0001) are replaced by Google accounts approved by an admin (ADR 0008):
-- the old users have no e-mail and cannot sign in any more, so they and their sessions go.
DELETE FROM "app"."session";--> statement-breakpoint
DELETE FROM "app"."user";--> statement-breakpoint
CREATE TABLE "app"."geo_cache" (
	"query" text PRIMARY KEY NOT NULL,
	"label" text,
	"lat" double precision,
	"lon" double precision,
	"municipality" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."oauth_account" (
	"provider" text NOT NULL,
	"provider_user_id" text NOT NULL,
	"user_id" integer NOT NULL,
	"email" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "oauth_account_provider_provider_user_id_pk" PRIMARY KEY("provider","provider_user_id")
);
--> statement-breakpoint
CREATE TABLE "app"."place" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"label" text NOT NULL,
	"address" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"municipality" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "place_user_label_uq" UNIQUE("user_id","label")
);
--> statement-breakpoint
CREATE TABLE "app"."route_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"meters" integer NOT NULL,
	"seconds" integer NOT NULL,
	"approximate" boolean DEFAULT false NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."trip" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"date" date NOT NULL,
	"status" text NOT NULL,
	"mode" text NOT NULL,
	"stops" jsonb NOT NULL,
	"legs" jsonb,
	"ticket_cost" integer,
	"extra_cost" integer,
	"note" text,
	"computed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trip_user_date_uq" UNIQUE("user_id","date")
);
--> statement-breakpoint
ALTER TABLE "app"."user" ALTER COLUMN "official_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."user" ADD COLUMN "email" text NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."user" ADD COLUMN "name" text;--> statement-breakpoint
ALTER TABLE "app"."user" ADD COLUMN "avatar_url" text;--> statement-breakpoint
ALTER TABLE "app"."user" ADD COLUMN "role" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."user" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."user" ADD COLUMN "requested_official_id" integer;--> statement-breakpoint
ALTER TABLE "app"."user" ADD COLUMN "requested_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."user" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."user" ADD COLUMN "reviewed_by_user_id" integer;--> statement-breakpoint
ALTER TABLE "app"."user" ADD COLUMN "home_address" text;--> statement-breakpoint
ALTER TABLE "app"."user" ADD COLUMN "home_lat" double precision;--> statement-breakpoint
ALTER TABLE "app"."user" ADD COLUMN "home_lon" double precision;--> statement-breakpoint
ALTER TABLE "app"."user" ADD COLUMN "home_municipality" text;--> statement-breakpoint
ALTER TABLE "app"."oauth_account" ADD CONSTRAINT "oauth_account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."place" ADD CONSTRAINT "place_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."trip" ADD CONSTRAINT "trip_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "oauth_account_user_idx" ON "app"."oauth_account" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "app"."user" ADD CONSTRAINT "user_requested_official_id_official_id_fk" FOREIGN KEY ("requested_official_id") REFERENCES "cbf"."official"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "user_status_idx" ON "app"."user" USING btree ("status");--> statement-breakpoint
ALTER TABLE "app"."user" ADD CONSTRAINT "user_email_unique" UNIQUE("email");