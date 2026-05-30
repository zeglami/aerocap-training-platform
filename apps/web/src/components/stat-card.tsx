interface StatCardProps {
  title:     string;
  value:     string | number;
  subtitle?: string;
  color?:    'blue' | 'green' | 'amber' | 'purple' | 'sky';
}

const colorMap = {
  blue:   'bg-blue-50 text-blue-700 border-blue-100',
  green:  'bg-emerald-50 text-emerald-700 border-emerald-100',
  amber:  'bg-amber-50 text-amber-700 border-amber-100',
  purple: 'bg-purple-50 text-purple-700 border-purple-100',
  sky:    'bg-sky-50 text-sky-700 border-sky-100',
};

export function StatCard({ title, value, subtitle, color = 'blue' }: StatCardProps) {
  return (
    <div className={`rounded-xl border p-5 ${colorMap[color]}`}>
      <p className="text-xs font-semibold uppercase tracking-wider opacity-70">{title}</p>
      <p className="text-3xl font-bold mt-2">{value}</p>
      {subtitle && <p className="text-xs mt-1 opacity-60">{subtitle}</p>}
    </div>
  );
}
