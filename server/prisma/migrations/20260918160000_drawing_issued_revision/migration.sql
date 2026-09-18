-- `Drawing.issuedRevision` — what is out there, beside `currentRevision`, which
-- is what the office is drawing. See the field's comment in `schema.prisma`.

ALTER TABLE "Drawing" ADD COLUMN "issuedRevision" TEXT;

-- Backfill from the Planversände that already exist, because the fact was never
-- lost — it was only unreachable from the row. Every drawing that appears in a
-- `TransmittalItem` gets the newest of its revisions that was actually sent.
--
-- Ordered by `createdAt` rather than by the revision label, deliberately: the
-- label is bijective base-26 (`Z` then `AA`), so a text `ORDER BY` puts `AA`
-- before `B` and would backfill the *wrong* letter on any plan past `Z`.
-- Revisions are append-only and created in order, so their creation time is the
-- same ordering without having to express base-26 in SQL.
UPDATE "Drawing" d
SET "issuedRevision" = newest."revision"
FROM (
  SELECT DISTINCT ON (r."drawingId") r."drawingId", r."revision"
  FROM "DrawingRevision" r
  WHERE EXISTS (
    SELECT 1 FROM "TransmittalItem" i WHERE i."drawingRevisionId" = r."id"
  )
  ORDER BY r."drawingId", r."createdAt" DESC
) AS newest
WHERE d."id" = newest."drawingId";
