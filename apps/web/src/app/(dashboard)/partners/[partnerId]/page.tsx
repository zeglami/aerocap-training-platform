'use client';

import { useEffect, useState, use } from 'react';

interface Partner {
  id: string;
  name: string;
  icao_code: string | null;
  type: string;
  contact_name: string;
  contact_email: string;
  contract_start: string;
  contract_end: string | null;
  max_pilots: number | null;
  status: string;
  notes: string | null;
}

interface Member {
  id: string;
  user_id: string;
  member_role: string;
  booking_authorized: number;
  authorized_at: string | null;
  joined_at: string;
  status: string;
  notes: string | null;
}

interface Stats {
  totalMembers: number;
  authorizedMembers: number;
  pendingMembers: number;
  suspendedMembers: number;
}

interface ApiResponse<T> { data: T; meta: { total?: number }; error: { message: string } | null }

const TYPE_LABELS: Record<string, string> = {
  AIRLINE: 'Airline', MILITARY: 'Military',
  TRAINING_ACADEMY: 'Training Academy', CORPORATE: 'Corporate', CHARTER: 'Charter',
};

const MEMBER_ROLE_STYLE: Record<string, string> = {
  PILOT:               'bg-slate-100 text-slate-600',
  PARTNER_ADMIN:       'bg-brand/10 text-brand',
  PARTNER_COORDINATOR: 'bg-blue-100 text-blue-700',
};

function StatCard({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-100 p-5">
      <p className="text-xs text-slate-400 uppercase tracking-wide">{label}</p>
      <p className={`text-3xl font-bold mt-1 ${accent ?? 'text-slate-900'}`}>{value}</p>
    </div>
  );
}

