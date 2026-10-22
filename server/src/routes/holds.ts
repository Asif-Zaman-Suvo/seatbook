import { Router, RequestHandler } from 'express';
import { AuthRequest, requireRole } from '../middleware/auth';
import { asyncHandler } from '../http';
import { identifier, integer, objectBody } from '../validation';
import { activeHolds, confirmHold, createHold, releaseHold } from '../services/holdService';

export default function holdRoutes(authenticate: RequestHandler) {
  const router = Router();
  router.use(authenticate, requireRole('ATTENDEE'));
  router.post('/', asyncHandler(async (req: AuthRequest, res) => {
    const seatId = integer(objectBody(req.body).seatId, 'Seat ID', 1);
    const { created, ...response } = await createHold(req.user!.id, seatId);
    res.status(created ? 201 : 200).json(response);
  }));
  router.get('/mine', asyncHandler(async (req: AuthRequest, res) => {
    res.json(await activeHolds(req.user!.id));
  }));
  router.post('/:id/confirm', asyncHandler(async (req: AuthRequest, res) => {
    res.json(await confirmHold(req.user!.id, identifier(req.params.id)));
  }));
  router.post('/:id/release', asyncHandler(async (req: AuthRequest, res) => {
    res.json(await releaseHold(req.user!.id, identifier(req.params.id)));
  }));
  return router;
}
