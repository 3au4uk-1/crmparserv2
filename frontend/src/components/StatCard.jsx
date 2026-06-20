const colorMap = {
  gray: 'bg-pastel-gray-bg border-pastel-gray-bg',
  yellow: 'bg-pastel-yellow-bg border-pastel-yellow-bg',
  blue: 'bg-pastel-blue-bg border-pastel-blue-bg',
  green: 'bg-pastel-green-bg border-pastel-green-bg',
  red: 'bg-pastel-red-bg border-pastel-red-bg',
};

const textMap = {
  gray: 'text-pastel-gray-text',
  yellow: 'text-pastel-yellow-text',
  blue: 'text-pastel-blue-text',
  green: 'text-pastel-green-text',
  red: 'text-pastel-red-text',
};

export default function StatCard({ label, value, color = 'gray', highlight = false }) {
  return (
    <div
      className={`rounded-lg border p-5 transition-shadow duration-200 hover:shadow-subtle ${
        highlight ? 'surface ring-1 ring-ink/5' : colorMap[color]
      }`}
    >
      <p className={`text-xs font-medium uppercase tracking-wide opacity-80 ${textMap[color]}`}>
        {label}
      </p>
      <p className={`text-3xl font-semibold mt-2 tabular-nums tracking-tight ${textMap[color]}`}>
        {value}
      </p>
    </div>
  );
}
