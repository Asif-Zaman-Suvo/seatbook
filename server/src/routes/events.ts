import { Router, RequestHandler } from 'express';
import prisma from '../db';
import { AuthRequest, requireRole } from '../middleware/auth';
import { getEventWithSeats, listEvents } from '../services/eventService';
import { formatPrice, isSeatBookable, seatLabel } from '../utils/helpers';
import { asyncHandler, HttpError } from '../http';
import { eventInput, identifier } from '../validation';

export default function eventRoutes(authenticate: RequestHandler) {
  const router = Router();
  router.get('/', asyncHandler(async (_req, res) => { res.json(await listEvents()); }));

  router.get('/:id', asyncHandler(async (req, res) => {
    const event = await getEventWithSeats(identifier(req.params.id));
    if (!event) throw new HttpError(404, 'EVENT_NOT_FOUND', 'Event not found');
    const now = new Date();
    res.json({
      id: event.id, title: event.title, description: event.description, venue: event.venue,
      startsAt: event.startsAt, priceCents: event.priceCents, price: formatPrice(event.priceCents),
      rows: event.rows, cols: event.cols, organizer: event.organizer,
      seats: event.seats.map((seat) => ({ id: seat.id, row: seat.row, col: seat.col, label: seat.label, available: isSeatBookable(seat, event, now) })),
    });
  }));

  router.post('/', authenticate, requireRole('ORGANIZER'), asyncHandler(async (req: AuthRequest, res) => {
    const input = eventInput(req.body);
    const seats = [];
    for (let row = 0; row < input.rows; row++) {
      for (let col = 0; col < input.cols; col++) seats.push({ row, col, label: seatLabel(row, col) });
    }
    // A Prisma nested write creates the event and full grid atomically.
    const event = await prisma.event.create({ data: { ...input, organizerId: req.user!.id, seats: { create: seats } } });
    res.status(201).json(event);
  }));
  return router;
}
