import { Router, RequestHandler } from 'express';
import prisma from '../db';
import { AuthRequest, requireRole } from '../middleware/auth';
import { formatPrice } from '../utils/helpers';
import { asyncHandler } from '../http';
import { identifier, integer, objectBody } from '../validation';
import { bookSeat, cancelBooking } from '../services/bookingService';

export default function bookingRoutes(authenticate: RequestHandler) {
  const router = Router();
  router.use(authenticate, requireRole('ATTENDEE'));
  router.post('/', asyncHandler(async (req: AuthRequest, res) => {
    const seatId = integer(objectBody(req.body).seatId, 'Seat ID', 1);
    res.status(201).json(await bookSeat(req.user!.id, seatId));
  }));

  router.get('/mine', asyncHandler(async (req: AuthRequest, res) => {
    const bookings = await prisma.booking.findMany({
      where: { userId: req.user!.id }, orderBy: { createdAt: 'desc' },
      select: {
        id: true, status: true, createdAt: true,
        seat: { select: { label: true, event: { select: { id: true, title: true, venue: true, startsAt: true, priceCents: true } } } },
      },
    });
    res.json(bookings.map((b) => ({ id: b.id, status: b.status, createdAt: b.createdAt, seat: b.seat.label, event: { ...b.seat.event, price: formatPrice(b.seat.event.priceCents) } })));
  }));

  router.post('/:id/cancel', asyncHandler(async (req: AuthRequest, res) => {
    await cancelBooking(req.user!.id, identifier(req.params.id));
    res.json({ success: true });
  }));
  return router;
}
