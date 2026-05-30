'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/components/auth-context';

// ─── Types ────────────────────────────────────────────────────────────────────

interface BlockedPeriod {
  id: string; tenant_id: string; simulator_id: string | null;
  block_type: string; title: string; description: string | null;
  start_at: string; end_at: string; isPublic: boolean; affects_slots: boolean;
  created_at: string;
}

interface MaintenanceRecord {
  id: string; tenant_id: string; simulator_id: string;
  blocked_period_id: string | null; maintenance_type: string;
  title: string; description: string | null;
  planned_start_at: string; planned_end_at: string;
  actual_start_at: string | null; actual_end_at: string | null;
  status: string; technician_name: string | null;
  authority_reference_number: string | null;
  partialOperationAllowed: boolean; qualification_level_during: string | null;
  completion_notes: string | null; created_at: string;
}

interface OperatingSchedule {
  id: string; tenant_id: string; simulator_id: string | null;
  name: string; effective_from: string; effective_until: string | null;
  status: string; time_zone: string; dailyWindows: DailyWindow[];
  notes: string | null; created_at: string;
}

interface DailyWindow {
  dayOfWeek: number; openTime: string; closeTime: string; isOpen: boolean;
}

interface Simulator { id: string; name: string; aircraft: string; type: string; }
interface ApiResponse<T> { data: T; error: { message: string } | null }

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const BLOCK_TYPE_LABELS: Record<string, string> = {
  HOLIDAY: 'Holiday', MAINTENANCE: 'Maintenance',
  AUTHORITY_INSPECTION: 'Authority Inspection', WEATHER_CLOSURE: 'Weather Closure',
  SPECIAL_EVENT: 'Special Event', OTHER: 'Other',
};
const MAINTENANCE_TYPE_LABELS: Record<string, string> = {
  SCHEDULED_100H: 'Scheduled 100h', SCHEDULED_500H: 'Scheduled 500h',
  ANNUAL_RECERTIFICATION: 'Annual Recertification', COMPONENT_REPLACEMENT: 'Component Replacement',
  SOFTWARE_UPGRADE: 'Software Upgrade', UNSCHEDULED: 'Unscheduled', FSTD_REQUALIFICATION: 'FSTD Requalification',
};

// datetime-local inputs return "YYYY-MM-DDTHH:mm" — convert to full ISO 8601 UTC string
function toISO(v: FormDataEntryValue | null): string {
  if (!v) return '';
  const s = String(v).trim();
  if (!s) return '';
  return new Date(s).toISOString();
}

