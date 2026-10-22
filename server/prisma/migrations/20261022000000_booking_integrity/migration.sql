-- Never resolve conflicting customer bookings or accounts by deleting data.
-- One PostgreSQL statement makes all normalization and DDL atomic. An explicit
-- BEGIN/COMMIT batch masks the original error in Prisma 5 with 25P02; the DO
-- statement instead rolls back completely while preserving the root diagnostic.
DO $$
BEGIN
  -- Keep the preflight checks, normalization, and constraint installation on the
  -- same data, even if an old application instance is still writing.
  LOCK TABLE "User", "Event", "Seat", "Booking" IN ACCESS EXCLUSIVE MODE;
  IF EXISTS (SELECT 1 FROM "Booking" WHERE "status" = 'CONFIRMED' GROUP BY "seatId" HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Multiple confirmed bookings exist for a seat. Reconcile them before retrying this migration.';
  END IF;
  IF EXISTS (SELECT 1 FROM "User" GROUP BY lower(btrim("email")) HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'Email addresses collide after normalization. Reconcile accounts before retrying this migration.';
  END IF;
  UPDATE "User" SET "email" = lower(btrim("email")) WHERE "email" <> lower(btrim("email"));
  ALTER TABLE "User" ADD CONSTRAINT "User_email_normalized" CHECK ("email" = lower(btrim("email")));
  ALTER TABLE "Event" ADD CONSTRAINT "Event_grid_bounds" CHECK ("rows" BETWEEN 1 AND 26 AND "cols" BETWEEN 1 AND 30);
  ALTER TABLE "Event" ADD CONSTRAINT "Event_price_nonnegative" CHECK ("priceCents" >= 0);
  ALTER TABLE "Seat" ADD CONSTRAINT "Seat_coordinates_bounds" CHECK ("row" BETWEEN 0 AND 25 AND "col" BETWEEN 0 AND 29);
  ALTER TABLE "Booking" ADD CONSTRAINT "Booking_cancellation_consistent" CHECK (("status" = 'CANCELLED') = ("cancelledAt" IS NOT NULL));

  CREATE UNIQUE INDEX "Booking_one_confirmed_per_seat" ON "Booking" ("seatId") WHERE "status" = 'CONFIRMED';
  CREATE INDEX "Booking_seatId_status_idx" ON "Booking" ("seatId", "status");
  CREATE INDEX "Booking_userId_createdAt_idx" ON "Booking" ("userId", "createdAt");
  CREATE INDEX "Event_startsAt_idx" ON "Event" ("startsAt");

END $$;
