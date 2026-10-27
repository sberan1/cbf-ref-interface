ALTER TABLE "app"."user" ADD COLUMN "calendar_token" text;--> statement-breakpoint
ALTER TABLE "app"."user" ADD CONSTRAINT "user_calendar_token_unique" UNIQUE("calendar_token");