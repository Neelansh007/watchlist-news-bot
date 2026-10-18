CREATE TYPE "public"."close_reason" AS ENUM('STOP_LOSS', 'TAKE_PROFIT', 'MAX_HOLD', 'MANUAL');--> statement-breakpoint
CREATE TYPE "public"."instrument_status" AS ENUM('AVAILABLE', 'UNAVAILABLE');--> statement-breakpoint
CREATE TYPE "public"."position_status" AS ENUM('OPEN', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."review_decision" AS ENUM('APPROVE', 'REJECT', 'FLAG_FOR_HUMAN_REVIEW');--> statement-breakpoint
CREATE TYPE "public"."side" AS ENUM('LONG', 'SHORT');--> statement-breakpoint
CREATE TYPE "public"."vote" AS ENUM('LONG', 'SHORT', 'NO_TRADE');--> statement-breakpoint
CREATE TABLE "analyst_votes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"cycle_id" integer NOT NULL,
	"agent" text NOT NULL,
	"symbol" text NOT NULL,
	"vote" "vote" NOT NULL,
	"confidence" double precision NOT NULL,
	"reasoning" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "candles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"timeframe" text NOT NULL,
	"start_time" bigint NOT NULL,
	"open" numeric(30, 12) NOT NULL,
	"high" numeric(30, 12) NOT NULL,
	"low" numeric(30, 12) NOT NULL,
	"close" numeric(30, 12) NOT NULL,
	"volume" numeric(30, 12) NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consensus_results" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"cycle_id" integer NOT NULL,
	"symbol" text NOT NULL,
	"decision" "vote" NOT NULL,
	"confidence" double precision NOT NULL,
	"votes_for" integer NOT NULL,
	"votes_against" integer NOT NULL,
	"votes_total" integer NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cycles" (
	"id" serial PRIMARY KEY NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"mode" text NOT NULL,
	"status" text DEFAULT 'RUNNING' NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "instruments" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"base_asset" text NOT NULL,
	"quote_asset" text NOT NULL,
	"mudrex_asset_id" text,
	"status" "instrument_status" NOT NULL,
	"tradable" boolean DEFAULT false NOT NULL,
	"unavailable_reason" text,
	"raw" jsonb,
	"price_precision" integer,
	"qty_precision" integer,
	"min_qty" numeric(30, 12),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instruments_symbol_unique" UNIQUE("symbol")
);
--> statement-breakpoint
CREATE TABLE "journal" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"cycle_id" integer,
	"symbol" text,
	"kind" text NOT NULL,
	"message" text NOT NULL,
	"payload" jsonb
);
--> statement-breakpoint
CREATE TABLE "news_items" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"title" text NOT NULL,
	"link" text NOT NULL,
	"source" text NOT NULL,
	"published_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "news_items_link_unique" UNIQUE("link")
);
--> statement-breakpoint
CREATE TABLE "portfolio_snapshots" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"equity" numeric(30, 12) NOT NULL,
	"cash_balance" numeric(30, 12) NOT NULL,
	"unrealized_pnl" numeric(30, 12) NOT NULL,
	"open_position_count" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "positions" (
	"id" serial PRIMARY KEY NOT NULL,
	"symbol" text NOT NULL,
	"side" "side" NOT NULL,
	"qty" numeric(30, 12) NOT NULL,
	"leverage" integer NOT NULL,
	"entry_price" numeric(30, 12) NOT NULL,
	"stop_loss" numeric(30, 12) NOT NULL,
	"take_profit" numeric(30, 12) NOT NULL,
	"entry_fee" numeric(30, 12) DEFAULT '0' NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"opened_cycle_id" integer,
	"max_hold_until" timestamp with time zone NOT NULL,
	"status" "position_status" DEFAULT 'OPEN' NOT NULL,
	"close_reason" "close_reason",
	"exit_price" numeric(30, 12),
	"exit_fee" numeric(30, 12),
	"realized_pnl" numeric(30, 12),
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "review_decisions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"cycle_id" integer NOT NULL,
	"symbol" text NOT NULL,
	"decision" "review_decision" NOT NULL,
	"model" text NOT NULL,
	"reasoning" text,
	"raw" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "risk_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"cycle_id" integer,
	"symbol" text,
	"limit" text NOT NULL,
	"action" text NOT NULL,
	"message" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "votes_cycle_symbol_idx" ON "analyst_votes" USING btree ("cycle_id","symbol");--> statement-breakpoint
CREATE UNIQUE INDEX "candles_symbol_tf_start_idx" ON "candles" USING btree ("symbol","timeframe","start_time");--> statement-breakpoint
CREATE INDEX "candles_symbol_tf_idx" ON "candles" USING btree ("symbol","timeframe");--> statement-breakpoint
CREATE INDEX "journal_ts_idx" ON "journal" USING btree ("ts");--> statement-breakpoint
CREATE INDEX "news_symbol_published_idx" ON "news_items" USING btree ("symbol","published_at");--> statement-breakpoint
CREATE INDEX "positions_status_idx" ON "positions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "risk_events_created_idx" ON "risk_events" USING btree ("created_at");