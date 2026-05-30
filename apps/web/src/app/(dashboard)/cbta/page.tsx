import { getServerToken, getServerUser } from '@/lib/auth';
import { createServiceClient } from '@/lib/api';
import type { ProgressItem, Assessment } from '@/types';

const CBTA_SVC = process.env.CBTA_SERVICE_URL ?? 'http://localhost:3003';

interface ProgressResponse { progress: ProgressItem[]; history: Assessment[] }

const SCORE_LABEL: Record<number, string> = {
  1: 'Below Standard',
  2: 'Developing',
  3: 'Meets Standard',
  4: 'Exceeds Standard',
  5: 'Exemplary',
};

const SCORE_COLOR: Record<number, string> = {
  1: 'bg-red-100 text-red-700',
  2: 'bg-orange-100 text-orange-700',
  3: 'bg-yellow-100 text-yellow-700',
  4: 'bg-emerald-100 text-emerald-700',
  5: 'bg-blue-100 text-blue-700',
};

function ScoreBar({ score }: { score: number | null }) {
  if (!score) return <span className="text-xs text-slate-400">Not assessed</span>;
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5">
        {[1, 2, 3, 4, 5].map(i => (
          <div
            key={i}
            className={`h-2 w-4 rounded-sm ${i <= score ? 'bg-brand' : 'bg-slate-200'}`}
          />
        ))}
      </div>
      <span className={`inline-flex px-1.5 py-0.5 rounded text-xs font-medium ${SCORE_COLOR[score] ?? ''}`}>
        {score}/5
      </span>
    </div>
  );
}

export default async function CbtaPage() {
  const [token, user] = await Promise.all([getServerToken(), getServerUser()]);
  const api = createServiceClient(CBTA_SVC, token);

  let progress: ProgressItem[] = [];
  let history: Assessment[]    = [];

  try {
    const data = await api.get<ProgressResponse>(`/api/v1/progress/${user!.id}`);
    progress = data.progress;
    history  = data.history;
  } catch {
    // service unavailable — show empty state
  }

  const technical    = progress.filter(p => p.category === 'TECHNICAL');
  const nonTechnical = progress.filter(p => p.category === 'NON_TECHNICAL');

  const overallAvg = progress.length > 0
    ? (progress.reduce((sum, p) => sum + (p.average_score ?? 0), 0) / progress.filter(p => p.average_score).length)
    : null;

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">CBTA Progress</h1>
        <p className="text-slate-500 text-sm mt-1">
          Competency-Based Training & Assessment — EASA standard (8 competency units)
        </p>
      </div>

      {/* Summary bar */}
      {overallAvg !== null && (
        <div className="bg-gradient-to-r from-brand to-brand-dark rounded-xl p-5 text-white">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium opacity-80">Overall average score</p>
              <p className="text-4xl font-bold mt-1">{overallAvg.toFixed(2)}<span className="text-lg font-normal opacity-60"> / 5</span></p>
              <p className="text-sm opacity-70 mt-1">{SCORE_LABEL[Math.round(overallAvg)] ?? ''}</p>
            </div>
            <div className="text-right opacity-70">
              <p className="text-2xl font-bold">{progress.filter(p => p.total_assessments > 0).length}/{progress.length}</p>
              <p className="text-xs mt-1">units assessed</p>
            </div>
          </div>
        </div>
      )}

      {/* Competency tables */}
      {[
        { label: 'Technical Competencies', items: technical },
        { label: 'Non-Technical Competencies', items: nonTechnical },
      ].map(section => (
        <div key={section.label} className="bg-white rounded-xl border border-slate-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800">{section.label}</h2>
          </div>
          {section.items.length === 0 ? (
            <div className="px-5 py-8 text-center text-slate-400 text-sm">
              No data available. Run services to populate.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-slate-400 uppercase tracking-wide border-b border-slate-50">
                  <th className="text-left px-5 py-3 font-medium w-16">Code</th>
                  <th className="text-left px-5 py-3 font-medium">Competency</th>
                  <th className="text-left px-5 py-3 font-medium">Latest Score</th>
                  <th className="text-left px-5 py-3 font-medium">Average</th>
                  <th className="text-left px-5 py-3 font-medium">Sessions</th>
                  <th className="text-left px-5 py-3 font-medium">Last Assessed</th>
                </tr>
              </thead>
              <tbody>
                {section.items.map(p => (
                  <tr key={p.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                    <td className="px-5 py-3">
                      <span className="inline-flex items-center px-2 py-1 rounded bg-slate-100 text-slate-600 text-xs font-mono font-bold">
                        {p.code}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-slate-900 font-medium">{p.name}</td>
                    <td className="px-5 py-3"><ScoreBar score={p.latest_score} /></td>
                    <td className="px-5 py-3 text-slate-600 text-xs">
                      {p.average_score ? p.average_score.toFixed(1) : '—'}
                    </td>
                    <td className="px-5 py-3 text-slate-500 text-xs">{p.total_assessments}</td>
                    <td className="px-5 py-3 text-slate-400 text-xs">
                      {p.last_assessed
                        ? new Date(p.last_assessed).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}

      {/* Recent assessment history */}
      {history.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-100 overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800">Assessment History</h2>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs text-slate-400 uppercase tracking-wide border-b border-slate-50">
                <th className="text-left px-5 py-3 font-medium">Date</th>
                <th className="text-left px-5 py-3 font-medium">Unit</th>
                <th className="text-left px-5 py-3 font-medium">Score</th>
              </tr>
            </thead>
            <tbody>
              {history.slice(0, 20).map((a, i) => (
                <tr key={i} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                  <td className="px-5 py-3 text-slate-500 text-xs">
                    {new Date(a.assessed_at).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-5 py-3">
                    <span className="font-mono text-xs text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded mr-2">{a.code}</span>
                  </td>
                  <td className="px-5 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${SCORE_COLOR[a.score] ?? ''}`}>
                      {a.score}/5
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
