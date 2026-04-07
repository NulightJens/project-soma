export default function ActivityLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-7 w-32 rounded bg-muted/40" />
        <div className="h-4 w-56 rounded bg-muted/30" />
      </div>

      {/* Filter bar */}
      <div className="flex gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-9 w-28 rounded-md bg-muted/30" />
        ))}
      </div>

      {/* Event list */}
      <div className="space-y-2">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-16 rounded-lg bg-muted/30" />
        ))}
      </div>
    </div>
  );
}
