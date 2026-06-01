'use client';

import { useState, useEffect, FormEvent } from 'react';
import Link from 'next/link';

interface Country { tenantId: string; name: string; region: string }
interface ApiResponse<T> { data: T | null; error: { message: string } | null }

type Step = 'type' | 'individual' | 'partner' | 'partner-success';
type AccountType = 'individual' | 'partner';

const REGION_FLAG: Record<string, string> = { FR: '🇫🇷', ZA: '🇿🇦', CN: '🇨🇳', IN: '🇮🇳' };

const PARTNER_TYPES = [
  { value: 'AIRLINE',           label: 'Airline' },
  { value: 'MILITARY',          label: 'Military' },
  { value: 'TRAINING_ACADEMY',  label: 'Training Academy' },
  { value: 'CORPORATE',         label: 'Corporate Aviation' },
  { value: 'CHARTER',           label: 'Charter Operator' },
];

// ─── Shared layout wrapper ────────────────────────────────────────────────────

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-navy-950 via-navy-800 to-brand-dark py-10 px-4">
      <div className="w-full max-w-lg">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-brand mb-4">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-8 h-8 text-white">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
            </svg>
          </div>
          <h1 className="text-2xl font-bold text-white tracking-tight">AeroCap</h1>
          <p className="text-slate-400 mt-1 text-sm">Pilot Training Portal</p>
        </div>
        {children}
      </div>
    </div>
  );
}

// ─── Step 1: Account type selector ───────────────────────────────────────────

function TypeSelector({ onSelect }: { onSelect: (t: AccountType) => void }) {
  const [hovered, setHovered] = useState<AccountType | null>(null);

  return (
    <Shell>
      <div className="bg-white rounded-2xl shadow-2xl p-8">
        <h2 className="text-xl font-semibold text-slate-800 text-center mb-1">Create your account</h2>
        <p className="text-sm text-slate-400 text-center mb-7">Choose the account type that fits your role</p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Individual */}
          <button
            type="button"
            onClick={() => onSelect('individual')}
            onMouseEnter={() => setHovered('individual')}
            onMouseLeave={() => setHovered(null)}
            className={`group relative flex flex-col items-start gap-4 rounded-2xl border-2 p-6 text-left transition-all duration-150 ${
              hovered === 'individual'
                ? 'border-brand bg-brand/5 shadow-md'
                : 'border-slate-200 hover:border-brand/40'
            }`}
          >
            {/* Icon */}
            <div className={`flex items-center justify-center w-12 h-12 rounded-xl transition-colors ${
              hovered === 'individual' ? 'bg-brand text-white' : 'bg-slate-100 text-slate-500'
            }`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-6 h-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
              </svg>
            </div>

            <div>
              <p className="font-semibold text-slate-900 text-base">Individual Pilot</p>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Self-register as a pilot. Access CBTA progress, licences, and simulator booking once approved.
              </p>
            </div>

            <ul className="space-y-1.5 mt-auto w-full">
              {['Free self-registration', 'Training country selection', 'Manager approval for booking'].map(f => (
                <li key={f} className="flex items-center gap-2 text-xs text-slate-500">
                  <svg viewBox="0 0 16 16" fill="currentColor" className={`w-3.5 h-3.5 flex-shrink-0 ${hovered === 'individual' ? 'text-brand' : 'text-slate-300'}`}>
                    <path d="M12.78 4.22a.75.75 0 0 1 0 1.06l-5.5 5.5a.75.75 0 0 1-1.06 0l-2.5-2.5a.75.75 0 0 1 1.06-1.06l1.97 1.97 4.97-4.97a.75.75 0 0 1 1.06 0Z"/>
                  </svg>
                  {f}
                </li>
              ))}
            </ul>

            <div className={`absolute bottom-4 right-4 transition-opacity ${hovered === 'individual' ? 'opacity-100' : 'opacity-0'}`}>
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-brand">
                <path fillRule="evenodd" d="M3 10a.75.75 0 0 1 .75-.75h10.638L10.23 5.29a.75.75 0 1 1 1.04-1.08l5.5 5.25a.75.75 0 0 1 0 1.08l-5.5 5.25a.75.75 0 1 1-1.04-1.08l4.158-3.96H3.75A.75.75 0 0 1 3 10Z" clipRule="evenodd"/>
              </svg>
            </div>
          </button>

          {/* Partner */}
          <button
            type="button"
            onClick={() => onSelect('partner')}
            onMouseEnter={() => setHovered('partner')}
            onMouseLeave={() => setHovered(null)}
            className={`group relative flex flex-col items-start gap-4 rounded-2xl border-2 p-6 text-left transition-all duration-150 ${
              hovered === 'partner'
                ? 'border-emerald-500 bg-emerald-50 shadow-md'
                : 'border-slate-200 hover:border-emerald-300'
            }`}
          >
            <div className={`flex items-center justify-center w-12 h-12 rounded-xl transition-colors ${
              hovered === 'partner' ? 'bg-emerald-500 text-white' : 'bg-slate-100 text-slate-500'
            }`}>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className="w-6 h-6">
                <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 21h16.5M4.5 3h15M5.25 3v18m13.5-18v18M9 6.75h1.5m-1.5 3h1.5m-1.5 3h1.5m3-6H15m-1.5 3H15m-1.5 3H15M9 21v-3.375c0-.621.504-1.125 1.125-1.125h3.75c.621 0 1.125.504 1.125 1.125V21" />
              </svg>
            </div>

            <div>
              <div className="flex items-center gap-2">
                <p className="font-semibold text-slate-900 text-base">Partner Organisation</p>
                <span className="text-xs font-medium bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">B2B</span>
              </div>
              <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                Airlines, military operators, training academies and corporate flight departments.
              </p>
            </div>

            <ul className="space-y-1.5 mt-auto w-full">
              {['Manage your pilot fleet', 'Authorize booking access', 'Dedicated partner dashboard'].map(f => (
                <li key={f} className="flex items-center gap-2 text-xs text-slate-500">
                  <svg viewBox="0 0 16 16" fill="currentColor" className={`w-3.5 h-3.5 flex-shrink-0 ${hovered === 'partner' ? 'text-emerald-500' : 'text-slate-300'}`}>
                    <path d="M12.78 4.22a.75.75 0 0 1 0 1.06l-5.5 5.5a.75.75 0 0 1-1.06 0l-2.5-2.5a.75.75 0 0 1 1.06-1.06l1.97 1.97 4.97-4.97a.75.75 0 0 1 1.06 0Z"/>
                  </svg>
                  {f}
                </li>
              ))}
            </ul>

            <div className={`absolute bottom-4 right-4 transition-opacity ${hovered === 'partner' ? 'opacity-100' : 'opacity-0'}`}>
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-emerald-500">
                <path fillRule="evenodd" d="M3 10a.75.75 0 0 1 .75-.75h10.638L10.23 5.29a.75.75 0 1 1 1.04-1.08l5.5 5.25a.75.75 0 0 1 0 1.08l-5.5 5.25a.75.75 0 1 1-1.04-1.08l4.158-3.96H3.75A.75.75 0 0 1 3 10Z" clipRule="evenodd"/>
              </svg>
            </div>
          </button>
        </div>

        <p className="text-center text-sm text-slate-400 mt-6">
          Already have an account?{' '}
          <Link href="/login" className="text-brand font-medium hover:underline">Sign in</Link>
        </p>
      </div>
    </Shell>
  );
}

