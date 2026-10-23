import { PrismaClient } from '@prisma/client';
import { seedDatabase } from './seedData';

const prisma = new PrismaClient();

seedDatabase(prisma)
  .then((result) => console.log(result === 'seeded'
    ? 'Seeded users, events and bookings'
    : 'Existing data found; demo initialization skipped without changing records. Demo completeness was not verified.'))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
