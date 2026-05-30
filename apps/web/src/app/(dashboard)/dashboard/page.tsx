import { getServerToken, getServerUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/api';
import { StatCard } from '@/components/stat-card';
import type { Reservation } from '@/types';

const USER_SVC    = process.env.USER_SERVICE_URL    ?? 'http://localhost:3001';
const BOOKING_SVC = process.env.BOOKING_SERVICE_URL ?? 'http://localhost:3002';
const CBTA_SVC    = process.env.CBTA_SERVICE_URL    ?? 'http://localhost:3003';

interface UserStats    { total: number; pilots: number; instructors: number; pending: number }
interface BookingStats { upcomingReservations: number; totalSimulators: number; availableSlots: number }
interface CbtaStats    { totalAssessments: number; pilotsAssessed: number; averageScore: number }

async function fetchStats(token: string | null, role: string) {
  const usersApi   = createServiceClient(USER_SVC,    token);
  const bookingApi = createServiceClient(BOOKING_SVC, token);
  const cbtaApi    = createServiceClient(CBTA_SVC,    token);

  const isPilot = role === 'PILOT';

  const [userStats, bookingStats, cbtaStats, reservations] = await Promise.allSettled([
    isPilot ? Promise.resolve(null) : usersApi.get<UserStats>('/api/v1/stats'),
    bookingApi.get<BookingStats>('/api/v1/stats'),
    cbtaApi.get<CbtaStats>('/api/v1/stats'),
    bookingApi.get<Reservation[]>('/api/v1/reservations?limit=5'),
  ]);

  return {
    userStats:    userStats.status    === 'fulfilled' ? userStats.value    : null,
    bookingStats: bookingStats.status === 'fulfilled' ? bookingStats.value : null,
    cbtaStats:    cbtaStats.status    === 'fulfilled' ? cbtaStats.value    : null,
    reservations: reservations.status === 'fulfilled' ? (reservations.value as Reservation[]) : [],
  };
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default async function DashboardPage() {
  const [token, user] = await Promise.all([getServerToken(), getServerUser()]);
  const { userStats, bookingStats, cbtaStats, reservations } = await fetchStats(token, user?.role ?? '');

  const isPilot   = user?.role === 'PILOT';
  const isPending = user && !user.bookingAuthorized && isPilot;
  const isAdmin   = user?.role === 'GLOBAL_ADMIN' || user?.role === 'COUNTRY_ADMIN';

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-slate-900">
          Good day, {user?.firstName || 'Pilot'}
        </h1>
        <p className="text-slate-500 text-sm mt-1">Here is an overview of your training portal.</p>
      </div>

      {/* Pending-approval banner (shown to pilots awaiting authorization) */}
      {isPending && (
        <div className="flex items-start gap-3 p-4 rounded-xl border border-amber-200 bg-amber-50">
          <div className="w-8 h-8 flex-shrink-0 flex items-center justify-center rounded-full bg-amber-100">
            <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-amber-600">
              <path fillRule="evenodd" d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2z" clipRule="evenodd" />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-amber-800 text-sm">Booking access pending approval</p>
            <p className="text-amber-700 text-sm mt-0.5">
              Your account is awaiting authorization from your training manager. You can view your
              profile and CBTA progress — simulator booking will be unlocked once approved.
            </p>
          </div>
        </div>
      )}

      {/* Admin alert: pending pilots waiting for approval */}
      {isAdmin && (userStats?.pending ?? 0) > 0 && (
        <div className="flex items-center justify-between p-4 rounded-xl border border-blue-200 bg-blue-50">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 flex items-center justify-center rounded-full bg-blue-100">
              <svg viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-blue-600">
                <path d="M10 9a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM6 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM1.49 15.326a.78.78 0 0 1-.358-.442 3 3 0 0 1 4.308-3.516 6.484 6.484 0 0 0-1.905 3.959c-.023.222-.014.442.025.654a4.97 4.97 0 0 1-2.07-.655ZM16.44 15.98a4.97 4.97 0 0 0 2.07-.654.78.78 0 0 0 .357-.442 3 3 0 0 0-4.308-3.517 6.484 6.484 0 0 1 1.907 3.96 2.32 2.32 0 0 1-.026.654ZM18 8a2 2 0 1 1-4 0 2 2 0 0 1 4 0ZM5.304 16.19a.844.844 0 0 1-.277-.71 5 5 0 0 1 9.947 0 .843.843 0 0 1-.277.71A6.975 6.975 0 0 1 10 18a6.974 6.974 0 0 1-4.696-1.81Z" />
              </svg>
            </div>
            <p className="text-sm text-blue-800">
              <span className="font-semibold">{userStats?.pending} pilot{userStats!.pending > 1 ? 's' : ''}</span> waiting for booking authorization
            </p>
          </div>
          <a href="/pilots" className="text-xs font-semibold text-blue-700 hover:text-blue-900 hover:underline">
            Review →
          </a>
        </div>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {isPilot ? (
          <>
            <StatCard
              title="My sessions"
              value={bookingStats?.upcomingReservations ?? '—'}
              subtitle="upcoming bookings"
              color="green"
            />
            <StatCard
              title="Available slots"
              value={bookingStats?.availableSlots ?? '—'}
              subtitle={`across ${bookingStats?.totalSimulators ?? 0} simulators`}
              color="sky"
            />
            <StatCard
              title="My CBTA score"
              value={cbtaStats ? cbtaStats.averageScore.toFixed(1) : '—'}
              subtitle={`${cbtaStats?.totalAssessments ?? 0} assessments`}
              color="purple"
            />
            <StatCard
              title="Simulators"
              value={bookingStats?.totalSimulators ?? '—'}
              subtitle="available facilities"
              color="blue"
            />
          </>
        ) : (
          <>
            <StatCard
              title="Total pilots"
              value={userStats?.pilots ?? '—'}
              subtitle={`${userStats?.instructors ?? 0} instructors`}
              color="blue"
            />
            <StatCard
              title="Upcoming sessions"
              value={bookingStats?.upcomingReservations ?? '—'}
              subtitle="confirmed bookings"
              color="green"
            />
            <StatCard
              title="Available slots"
              value={bookingStats?.availableSlots ?? '—'}
              subtitle={`across ${bookingStats?.totalSimulators ?? 0} simulators`}
              color="sky"
            />
            <StatCard
              title="Avg CBTA score"
              value={cbtaStats ? cbtaStats.averageScore.toFixed(1) : '—'}
              subtitle={`${cbtaStats?.totalAssessments ?? 0} assessments`}
              color="purple"
            />
          </>
        )}
      </div>

      {/* Upcoming reservations — only shown to authorized users */}
      {!isPending && (
        <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="font-semibold text-slate-800">Upcoming Sessions</h2>
            <a href="/bookings" className="text-xs text-brand hover:underline">View all →</a>
          </div>

          {Array.isArray(reservations) && reservations.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-400 uppercase tracking-wide border-b border-slate-50">
                  <th className="text-left px-5 py-3 font-medium">Simulator</th>
                  <th className="text-left px-5 py-3 font-medium">Aircraft</th>
                  <th className="text-left px-5 py-3 font-medium">Start</th>
                  <th className="text-left px-5 py-3 font-medium">End</th>
                  <th className="text-left px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {(reservations as Reservation[]).map(r => (
                  <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3 font-medium text-slate-900">{r.simulator_name}</td>
                    <td className="px-5 py-3 text-slate-500 text-xs font-mono">{r.aircraft}</td>
                    <td className="px-5 py-3 text-slate-600">{formatDate(r.start_time)}</td>
                    <td className="px-5 py-3 text-slate-600">{formatDate(r.end_time)}</td>
                    <td className="px-5 py-3">
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">
                        {r.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="px-5 py-10 text-center text-slate-400 text-sm">
              No upcoming sessions.{' '}
              <a href="/bookings" className="text-brand hover:underline">Book a simulator slot →</a>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