function fmtDt(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

const STATUS_STYLES: Record<string, string> = {
  ACTIVE: 'bg-emerald-100 text-emerald-700', DRAFT: 'bg-amber-100 text-amber-700',
  SUPERSEDED: 'bg-slate-100 text-slate-500', PLANNED: 'bg-blue-100 text-blue-700',
  IN_PROGRESS: 'bg-amber-100 text-amber-700', COMPLETED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-red-100 text-red-600',
};
const BLOCK_STYLES: Record<string, string> = {
  HOLIDAY: 'bg-indigo-100 text-indigo-700', MAINTENANCE: 'bg-amber-100 text-amber-700',
  AUTHORITY_INSPECTION: 'bg-orange-100 text-orange-700', WEATHER_CLOSURE: 'bg-sky-100 text-sky-700',
  SPECIAL_EVENT: 'bg-purple-100 text-purple-700', OTHER: 'bg-slate-100 text-slate-600',
};

// ═══════════════════════════════════════════════════════════════════════════════
// PAGE
// ═══════════════════════════════════════════════════════════════════════════════

export default function SchedulePage() {
  const me = useAuth();
  const canEdit = ['GLOBAL_ADMIN', 'COUNTRY_ADMIN', 'MANAGER'].includes(me.role);

  const [tab, setTab] = useState<'blocks' | 'maintenance' | 'schedules'>('blocks');
  const [simulators, setSimulators] = useState<Simulator[]>([]);

  // Blocked periods state
  const [blocks, setBlocks]     = useState<BlockedPeriod[]>([]);
  const [blocksLoading, setBL]  = useState(true);
  const [showBlockForm, setSBF] = useState(false);

  // Maintenance state
  const [maintenance, setMaint] = useState<MaintenanceRecord[]>([]);
  const [maintLoading, setML]   = useState(true);
  const [showMaintForm, setSMF] = useState(false);
  const [completingId, setCId]  = useState<string | null>(null);

  // Schedules state
  const [schedules, setScheds]  = useState<OperatingSchedule[]>([]);
  const [schedsLoading, setSchL]= useState(true);
  const [showSchedForm, setSSF] = useState(false);

  const [formError, setFormError] = useState('');
  const [submitting, setSub]      = useState(false);

  // ── Load data ────────────────────────────────────────────────────────────────

  const loadBlocks = useCallback(async () => {
    setBL(true);
    const r = await fetch('/api/schedule/blocked-periods?limit=50');
    const j = await r.json() as ApiResponse<BlockedPeriod[]>;
    setBlocks(j.data ?? []);
    setBL(false);
  }, []);

  const loadMaint = useCallback(async () => {
    setML(true);
    const r = await fetch('/api/schedule/maintenance?limit=50');
    const j = await r.json() as ApiResponse<MaintenanceRecord[]>;
    setMaint(j.data ?? []);
    setML(false);
  }, []);

  const loadScheds = useCallback(async () => {
    setSchL(true);
    const r = await fetch('/api/schedule/operating-schedules?limit=50');
    const j = await r.json() as ApiResponse<OperatingSchedule[]>;
    setScheds(j.data ?? []);
    setSchL(false);
  }, []);

  useEffect(() => {
    fetch('/api/booking/simulators').then(r => r.json()).then((j: ApiResponse<Simulator[]>) => setSimulators(j.data ?? []));
    void loadBlocks();
    void loadMaint();
    void loadScheds();
  }, [loadBlocks, loadMaint, loadScheds]);

  // ── Blocked period form ──────────────────────────────────────────────────────

  async function handleCreateBlock(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSub(true); setFormError('');
    const fd = new FormData(e.currentTarget);
    const body = {
      blockType:   fd.get('blockType'),
      title:       fd.get('title'),
      simulatorId: fd.get('simulatorId') || null,
      startAt:     toISO(fd.get('startAt')),
      endAt:       toISO(fd.get('endAt')),
      isPublic:    fd.get('isPublic') === 'true',
      affectsSlots: true,
    };
    const r = await fetch('/api/schedule/blocked-periods', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = await r.json() as ApiResponse<BlockedPeriod>;
    if (r.ok) { setSBF(false); await loadBlocks(); } else { setFormError(j.error?.message ?? 'Failed'); }
    setSub(false);
  }

  async function deleteBlock(id: string) {
    if (!confirm('Remove this blocked period?')) return;
    await fetch(`/api/schedule/blocked-periods/${id}`, { method: 'DELETE' });
    await loadBlocks();
  }

  // ── Maintenance form ─────────────────────────────────────────────────────────

  async function handleCreateMaint(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSub(true); setFormError('');
    const fd = new FormData(e.currentTarget);
    const body = {
      simulatorId:             fd.get('simulatorId'),
      maintenanceType:         fd.get('maintenanceType'),
      title:                   fd.get('title'),
      plannedStartAt:          toISO(fd.get('plannedStartAt')),
      plannedEndAt:            toISO(fd.get('plannedEndAt')),
      technicianName:          fd.get('technicianName') || null,
      authorityReferenceNumber:fd.get('authorityReferenceNumber') || null,
      partialOperationAllowed: fd.get('partialOperationAllowed') === 'true',
      qualificationLevelDuring:fd.get('qualificationLevelDuring') || null,
      autoCreateBlockedPeriod: true,
    };
    const r = await fetch('/api/schedule/maintenance', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = await r.json() as ApiResponse<MaintenanceRecord>;
    if (r.ok) { setSMF(false); await loadMaint(); await loadBlocks(); }
    else { setFormError(j.error?.message ?? 'Failed'); }
    setSub(false);
  }

  async function handleCompleteMaint(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!completingId) return;
    setSub(true); setFormError('');
    const fd = new FormData(e.currentTarget);
    const body = {
      completionNotes:          fd.get('completionNotes'),
      actualEndAt:              fd.get('actualEndAt') ? toISO(fd.get('actualEndAt')) : undefined,
      authorityReferenceNumber: fd.get('authorityReferenceNumber') || undefined,
    };
    const r = await fetch(`/api/schedule/maintenance/${completingId}/complete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = await r.json() as ApiResponse<MaintenanceRecord>;
    if (r.ok) { setCId(null); await loadMaint(); }
    else { setFormError(j.error?.message ?? 'Failed'); }
    setSub(false);
  }

  // ── Operating schedule form ──────────────────────────────────────────────────

  async function handleCreateSched(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSub(true); setFormError('');
    const fd = new FormData(e.currentTarget);

    const dailyWindows = DAYS.map((_, i) => ({
      dayOfWeek: i,
      openTime:  (fd.get(`open_${i}`) as string) || '06:00',
      closeTime: (fd.get(`close_${i}`) as string) || '22:00',
      isOpen:    fd.get(`isOpen_${i}`) === 'on',
    }));

    const body = {
      name:          fd.get('name'),
      simulatorId:   fd.get('simulatorId') || null,
      effectiveFrom: fd.get('effectiveFrom'),
      timeZone:      fd.get('timeZone') || 'UTC',
      dailyWindows,
    };
    const r = await fetch('/api/schedule/operating-schedules', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const j = await r.json() as ApiResponse<OperatingSchedule>;
    if (r.ok) { setSSF(false); await loadScheds(); }
    else { setFormError(j.error?.message ?? 'Failed'); }
    setSub(false);
  }

  async function activateSchedule(id: string) {
    const today = new Date().toISOString().slice(0, 10);
    const r = await fetch(`/api/schedule/operating-schedules/${id}/activate`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ effectiveFrom: today }),
    });
    if (r.ok) await loadScheds();
    else { const j = await r.json() as ApiResponse<null>; alert(j.error?.message ?? 'Failed'); }
  }

  async function deleteSchedule(id: string) {
    if (!confirm('Delete this schedule?')) return;
    await fetch(`/api/schedule/operating-schedules/${id}`, { method: 'DELETE' });
    await loadScheds();
  }

  // ── Not authorized ───────────────────────────────────────────────────────────

  if (!canEdit) {
    return (
      <div className="max-w-5xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-900 mb-4">Simulator Schedule</h1>
        <div className="bg-white rounded-xl border border-slate-100 p-10 text-center">
          <p className="text-slate-500">This area is restricted to Managers and Administrators.</p>
        </div>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Simulator Schedule Management</h1>
          <p className="text-slate-500 text-sm mt-1">Manage availability, blocked periods, and maintenance windows.</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 bg-slate-100 rounded-xl p-1 w-fit">
        {(['blocks', 'maintenance', 'schedules'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === t ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {t === 'blocks' ? 'Blocked Periods' : t === 'maintenance' ? 'Maintenance' : 'Operating Schedules'}
          </button>
        ))}
      </div>

      {/* ── BLOCKED PERIODS TAB ─────────────────────────────────────────────── */}
      {tab === 'blocks' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => { setSBF(true); setFormError(''); }}
              className="px-4 py-2 bg-brand hover:bg-brand-dark text-white text-sm font-semibold rounded-lg transition-colors">
              + Add Blocked Period
            </button>
          </div>

          {showBlockForm && (
            <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
              <h3 className="text-base font-semibold text-slate-900 mb-4">New Blocked Period</h3>
              {formError && <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{formError}</div>}
              <form onSubmit={handleCreateBlock} className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
                  <select name="blockType" required className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand">
                    {Object.entries(BLOCK_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
                  <input name="title" required placeholder="e.g. Bastille Day" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Simulator</label>
                  <select name="simulatorId" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand">
                    <option value="">All simulators (facility-wide)</option>
                    {simulators.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Visible to pilots?</label>
                  <select name="isPublic" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand">
                    <option value="true">Yes — show title and dates</option>
                    <option value="false">No — show as &quot;Unavailable&quot;</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Starts at</label>
                  <input type="datetime-local" name="startAt" required className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand"
                    onChange={e => { const v = e.target.value; if (v) e.target.value = new Date(v).toISOString().slice(0, 16); }} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Ends at</label>
                  <input type="datetime-local" name="endAt" required className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
                </div>
                <div className="col-span-2 flex gap-3 pt-2">
                  <button type="button" onClick={() => setSBF(false)} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
                  <button type="submit" disabled={submitting} className="flex-1 py-2.5 rounded-lg bg-brand hover:bg-brand-dark disabled:bg-slate-200 text-white text-sm font-semibold transition-colors">
                    {submitting ? 'Creating…' : 'Create Block'}
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-800">Active &amp; Upcoming Blocked Periods</h2>
            </div>
            {blocksLoading ? (
              <div className="p-8 text-center text-slate-400 text-sm animate-pulse">Loading…</div>
            ) : blocks.length === 0 ? (
              <div className="p-10 text-center text-slate-400 text-sm">No blocked periods defined.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-400 uppercase tracking-wide border-b border-slate-50">
                    <th className="text-left px-5 py-3 font-medium">Type</th>
                    <th className="text-left px-5 py-3 font-medium">Title</th>
                    <th className="text-left px-5 py-3 font-medium">Simulator</th>
                    <th className="text-left px-5 py-3 font-medium">Period</th>
                    <th className="text-left px-5 py-3 font-medium">Visibility</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {blocks.map(b => (
                    <tr key={b.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${BLOCK_STYLES[b.block_type] ?? 'bg-slate-100 text-slate-600'}`}>
                          {BLOCK_TYPE_LABELS[b.block_type] ?? b.block_type}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-medium text-slate-900">{b.title}</td>
                      <td className="px-5 py-3 text-slate-500 text-xs">
                        {b.simulator_id
                          ? simulators.find(s => s.id === b.simulator_id)?.name ?? b.simulator_id
                          : 'All simulators'}
                      </td>
                      <td className="px-5 py-3 text-slate-600 text-xs">
                        {fmtDt(b.start_at)} → {fmtDt(b.end_at)}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${b.isPublic ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-500'}`}>
                          {b.isPublic ? 'Public' : 'Internal'}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        <button onClick={() => deleteBlock(b.id)}
                          className="text-xs text-red-400 hover:text-red-600 transition-colors">Remove</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── MAINTENANCE TAB ─────────────────────────────────────────────────── */}
      {tab === 'maintenance' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => { setSMF(true); setFormError(''); }}
              className="px-4 py-2 bg-brand hover:bg-brand-dark text-white text-sm font-semibold rounded-lg transition-colors">
              + Schedule Maintenance
            </button>
          </div>

          {showMaintForm && (
            <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
              <h3 className="text-base font-semibold text-slate-900 mb-4">Schedule Maintenance Window</h3>
              <p className="text-xs text-slate-500 mb-4">A blocked period will be automatically created for this window.</p>
              {formError && <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{formError}</div>}
              <form onSubmit={handleCreateMaint} className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Simulator</label>
                  <select name="simulatorId" required className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand">
                    <option value="">Select…</option>
                    {simulators.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Maintenance Type</label>
                  <select name="maintenanceType" required className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand">
                    {Object.entries(MAINTENANCE_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </div>
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
                  <input name="title" required placeholder="e.g. FFS Level D 4-week maintenance" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Planned Start</label>
                  <input type="datetime-local" name="plannedStartAt" required className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Planned End</label>
                  <input type="datetime-local" name="plannedEndAt" required className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Technician (optional)</label>
                  <input name="technicianName" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Authority Ref. # (optional)</label>
                  <input name="authorityReferenceNumber" placeholder="e.g. DGAC-FSTD-2026-042" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Partial operation allowed?</label>
                  <select name="partialOperationAllowed" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand">
                    <option value="false">No — simulator fully unavailable</option>
                    <option value="true">Yes — ground briefings only</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Effective qualification during (if partial)</label>
                  <input name="qualificationLevelDuring" placeholder="e.g. FTD" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
                </div>
                <div className="col-span-2 flex gap-3 pt-2">
                  <button type="button" onClick={() => setSMF(false)} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
                  <button type="submit" disabled={submitting} className="flex-1 py-2.5 rounded-lg bg-brand hover:bg-brand-dark disabled:bg-slate-200 text-white text-sm font-semibold transition-colors">
                    {submitting ? 'Scheduling…' : 'Schedule Maintenance'}
                  </button>
                </div>
              </form>
            </div>
          )}

          {completingId && (
            <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
              <h3 className="text-base font-semibold text-slate-900 mb-4">Mark Maintenance Complete</h3>
              {formError && <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{formError}</div>}
              <form onSubmit={handleCompleteMaint} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Actual End Time (leave blank for now)</label>
                  <input type="datetime-local" name="actualEndAt" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Completion Notes <span className="text-red-500">*</span></label>
                  <textarea name="completionNotes" required minLength={10} rows={3} placeholder="Describe what was done and the outcome…" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand resize-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1">Authority Reference # (optional)</label>
                  <input name="authorityReferenceNumber" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
                </div>
                <div className="flex gap-3">
                  <button type="button" onClick={() => setCId(null)} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
                  <button type="submit" disabled={submitting} className="flex-1 py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:bg-slate-200 text-white text-sm font-semibold transition-colors">
                    {submitting ? 'Saving…' : 'Mark Complete'}
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-800">Maintenance Records</h2>
            </div>
            {maintLoading ? (
              <div className="p-8 text-center text-slate-400 text-sm animate-pulse">Loading…</div>
            ) : maintenance.length === 0 ? (
              <div className="p-10 text-center text-slate-400 text-sm">No maintenance records.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-400 uppercase tracking-wide border-b border-slate-50">
                    <th className="text-left px-5 py-3 font-medium">Simulator</th>
                    <th className="text-left px-5 py-3 font-medium">Type</th>
                    <th className="text-left px-5 py-3 font-medium">Title</th>
                    <th className="text-left px-5 py-3 font-medium">Planned Period</th>
                    <th className="text-left px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {maintenance.map(m => (
                    <tr key={m.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                      <td className="px-5 py-3 text-slate-600 text-xs">
                        {simulators.find(s => s.id === m.simulator_id)?.name ?? m.simulator_id}
                      </td>
                      <td className="px-5 py-3 text-xs text-slate-500">
                        {MAINTENANCE_TYPE_LABELS[m.maintenance_type] ?? m.maintenance_type}
                      </td>
                      <td className="px-5 py-3 font-medium text-slate-900">{m.title}</td>
                      <td className="px-5 py-3 text-xs text-slate-500">
                        {fmtDate(m.planned_start_at)} → {fmtDate(m.planned_end_at)}
                      </td>
                      <td className="px-5 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[m.status] ?? 'bg-slate-100 text-slate-500'}`}>
                          {m.status.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-5 py-3">
                        {['PLANNED','IN_PROGRESS'].includes(m.status) && (
                          <button onClick={() => { setCId(m.id); setFormError(''); }}
                            className="text-xs text-emerald-600 hover:text-emerald-800 font-medium transition-colors">
                            Complete
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {/* ── OPERATING SCHEDULES TAB ─────────────────────────────────────────── */}
      {tab === 'schedules' && (
        <div className="space-y-4">
          <div className="flex justify-end">
            <button onClick={() => { setSSF(true); setFormError(''); }}
              className="px-4 py-2 bg-brand hover:bg-brand-dark text-white text-sm font-semibold rounded-lg transition-colors">
              + New Schedule
            </button>
          </div>

          {showSchedForm && (
            <div className="bg-white rounded-2xl border border-slate-100 p-6 shadow-sm">
              <h3 className="text-base font-semibold text-slate-900 mb-1">New Operating Schedule</h3>
              <p className="text-xs text-slate-500 mb-4">Define when the facility (or a specific simulator) is open for bookings each week.</p>
              {formError && <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm">{formError}</div>}
              <form onSubmit={handleCreateSched} className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Schedule Name</label>
                    <input name="name" required placeholder="e.g. Standard CDG Weekday Schedule" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Simulator (optional)</label>
                    <select name="simulatorId" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand">
                      <option value="">All simulators (facility-wide)</option>
                      {simulators.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Effective From</label>
                    <input type="date" name="effectiveFrom" required defaultValue={new Date().toISOString().slice(0, 10)} className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1">Timezone</label>
                    <select name="timeZone" className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-brand">
                      <option value="Europe/Paris">Europe/Paris (UTC+1/+2)</option>
                      <option value="Africa/Johannesburg">Africa/Johannesburg (UTC+2)</option>
                      <option value="Asia/Shanghai">Asia/Shanghai (UTC+8)</option>
                      <option value="Asia/Kolkata">Asia/Kolkata (UTC+5:30)</option>
                      <option value="UTC">UTC</option>
                    </select>
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium text-slate-700 mb-2">Daily Operating Windows</p>
                  <div className="rounded-xl border border-slate-200 overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="text-left px-4 py-2 font-medium text-slate-600 text-xs">Day</th>
                          <th className="text-left px-4 py-2 font-medium text-slate-600 text-xs">Open?</th>
                          <th className="text-left px-4 py-2 font-medium text-slate-600 text-xs">Opens</th>
                          <th className="text-left px-4 py-2 font-medium text-slate-600 text-xs">Closes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {DAYS.map((day, i) => (
                          <tr key={i} className="border-t border-slate-100">
                            <td className="px-4 py-2 font-medium text-slate-800 text-xs">{day}</td>
                            <td className="px-4 py-2">
                              <input type="checkbox" name={`isOpen_${i}`}
                                defaultChecked={i >= 1 && i <= 5}
                                className="w-4 h-4 accent-brand" />
                            </td>
                            <td className="px-4 py-2">
                              <input type="time" name={`open_${i}`} defaultValue="06:00"
                                className="px-2 py-1 rounded border border-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-brand" />
                            </td>
                            <td className="px-4 py-2">
                              <input type="time" name={`close_${i}`} defaultValue="22:00"
                                className="px-2 py-1 rounded border border-slate-200 text-xs focus:outline-none focus:ring-1 focus:ring-brand" />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={() => setSSF(false)} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50">Cancel</button>
                  <button type="submit" disabled={submitting} className="flex-1 py-2.5 rounded-lg bg-brand hover:bg-brand-dark disabled:bg-slate-200 text-white text-sm font-semibold transition-colors">
                    {submitting ? 'Creating…' : 'Create Schedule (DRAFT)'}
                  </button>
                </div>
              </form>
            </div>
          )}

          <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="font-semibold text-slate-800">Operating Schedules</h2>
            </div>
            {schedsLoading ? (
              <div className="p-8 text-center text-slate-400 text-sm animate-pulse">Loading…</div>
            ) : schedules.length === 0 ? (
              <div className="p-10 text-center text-slate-400 text-sm">No schedules defined. Create one to control when bookings are available.</div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-400 uppercase tracking-wide border-b border-slate-50">
                    <th className="text-left px-5 py-3 font-medium">Name</th>
                    <th className="text-left px-5 py-3 font-medium">Simulator</th>
                    <th className="text-left px-5 py-3 font-medium">Effective</th>
                    <th className="text-left px-5 py-3 font-medium">Status</th>
                    <th className="text-left px-5 py-3 font-medium">Open days</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {schedules.map(s => {
                    const openDays = Array.isArray(s.dailyWindows)
                      ? s.dailyWindows.filter(w => w.isOpen).map(w => DAYS[w.dayOfWeek]).join(', ')
                      : '—';
                    return (
                      <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                        <td className="px-5 py-3 font-medium text-slate-900">{s.name}</td>
                        <td className="px-5 py-3 text-xs text-slate-500">
                          {s.simulator_id ? simulators.find(sim => sim.id === s.simulator_id)?.name ?? s.simulator_id : 'All simulators'}
                        </td>
                        <td className="px-5 py-3 text-xs text-slate-500">
                          From {fmtDate(s.effective_from)}{s.effective_until ? ` → ${fmtDate(s.effective_until)}` : ' (indefinite)'}
                        </td>
                        <td className="px-5 py-3">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLES[s.status] ?? 'bg-slate-100 text-slate-500'}`}>
                            {s.status}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-xs text-slate-500">{openDays}</td>
                        <td className="px-5 py-3 flex gap-3">
                          {s.status === 'DRAFT' && (
                            <button onClick={() => activateSchedule(s.id)}
                              className="text-xs text-brand hover:text-brand-dark font-medium transition-colors">
                              Activate
                            </button>
                          )}
                          {s.status === 'DRAFT' && (
                            <button onClick={() => deleteSchedule(s.id)}
                              className="text-xs text-red-400 hover:text-red-600 transition-colors">
                              Delete
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
        </div>
      )}
    </div>
  );
}
