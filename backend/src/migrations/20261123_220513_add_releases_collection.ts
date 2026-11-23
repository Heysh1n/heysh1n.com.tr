import { MigrateDownArgs, MigrateUpArgs, sql } from '@payloadcms/db-postgres'

export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    DO $$ BEGIN
      CREATE TYPE "public"."enum_releases_product" AS ENUM('sfc-pro', 'sfcp-vscode');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;

    DO $$ BEGIN
      CREATE TYPE "public"."enum_releases_target" AS ENUM(
        'linux-x86_64',
        'linux-aarch64',
        'windows-x86_64',
        'windows-aarch64',
        'macos-arm64',
        'macos-x86_64',
        'darwin-arm64',
        'darwin-x86_64',
        'vscode',
        'custom'
      );
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;

    DO $$ BEGIN
      CREATE TYPE "public"."enum_releases_channel" AS ENUM('stable', 'beta', 'nightly');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;

    DO $$ BEGIN
      CREATE TYPE "public"."enum_releases_status" AS ENUM('published', 'draft', 'archived');
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;

    CREATE TABLE IF NOT EXISTS "releases" (
      "id" serial PRIMARY KEY NOT NULL,
      "release_label" varchar,
      "product" "public"."enum_releases_product" DEFAULT 'sfc-pro' NOT NULL,
      "version" varchar NOT NULL,
      "target" "public"."enum_releases_target" DEFAULT 'linux-x86_64' NOT NULL,
      "custom_target" varchar,
      "download_url" varchar,
      "sha256" varchar,
      "notes" varchar,
      "channel" "public"."enum_releases_channel" DEFAULT 'stable' NOT NULL,
      "status" "public"."enum_releases_status" DEFAULT 'published' NOT NULL,
      "is_current" boolean DEFAULT false,
      "published_at" timestamp(3) with time zone,
      "updated_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "created_at" timestamp(3) with time zone DEFAULT now() NOT NULL,
      "url" varchar,
      "thumbnail_u_r_l" varchar,
      "filename" varchar,
      "mime_type" varchar,
      "filesize" numeric,
      "width" numeric,
      "height" numeric
    );

    CREATE INDEX IF NOT EXISTS "releases_product_idx" ON "releases" USING btree ("product");
    CREATE INDEX IF NOT EXISTS "releases_version_idx" ON "releases" USING btree ("version");
    CREATE INDEX IF NOT EXISTS "releases_target_idx" ON "releases" USING btree ("target");
    CREATE INDEX IF NOT EXISTS "releases_channel_idx" ON "releases" USING btree ("channel");
    CREATE INDEX IF NOT EXISTS "releases_status_idx" ON "releases" USING btree ("status");
    CREATE INDEX IF NOT EXISTS "releases_updated_at_idx" ON "releases" USING btree ("updated_at");
    CREATE INDEX IF NOT EXISTS "releases_created_at_idx" ON "releases" USING btree ("created_at");
    CREATE UNIQUE INDEX IF NOT EXISTS "releases_filename_idx" ON "releases" USING btree ("filename");

    ALTER TABLE "payload_locked_documents_rels"
      ADD COLUMN IF NOT EXISTS "releases_id" integer;

    DO $$ BEGIN
      ALTER TABLE "payload_locked_documents_rels"
        ADD CONSTRAINT "payload_locked_documents_rels_releases_fk"
        FOREIGN KEY ("releases_id")
        REFERENCES "public"."releases"("id")
        ON DELETE cascade
        ON UPDATE no action;
    EXCEPTION
      WHEN duplicate_object THEN NULL;
    END $$;

    CREATE INDEX IF NOT EXISTS "payload_locked_documents_rels_releases_id_idx"
      ON "payload_locked_documents_rels" USING btree ("releases_id");
  `)
}

export async function down({ db }: MigrateDownArgs): Promise<void> {
  await db.execute(sql`
    ALTER TABLE "payload_locked_documents_rels"
      DROP CONSTRAINT IF EXISTS "payload_locked_documents_rels_releases_fk";

    DROP INDEX IF EXISTS "payload_locked_documents_rels_releases_id_idx";

    ALTER TABLE "payload_locked_documents_rels"
      DROP COLUMN IF EXISTS "releases_id";

    DROP TABLE IF EXISTS "releases" CASCADE;

    DROP TYPE IF EXISTS "public"."enum_releases_product";
    DROP TYPE IF EXISTS "public"."enum_releases_target";
    DROP TYPE IF EXISTS "public"."enum_releases_channel";
    DROP TYPE IF EXISTS "public"."enum_releases_status";
  `)
}
