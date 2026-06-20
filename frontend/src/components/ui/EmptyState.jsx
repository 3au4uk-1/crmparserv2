import { IconEmpty } from './Icons';

export default function EmptyState({ title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
      <IconEmpty className="text-ink-faint mb-4" />
      <h3 className="text-base font-semibold text-ink mb-1">{title}</h3>
      {description && (
        <p className="text-sm text-ink-muted max-w-sm leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
