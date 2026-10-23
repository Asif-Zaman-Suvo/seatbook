import { Routes, Route, Navigate } from 'react-router-dom';
import { ReactNode } from 'react';
import { useUser } from './auth';
import { Role } from './types';
import Navbar from './components/Navbar';
import EventsPage from './pages/EventsPage';
import EventDetailPage from './pages/EventDetailPage';
import MyBookingsPage from './pages/MyBookingsPage';
import LoginPage from './pages/LoginPage';
import CreateEventPage from './pages/CreateEventPage';
import { HoldProvider } from './holds';
import SeatHolds from './components/SeatHolds';

function ProtectedRoute({ role, children }: { role: Role; children: ReactNode }) {
  const user = useUser();
  if (!user) return <Navigate to="/login" replace />;
  if (user.role !== role) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <HoldProvider><div className="min-h-screen">
      <Navbar />
      <main className="max-w-6xl mx-auto px-6 py-10">
        <SeatHolds />
        <Routes>
          <Route path="/" element={<EventsPage />} />
          <Route path="/events/new" element={<ProtectedRoute role="ORGANIZER"><CreateEventPage /></ProtectedRoute>} />
          <Route path="/events/:id" element={<EventDetailPage />} />
          <Route path="/my-bookings" element={<ProtectedRoute role="ATTENDEE"><MyBookingsPage /></ProtectedRoute>} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="*" element={<p>Page not found.</p>} />
        </Routes>
      </main>
      <footer className="text-center text-white/40 text-sm py-10">
        Made with 💜 by the Seatbook team · © {new Date().getFullYear()}
      </footer>
    </div></HoldProvider>
  );
}
