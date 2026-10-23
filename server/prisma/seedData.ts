import { Prisma, PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { seatLabel } from '../src/utils/helpers';

function buildSeats(rows: number, cols: number) {
  const seats = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      seats.push({ row: r, col: c, label: seatLabel(r, c) });
    }
  }
  return seats;
}

function daysFromNow(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(18, 30, 0, 0);
  return d;
}

// Demo initialization is all-or-nothing. Populated databases are never repaired
// by guessing ownership or resetting credentials; that requires deliberate review.
export async function seedDatabase(prisma: PrismaClient): Promise<'seeded' | 'existing-data'> {
  const passwordHash = await bcrypt.hash('password123', 10);
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL lock_timeout = '3s'`;
    // A fresh database has no row to lock. Serialize initializers and user writes
    // before checking emptiness; READ COMMITTED sees a previous seed's commit.
    await tx.$executeRaw`LOCK TABLE "User" IN SHARE ROW EXCLUSIVE MODE`;
    if (await tx.user.findFirst({ select: { id: true } })) return 'existing-data';

    const organizer = await tx.user.create({
      data: { email: 'organizer@seatbook.test', name: 'Karim Rahman', passwordHash, role: 'ORGANIZER' },
    });
    const alice = await tx.user.create({
      data: { email: 'alice@seatbook.test', name: 'Alice Karim', passwordHash },
    });
    const bob = await tx.user.create({
      data: { email: 'bob@seatbook.test', name: 'Bob Hossain', passwordHash },
    });

    const talk = await tx.event.create({
      data: {
        title: 'Postgres in Practice',
        description: 'An evening talk on indexes, query plans and the mistakes we keep making.',
        venue: 'Banani Hall, Room 2',
        startsAt: daysFromNow(7),
        rows: 5,
        cols: 8,
        priceCents: 1500,
        organizerId: organizer.id,
        seats: { create: buildSeats(5, 8) },
      },
      include: { seats: { orderBy: [{ row: 'asc' }, { col: 'asc' }] } },
    });

    await tx.event.create({
      data: {
        title: 'Design Systems Workshop',
        description: 'Hands-on workshop. Bring a laptop.',
        venue: 'Gulshan Studio',
        startsAt: daysFromNow(14),
        rows: 4,
        cols: 6,
        priceCents: 4000,
        organizerId: organizer.id,
        seats: { create: buildSeats(4, 6) },
      },
    });

    const past = await tx.event.create({
      data: {
        title: 'Intro to TypeScript',
        description: 'Already happened. Kept for history.',
        venue: 'Banani Hall, Room 1',
        startsAt: daysFromNow(-10),
        rows: 3,
        cols: 5,
        priceCents: 0,
        organizerId: organizer.id,
        seats: { create: buildSeats(3, 5) },
      },
      include: { seats: { orderBy: [{ row: 'asc' }, { col: 'asc' }] } },
    });

    await tx.booking.create({ data: { seatId: talk.seats[0].id, userId: alice.id } });
    await tx.booking.create({ data: { seatId: talk.seats[1].id, userId: bob.id } });
    await tx.booking.create({
      data: { seatId: talk.seats[2].id, userId: bob.id, status: 'CANCELLED', cancelledAt: new Date() },
    });
    await tx.booking.create({ data: { seatId: past.seats[3].id, userId: alice.id } });

    return 'seeded';
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, maxWait: 5000, timeout: 15_000 });
}
