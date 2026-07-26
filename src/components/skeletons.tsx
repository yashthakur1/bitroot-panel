// Shimmer skeleton building blocks. The .shimmer class (globals.css) draws a
// light sweep across a gray block.

export function Shimmer({ className = '' }: { className?: string }) {
  return <div className={`shimmer ${className}`} />;
}

export function TableSkeleton({ rows = 5, cols = 6 }: { rows?: number; cols?: number }) {
  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="bg-gray-50 px-4 py-3 flex gap-6">
        {Array.from({ length: cols }).map((_, i) => (
          <Shimmer key={i} className="h-3 w-20" />
        ))}
      </div>
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="border-t px-4 py-4 flex gap-6 items-center">
          {Array.from({ length: cols }).map((_, c) => (
            <Shimmer key={c} className={`h-4 ${c === 0 ? 'w-32' : 'w-16'}`} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function StatCardsSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="border rounded-lg p-4 space-y-2">
          <Shimmer className="h-3 w-14" />
          <Shimmer className="h-6 w-20" />
        </div>
      ))}
    </div>
  );
}

export function PageSkeleton() {
  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <Shimmer className="h-9 w-56" />
        <div className="flex gap-3">
          <Shimmer className="h-9 w-28" />
          <Shimmer className="h-9 w-36" />
        </div>
      </div>
      <TableSkeleton />
    </div>
  );
}
