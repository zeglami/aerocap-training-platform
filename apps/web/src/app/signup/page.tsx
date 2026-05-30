'use client';

import { useState, useEffect, FormEvent } from 'react';
import Link from 'next/link';

interface Country { tenantId: string; name: string; region: string }
interface ApiResponse<T> { data: T | null; error: { message: string } | null }

const REGION_FLAG: Record<string, string> = { FR: '🇫🇷', ZA: '🇿🇦', CN: '🇨🇳', IN: '🇮🇳' };

export default function SignupPage() {
  const [countries,  setCountries]  = useState<Country[]>([]);
  const [firstName,  setFirstName]  = useState('');
  const [lastName,   setLastName]   = useState('');
  const [email,      setEmail]      = useState('');
  const [password,   setPassword]   = useState('');
  const [tenantId,   setTenantId]   = useState('');
  const [error,      setError]      = useState('');
  const [loading,    setLoading]    = useState(false);

  useEffect(() => {
    fetch('/api/auth/signup')
      .then(r => r.json() as Promise<ApiResponse<Country[]>>)
      .then(d => {
        const list = d.data ?? [];
        setCountries(list);
        if (list.length === 1) setTenantId(list[0].tenantId);
      })
      .catch(() => {});
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await fetch('/api/auth/signup', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ firstName, lastName, email, password, tenantId }),
      });
      const json = await res.json() as ApiResponse<{ ok: boolean }>;
      if (!res.ok || json.error) { setError(json.error?.message ?? 'Signup failed'); return; }
      window.location.href = '/dashboard';
    } catch {
      setError('Network error. Is the service running?');
    } finally {
      setLoading(false);
    }
  }

  const selectedCountry = countries.find(c => c.tenantId === tenantId);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-navy-950 via-navy-800 to-brand-dark py-10">
      <div className="w-full max-w-md px-4">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand mb-4">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-8 h-8 text-white">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Create your account</h1>
          <p className="text-slate-400 mt-1 text-sm">AeroCap Pilot Training Portal</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          {error && (
            <div className="mb-5 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Name row */}
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">First name</label>
                <input
                  type="text" required value={firstName} onChange={e => setFirstName(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand text-sm"
                  placeholder="Alice"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Last name</label>
                <input
                  type="text" required value={lastName} onChange={e => setLastName(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand text-sm"
                  placeholder="Martin"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
              <input
                type="email" required value={email} onChange={e => setEmail(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand text-sm"
                placeholder="you@airline.com"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <input
                type="password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand text-sm"
                placeholder="Minimum 8 characters"
              />
            </div>

            {/* Country picker — card grid */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Training country</label>
              <p className="text-xs text-slate-400 mb-2">Select the AeroCap facility where you will train</p>
              {countries.length === 0 ? (
                <div className="text-sm text-slate-400 py-3 text-center">Loading countries…</div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {countries.map(c => {
                    const selected = tenantId === c.tenantId;
                    return (
                      <button
                        key={c.tenantId}
                        type="button"
                        onClick={() => setTenantId(c.tenantId)}
                        className={`flex items-center gap-2.5 px-3 py-3 rounded-xl border-2 text-left transition-all ${
                          selected
                            ? 'border-brand bg-brand/5 text-slate-900'
                            : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                        }`}
                      >
                        <span className="text-xl leading-none">{REGION_FLAG[c.region] ?? '🌍'}</span>
                        <div>
                          <p className="text-sm font-medium leading-tight">{c.name}</p>
                          <p className="text-xs text-slate-400">{c.region}</p>
                        </div>
                        {selected && (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-4 h-4 text-brand ml-auto flex-shrink-0">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                          </svg>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              {/* Hidden input to satisfy form validation */}
              <input type="text" required value={tenantId} onChange={() => {}} className="sr-only" tabIndex={-1} />
            </div>

            <button
              type="submit" disabled={loading || !tenantId}
              className="w-full py-2.5 bg-brand hover:bg-brand-dark disabled:bg-slate-300 text-white font-semibold rounded-lg transition-colors text-sm mt-2"
            >
              {loading ? 'Creating account…' : `Create account${selectedCountry ? ` — ${selectedCountry.name}` : ''}`}
            </button>
          </form>

          <div className="mt-5 p-3.5 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-xs font-semibold text-amber-700 mb-1">After registration</p>
            <p className="text-xs text-amber-600">
              You can immediately view your profile and CBTA progress.
              Simulator booking is enabled once your training manager approves your account.
            </p>
          </div>

          <p className="text-center text-sm text-slate-500 mt-5">
            Already have an account?{' '}
            <Link href="/login" className="text-brand font-medium hover:underline">Sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
