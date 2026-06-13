-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TYPE "public"."enum_leads_email_type" AS ENUM('business', 'free');--> statement-breakpoint
CREATE TYPE "public"."enum_leads_source" AS ENUM('industry-page', 'booking-page', 'contact-form');--> statement-breakpoint
CREATE TYPE "public"."enum_leads_status" AS ENUM('new', 'booked', 'contacted', 'qualified', 'won', 'lost');--> statement-breakpoint
CREATE TYPE "public"."enum_leads_team_size" AS ENUM('1', '2-10', '11-50', '51-200', '200+');--> statement-breakpoint
CREATE TYPE "public"."enum_leads_timeline" AS ENUM('asap', 'quarter', 'year', 'exploring');--> statement-breakpoint
CREATE TYPE "public"."enum_outreach_status" AS ENUM('draft', 'approved', 'edited', 'denied', 'sent');--> statement-breakpoint
CREATE TYPE "public"."enum_outreach_step" AS ENUM('connection', 'diagnostic', 'reflect', 'invite', 'followup');--> statement-breakpoint
CREATE TYPE "public"."enum_pages_status" AS ENUM('draft', 'published');--> statement-breakpoint
CREATE TYPE "public"."enum_prospects_status" AS ENUM('new', 'qualified', 'note_ready', 'connected', 'diagnostic_sent', 'replied', 'invited', 'prepped', 'meeting', 'won', 'lost', 'disqualified');--> statement-breakpoint
CREATE TYPE "public"."enum_prospects_vertical" AS ENUM('insurance', 'mortgage', 'wealth', 'msp', 'law', 'other');--> statement-breakpoint
CREATE TABLE "payload_locked_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"global_slug" varchar,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" varchar NOT NULL,
	"slug" varchar NOT NULL,
	"status" "enum_pages_status" DEFAULT 'draft',
	"content" jsonb,
	"meta_title" varchar,
	"meta_description" varchar,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payload_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar,
	"value" jsonb,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payload_kv" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" varchar NOT NULL,
	"data" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "media" (
	"id" serial PRIMARY KEY NOT NULL,
	"alt" varchar NOT NULL,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"url" varchar,
	"thumbnail_u_r_l" varchar,
	"filename" varchar,
	"mime_type" varchar,
	"filesize" numeric,
	"width" numeric,
	"height" numeric,
	"focal_x" numeric,
	"focal_y" numeric
);
--> statement-breakpoint
CREATE TABLE "payload_locked_documents_rels" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"users_id" integer,
	"media_id" integer,
	"pages_id" integer,
	"leads_id" integer,
	"prospects_id" integer,
	"outreach_id" integer
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"email" varchar NOT NULL,
	"reset_password_token" varchar,
	"reset_password_expiration" timestamp(3) with time zone,
	"salt" varchar,
	"hash" varchar,
	"login_attempts" numeric DEFAULT '0',
	"lock_until" timestamp(3) with time zone
);
--> statement-breakpoint
CREATE TABLE "payload_migrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar,
	"batch" numeric,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users_sessions" (
	"_order" integer NOT NULL,
	"_parent_id" integer NOT NULL,
	"id" varchar PRIMARY KEY NOT NULL,
	"created_at" timestamp(3) with time zone,
	"expires_at" timestamp(3) with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payload_preferences_rels" (
	"id" serial PRIMARY KEY NOT NULL,
	"order" integer,
	"parent_id" integer NOT NULL,
	"path" varchar NOT NULL,
	"users_id" integer
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar NOT NULL,
	"email" varchar NOT NULL,
	"phone" varchar,
	"company" varchar,
	"role" varchar,
	"industry" varchar,
	"team_size" "enum_leads_team_size",
	"timeline" "enum_leads_timeline",
	"problem" varchar,
	"email_type" "enum_leads_email_type",
	"source" "enum_leads_source" NOT NULL,
	"source_path" varchar,
	"status" "enum_leads_status" DEFAULT 'new',
	"booked_slot" varchar,
	"notes" varchar,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prospects" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" varchar NOT NULL,
	"title" varchar,
	"company" varchar,
	"vertical" "enum_prospects_vertical",
	"location" varchar,
	"degree" varchar,
	"mutuals" varchar,
	"niche" varchar,
	"hook" varchar,
	"profile_url" varchar,
	"fit_score" numeric,
	"fit_reason" varchar,
	"status" "enum_prospects_status" DEFAULT 'qualified',
	"source" varchar,
	"recon" jsonb,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outreach" (
	"id" serial PRIMARY KEY NOT NULL,
	"prospect_id" integer NOT NULL,
	"step" "enum_outreach_step" DEFAULT 'connection' NOT NULL,
	"body" varchar NOT NULL,
	"status" "enum_outreach_status" DEFAULT 'draft',
	"deny_reason" varchar,
	"approved_at" timestamp(3) with time zone,
	"sent_at" timestamp(3) with time zone,
	"updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp(3) with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_locked_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_media_fk" FOREIGN KEY ("media_id") REFERENCES "public"."media"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_pages_fk" FOREIGN KEY ("pages_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_leads_fk" FOREIGN KEY ("leads_id") REFERENCES "public"."leads"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_prospects_fk" FOREIGN KEY ("prospects_id") REFERENCES "public"."prospects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payload_locked_documents_rels" ADD CONSTRAINT "payload_locked_documents_rels_outreach_fk" FOREIGN KEY ("outreach_id") REFERENCES "public"."outreach"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users_sessions" ADD CONSTRAINT "users_sessions_parent_id_fk" FOREIGN KEY ("_parent_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_parent_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."payload_preferences"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payload_preferences_rels" ADD CONSTRAINT "payload_preferences_rels_users_fk" FOREIGN KEY ("users_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outreach" ADD CONSTRAINT "outreach_prospect_id_prospects_id_fk" FOREIGN KEY ("prospect_id") REFERENCES "public"."prospects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payload_locked_documents_created_at_idx" ON "payload_locked_documents" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_global_slug_idx" ON "payload_locked_documents" USING btree ("global_slug" text_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_updated_at_idx" ON "payload_locked_documents" USING btree ("updated_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "pages_created_at_idx" ON "pages" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "pages_slug_idx" ON "pages" USING btree ("slug" text_ops);--> statement-breakpoint
CREATE INDEX "pages_updated_at_idx" ON "pages" USING btree ("updated_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "payload_preferences_created_at_idx" ON "payload_preferences" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "payload_preferences_key_idx" ON "payload_preferences" USING btree ("key" text_ops);--> statement-breakpoint
CREATE INDEX "payload_preferences_updated_at_idx" ON "payload_preferences" USING btree ("updated_at" timestamptz_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "payload_kv_key_idx" ON "payload_kv" USING btree ("key" text_ops);--> statement-breakpoint
CREATE INDEX "media_created_at_idx" ON "media" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "media_filename_idx" ON "media" USING btree ("filename" text_ops);--> statement-breakpoint
CREATE INDEX "media_updated_at_idx" ON "media" USING btree ("updated_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_rels_leads_id_idx" ON "payload_locked_documents_rels" USING btree ("leads_id" int4_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_rels_media_id_idx" ON "payload_locked_documents_rels" USING btree ("media_id" int4_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_rels_order_idx" ON "payload_locked_documents_rels" USING btree ("order" int4_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_rels_outreach_id_idx" ON "payload_locked_documents_rels" USING btree ("outreach_id" int4_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_rels_pages_id_idx" ON "payload_locked_documents_rels" USING btree ("pages_id" int4_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_rels_parent_idx" ON "payload_locked_documents_rels" USING btree ("parent_id" int4_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_rels_path_idx" ON "payload_locked_documents_rels" USING btree ("path" text_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_rels_prospects_id_idx" ON "payload_locked_documents_rels" USING btree ("prospects_id" int4_ops);--> statement-breakpoint
CREATE INDEX "payload_locked_documents_rels_users_id_idx" ON "payload_locked_documents_rels" USING btree ("users_id" int4_ops);--> statement-breakpoint
CREATE INDEX "users_created_at_idx" ON "users" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "users" USING btree ("email" text_ops);--> statement-breakpoint
CREATE INDEX "users_updated_at_idx" ON "users" USING btree ("updated_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "payload_migrations_created_at_idx" ON "payload_migrations" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "payload_migrations_updated_at_idx" ON "payload_migrations" USING btree ("updated_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "users_sessions_order_idx" ON "users_sessions" USING btree ("_order" int4_ops);--> statement-breakpoint
CREATE INDEX "users_sessions_parent_id_idx" ON "users_sessions" USING btree ("_parent_id" int4_ops);--> statement-breakpoint
CREATE INDEX "payload_preferences_rels_order_idx" ON "payload_preferences_rels" USING btree ("order" int4_ops);--> statement-breakpoint
CREATE INDEX "payload_preferences_rels_parent_idx" ON "payload_preferences_rels" USING btree ("parent_id" int4_ops);--> statement-breakpoint
CREATE INDEX "payload_preferences_rels_path_idx" ON "payload_preferences_rels" USING btree ("path" text_ops);--> statement-breakpoint
CREATE INDEX "payload_preferences_rels_users_id_idx" ON "payload_preferences_rels" USING btree ("users_id" int4_ops);--> statement-breakpoint
CREATE INDEX "leads_created_at_idx" ON "leads" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "leads_email_idx" ON "leads" USING btree ("email" text_ops);--> statement-breakpoint
CREATE INDEX "leads_updated_at_idx" ON "leads" USING btree ("updated_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "prospects_created_at_idx" ON "prospects" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "prospects_updated_at_idx" ON "prospects" USING btree ("updated_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "outreach_created_at_idx" ON "outreach" USING btree ("created_at" timestamptz_ops);--> statement-breakpoint
CREATE INDEX "outreach_prospect_idx" ON "outreach" USING btree ("prospect_id" int4_ops);--> statement-breakpoint
CREATE INDEX "outreach_updated_at_idx" ON "outreach" USING btree ("updated_at" timestamptz_ops);
*/