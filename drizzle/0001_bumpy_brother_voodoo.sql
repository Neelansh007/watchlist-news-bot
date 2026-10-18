ALTER TABLE "analyst_votes" ADD COLUMN "initiating" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "analyst_votes" ADD COLUMN "veto" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "analyst_votes" ADD COLUMN "sentiment_score" double precision;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "intended_entry_price" numeric(30, 12) NOT NULL;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "reward_risk" numeric(30, 12) NOT NULL;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "margin" numeric(30, 12) NOT NULL;--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "raw_exit_price" numeric(30, 12);--> statement-breakpoint
ALTER TABLE "positions" ADD COLUMN "gap_through_stop" boolean DEFAULT false NOT NULL;