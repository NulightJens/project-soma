export default function DashboardLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      {/* Header skeleton */}
      <div className="space-y-2">
        <div className="h-7 w-40 rounded bg-muted/40" />
        <div className="h-4 w-60 rounded bg-muted/30" />
      </div>

      {/* Cards row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-28 rounded-xl bg-muted/30" />
        ))}
      </div>

      {/* Main content area */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-3 h-64 rounded-xl bg-muted/30" />
        <div className="lg:col-span-2 h-64 rounded-xl bg-muted/30" />
      </div>

      {/* Bottom section */}
      <div className="h-48 rounded-xl bg-muted/30" />
    </div>
  );
}
