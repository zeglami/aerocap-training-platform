'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/components/auth-context';
import type { Licence, TypeRating, LicenceStatus } from '@/types';
import { LICENCE_LABELS } from '@/types';

const STATUS_STYLE: Record<LicenceStatus, string> = {
  VALID:         'bg-emerald-100 text-emerald-700 border-emerald-200',
  EXPIRING_SOON: 'bg-amber-100   text-amber-700   border-amber-200',
  EXPIRED:       'bg-red-100     text-red-700     border-red-200',
};

const SEVERITY_BAR: Record<LicenceStatus, string> = {
  VALID:         'bg-emerald-500',
  EXPIRING_SOON: 'bg-amber-500',
  EXPIRED:       'bg-red-500',
};

interface ApiResp<T> { data: T; meta: { total?: number } }

function ExpiryBar({ days, status }: { days: number; status: LicenceStatus }) {
  const maxDays = 365;
  const pct     = status === 'EXPIRED' ? 0 : Math.min(100, Math.max(0, (days / maxDays) * 100));
  return (
    <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
      <div className={`h-full rounded-full transition-all ${SEVERITY_BAR[status]}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

export default function LicencesPage() {
  const { id: pilotId } = useAuth();
  const [licences,    setLicences]    = useState<Licence[]>([]);
  const [typeRatings, setTypeRatings] = useState<TypeRating[]>([]);
  const [loading,     setLoading]     = useState(true);
  const [filter,      setFilter]      = useState<'all' | 'expiring' | 'expired'>('all');

  useEffect(() => {
    async function load() {
      setLoading(true);
      const [licRes, trRes] = await Promise.all([
        fetch('/api/hris/licences'),
        fetch(`/api/hris/type-ratings/${pilotId}`),
      ]);
      const licJson = await licRes.json() as ApiResp<Licence[]>;
      const trJson  = await trRes.json() as ApiResp<TypeRating[]>;

      setLicences(licJson.data ?? []);
      setTypeRatings(trJson.data ?? []);
      setLoading(false);
    }
    void load();
  }, []);

  const counts = {
    all:      licences.length,
    expiring: licences.filter(l => l.status === 'EXPIRING_SOON').length,
    expired:  licences.filter(l => l.status === 'EXPIRED').length,
  };

  const displayed = licences.filter(l =>
    filter === 'all'      ? true :
    filter === 'expiring' ? l.status === 'EXPIRING_SOON' :
                            l.status === 'EXPIRED'
  );

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Licences & Ratings</h1>
        <p className="text-slate-500 text-sm mt-1">
          All licences, certificates and aircraft type ratings with expiry tracking.
        </p>
      </div>

      {/* Status summary pills */}
      <div className="flex gap-2 flex-wrap">
        {([
          { key: 'all',      label: 'All',               count: counts.all,      color: 'bg-slate-100 text-slate-700 border-slate-200' },
          { key: 'expiring', label: 'Expiring (< 60d)',   count: counts.expiring, color: 'bg-amber-100 text-amber-700 border-amber-200' },
          { key: 'expired',  label: 'Expired',            count: counts.expired,  color: 'bg-red-100   text-red-700   border-red-200' },
        ] as const).map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${tab.color} ${filter === tab.key ? 'ring-2 ring-offset-1 ring-current' : 'opacity-70 hover:opacity-100'}`}
          >
            {tab.label}
            <span className="font-bold">{tab.count}</span>
          </button>
        ))}
      </div>

      {/* Licences table */}
      <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-800">Licences & Certificates</h2>
        </div>
        {loading ? (
          <div className="divide-y">
            {[1,2,3,4].map(i => (
              <div key={i} className="px-5 py-4 animate-pulse flex gap-4">
                <div className="h-4 bg-slate-100 rounded w-48" />
                <div className="h-4 bg-slate-100 rounded w-32 ml-auto" />
              </div>
            ))}
          </div>
        ) : displayed.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-slate-400">
            {filter === 'all' ? 'No licences on record.' : `No ${filter} licences.`}
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-400 uppercase tracking-wide border-b border-slate-50">
                <th className="text-left px-5 py-3 font-medium">Licence</th>
                <th className="text-left px-5 py-3 font-medium">Number</th>
                <th className="text-left px-5 py-3 font-medium w-40">Expiry progress</th>
                <th className="text-left px-5 py-3 font-medium">Expires</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {displayed.map(lic => (
                <tr key={lic.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3">
                    <p className="font-medium text-slate-900">{LICENCE_LABELS[lic.type] ?? lic.type}</p>
                    {lic.issuing_authority && <p className="text-xs text-slate-400">{lic.issuing_authority}</p>}
                  </td>
                  <td className="px-5 py-3 text-xs font-mono text-slate-500">{lic.number ?? '—'}</td>
                  <td className="px-5 py-3 w-40">
                    <ExpiryBar days={lic.days_remaining} status={lic.status} />
                    <p className={`text-xs mt-1 ${lic.status === 'EXPIRED' ? 'text-red-600' : lic.status === 'EXPIRING_SOON' ? 'text-amber-600' : 'text-slate-400'}`}>
                      {lic.status === 'EXPIRED'
                        ? `${Math.abs(lic.days_remaining)}d overdue`
                        : `${lic.days_remaining}d left`}
                    </p>
                  </td>
                  <td className="px-5 py-3 text-slate-600 text-xs">
                    {new Date(lic.expires_at).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLE[lic.status]}`}>
                      {lic.status === 'EXPIRING_SOON' ? 'Expiring' : lic.status === 'EXPIRED' ? 'Expired' : 'Valid'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Type Ratings */}
      {typeRatings.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800">Aircraft Type Ratings</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-5">
            {typeRatings.map(tr => {
              const isExpired = tr.expires_at && new Date(tr.expires_at) < new Date();
              const isSoon    = !isExpired && tr.expires_at && (new Date(tr.expires_at).getTime() - Date.now()) < 60 * 86_400_000;
              return (
                <div key={tr.id} className={`rounded-xl border p-4 ${isExpired ? 'border-red-200 bg-red-50' : isSoon ? 'border-amber-200 bg-amber-50' : 'border-slate-100 bg-slate-50'}`}>
                  <div className="flex items-start justify-between mb-2">
                    <span className={`text-xl font-black font-mono ${isExpired ? 'text-red-700' : 'text-navy-800'}`}>{tr.aircraft_type}</span>
                    {(isExpired || isSoon) && (
                      <svg viewBox="0 0 16 16" fill="currentColor" className={`w-4 h-4 ${isExpired ? 'text-red-500' : 'text-amber-500'}`}>
                        <path fillRule="evenodd" d="M8 1.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM7.25 4.75a.75.75 0 0 1 1.5 0v3.5a.75.75 0 0 1-1.5 0v-3.5zm.75 7a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" clipRule="evenodd"/>
                      </svg>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 truncate">{tr.aircraft_full}</p>
                  <p className="text-xs text-slate-400 mt-1">Rated {new Date(tr.rated_at).toLocaleDateString('en-GB', { month:'short', year:'numeric' })}</p>
                  {tr.expires_at && (
                    <p className={`text-xs font-medium mt-1 ${isExpired ? 'text-red-600' : isSoon ? 'text-amber-600' : 'text-slate-400'}`}>
                      {isExpired ? 'EXPIRED' : `Until ${new Date(tr.expires_at).toLocaleDateString('en-GB', { month:'short', year:'numeric' })}`}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && licences.length === 0 && typeRatings.length === 0 && (
        <div className="bg-white rounded-xl border border-slate-100 p-10 text-center">
          <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-6 h-6 text-slate-400">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 17.25v3.375c0 .621-.504 1.125-1.125 1.125h-9.75a1.125 1.125 0 0 1-1.125-1.125V7.875c0-.621.504-1.125 1.125-1.125H6.75a9.06 9.06 0 0 1 1.5.124m7.5 10.376h3.375c.621 0 1.125-.504 1.125-1.125V11.25c0-4.46-3.243-8.161-7.5-8.876a9.06 9.06 0 0 0-1.5-.124H9.375c-.621 0-1.125.504-1.125 1.125v3.5m7.5 10.375H9.375a1.125 1.125 0 0 1-1.125-1.125v-9.25m12 6.625v-1.875a3.375 3.375 0 0 0-3.375-3.375h-1.5a1.125 1.125 0 0 1-1.125-1.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H9.75" />
            </svg>
          </div>
          <p className="text-slate-500 text-sm font-medium">No records yet</p>
          <p className="text-slate-400 text-xs mt-1">Ask your training manager to add your licences.</p>
        </div>
      )}
    </div>
  );
}
