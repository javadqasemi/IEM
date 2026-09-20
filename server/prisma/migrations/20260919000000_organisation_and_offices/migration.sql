-- The firm becomes an entity, and Office stops being a stub.
--
-- Two things here are hand-written rather than generated, and both are about
-- not losing what is already in the column.
--
--   1. `address` is RENAMED to `street`, not dropped and re-added. Prisma's own
--      diff proposed the drop, which would have silently emptied both existing
--      offices — the warning it printed ("still contains 2 non-null values") is
--      the whole reason this file is written out.
--   2. `kind` and `position` are backfilled from `isHeadquarters`, so the two
--      seeded rows come out of the migration already correct rather than
--      waiting for a re-seed.

-- CreateEnum
CREATE TYPE "OrganisationStatus" AS ENUM ('ACTIVE', 'DORMANT', 'LIQUIDATION');

-- AlterTable: Office
ALTER TABLE "Office" RENAME COLUMN "address" TO "street";

ALTER TABLE "Office"
    ADD COLUMN "archivedAt"   TIMESTAMP(3),
    ADD COLUMN "canton"       TEXT,
    ADD COLUMN "country"      TEXT NOT NULL DEFAULT 'CH',
    ADD COLUMN "email"        TEXT,
    ADD COLUMN "isPublic"     BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "kind"         TEXT NOT NULL DEFAULT 'Zweigbüro',
    ADD COLUMN "latitude"     DOUBLE PRECISION,
    ADD COLUMN "longitude"    DOUBLE PRECISION,
    ADD COLUMN "mapsUrl"      TEXT,
    ADD COLUMN "openingHours" TEXT,
    ADD COLUMN "position"     INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "updatedById"  TEXT,
    ADD COLUMN "version"      INTEGER NOT NULL DEFAULT 1;

-- Backfill: the headquarters says so, and sorts first.
UPDATE "Office" SET "kind" = 'Hauptsitz', "position" = 0 WHERE "isHeadquarters" = true;
UPDATE "Office" SET "position" = 1 WHERE "isHeadquarters" = false;

-- CreateTable
CREATE TABLE "Organisation" (
    "id" TEXT NOT NULL DEFAULT 'org',
    "name" TEXT NOT NULL DEFAULT 'IEM AG',
    "shortName" TEXT NOT NULL DEFAULT 'IEM',
    "description" TEXT,
    "foundedYear" INTEGER,
    "organisationType" TEXT NOT NULL DEFAULT 'Aktiengesellschaft',
    "defaultLocale" TEXT NOT NULL DEFAULT 'de-CH',
    "defaultTimezone" TEXT NOT NULL DEFAULT 'Europe/Zurich',
    "defaultCurrency" TEXT NOT NULL DEFAULT 'CHF',
    "status" "OrganisationStatus" NOT NULL DEFAULT 'ACTIVE',
    "legalName" TEXT,
    "legalForm" TEXT,
    "uid" TEXT,
    "vatId" TEXT,
    "commercialRegister" TEXT,
    "registerOffice" TEXT,
    "legalStreet" TEXT,
    "legalZip" TEXT,
    "legalCity" TEXT,
    "legalCountry" TEXT NOT NULL DEFAULT 'CH',
    "invoiceAddress" TEXT,
    "legalContactName" TEXT,
    "legalContactEmail" TEXT,
    "dataProtectionContactName" TEXT,
    "dataProtectionContactEmail" TEXT,
    "copyright" TEXT,
    "legalNotice" TEXT,
    "mainEmail" TEXT,
    "mainPhone" TEXT,
    "recruitmentEmail" TEXT,
    "supportEmail" TEXT,
    "billingEmail" TEXT,
    "website" TEXT,
    "seoTitlePattern" TEXT,
    "seoDescription" TEXT,
    "ogImageUrl" TEXT,
    "faviconUrl" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organisation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Office_deletedAt_idx" ON "Office"("deletedAt");

-- CreateIndex
CREATE INDEX "Office_isPublic_position_idx" ON "Office"("isPublic", "position");

-- AddForeignKey
ALTER TABLE "Organisation" ADD CONSTRAINT "Organisation_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Office" ADD CONSTRAINT "Office_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- The `offices` content type is retired: the published document now derives its
-- offices from the table above. The rows go with it, and the entries first —
-- there is no foreign key, so order is a courtesy rather than a constraint.
DELETE FROM "ContentEntry" WHERE "typeKey" = 'offices';
DELETE FROM "ContentType"  WHERE "key" = 'offices';

-- Nine settings rows that are now columns on Organisation. `company.name` is
-- among them: MailService reads the organisation instead.
DELETE FROM "Setting" WHERE "key" IN (
    'company.name',
    'company.legalName',
    'company.email',
    'company.website',
    'brand.logoUrl',
    'brand.faviconUrl',
    'brand.primaryColor',
    'site.baseUrl',
    'site.defaultLocale'
);
