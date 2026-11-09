CREATE TABLE "app"."venue_fix" (
	"venue_id" integer PRIMARY KEY NOT NULL,
	"address" text NOT NULL,
	"lat" double precision NOT NULL,
	"lon" double precision NOT NULL,
	"user_id" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."venue_fix" ADD CONSTRAINT "venue_fix_venue_id_venue_id_fk" FOREIGN KEY ("venue_id") REFERENCES "cbf"."venue"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."venue_fix" ADD CONSTRAINT "venue_fix_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."user"("id") ON DELETE set null ON UPDATE no action;