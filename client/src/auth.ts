import { useEffect, useState } from 'react';
import { AuthResponse, User } from './types';

const changed = 'seatbook-auth-change';

export function getUser(): User | null {
  try {
    if (!localStorage.getItem('token')) return null;
    const user: unknown = JSON.parse(localStorage.getItem('user') || 'null');
    if (!user || typeof user !== 'object') return null;
    const value = user as Partial<User>;
    if (!Number.isInteger(value.id) || typeof value.email !== 'string' || typeof value.name !== 'string' || !['ATTENDEE', 'ORGANIZER'].includes(value.role || '')) return null;
    return value as User;
  } catch { return null; }
}

export function saveSession(data: AuthResponse) {
  localStorage.setItem('token', data.token);
  localStorage.setItem('user', JSON.stringify(data.user));
  window.dispatchEvent(new Event(changed));
}

export function clearSession() {
  localStorage.removeItem('token');
  localStorage.removeItem('user');
  window.dispatchEvent(new Event(changed));
}

export function useUser() {
  const [user, setUser] = useState(getUser);
  useEffect(() => {
    const update = () => setUser(getUser());
    window.addEventListener(changed, update);
    window.addEventListener('storage', update);
    return () => { window.removeEventListener(changed, update); window.removeEventListener('storage', update); };
  }, []);
  return user;
}
