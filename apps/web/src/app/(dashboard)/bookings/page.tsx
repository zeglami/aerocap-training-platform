'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/auth-context';
import type { Reservation, Simulator, Slot, SessionType } from '@/types';

function fmt(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
  });
}

interface ApiListResponse<T> { data: T[]; meta: { total: number } }
interface PilotOption { id: string; first_name: string; last_name: string; email: string }
interface Warning { code: string; message: string }
interface CalendarDay {
  date: string; status: string; title: string | null;
  blocks: { blockType: string; title: string | null }[];
}

const SESSION_TYPES: { value: SessionType; label: string }[] = [
  { value: 'RECURRENT',    label: 'Recurrent Training' },
  { value: 'OPC',          label: 'Operator Proficiency Check (OPC)' },
  { value: 'LPC',          label: 'Licence Proficiency Check (LPC)' },
  { value: 'ITR',          label: 'Initial Type Rating (ITR)' },
  { value: 'LINE_CHECK',   label: 'Line Check Preparation' },
  { value: 'UPRT',         label: 'Upset Prevention & Recovery (UPRT)' },
  { value: 'EBT',          label: 'Evidence-Based Training (EBT)' },
  { value: 'FREE_PRACTICE','label': 'Free Practice' },
];

const CALENDAR_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  AVAILABLE:         { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'Available' },
  HOLIDAY:           { bg: 'bg-indigo-50',  text: 'text-indigo-700',  label: 'Holiday' },
  MAINTENANCE:       { bg: 'bg-amber-50',   text: 'text-amber-700',   label: 'Maintenance' },
  BLOCKED:           { bg: 'bg-slate-100',  text: 'text-slate-500',   label: 'Unavailable' },
  PARTIALLY_AVAILABLE:{ bg: 'bg-amber-50',  text: 'text-amber-600',   label: 'Partial' },
  OVERRIDE_OPEN:     { bg: 'bg-cyan-50',    text: 'text-cyan-700',    label: 'Extended Hours' },
};

const IS_ADMIN_ROLE = ['GLOBAL_ADMIN', 'COUNTRY_ADMIN', 'INSTRUCTOR'] as const;