// ─── Step 2a: Individual pilot form ──────────────────────────────────────────

function IndividualForm({ onBack }: { onBack: () => void }) {
  const [countries, setCountries] = useState<Country[]>([]);
  const [firstName, setFirstName] = useState('');
  const [lastName,  setLastName]  = useState('');
  const [email,     setEmail]     = useState('');
  const [password,  setPassword]  = useState('');
  const [tenantId,  setTenantId]  = useState('');
  const [error,     setError]     = useState('');
  const [loading,   setLoading]   = useState(false);

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
    setError(''); setLoading(true);
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
    <Shell>
      <div className="bg-white rounded-2xl shadow-2xl p-8">
        {/* Back + title */}
        <div className="flex items-center gap-3 mb-6">
          <button type="button" onClick={onBack}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path fillRule="evenodd" d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z" clipRule="evenodd"/>
            </svg>
          </button>
          <div>
            <h2 className="text-lg font-semibold text-slate-800">Individual pilot registration</h2>
            <p className="text-xs text-slate-400">Create your personal training account</p>
          </div>
        </div>

        {error && (
          <div className="mb-5 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">First name</label>
              <input type="text" required value={firstName} onChange={e => setFirstName(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand text-sm" placeholder="Alice" />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Last name</label>
              <input type="text" required value={lastName} onChange={e => setLastName(e.target.value)}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand text-sm" placeholder="Martin" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand text-sm" placeholder="you@airline.com" />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
            <input type="password" required minLength={8} value={password} onChange={e => setPassword(e.target.value)}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-brand text-sm" placeholder="Minimum 8 characters" />
          </div>

          {/* Country picker */}
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Training facility</label>
            <p className="text-xs text-slate-400 mb-2">Select the AeroCap facility where you will train</p>
            {countries.length === 0 ? (
              <div className="text-sm text-slate-400 py-3 text-center">Loading…</div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {countries.map(c => {
                  const selected = tenantId === c.tenantId;
                  return (
                    <button key={c.tenantId} type="button" onClick={() => setTenantId(c.tenantId)}
                      className={`flex items-center gap-2.5 px-3 py-3 rounded-xl border-2 text-left transition-all ${
                        selected ? 'border-brand bg-brand/5 text-slate-900' : 'border-slate-200 text-slate-600 hover:border-slate-300 hover:bg-slate-50'
                      }`}>
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
            <input type="text" required value={tenantId} onChange={() => {}} className="sr-only" tabIndex={-1} />
          </div>

          <button type="submit" disabled={loading || !tenantId}
            className="w-full py-2.5 bg-brand hover:bg-brand-dark disabled:bg-slate-300 text-white font-semibold rounded-lg transition-colors text-sm mt-2">
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
    </Shell>
  );
}

// ─── Step 2b: Partner enquiry form ───────────────────────────────────────────

function PartnerForm({ onBack, onSuccess }: { onBack: () => void; onSuccess: () => void }) {
  const [form, setForm] = useState({
    orgName: '', orgType: 'AIRLINE', icaoCode: '',
    contactName: '', contactEmail: '', contactPhone: '',
    pilotCount: '', trainingRegions: [] as string[], notes: '',
  });
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  const regions = [
    { id: 'FR', label: '🇫🇷 France / EU' },
    { id: 'ZA', label: '🇿🇦 South Africa' },
    { id: 'CN', label: '🇨🇳 China' },
    { id: 'IN', label: '🇮🇳 India' },
  ];

  function toggleRegion(id: string) {
    setForm(f => ({
      ...f,
      trainingRegions: f.trainingRegions.includes(id)
        ? f.trainingRegions.filter(r => r !== id)
        : [...f.trainingRegions, id],
    }));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (form.trainingRegions.length === 0) { setError('Please select at least one training region.'); return; }
    setError(''); setLoading(true);

    // In production this would POST to a CRM or partner-service inquiries endpoint.
    // For the demo we simulate a short delay and show success.
    await new Promise(r => setTimeout(r, 900));
    setLoading(false);
    onSuccess();
  }

  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(f => ({ ...f, [key]: e.target.value }));

  return (
    <Shell>
      <div className="bg-white rounded-2xl shadow-2xl p-8">
        {/* Back + title */}
        <div className="flex items-center gap-3 mb-6">
          <button type="button" onClick={onBack}
            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path fillRule="evenodd" d="M17 10a.75.75 0 0 1-.75.75H5.612l4.158 3.96a.75.75 0 1 1-1.04 1.08l-5.5-5.25a.75.75 0 0 1 0-1.08l5.5-5.25a.75.75 0 1 1 1.04 1.08L5.612 9.25H16.25A.75.75 0 0 1 17 10Z" clipRule="evenodd"/>
            </svg>
          </button>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-slate-800">Partner registration</h2>
              <span className="text-xs font-medium bg-emerald-100 text-emerald-700 px-1.5 py-0.5 rounded">B2B</span>
            </div>
            <p className="text-xs text-slate-400">We'll set up your organisation account within 2 business days</p>
          </div>
        </div>

        {error && (
          <div className="mb-5 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">

          {/* Organisation section */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Organisation</p>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Organisation name *</label>
              <input type="text" required value={form.orgName} onChange={set('orgName')}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm"
                placeholder="e.g. Air France, Royal Air Force" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Type *</label>
                <select value={form.orgType} onChange={set('orgType')}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm bg-white">
                  {PARTNER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">ICAO code</label>
                <input type="text" maxLength={4} value={form.icaoCode} onChange={set('icaoCode')}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm font-mono uppercase"
                  placeholder="AFR" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Estimated pilot count</label>
              <select value={form.pilotCount} onChange={set('pilotCount')}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm bg-white">
                <option value="">Select range</option>
                <option value="1-10">1 – 10 pilots</option>
                <option value="11-50">11 – 50 pilots</option>
                <option value="51-200">51 – 200 pilots</option>
                <option value="201-500">201 – 500 pilots</option>
                <option value="500+">500+ pilots</option>
              </select>
            </div>
          </div>

          {/* Training regions */}
          <div className="space-y-2">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Training facilities needed *</p>
            <div className="grid grid-cols-2 gap-2">
              {regions.map(r => {
                const selected = form.trainingRegions.includes(r.id);
                return (
                  <button key={r.id} type="button" onClick={() => toggleRegion(r.id)}
                    className={`flex items-center justify-between px-3 py-2.5 rounded-xl border-2 text-left text-sm transition-all ${
                      selected ? 'border-emerald-500 bg-emerald-50 text-slate-900 font-medium' : 'border-slate-200 text-slate-600 hover:border-emerald-300'
                    }`}>
                    {r.label}
                    {selected && (
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="w-4 h-4 text-emerald-500 flex-shrink-0">
                        <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Contact section */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Primary contact</p>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Full name *</label>
              <input type="text" required value={form.contactName} onChange={set('contactName')}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm"
                placeholder="Training Manager name" />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Work email *</label>
                <input type="email" required value={form.contactEmail} onChange={set('contactEmail')}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm"
                  placeholder="training@airline.com" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Phone</label>
                <input type="tel" value={form.contactPhone} onChange={set('contactPhone')}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm"
                  placeholder="+33 1 00 00 00 00" />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Additional notes</label>
              <textarea rows={3} value={form.notes} onChange={set('notes')}
                className="w-full px-3 py-2.5 rounded-lg border border-slate-200 focus:outline-none focus:ring-2 focus:ring-emerald-400 text-sm resize-none"
                placeholder="Simulator types needed, training programme requirements, preferred start date…" />
            </div>
          </div>

          <button type="submit" disabled={loading}
            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-300 text-white font-semibold rounded-lg transition-colors text-sm">
            {loading ? 'Submitting enquiry…' : 'Submit partner enquiry'}
          </button>
        </form>

        <p className="text-center text-xs text-slate-400 mt-4">
          Already have an account?{' '}
          <Link href="/login" className="text-brand font-medium hover:underline">Sign in</Link>
        </p>
      </div>
    </Shell>
  );
}

// ─── Step 2b success ──────────────────────────────────────────────────────────

function PartnerSuccess() {
  return (
    <Shell>
      <div className="bg-white rounded-2xl shadow-2xl p-10 text-center">
        {/* Checkmark */}
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-100 mb-5">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="w-8 h-8 text-emerald-600">
            <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        </div>

        <h2 className="text-xl font-bold text-slate-900 mb-2">Enquiry received</h2>
        <p className="text-sm text-slate-500 mb-6 max-w-sm mx-auto">
          Thank you for your interest in an AeroCap partner account.
          An AeroCap representative will contact you within <strong>2 business days</strong> to set up your organisation.
        </p>

        {/* What happens next */}
        <div className="bg-slate-50 rounded-xl p-5 text-left space-y-3 mb-6">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">What happens next</p>
          {[
            { step: '1', text: 'AeroCap reviews your organisation details and training requirements' },
            { step: '2', text: 'We create your partner account and assign a dedicated Partner Admin login' },
            { step: '3', text: 'You receive an email invitation to complete your account setup' },
            { step: '4', text: 'Start adding your pilots and managing booking authorisations' },
          ].map(item => (
            <div key={item.step} className="flex items-start gap-3">
              <span className="flex-shrink-0 w-5 h-5 rounded-full bg-emerald-100 text-emerald-700 text-xs font-bold flex items-center justify-center">
                {item.step}
              </span>
              <p className="text-sm text-slate-600 leading-snug">{item.text}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-col gap-3">
          <Link href="/login"
            className="w-full py-2.5 bg-brand hover:bg-brand-dark text-white font-semibold rounded-lg transition-colors text-sm text-center">
            Go to sign in
          </Link>
          <Link href="/"
            className="text-sm text-slate-400 hover:text-slate-600 transition-colors">
            Back to home
          </Link>
        </div>
      </div>
    </Shell>
  );
}

// ─── Page orchestrator ────────────────────────────────────────────────────────

export default function SignupPage() {
  const [step, setStep] = useState<Step>('type');

  if (step === 'type')           return <TypeSelector onSelect={t => setStep(t)} />;
  if (step === 'individual')     return <IndividualForm onBack={() => setStep('type')} />;
  if (step === 'partner')        return <PartnerForm onBack={() => setStep('type')} onSuccess={() => setStep('partner-success')} />;
  if (step === 'partner-success') return <PartnerSuccess />;
  return null;
}