function AddMemberModal({
  partnerId,
  onClose,
  onAdded,
}: { partnerId: string; onClose: () => void; onAdded: () => void }) {
  const [userId, setUserId]     = useState('');
  const [role, setRole]         = useState('PILOT');
  const [notes, setNotes]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const res  = await fetch(`/api/partner/partners/${partnerId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, memberRole: role, notes: notes || undefined }),
      });
      const json = await res.json() as ApiResponse<Member>;
      if (!res.ok) { setError(json.error?.message ?? 'Error'); setLoading(false); return; }
      onAdded(); onClose();
    } catch { setError('Network error'); setLoading(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">Add Pilot to Partner</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">User ID (UUID) *</label>
            <input
              type="text"
              value={userId}
              onChange={e => setUserId(e.target.value)}
              required
              placeholder="e.g. pilot-alice or UUID"
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40 font-mono"
            />
            <p className="text-xs text-slate-400 mt-1">Find the user ID from the Pilots page.</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Role</label>
            <select
              value={role}
              onChange={e => setRole(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40"
            >
              <option value="PILOT">Pilot</option>
              <option value="PARTNER_ADMIN">Partner Admin</option>
              <option value="PARTNER_COORDINATOR">Partner Coordinator</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40"
            />
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 rounded-lg bg-brand text-white px-4 py-2 text-sm font-medium hover:bg-brand-dark disabled:opacity-50">
              {loading ? 'Adding…' : 'Add Member'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function PartnerDetailPage({ params }: { params: Promise<{ partnerId: string }> }) {
  const { partnerId } = use(params);

  const [partner, setPartner]   = useState<Partner | null>(null);
  const [members, setMembers]   = useState<Member[]>([]);
  const [stats, setStats]       = useState<Stats | null>(null);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(true);
  const [showAdd, setShowAdd]   = useState(false);
  const [actionId, setActionId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [pRes, mRes, sRes] = await Promise.all([
        fetch(`/api/partner/partners/${partnerId}`),
        fetch(`/api/partner/partners/${partnerId}/members?limit=100`),
        fetch(`/api/partner/partners/${partnerId}/stats`),
      ]);
      const [pJson, mJson, sJson] = await Promise.all([
        pRes.json() as Promise<ApiResponse<Partner>>,
        mRes.json() as Promise<ApiResponse<Member[]>>,
        sRes.json() as Promise<ApiResponse<Stats>>,
      ]);
      setPartner(pJson.data ?? null);
      setMembers(mJson.data ?? []);
      setTotal(mJson.meta?.total ?? 0);
      setStats(sJson.data ?? null);
    } finally {
      setLoading(false);
    }
  }

  async function authorize(memberId: string, userId: string, grant: boolean) {
    setActionId(memberId);
    const endpoint = grant ? 'authorize' : 'authorize';
    const method   = grant ? 'POST' : 'DELETE';
    await fetch(`/api/partner/partners/${partnerId}/members/${memberId}/${endpoint}`, { method });
    setActionId(null);
    void load();
  }

  async function removeMember(memberId: string) {
    if (!confirm('Remove this member from the partner? Their booking access will not be automatically revoked.')) return;
    await fetch(`/api/partner/partners/${partnerId}/members/${memberId}`, { method: 'DELETE' });
    void load();
  }

  useEffect(() => { void load(); }, [partnerId]);

  if (loading) {
    return <div className="flex items-center justify-center py-24 text-slate-400 text-sm">Loading…</div>;
  }
  if (!partner) {
    return <div className="flex items-center justify-center py-24 text-slate-400 text-sm">Partner not found.</div>;
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-slate-900">{partner.name}</h1>
            {partner.icao_code && (
              <span className="font-mono text-xs bg-slate-100 text-slate-500 px-2 py-1 rounded">
                {partner.icao_code}
              </span>
            )}
            <span className={`text-xs font-medium px-2 py-1 rounded-full ${
              partner.status === 'ACTIVE' ? 'bg-emerald-100 text-emerald-700' :
              partner.status === 'SUSPENDED' ? 'bg-amber-100 text-amber-700' :
              'bg-red-100 text-red-700'}`}>
              {partner.status}
            </span>
          </div>
          <p className="text-slate-500 text-sm mt-1">
            {TYPE_LABELS[partner.type] ?? partner.type} · {partner.contact_name} · {partner.contact_email}
          </p>
        </div>
        <a href="/partners" className="text-xs text-slate-400 hover:text-slate-600">← All partners</a>
      </div>

      {/* Contract info */}
      <div className="bg-white rounded-xl border border-slate-100 px-6 py-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wide">Contract start</p>
            <p className="font-medium text-slate-700 mt-1">
              {new Date(partner.contract_start).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wide">Contract end</p>
            <p className="font-medium text-slate-700 mt-1">
              {partner.contract_end
                ? new Date(partner.contract_end).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                : 'Open-ended'}
            </p>
          </div>
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wide">Pilot limit</p>
            <p className="font-medium text-slate-700 mt-1">{partner.max_pilots ?? 'Unlimited'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 uppercase tracking-wide">Type</p>
            <p className="font-medium text-slate-700 mt-1">{TYPE_LABELS[partner.type] ?? partner.type}</p>
          </div>
        </div>
        {partner.notes && (
          <p className="text-xs text-slate-400 mt-4 border-t border-slate-50 pt-3">{partner.notes}</p>
        )}
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <StatCard label="Total members"  value={stats.totalMembers} />
          <StatCard label="Booking authorised" value={stats.authorizedMembers} accent="text-emerald-600" />
          <StatCard label="Pending auth"   value={stats.pendingMembers} accent={stats.pendingMembers > 0 ? 'text-amber-600' : undefined} />
          <StatCard label="Suspended"      value={stats.suspendedMembers} accent={stats.suspendedMembers > 0 ? 'text-red-600' : undefined} />
        </div>
      )}

      {/* Members */}
      <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-slate-800">Pilots & Admins</h2>
            <p className="text-xs text-slate-400 mt-0.5">{total} member{total !== 1 ? 's' : ''}</p>
          </div>
          <button
            onClick={() => setShowAdd(true)}
            className="flex items-center gap-1.5 text-xs font-medium text-brand hover:text-brand-dark border border-brand/20 hover:border-brand/40 rounded-lg px-3 py-1.5 transition-colors"
          >
            + Add Member
          </button>
        </div>

        {members.length === 0 ? (
          <div className="px-5 py-10 text-center text-slate-400 text-sm">
            No members yet. Add a pilot or partner admin to get started.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-400 uppercase tracking-wide border-b border-slate-50">
                <th className="text-left px-5 py-3 font-medium">User ID</th>
                <th className="text-left px-5 py-3 font-medium">Role</th>
                <th className="text-left px-5 py-3 font-medium">Booking Auth</th>
                <th className="text-left px-5 py-3 font-medium">Joined</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {members.map(m => (
                <tr key={m.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3 font-mono text-xs text-slate-500">{m.user_id}</td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded text-xs font-medium ${MEMBER_ROLE_STYLE[m.member_role] ?? 'bg-slate-100 text-slate-600'}`}>
                      {m.member_role.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-5 py-3">
                    {m.booking_authorized ? (
                      <span className="flex items-center gap-1 text-xs text-emerald-600 font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 inline-block" />
                        Authorised
                        {m.authorized_at && (
                          <span className="text-slate-300 font-normal">
                            · {new Date(m.authorized_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 text-xs text-amber-600 font-medium">
                        <span className="w-1.5 h-1.5 rounded-full bg-amber-400 inline-block" />
                        Pending
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-slate-400 text-xs">
                    {new Date(m.joined_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`text-xs font-medium ${m.status === 'ACTIVE' ? 'text-slate-500' : 'text-red-500'}`}>
                      {m.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      {m.booking_authorized ? (
                        <button
                          disabled={actionId === m.id}
                          onClick={() => authorize(m.id, m.user_id, false)}
                          className="text-xs text-amber-600 hover:text-amber-800 disabled:opacity-40"
                        >
                          Revoke
                        </button>
                      ) : (
                        <button
                          disabled={actionId === m.id}
                          onClick={() => authorize(m.id, m.user_id, true)}
                          className="text-xs text-emerald-600 hover:text-emerald-800 font-medium disabled:opacity-40"
                        >
                          Authorise
                        </button>
                      )}
                      <button
                        onClick={() => removeMember(m.id)}
                        className="text-xs text-red-400 hover:text-red-600"
                      >
                        Remove
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && (
        <AddMemberModal
          partnerId={partnerId}
          onClose={() => setShowAdd(false)}
          onAdded={() => void load()}
        />
      )}
    </div>
  );
}
