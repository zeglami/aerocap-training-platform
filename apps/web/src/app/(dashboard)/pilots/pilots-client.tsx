'use client';

import { useState, useEffect, useCallback } from 'react';

type UserRole = 'GLOBAL_ADMIN' | 'COUNTRY_ADMIN' | 'MANAGER' | 'INSTRUCTOR' | 'PILOT';

interface UserRecord {
  id:                 string;
  email:              string;
  first_name:         string;
  last_name:          string;
  role:               UserRole;
  booking_authorized: number;
  signup_method:      'admin' | 'self';
  created_at:         string;
}

interface ApiResponse<T> { data: T; meta: { total: number } }

const ROLE_COLOR: Record<string, string> = {
  GLOBAL_ADMIN:  'bg-purple-100 text-purple-700',
  COUNTRY_ADMIN: 'bg-blue-100   text-blue-700',
  MANAGER:       'bg-teal-100   text-teal-700',
  INSTRUCTOR:    'bg-amber-100  text-amber-700',
  PILOT:         'bg-slate-100  text-slate-600',
};

export default function PilotsClient({ canAuthorize }: { canAuthorize: boolean }) {
  const [users,   setUsers]   = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting,  setActing]  = useState<string | null>(null);
  const [tab,     setTab]     = useState<'all' | 'pending'>('all');

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch('/api/users/users?limit=100');
      const json = await res.json() as ApiResponse<UserRecord[]>;
      setUsers(json.data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadUsers(); }, [loadUsers]);

  const pending   = users.filter(u => u.booking_authorized === 0 && u.signup_method === 'self');
  const displayed = tab === 'pending' ? pending : users;

  async function authorize(userId: string) {
    setActing(userId);
    await fetch(`/api/users/${userId}/authorize`, { method: 'POST' });
    await loadUsers();
    setActing(null);
  }

  async function revoke(userId: string) {
    if (!confirm('Revoke booking access for this pilot?')) return;
    setActing(userId);
    await fetch(`/api/users/${userId}/revoke`, { method: 'POST' });
    await loadUsers();
    setActing(null);
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Pilots & Crew</h1>
        <p className="text-slate-500 text-sm mt-1">
          {canAuthorize
            ? 'Manage organisation members and booking authorizations.'
            : 'View organisation members and their training status.'}
        </p>
      </div>

      {/* Tabs — pending tab only visible to admins who can act on it */}
      <div className="flex gap-1 border-b border-slate-200">
        {(['all', ...(canAuthorize ? ['pending'] : [])] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t as 'all' | 'pending')}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors capitalize ${
              tab === t
                ? 'border-brand text-brand'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'all' ? 'All members' : (
              <span className="flex items-center gap-1.5">
                Pending approval
                {pending.length > 0 && (
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-amber-500 text-white text-xs font-bold">
                    {pending.length}
                  </span>
                )}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="divide-y">
            {[1,2,3,4].map(i => (
              <div key={i} className="px-5 py-4 animate-pulse flex gap-4">
                <div className="w-8 h-8 bg-slate-100 rounded-full flex-shrink-0" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 bg-slate-100 rounded w-40" />
                  <div className="h-3 bg-slate-100 rounded w-28" />
                </div>
              </div>
            ))}
          </div>
        ) : displayed.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <p className="text-slate-500 text-sm font-medium">
              {tab === 'pending' ? 'No pilots pending approval' : 'No members found'}
            </p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-400 uppercase tracking-wide border-b border-slate-100">
                <th className="text-left px-5 py-3 font-medium">Name</th>
                <th className="text-left px-5 py-3 font-medium">Email</th>
                <th className="text-left px-5 py-3 font-medium">Role</th>
                <th className="text-left px-5 py-3 font-medium">Booking</th>
                <th className="text-left px-5 py-3 font-medium">Joined</th>
                {canAuthorize && <th className="text-left px-5 py-3 font-medium"></th>}
              </tr>
            </thead>
            <tbody>
              {displayed.map(u => {
                const authorized = u.booking_authorized === 1;
                const isSelf     = u.signup_method === 'self';
                const isPilot    = u.role === 'PILOT';
                const isLoading  = acting === u.id;
                const initials   = `${u.first_name.charAt(0)}${u.last_name.charAt(0)}`.toUpperCase();

                return (
                  <tr key={u.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                          authorized ? 'bg-brand/10 text-brand' : 'bg-amber-100 text-amber-700'
                        }`}>
                          {initials}
                        </div>
                        <div>
                          <p className="font-medium text-slate-900">{u.first_name} {u.last_name}</p>
                          {isSelf && (
                            <p className="text-xs text-slate-400">Self-registered</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-slate-500 text-xs">{u.email}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLOR[u.role] ?? ''}`}>
                        {u.role.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-5 py-3">
                      {isPilot ? (
                        authorized ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                            <svg viewBox="0 0 12 12" fill="currentColor" className="w-3 h-3">
                              <path fillRule="evenodd" d="M10.293 3.293a1 1 0 0 1 0 1.414l-4 4a1 1 0 0 1-1.414 0l-2-2a1 1 0 1 1 1.414-1.414L5.5 6.586l3.293-3.293a1 1 0 0 1 1.414 0z" clipRule="evenodd"/>
                            </svg>
                            Authorized
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-700">
                            <svg viewBox="0 0 12 12" fill="currentColor" className="w-3 h-3">
                              <path fillRule="evenodd" d="M6 1a5 5 0 1 0 0 10A5 5 0 0 0 6 1zm0 4.5a.5.5 0 0 1 .5.5v2a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm0-2.5a.75.75 0 1 1 0 1.5.75.75 0 0 1 0-1.5z" clipRule="evenodd"/>
                            </svg>
                            Pending
                          </span>
                        )
                      ) : (
                        <span className="text-xs text-slate-400">—</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-slate-400 text-xs">
                      {new Date(u.created_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </td>
                    {/* Authorize / Revoke — admins only, never shown to instructors */}
                    {canAuthorize && (
                      <td className="px-5 py-3">
                        {isPilot && (
                          authorized ? (
                            <button
                              onClick={() => revoke(u.id)}
                              disabled={isLoading}
                              className="text-xs text-slate-400 hover:text-red-600 transition-colors disabled:opacity-40"
                            >
                              {isLoading ? '…' : 'Revoke'}
                            </button>
                          ) : (
                            <button
                              onClick={() => authorize(u.id)}
                              disabled={isLoading}
                              className="px-3 py-1 rounded-lg bg-brand hover:bg-brand-dark disabled:opacity-40 text-white text-xs font-semibold transition-colors"
                            >
                              {isLoading ? 'Authorizing…' : 'Authorize'}
                            </button>
                          )
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
