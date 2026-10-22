import { HttpError } from './http';

function invalid(message: string): never { throw new HttpError(400, 'VALIDATION_ERROR', message); }

export function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid('A JSON object is required');
  return value as Record<string, unknown>;
}

export function text(value: unknown, name: string, max: number, min = 1): string {
  if (typeof value !== 'string') invalid(`${name} must be text`);
  const result = value.trim();
  if (result.length < min || result.length > max) invalid(`${name} must contain ${min}–${max} characters`);
  return result;
}

export function integer(value: unknown, name: string, min: number, max = 2147483647): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) invalid(`${name} must be an integer between ${min} and ${max}`);
  return value;
}

export function identifier(value: string): number {
  if (!/^[1-9]\d*$/.test(value)) invalid('Invalid resource ID');
  return integer(Number(value), 'ID', 1);
}

export function credentials(value: unknown, registering = false) {
  const body = objectBody(value);
  const email = text(body.email, 'Email', 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) invalid('A valid email address is required');
  // bcrypt deliberately accepts legacy inputs longer than 72 bytes on login.
  // Bound those inputs by the API's existing 32 KiB JSON budget, without trimming
  // or truncating credentials. Only new registrations enforce bcrypt's byte limit.
  const maxPasswordBytes = registering ? 72 : 32 * 1024;
  if (typeof body.password !== 'string' || body.password.length < (registering ? 12 : 1) || Buffer.byteLength(body.password, 'utf8') > maxPasswordBytes) {
    invalid(registering ? 'Password must be at least 12 characters and at most 72 UTF-8 bytes' : 'Invalid password');
  }
  return { email, password: body.password };
}

export function registration(value: unknown): { email: string; password: string; name: string; role: 'ORGANIZER' | 'ATTENDEE' } {
  const body = objectBody(value);
  const role = body.role === undefined ? 'ATTENDEE' : body.role;
  if (role !== 'ORGANIZER' && role !== 'ATTENDEE') invalid('Invalid account role');
  return { ...credentials(value, true), name: text(body.name, 'Name', 100), role };
}

export function eventInput(value: unknown, now = new Date()) {
  const body = objectBody(value);
  const date = text(body.startsAt, 'Start time', 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(date)) invalid('Start time must be an ISO timestamp with a timezone');
  const [year, month, day] = date.slice(0, 10).split('-').map(Number);
  const startsAt = new Date(date);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate() || Number(date.slice(11, 13)) > 23 || !Number.isFinite(startsAt.getTime()) || startsAt <= now) invalid('Start time must be a valid future date');
  return {
    title: text(body.title, 'Title', 200),
    description: body.description === undefined ? '' : text(body.description, 'Description', 5000, 0),
    venue: text(body.venue, 'Venue', 200), startsAt,
    rows: integer(body.rows, 'Rows', 1, 26), cols: integer(body.cols, 'Columns', 1, 30),
    priceCents: body.priceCents === undefined ? 0 : integer(body.priceCents, 'Price', 0),
  };
}