export default function BookingsPage() {
  const me        = useAuth();
  const isAdmin   = (IS_ADMIN_ROLE as readonly string[]).includes(me.role);

  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [simulators,   setSimulators]   = useState<Simulator[]>([]);
  const [pilots,       setPilots]       = useState<PilotOption[]>([]);
  const [slots,        setSlots]        = useState<Slot[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [bookingOpen,  setBookingOpen]  = useState(false);
  const [selPilot,     setSelPilot]     = useState('');   // admin: required
  const [selSim,       setSelSim]       = useState('');
  const [selSlot,      setSelSlot]      = useState('');
  const [notes,        setNotes]        = useState('');
  const [sessionType,  setSessionType]  = useState<SessionType>('RECURRENT');
  const [submitting,   setSubmitting]   = useState(false);
  const [error,        setError]        = useState('');
  const [warnings,     setWarnings]     = useState<Warning[]>([]);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [calendarDays, setCalendar]     = useState<CalendarDay[]>([]);
  const [calLoading,   setCalLoading]   = useState(true);

  const loadReservations = useCallback(async () => {
    const res = await fetch('/api/booking/reservations');
    if (res.ok) {
      const json = await res.json() as ApiListResponse<Reservation>;
      setReservations(json.data ?? []);
    }
  }, []);

  // Load calendar for next 14 days to show schedule status
  useEffect(() => {
    const from  = new Date().toISOString().slice(0, 10);
    const until = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
    setCalLoading(true);
    fetch(`/api/schedule/calendar?from=${from}&until=${until}`)
      .then(r => r.json())
      .then((j: { data: CalendarDay[] }) => setCalendar(j.data ?? []))
      .catch(() => setCalendar([]))
      .finally(() => setCalLoading(false));
  }, []);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const fetches: Promise<Response>[] = [
          fetch('/api/booking/reservations'),
          fetch('/api/booking/simulators'),
        ];
        if (isAdmin) fetches.push(fetch('/api/users/users?role=PILOT&limit=100'));

        const results = await Promise.all(fetches);
        const [resJson, simJson] = await Promise.all([
          results[0].json() as Promise<ApiListResponse<Reservation>>,
          results[1].json() as Promise<ApiListResponse<Simulator>>,
        ]);
        setReservations(resJson.data ?? []);
        setSimulators(simJson.data ?? []);

        if (isAdmin && results[2]) {
          const pilotJson = await results[2].json() as ApiListResponse<PilotOption>;
          setPilots(pilotJson.data ?? []);
        }
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, [isAdmin]);

  useEffect(() => {
    if (!selSim) { setSlots([]); return; }
    setSlotsLoading(true);

    // Fetch slots AND the 28-day calendar in parallel.
    // Only show slots whose date falls on an AVAILABLE or OVERRIDE_OPEN schedule day.
    const from  = new Date().toISOString().slice(0, 10);
    const until = new Date(Date.now() + 28 * 86_400_000).toISOString().slice(0, 10);

    Promise.all([
      fetch(`/api/booking/slots?simulatorId=${selSim}&available=true`).then(r => r.json() as Promise<ApiListResponse<Slot>>),
      fetch(`/api/schedule/calendar?from=${from}&until=${until}&simulatorId=${selSim}`).then(r => r.json()).catch(() => ({ data: [] as CalendarDay[] })),
    ])
      .then(([slotRes, calRes]) => {
        const allSlots = slotRes.data ?? [];
        const cal = (calRes as { data: CalendarDay[] }).data ?? [];

        if (cal.length === 0) {
          // Schedule-service offline — show all available slots (fallback)
          setSlots(allSlots);
          return;
        }

        // Build a set of dates that are open for booking
        const openDates = new Set(
          cal
            .filter(d => d.status === 'AVAILABLE' || d.status === 'OVERRIDE_OPEN')
            .map(d => d.date)   // "YYYY-MM-DD"
        );

        setSlots(allSlots.filter(s => openDates.has(s.start_time.slice(0, 10))));
      })
      .finally(() => setSlotsLoading(false));
  }, [selSim]);

  function openBookingModal() {
    setBookingOpen(true);
    setSelPilot(''); setSelSim(''); setSelSlot('');
    setNotes(''); setError(''); setWarnings([]); setSessionType('RECURRENT');
  }

  async function handleBook(e: React.FormEvent) {
    e.preventDefault();
    if (!selSlot) return;
    setSubmitting(true);
    setError('');

    const body: Record<string, string> = { slotId: selSlot, sessionType, notes };
    if (isAdmin && selPilot) body.forPilotId = selPilot;

    const res = await fetch('/api/booking/reservations', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    const json = await res.json() as { data: (Reservation & { warnings?: Warning[] }) | null; error: { message: string } | null };

    if (res.ok) {
      setWarnings(json.data?.warnings ?? []);
      if ((json.data?.warnings?.length ?? 0) === 0) {
        setBookingOpen(false);
      }
      await loadReservations();
    } else {
      setError(json.error?.message ?? 'Failed to book');
    }
    setSubmitting(false);
  }

  async function cancelReservation(id: string) {
    if (!confirm('Cancel this reservation?')) return;
    await fetch(`/api/booking/reservations/${id}`, { method: 'DELETE' });
    await loadReservations();
  }

  const isPending = !me.bookingAuthorized && me.role === 'PILOT';

  // Pending pilots: show only the lock screen, no booking UI
  if (isPending) {
    return (
      <div className="max-w-5xl mx-auto space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Simulator Bookings</h1>
          <p className="text-slate-500 text-sm mt-1">Manage your simulator session reservations.</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-100 p-10 text-center">
          <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-8 h-8 text-amber-500">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 1 0-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 0 0 2.25-2.25v-6.75a2.25 2.25 0 0 0-2.25-2.25H6.75a2.25 2.25 0 0 0-2.25 2.25v6.75a2.25 2.25 0 0 0 2.25 2.25Z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-slate-800 mb-2">Booking access not yet authorized</h2>
          <p className="text-slate-500 text-sm max-w-sm mx-auto">
            Your training manager needs to authorize your account before you can book simulator slots.
            You will receive confirmation once approved.
          </p>
          <p className="text-xs text-slate-400 mt-4">
            In the meantime, you can view your CBTA progress and profile.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Simulator Bookings</h1>
          <p className="text-slate-500 text-sm mt-1">Manage your simulator session reservations.</p>
        </div>
        <button
          onClick={openBookingModal}
          className="px-4 py-2 bg-brand hover:bg-brand-dark text-white text-sm font-semibold rounded-lg transition-colors flex items-center gap-2"
        >
          <span className="text-lg leading-none">+</span> Book a slot
        </button>
      </div>

      {/* Simulators overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {simulators.map(s => (
          <div key={s.id} className="bg-white rounded-xl border border-slate-100 p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-slate-900 text-sm">{s.name}</p>
                <p className="text-xs text-slate-400 mt-0.5">{s.aircraft}</p>
                <p className="text-xs text-slate-400">{s.type}</p>
              </div>
              <span className="text-xs bg-emerald-50 text-emerald-600 border border-emerald-100 px-2 py-0.5 rounded-full">Active</span>
            </div>
            <p className="text-xs text-slate-500 mt-3 flex items-center gap-1">
              <svg viewBox="0 0 16 16" fill="currentColor" className="w-3 h-3 flex-shrink-0">
                <path fillRule="evenodd" d="M8 1.5a.5.5 0 0 1 .5.5v5.793l2.146-2.147a.5.5 0 0 1 .708.708l-3 3a.5.5 0 0 1-.708 0l-3-3a.5.5 0 0 1 .708-.708L7.5 7.793V2a.5.5 0 0 1 .5-.5z"/>
              </svg>
              {s.location}
            </p>
          </div>
        ))}
      </div>

      {/* Availability calendar strip — pilots see only open vs closed days */}
      {!calLoading && calendarDays.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-100 p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-slate-800 text-sm">Next 14 Days — Slot Availability</h2>
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-400" />Open</span>
              <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-full bg-slate-300" />Closed</span>
            </div>
          </div>
          <div className="flex gap-1 overflow-x-auto pb-1">
            {calendarDays.map(day => {
              const isOpen = day.status === 'AVAILABLE' || day.status === 'OVERRIDE_OPEN';
              const d      = new Date(day.date + 'T12:00:00Z'); // noon UTC avoids DST day-shift
              const today  = new Date().toISOString().slice(0, 10);
              const isToday = day.date === today;
              return (
                <div key={day.date}
                  title={isOpen ? 'Slots available' : (day.title ?? CALENDAR_STATUS_STYLES[day.status]?.label ?? 'Unavailable')}
                  className={`flex flex-col items-center rounded-lg px-2.5 py-2 min-w-[44px] border transition-colors ${
                    isOpen
                      ? 'bg-emerald-50 border-emerald-200'
                      : 'bg-slate-50 border-slate-100 opacity-60'
                  } ${isToday ? 'ring-2 ring-brand ring-offset-1' : ''}`}>
                  <span className="text-xs font-medium text-slate-400">
                    {d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' })}
                  </span>
                  <span className={`text-sm font-bold mt-0.5 ${isOpen ? 'text-emerald-700' : 'text-slate-400'}`}>
                    {d.getUTCDate()}
                  </span>
                  {!isOpen && day.title && (
                    <span className="text-xs mt-0.5 text-slate-400 leading-tight text-center max-w-[40px] truncate" title={day.title}>
                      {day.title}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
          {calendarDays.some(d => d.status !== 'AVAILABLE' && d.status !== 'OVERRIDE_OPEN') && (
            <p className="text-xs text-slate-400 mt-2">
              Greyed-out days are closed for training (holiday or maintenance). Slots on those days will not appear in the booking form.
            </p>
          )}
        </div>
      )}

      {/* Reservations table */}
      <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-semibold text-slate-800">
            {isAdmin ? 'All Reservations' : 'Your Reservations'}
          </h2>
          {!loading && <span className="text-xs text-slate-400">{reservations.length} session{reservations.length !== 1 ? 's' : ''}</span>}
        </div>

        {loading ? (
          <div className="divide-y divide-slate-50">
            {[1,2,3].map(i => (
              <div key={i} className="px-5 py-4 animate-pulse flex gap-4">
                <div className="h-4 bg-slate-100 rounded w-40" />
                <div className="h-4 bg-slate-100 rounded w-32" />
                <div className="h-4 bg-slate-100 rounded w-32" />
              </div>
            ))}
          </div>
        ) : reservations.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="w-6 h-6 text-slate-400">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
              </svg>
            </div>
            <p className="text-slate-500 text-sm font-medium">No reservations yet</p>
            <p className="text-slate-400 text-xs mt-1">Book a simulator slot to get started.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-400 uppercase tracking-wide border-b border-slate-50">
                <th className="text-left px-5 py-3 font-medium">Simulator</th>
                <th className="text-left px-5 py-3 font-medium">Start</th>
                <th className="text-left px-5 py-3 font-medium">Duration</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="text-left px-5 py-3 font-medium"></th>
              </tr>
            </thead>
            <tbody>
              {reservations.map(r => {
                const durationH = Math.round((new Date(r.end_time).getTime() - new Date(r.start_time).getTime()) / 3_600_000);
                return (
                  <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3">
                      <p className="font-medium text-slate-900">{r.simulator_name}</p>
                      <p className="text-xs text-slate-400 font-mono">{r.aircraft}</p>
                    </td>
                    <td className="px-5 py-3 text-slate-600 text-sm">{fmt(r.start_time)}</td>
                    <td className="px-5 py-3 text-slate-500 text-xs">{durationH}h</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                        r.status === 'CONFIRMED' ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'
                      }`}>{r.status}</span>
                    </td>
                    <td className="px-5 py-3">
                      {r.status === 'CONFIRMED' && (
                        <button
                          onClick={() => cancelReservation(r.id)}
                          className="text-xs text-red-400 hover:text-red-600 transition-colors"
                        >
                          Cancel
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Booking modal */}
      {bookingOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-5 border-b border-slate-100">
              <h2 className="text-lg font-semibold text-slate-900">Book a Simulator Slot</h2>
              <button
                onClick={() => setBookingOpen(false)}
                className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleBook} className="px-6 py-5 space-y-4">
              {error && (
                <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{error}</div>
              )}
              {warnings.length > 0 && (
                <div className="p-3 rounded-lg bg-amber-50 border border-amber-200">
                  <p className="text-amber-800 font-semibold text-sm mb-1">Booking confirmed with warnings:</p>
                  {warnings.map(w => (
                    <p key={w.code} className="text-amber-700 text-xs mt-1">⚠ {w.message}</p>
                  ))}
                  <button type="button" onClick={() => { setBookingOpen(false); setWarnings([]); }}
                    className="mt-3 text-xs underline text-amber-700">Dismiss and close</button>
                </div>
              )}

              {/* Step 0 (admin/instructor only): choose which pilot to book for */}
              {isAdmin && (
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand text-white text-xs font-bold mr-1.5">1</span>
                    Pilot to book for
                  </label>
                  <select
                    required
                    value={selPilot}
                    onChange={e => { setSelPilot(e.target.value); setSelSim(''); setSelSlot(''); }}
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand bg-white"
                  >
                    <option value="">Select a pilot…</option>
                    {pilots.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.first_name} {p.last_name} — {p.email}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-400 mt-1">
                    Only booking-authorized pilots are listed.
                  </p>
                </div>
              )}

              {/* Session type */}
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-brand text-white text-xs font-bold mr-1.5">
                    {isAdmin ? '2' : '1'}
                  </span>
                  Session type
                </label>
                <select
                  value={sessionType}
                  onChange={e => setSessionType(e.target.value as SessionType)}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand bg-white"
                >
                  {SESSION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                {['LPC','OPC'].includes(sessionType) && (
                  <p className="text-xs text-amber-600 mt-1">
                    LPC/OPC requires FFS Level D and a qualified TRE examiner. 30-day gap rule applies.
                  </p>
                )}
              </div>

              {/* Step (admin): Choose simulator */}
              <div className={isAdmin && !selPilot ? 'opacity-40 pointer-events-none' : ''}>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold mr-1.5 ${(!isAdmin || selPilot) ? 'bg-brand text-white' : 'bg-slate-200 text-slate-500'}`}>
                    {isAdmin ? '3' : '2'}
                  </span>
                  Choose a simulator
                </label>
                <select
                  required
                  value={selSim}
                  onChange={e => { setSelSim(e.target.value); setSelSlot(''); }}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand bg-white"
                >
                  <option value="">Select a simulator…</option>
                  {simulators.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name} — {s.aircraft} ({s.type})
                    </option>
                  ))}
                </select>
              </div>

              {/* Slot picker */}
              <div className={selSim ? '' : 'opacity-40 pointer-events-none'}>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold mr-1.5 ${selSim ? 'bg-brand text-white' : 'bg-slate-200 text-slate-500'}`}>
                    {isAdmin ? '4' : '3'}
                  </span>
                  Pick a time slot
                </label>
                {slotsLoading ? (
                  <div className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm text-slate-400 animate-pulse bg-slate-50">
                    Loading available slots…
                  </div>
                ) : slots.length === 0 && selSim ? (
                  <div className="w-full px-3 py-2.5 rounded-lg border border-amber-200 bg-amber-50 text-sm text-amber-700 space-y-0.5">
                    <p className="font-medium">No available slots</p>
                    <p className="text-xs text-amber-600">
                      All upcoming slots are either booked or fall on a closed day (holiday / maintenance).
                      Try a different simulator or check back later.
                    </p>
                  </div>
                ) : (
                  <select
                    required={!!selSim}
                    value={selSlot}
                    onChange={e => setSelSlot(e.target.value)}
                    className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand bg-white"
                  >
                    <option value="">Select a time slot…</option>
                    {slots.map(s => (
                      <option key={s.id} value={s.id}>
                        {fmt(s.start_time)} → {new Date(s.end_time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* Notes */}
              <div className={selSlot ? '' : 'opacity-40 pointer-events-none'}>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">
                  <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs font-bold mr-1.5 ${selSlot ? 'bg-brand text-white' : 'bg-slate-200 text-slate-500'}`}>
                    {isAdmin ? '5' : '4'}
                  </span>
                  Notes <span className="font-normal text-slate-400">(optional)</span>
                </label>
                <textarea
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                  rows={2}
                  className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand resize-none bg-white"
                  placeholder="E.g. Initial type rating — LOFT scenario"
                />
              </div>

              <div className="flex gap-3 pt-1">
                <button
                  type="button"
                  onClick={() => setBookingOpen(false)}
                  className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !selSlot}
                  className="flex-1 py-2.5 rounded-lg bg-brand hover:bg-brand-dark disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-semibold transition-colors"
                >
                  {submitting ? 'Booking…' : 'Confirm Booking'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
