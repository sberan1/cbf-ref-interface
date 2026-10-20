CREATE TABLE "app"."own_game" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"date" date NOT NULL,
	"title" text NOT NULL,
	"role" text NOT NULL,
	"games" integer DEFAULT 1 NOT NULL,
	"fee" integer,
	"place" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."own_game" ADD CONSTRAINT "own_game_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "app"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "own_game_user_date_idx" ON "app"."own_game" USING btree ("user_id","date");