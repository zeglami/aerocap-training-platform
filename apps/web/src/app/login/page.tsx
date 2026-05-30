'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

export default function LoginPage() {
  const router = useRouter();
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [error,    setError]    = useState('');
  const [loading,  setLoading]  = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const res = await fetch('/api/auth/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password }),
      });
      const json = await res.json() as { data: { ok: boolean } | null; error: { message: string } | null };

      if (!res.ok || json.error) {
        setError(json.error?.message ?? 'Login failed');
        return;
      }
      window.location.href = '/dashboard';
    } catch {
      setError('Network error. Is the user-service running?');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-navy-950 via-navy-800 to-brand-dark">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-brand mb-4">
            <svg viewBox="0 0 24 24" fill="none" className="w-9 h-9 text-white" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">AeroCap</h1>
          <p className="text-slate-400 mt-1 text-sm">Pilot Training Portal</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-xl font-semibold text-slate-800 mb-6">Sign in to your account</h2>

          {error && (
            <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent text-sm"
                placeholder="pilot@airline.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={e => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand focus:border-transparent text-sm"
                placeholder="••••••••"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 px-4 bg-brand hover:bg-brand-dark disabled:bg-slate-300 text-white font-semibold rounded-lg transition-colors text-sm"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          {/* Demo credentials hint */}
          <div className="mt-6 p-3.5 bg-slate-50 rounded-lg border border-slate-100">
            <p className="text-xs font-semibold text-slate-500 mb-2.5">AeroCap France — demo accounts</p>
            <div className="space-y-1.5 text-xs text-slate-600">
              <div className="flex justify-between"><span className="font-mono">admin@demo.com / admin123</span><span className="text-slate-400">Éric Moreau · Admin</span></div>
              <div className="flex justify-between"><span className="font-mono">manager.fr@demo.com / manager123</span><span className="text-slate-400">Claire Fontaine · Manager FR</span></div>
              <div className="flex justify-between"><span className="font-mono">manager.global@demo.com / manager123</span><span className="text-slate-400">Nadia Larousse · Global</span></div>
              <div className="flex justify-between"><span className="font-mono">j.dubois@aerocap.fr / pilot123</span><span className="text-slate-400">Jean-Pierre Dubois · CFI</span></div>
              <div className="border-t border-slate-200 my-1.5" />
              <div className="flex justify-between"><span className="font-mono">a.martin@aerocap.fr / pilot123</span><span className="text-slate-400">Alice Martin · A320 ITR</span></div>
              <div className="flex justify-between"><span className="font-mono">r.leroy@aerocap.fr / pilot123</span><span className="text-slate-400">Robert Leroy · B737 OPC due</span></div>
              <div className="flex justify-between"><span className="font-mono">s.reyes@aerocap.fr / pilot123</span><span className="text-slate-400">Sofia Reyes · A350 upgrade</span></div>
              <div className="flex justify-between"><span className="font-mono">c.rousseau@aerocap.fr / pilot123</span><span className="text-slate-400">Camille Rousseau · Exemplary</span></div>
              <div className="flex justify-between"><span className="font-mono">p.dumont@aerocap.fr / pilot123</span><span className="text-slate-400">Pierre Dumont · FPM deficit</span></div>
              <div className="flex justify-between text-amber-600"><span className="font-mono">newpilot@demo.com / pilot123</span><span>Lucas Petit · pending</span></div>
            </div>
          </div>

          <p className="text-center text-sm text-slate-500 mt-5">
            New pilot?{' '}
            <Link href="/signup" className="text-brand font-medium hover:underline">Create an account</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
