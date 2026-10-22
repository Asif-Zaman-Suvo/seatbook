import { useState, FormEvent } from 'react';
import GradientButton from '../components/GradientButton';
import { useNavigate } from 'react-router-dom';
import { api, errorMessage } from '../api';
import { saveSession } from '../auth';
import { AuthResponse, Role } from '../types';

export default function LoginPage() {
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [role, setRole] = useState<Role>('ATTENDEE');
  const [pending, setPending] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (pending) return;
    setPending(true);
    try {
      const data = await api<AuthResponse>(`/auth/${isLogin ? 'login' : 'register'}`, {
        method: 'POST', body: JSON.stringify(isLogin ? { email, password } : { email, password, name, role }),
      });
      saveSession(data);
      navigate('/');
    } catch (error) { setError(errorMessage(error)); }
    finally { setPending(false); }
  };

  return (
    <div className="flex justify-center py-10">
      <div className="glass rounded-3xl p-10 w-[440px] glow">
        <div className="text-center mb-8">
          <div className="text-6xl animate-float">🎟️</div>
          <h1 className="mt-4 text-4xl font-extrabold">
            {isLogin ? 'Welcome ' : 'Join '}
            <span className="gradient-text">{isLogin ? 'Back!' : 'Seatbook!'}</span>
          </h1>
          <p className="mt-2 text-white/50">
            {isLogin ? 'Sign in to continue your journey ✨' : 'Start booking amazing events today 🚀'}
          </p>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          {!isLogin && (
            <input
              placeholder="👤 Full name"
              aria-label="Full name" required maxLength={100}
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full px-5 py-4 rounded-2xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-[#a855f7] transition-all duration-300"
            />
          )}
          <input
            placeholder="📧 Email address"
            aria-label="Email address" type="email" required maxLength={254} autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-5 py-4 rounded-2xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-[#a855f7] transition-all duration-300"
          />
          <input
            type="password"
            aria-label="Password" required minLength={isLogin ? 1 : 12} maxLength={isLogin ? 32768 : 72} autoComplete={isLogin ? 'current-password' : 'new-password'}
            placeholder="🔒 Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-5 py-4 rounded-2xl bg-white/5 border border-white/10 text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-[#a855f7] transition-all duration-300"
          />
          {!isLogin && <label className="block text-sm">Account type
            <select value={role} onChange={(e) => setRole(e.target.value as Role)} className="block w-full mt-2 p-3 rounded-xl bg-[#302b63]">
              <option value="ATTENDEE">Attendee — book seats</option>
              <option value="ORGANIZER">Organizer — create events</option>
            </select>
          </label>}
          {!isLogin && <p className="text-sm text-white/60">Use at least 12 characters and at most 72 UTF-8 bytes for your password.</p>}
          {error && <p role="alert" className="text-[#fca5a5] text-sm">⚠️ {error}</p>}
          <GradientButton type="submit" disabled={pending}>{pending ? 'Please wait…' : isLogin ? 'Sign In 🚀' : 'Create Account ✨'}</GradientButton>
        </form>
        <p className="mt-6 text-center text-white/50">
          {isLogin ? "Don't have an account? " : 'Already have an account? '}
          <button disabled={pending} onClick={() => { setIsLogin(!isLogin); setError(''); }} className="text-[#a855f7] cursor-pointer hover:underline">
            {isLogin ? 'Sign up' : 'Sign in'}
          </button>
        </p>
      </div>
    </div>
  );
}
