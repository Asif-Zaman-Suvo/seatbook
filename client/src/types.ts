export type Role = 'ORGANIZER' | 'ATTENDEE';

export interface User { id: number; email: string; name: string; role: Role; }
export interface AuthResponse { token: string; user: User; }
export interface EventSummary {
  id: number; title: string; venue: string; startsAt: string;
  price: string; priceCents: number; totalSeats: number; seatsLeft: number; serverTime: string;
}
export type SeatStatus = 'AVAILABLE' | 'HELD' | 'BOOKED' | 'CLOSED';
export interface Seat { id: number; row: number; col: number; label: string; available: boolean; status: SeatStatus; holdExpiresAt: string | null; }
export interface EventDetail {
  id: number; title: string; description: string; venue: string; startsAt: string;
  price: string; priceCents: number; rows: number; cols: number;
  organizer: { id: number; name: string }; seats: Seat[]; serverTime: string;
}

export interface Hold {
  id: number; seatId: number; status: 'HELD' | 'CONFIRMED' | 'RELEASED' | 'EXPIRED' | 'CANCELLED';
  createdAt: string; expiresAt: string;
}
export interface ActiveHold extends Hold {
  seat: { id: number; label: string; row: number; col: number;
    event: { id: number; title: string; venue: string; startsAt: string } };
}
export interface HoldResponse { hold: Hold; serverTime: string; }
export interface HoldsResponse { holds: ActiveHold[]; serverTime: string; }
export interface ConfirmHoldResponse extends HoldResponse { booking: { id: number; status: 'CONFIRMED' }; }
export interface Booking {
  id: number; status: 'CONFIRMED' | 'CANCELLED'; createdAt: string; seat: string;
  event: { id: number; title: string; venue: string; startsAt: string; price: string; priceCents: number };
}
