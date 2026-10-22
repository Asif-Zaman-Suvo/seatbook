-- PostgreSQL must commit new enum values before a later migration uses them.
ALTER TYPE "BookingStatus" ADD VALUE 'HELD';
ALTER TYPE "BookingStatus" ADD VALUE 'EXPIRED';
ALTER TYPE "BookingStatus" ADD VALUE 'RELEASED';
