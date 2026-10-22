export type Role = 'ORGANIZER' | 'ATTENDEE';

export interface User { id: number; email: string; name: string; role: Role; }
export interface AuthResponse { token: string; user: User; }
export interface EventSummary {
  id: number; title: string; venue: string; startsAt: string;
  price: string; priceCents: number; totalSeats: number; seatsLeft: number;
}
export interface Seat { id: number; row: number; col: number; label: string; available: boolean; }
export interface EventDetail {
  id: number; title: string; description: string; venue: string; startsAt: string;
  price: string; priceCents: number; rows: number; cols: number;
  organizer: { id: number; name: string }; seats: Seat[];
}
export interface Booking {
  id: number; status: 'CONFIRMED' | 'CANCELLED'; createdAt: string; seat: string;
  event: { id: number; title: string; venue: string; startsAt: string; price: string; priceCents: number };
}
