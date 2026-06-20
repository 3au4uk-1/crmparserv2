export function SkeletonLine({ className = 'h-4 w-full' }) {
  return <div className={`skeleton ${className}`} aria-hidden="true" />;
}

export function TableSkeleton({ rows = 5, cols = 6 }) {
  return (
    <div className="p-4 space-y-3" aria-label="Загрузка">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3">
          {Array.from({ length: cols }).map((_, j) => (
            <SkeletonLine key={j} className={`h-4 flex-1 ${j === 0 ? 'max-w-[2rem]' : ''}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function StatSkeleton() {
  return (
    <div className="surface p-5 space-y-3">
      <SkeletonLine className="h-3 w-24" />
      <SkeletonLine className="h-8 w-16" />
    </div>
  );
}
