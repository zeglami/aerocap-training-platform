import { redirect } from 'next/navigation';
import { getServerToken, getServerUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/api';
import type { Licence, LicenceStatus, LicenceType } from '@/types';
import { LICENCE_LABELS } from '@/types';

const HRIS_SVC    = process.env.HRIS_SERVICE_URL    ?? 'http://localhost:3004';
const USER_SVC    = process.env.USER_SERVICE_URL    ?? 'http://localhost:3001';
const CBTA_SVC    = process.env.CBTA_SERVICE_URL    ?? 'http://localhost:3003';
const BOOKING_SVC = process.env.BOOKING_SERVICE_URL ?? 'http://localhost:3002';

interface HrisStats { expired: number; expiring30: number; expiring90: number; totalTypeRatings: number; totalSimulatorHours: number }
interface UserStats { total: number; pilots: number; instructors: number; pending: number }
interface CbtaStats { totalAssessments: number; pilotsAssessed: number; averageScore: number }
interface BookingStats { upcomingReservations: number; totalSimulators: number; availableSlots: number }

const STATUS_STYLE: Record<LicenceStatus, string> = {
  VALID:         'bg-emerald-100 text-emerald-700',
  EXPIRING_SOON: 'bg-amber-100   text-amber-700',
  EXPIRED:       'bg-red-100     text-red-700',
};

function KpiCard({ label, value, sub, alert }: { label: string; value: string | number; sub?: string; alert?: boolean }) {
  return (
    <div className={`rounded-xl border p-5 ${alert ? 'border-red-200 bg-red-50' : 'border-slate-100 bg-white'}`}>
      <p className={`text-xs font-semibold uppercase tracking-wider ${alert ? 'text-red-500' : 'text-slate-400'}`}>{label}</p>
      <p className={`text-3xl font-bold mt-2 ${alert ? 'text-red-700' : 'text-slate-900'}`}>{value}</p>
      {sub && <p className={`text-xs mt-1 ${alert ? 'text-red-500' : 'text-slate-400'}`}>{sub}</p>}
    </div>
  );
}

export default async function ReportsPage() {
  const [token, user] = await Promise.all([getServerToken(), getServerUser()]);
  if (!user || user.role === 'PILOT') redirect('/dashboard');

  const hrisApi    = createServiceClient(HRIS_SVC,    token);
  const usersApi   = createServiceClient(USER_SVC,    token);
  const cbtaApi    = createServiceClient(CBTA_SVC,    token);
  const bookingApi = createServiceClient(BOOKING_SVC, token);

  const [hrisStats, userStats, cbtaStats, bookingStats, expiringLicences] = await Promise.allSettled([
    hrisApi.get<HrisStats>('/api/v1/stats'),
    usersApi.get<UserStats>('/api/v1/stats'),
    cbtaApi.get<CbtaStats>('/api/v1/stats'),
    bookingApi.get<BookingStats>('/api/v1/stats'),
    hrisApi.get<Licence[]>('/api/v1/expiring?days=90'),
  ]);

  const h  = hrisStats.status    === 'fulfilled' ? hrisStats.value    : null;
  const u  = userStats.status    === 'fulfilled' ? userStats.value    : null;
  const c  = cbtaStats.status    === 'fulfilled' ? cbtaStats.value    : null;
  const b  = bookingStats.status === 'fulfilled' ? bookingStats.value : null;
  const ex = expiringLicences.status === 'fulfilled' ? expiringLicences.value as Licence[] : [];

  const complianceRate = u && h
    ? Math.round(((u.pilots - h.expired) / Math.max(u.pilots, 1)) * 100)
    : null;

  const today30  = new Date(); today30.setDate(today30.getDate() + 30);
  const expired  = ex.filter(l => l.status === 'EXPIRED');
  const expiring = ex.filter(l => l.status === 'EXPIRING_SOON');

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Reports & Compliance</h1>
        <p className="text-slate-500 text-sm mt-1">Organisation overview — training status, licence compliance, simulator utilisation.</p>
      </div>

      {/* Compliance banner */}
      {h && (h.expired > 0 || h.expiring30 > 0) && (
        <div className={`flex items-center gap-4 p-4 rounded-xl border ${h.expired > 0 ? 'border-red-200 bg-red-50' : 'border-amber-200 bg-amber-50'}`}>
          <svg viewBox="0 0 20 20" fill="currentColor" className={`w-6 h-6 flex-shrink-0 ${h.expired > 0 ? 'text-red-500' : 'text-amber-500'}`}>
            <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" clipRule="evenodd"/>
          </svg>
          <div>
            <p className={`font-semibold text-sm ${h.expired > 0 ? 'text-red-800' : 'text-amber-800'}`}>
              {h.expired > 0
                ? `${h.expired} expired licence${h.expired > 1 ? 's' : ''} — immediate action required`
                : `${h.expiring30} licence${h.expiring30 > 1 ? 's' : ''} expiring within 30 days`}
            </p>
            <p className={`text-xs mt-0.5 ${h.expired > 0 ? 'text-red-600' : 'text-amber-600'}`}>
              Pilots with expired licences may not be legally authorised to operate.
            </p>
          </div>
        </div>
      )}

      {/* KPI grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Compliance rate"     value={complianceRate != null ? `${complianceRate}%` : '—'} sub="pilots with valid licences" alert={complianceRate != null && complianceRate < 90} />
        <KpiCard label="Expired licences"    value={h?.expired ?? '—'}      sub="require immediate renewal"    alert={(h?.expired ?? 0) > 0} />
        <KpiCard label="Expiring in 30 days" value={h?.expiring30 ?? '—'}   sub="action recommended" />
        <KpiCard label="Pilots assessed"     value={c?.pilotsAssessed ?? '—'} sub={`avg score ${c ? c.averageScore.toFixed(1) : '—'}/5`} />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard label="Total pilots"          value={u?.pilots ?? '—'}              sub={`${u?.pending ?? 0} pending approval`} />
        <KpiCard label="Upcoming sessions"     value={b?.upcomingReservations ?? '—'} sub="confirmed bookings" />
        <KpiCard label="Simulator hours (SIM)" value={h?.totalSimulatorHours ?? '—'} sub="total logged on AeroCap" />
        <KpiCard label="Type ratings"          value={h?.totalTypeRatings ?? '—'}    sub="across all pilots" />
      </div>

      {/* Expiring / expired licences table */}
      {ex.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-semibold text-slate-800">Licence Expiry Dashboard</h2>
            <span className="text-xs text-slate-400">{ex.length} licences within 90 days</span>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-400 uppercase tracking-wide border-b border-slate-50">
                <th className="text-left px-5 py-3 font-medium">Pilot ID</th>
                <th className="text-left px-5 py-3 font-medium">Licence</th>
                <th className="text-left px-5 py-3 font-medium">Number</th>
                <th className="text-left px-5 py-3 font-medium">Expires</th>
                <th className="text-left px-5 py-3 font-medium">Days</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {[...expired, ...expiring].map(lic => (
                <tr key={lic.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3 font-mono text-xs text-slate-500">{lic.pilot_id}</td>
                  <td className="px-5 py-3 font-medium text-slate-900">{LICENCE_LABELS[lic.type as LicenceType] ?? lic.type}</td>
                  <td className="px-5 py-3 font-mono text-xs text-slate-400">{lic.number ?? '—'}</td>
                  <td className="px-5 py-3 text-slate-600 text-xs">
                    {new Date(lic.expires_at).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`text-xs font-semibold ${lic.status === 'EXPIRED' ? 'text-red-600' : 'text-amber-600'}`}>
                      {lic.status === 'EXPIRED' ? `+${Math.abs(lic.days_remaining)}d` : `${lic.days_remaining}d`}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[lic.status]}`}>
                      {lic.status === 'EXPIRED' ? 'EXPIRED' : 'Expiring'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* CBTA summary */}
      {c && (
        <div className="bg-white rounded-xl border border-slate-100 p-5">
          <h2 className="font-semibold text-slate-800 mb-4">CBTA Overview</h2>
          <div className="grid grid-cols-3 gap-6 text-center">
            <div>
              <p className="text-3xl font-bold text-slate-900">{c.totalAssessments}</p>
              <p className="text-xs text-slate-400 mt-1">Total assessments logged</p>
            </div>
            <div>
              <p className="text-3xl font-bold text-slate-900">{c.pilotsAssessed}</p>
              <p className="text-xs text-slate-400 mt-1">Pilots assessed</p>
            </div>
            <div>
              <p className={`text-3xl font-bold ${c.averageScore >= 4 ? 'text-emerald-600' : c.averageScore >= 3 ? 'text-amber-600' : 'text-red-600'}`}>
                {c.averageScore.toFixed(2)}<span className="text-lg text-slate-400">/5</span>
              </p>
              <p className="text-xs text-slate-400 mt-1">Organisation average</p>
            </div>
          </div>
          {/* Score scale */}
          <div className="mt-6 flex rounded-lg overflow-hidden h-3">
            {[1,2,3,4,5].map(n => (
              <div key={n} className={`flex-1 ${n === 1 ? 'bg-red-400' : n === 2 ? 'bg-orange-400' : n === 3 ? 'bg-yellow-400' : n === 4 ? 'bg-emerald-400' : 'bg-blue-400'}`} />
            ))}
          </div>
          <div className="flex justify-between text-xs text-slate-400 mt-1">
            <span>1 — Below standard</span><span>3 — Meets standard</span><span>5 — Exemplary</span>
          </div>
        </div>
      )}
    </div>
  );
}
