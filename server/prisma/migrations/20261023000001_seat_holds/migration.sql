-- One statement keeps the column, constraints and index replacement atomic.
DO $$
BEGIN
  LOCK TABLE "Booking" IN ACCESS EXCLUSIVE MODE;
  ALTER TABLE "Booking" ADD COLUMN "expiresAt" TIMESTAMP(3);
  ALTER TABLE "Booking" ADD CONSTRAINT "Booking_hold_deadline"
    CHECK ("expiresAt" IS NULL OR "expiresAt" = "createdAt" + INTERVAL '10 minutes');
  ALTER TABLE "Booking" ADD CONSTRAINT "Booking_hold_requires_deadline"
    CHECK ("status" NOT IN ('HELD', 'EXPIRED', 'RELEASED') OR "expiresAt" IS NOT NULL);

  -- Expired HELD rows are reconciled under the seat lock before inserting.
  -- Time cannot appear in an immutable index predicate. This stronger index
  -- also prevents a hold and confirmed booking coexisting via direct DB writes.
  CREATE UNIQUE INDEX "Booking_one_live_reservation_per_seat" ON "Booking" ("seatId")
    WHERE "status" IN ('HELD', 'CONFIRMED');
  DROP INDEX "Booking_one_confirmed_per_seat";
  CREATE INDEX "Booking_userId_status_expiresAt_idx" ON "Booking" ("userId", "status", "expiresAt");
END $$;
