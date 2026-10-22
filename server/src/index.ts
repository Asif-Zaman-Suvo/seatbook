import { createApp } from './app';
import { loadConfig } from './config';
import prisma from './db';

const config = loadConfig();
const server = createApp(config).listen(config.port, () => {
  console.log(`Seatbook API running on http://localhost:${config.port}`);
});

function shutdown() {
  server.close(() => { prisma.$disconnect().finally(() => process.exit(0)); });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);
