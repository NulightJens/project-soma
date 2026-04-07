export default function AgentsLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-7 w-32 rounded bg-muted/40" />
        <div className="h-4 w-48 rounded bg-muted/30" />
      </div>

      {/* Health summary */}
      <div className="flex items-center gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-5 w-20 rounded bg-muted/30" />
        ))}
      </div>

      {/* Agent cards grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-44 rounded-xl bg-muted/30" />
        ))}
      </div>
    </div>
  );
}
