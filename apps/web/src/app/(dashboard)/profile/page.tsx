import { redirect } from 'next/navigation';
import { getServerToken, getServerUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/api';
import type { PilotProfile, Licence, TypeRating, LicenceType, LicenceStatus } from '@/types';
import { LICENCE_LABELS } from '@/types';

const HRIS_SVC    = process.env.HRIS_SERVICE_URL    ?? 'http://localhost:3004';
const CBTA_SVC    = process.env.CBTA_SERVICE_URL    ?? 'http://localhost:3003';
const BOOKING_SVC = process.env.BOOKING_SERVICE_URL ?? 'http://localhost:3002';

interface ProfileResponse { profile: PilotProfile; licences: Licence[]; type_ratings: TypeRating[] }
interface ProgressStats { progress: Array<{ average_score: number | null; total_assessments: number }> }
interface BookingStats  { upcomingReservations: number }

const STATUS_STYLE: Record<LicenceStatus, string> = {
  VALID:          'bg-emerald-100 text-emerald-700 border-emerald-200',
  EXPIRING_SOON:  'bg-amber-100   text-amber-700   border-amber-200',
  EXPIRED:        'bg-red-100     text-red-700     border-red-200',
};
const STATUS_LABEL: Record<LicenceStatus, string> = {
  VALID:         'Valid',
  EXPIRING_SOON: 'Expiring',
  EXPIRED:       'Expired',
};

function daysTag(days: number, status: LicenceStatus) {
  if (status === 'EXPIRED') return <span className="text-xs font-medium text-red-600">Expired {Math.abs(days)}d ago</span>;
  if (status === 'EXPIRING_SOON') return <span className="text-xs font-medium text-amber-600">{days}d remaining</span>;
  return <span className="text-xs text-slate-400">{days}d remaining</span>;
}

export default async function ProfilePage() {
  const [token, user] = await Promise.all([getServerToken(), getServerUser()]);
  if (!user) redirect('/login');

  const hrisApi    = createServiceClient(HRIS_SVC, token);
  const cbtaApi    = createServiceClient(CBTA_SVC, token);
  const bookingApi = createServiceClient(BOOKING_SVC, token);

  const [hrisData, cbtaData, bookingStats] = await Promise.allSettled([
    hrisApi.get<ProfileResponse>(`/api/v1/profile/${user.id}`),
    cbtaApi.get<ProgressStats>(`/api/v1/progress/${user.id}`),
    bookingApi.get<BookingStats>('/api/v1/stats'),
  ]);

  const profile     = hrisData.status === 'fulfilled' ? hrisData.value.profile : null;
  const licences    = hrisData.status === 'fulfilled' ? hrisData.value.licences : [];
  const typeRatings = hrisData.status === 'fulfilled' ? hrisData.value.type_ratings : [];
  const progress    = cbtaData.status  === 'fulfilled' ? cbtaData.value.progress : [];
  const upcoming    = bookingStats.status === 'fulfilled' ? bookingStats.value.upcomingReservations : 0;

  const assessed = progress.filter(p => p.total_assessments > 0);
  const avgCbta  = assessed.length > 0
    ? (assessed.reduce((s, p) => s + (p.average_score ?? 0), 0) / assessed.length).toFixed(2)
    : null;

  const hasAlert = licences.some(l => l.status !== 'VALID');

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Header card */}
      <div className="bg-gradient-to-r from-navy-950 to-brand-dark rounded-2xl p-6 text-white flex items-center gap-6">
        <div className="w-20 h-20 rounded-full bg-white/10 flex items-center justify-center text-3xl font-bold flex-shrink-0">
          {user.firstName.charAt(0)}{user.lastName.charAt(0)}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold">{user.firstName} {user.lastName}</h1>
          <p className="text-slate-300 text-sm mt-0.5">{user.role.replace('_', ' ')} · {user.email}</p>
          {profile?.home_base && <p className="text-slate-400 text-xs mt-1">Base: {profile.home_base}</p>}
          {profile?.licence_number && <p className="text-slate-400 text-xs font-mono">{profile.licence_number}</p>}
        </div>
        {hasAlert && (
          <div className="flex-shrink-0 flex items-center gap-2 bg-amber-500/20 border border-amber-500/40 rounded-lg px-3 py-2">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-amber-400">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" clipRule="evenodd"/>
            </svg>
            <span className="text-amber-300 text-xs font-medium">Licence action required</span>
          </div>
        )}
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total flight hours', value: profile?.total_hours?.toLocaleString() ?? '—', sub: 'logged' },
          { label: 'Simulator hours',    value: profile?.simulator_hours?.toLocaleString() ?? '—', sub: 'on AeroCap' },
          { label: 'Avg CBTA score',     value: avgCbta ?? '—', sub: `${assessed.length}/8 units` },
          { label: 'Upcoming sessions',  value: upcoming, sub: 'booked' },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-xl border border-slate-100 p-4">
            <p className="text-xs text-slate-400 uppercase tracking-wide">{s.label}</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{s.value}</p>
            <p className="text-xs text-slate-400">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Licences */}
      <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-semibold text-slate-800">Licences & Certificates</h2>
          <a href="/licences" className="text-xs text-brand hover:underline">Manage →</a>
        </div>
        {licences.length === 0 ? (
          <p className="px-5 py-8 text-center text-sm text-slate-400">No licences on record.</p>
        ) : (
          <div className="divide-y divide-slate-50">
            {licences.map(lic => (
              <div key={lic.id} className="px-5 py-3.5 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-900">{LICENCE_LABELS[lic.type as LicenceType] ?? lic.type}</p>
                  {lic.number && <p className="text-xs text-slate-400 font-mono">{lic.number}</p>}
                </div>
                <div className="flex items-center gap-3">
                  {daysTag(lic.days_remaining, lic.status)}
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_STYLE[lic.status]}`}>
                    {STATUS_LABEL[lic.status]}
                  </span>
                  <span className="text-xs text-slate-400">{new Date(lic.expires_at).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' })}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Type Ratings */}
      {typeRatings.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800">Type Ratings</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4">
            {typeRatings.map(tr => {
              const expired = tr.expires_at && new Date(tr.expires_at) < new Date();
              return (
                <div key={tr.id} className={`rounded-lg border p-3 ${expired ? 'border-red-200 bg-red-50' : 'border-slate-100 bg-slate-50'}`}>
                  <p className={`text-base font-bold font-mono ${expired ? 'text-red-700' : 'text-navy-800'}`}>{tr.aircraft_type}</p>
                  <p className="text-xs text-slate-500 mt-0.5 truncate">{tr.aircraft_full}</p>
                  <p className="text-xs text-slate-400 mt-1">Since {new Date(tr.rated_at).toLocaleDateString('en-GB', { month:'short', year:'numeric' })}</p>
                  {expired && <p className="text-xs text-red-600 font-medium mt-1">EXPIRED</p>}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Personal details (editable info) */}
      {profile && (
        <div className="bg-white rounded-xl border border-slate-100 p-5">
          <h2 className="font-semibold text-slate-800 mb-4">Personal Details</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
            {[
              { label: 'Nationality', value: profile.nationality },
              { label: 'Date of Birth', value: profile.date_of_birth },
              { label: 'Home Base', value: profile.home_base },
            ].map(f => (
              <div key={f.label}>
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">{f.label}</p>
                <p className="font-medium text-slate-700">{f.value ?? '—'}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
