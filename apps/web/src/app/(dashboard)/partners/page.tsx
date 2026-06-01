'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

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
  status: 'ACTIVE' | 'SUSPENDED' | 'EXPIRED';
  created_at: string;
}

interface ApiResponse<T> { data: T; meta: { total?: number }; error: { message: string } | null }

const TYPE_LABELS: Record<string, string> = {
  AIRLINE: 'Airline',
  MILITARY: 'Military',
  TRAINING_ACADEMY: 'Training Academy',
  CORPORATE: 'Corporate',
  CHARTER: 'Charter',
};

const STATUS_STYLE: Record<string, string> = {
  ACTIVE:    'bg-emerald-100 text-emerald-700',
  SUSPENDED: 'bg-amber-100 text-amber-700',
  EXPIRED:   'bg-red-100 text-red-700',
};

function AddPartnerModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    name: '', icaoCode: '', type: 'AIRLINE', contactName: '', contactEmail: '',
    contractRef: '', contractStart: '', contractEnd: '', maxPilots: '', notes: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError('');
    try {
      const res = await fetch('/api/partner/partners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:          form.name,
          icaoCode:      form.icaoCode || undefined,
          type:          form.type,
          contactName:   form.contactName,
          contactEmail:  form.contactEmail,
          contractRef:   form.contractRef || undefined,
          contractStart: form.contractStart,
          contractEnd:   form.contractEnd || undefined,
          maxPilots:     form.maxPilots ? parseInt(form.maxPilots) : null,
          notes:         form.notes || undefined,
        }),
      });
      const json = await res.json() as ApiResponse<Partner>;
      if (!res.ok) { setError(json.error?.message ?? 'Error'); setLoading(false); return; }
      onCreated();
      onClose();
    } catch { setError('Network error'); setLoading(false); }
  }

  const field = (label: string, key: keyof typeof form, type = 'text', required = false) => (
    <div key={key}>
      <label className="block text-xs font-medium text-slate-600 mb-1">{label}{required && ' *'}</label>
      <input
        type={type}
        value={form[key]}
        onChange={e => setForm(f => ({ ...f, [key]: e.target.value }))}
        required={required}
        className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40"
      />
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl mx-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h2 className="font-semibold text-slate-900">Add Partner Organisation</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
        </div>
        <form onSubmit={submit} className="px-6 py-5 space-y-4">
          {error && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>}

          {field('Organisation Name', 'name', 'text', true)}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Type *</label>
              <select
                value={form.type}
                onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40"
              >
                {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
            {field('ICAO Code', 'icaoCode')}
          </div>

          <div className="grid grid-cols-2 gap-4">
            {field('Contact Name', 'contactName', 'text', true)}
            {field('Contact Email', 'contactEmail', 'email', true)}
          </div>

          <div className="grid grid-cols-2 gap-4">
            {field('Contract Start', 'contractStart', 'date', true)}
            {field('Contract End', 'contractEnd', 'date')}
          </div>

          <div className="grid grid-cols-2 gap-4">
            {field('Contract Reference', 'contractRef')}
            {field('Max Pilots', 'maxPilots', 'number')}
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={2}
              className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand/40 resize-none"
            />
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="flex-1 rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
            <button type="submit" disabled={loading}
              className="flex-1 rounded-lg bg-brand text-white px-4 py-2 text-sm font-medium hover:bg-brand-dark disabled:opacity-50">
              {loading ? 'Creating…' : 'Create Partner'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function PartnersPage() {
  const [partners, setPartners] = useState<Partner[]>([]);
  const [total, setTotal]       = useState(0);
  const [loading, setLoading]   = useState(true);
  const [showAdd, setShowAdd]   = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res  = await fetch('/api/partner/partners?limit=50');
      const json = await res.json() as ApiResponse<Partner[]>;
      setPartners(json.data ?? []);
      setTotal(json.meta?.total ?? 0);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <div className="max-w-6xl mx-auto space-y-6">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Partners</h1>
          <p className="text-slate-500 text-sm mt-1">
            B2B operator organisations — airlines, military, academies.
            {total > 0 && <span className="ml-1 text-slate-400">{total} partner{total !== 1 ? 's' : ''}</span>}
          </p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 rounded-lg bg-brand text-white px-4 py-2 text-sm font-medium hover:bg-brand-dark transition-colors"
        >
          <span className="text-lg leading-none">+</span> Add Partner
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="px-6 py-12 text-center text-sm text-slate-400">Loading…</div>
        ) : partners.length === 0 ? (
          <div className="px-6 py-12 text-center">
            <p className="text-slate-400 text-sm">No partner organisations yet.</p>
            <p className="text-slate-300 text-xs mt-1">Create the first B2B partner to get started.</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-400 uppercase tracking-wide border-b border-slate-50">
                <th className="text-left px-5 py-3 font-medium">Organisation</th>
                <th className="text-left px-5 py-3 font-medium">Type</th>
                <th className="text-left px-5 py-3 font-medium">Contact</th>
                <th className="text-left px-5 py-3 font-medium">Contract</th>
                <th className="text-left px-5 py-3 font-medium">Pilots</th>
                <th className="text-left px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody>
              {partners.map(p => (
                <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3">
                    <p className="font-semibold text-slate-900">{p.name}</p>
                    {p.icao_code && (
                      <span className="text-xs font-mono text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded">
                        {p.icao_code}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-slate-600 text-xs">{TYPE_LABELS[p.type] ?? p.type}</td>
                  <td className="px-5 py-3">
                    <p className="text-slate-700 text-xs font-medium">{p.contact_name}</p>
                    <p className="text-slate-400 text-xs">{p.contact_email}</p>
                  </td>
                  <td className="px-5 py-3 text-slate-500 text-xs">
                    {new Date(p.contract_start).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}
                    {p.contract_end
                      ? ` → ${new Date(p.contract_end).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}`
                      : ' → open-ended'}
                  </td>
                  <td className="px-5 py-3 text-slate-500 text-xs">
                    {p.max_pilots != null ? `≤ ${p.max_pilots}` : 'Unlimited'}
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_STYLE[p.status] ?? ''}`}>
                      {p.status}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link
                      href={`/partners/${p.id}`}
                      className="text-xs text-brand hover:underline font-medium"
                    >
                      Manage →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showAdd && (
        <AddPartnerModal onClose={() => setShowAdd(false)} onCreated={() => void load()} />
      )}
    </div>
  );
}
