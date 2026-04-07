export default function AnalyticsLoading() {
  return (
    <div className="space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-7 w-36 rounded bg-muted/40" />
        <div className="h-4 w-64 rounded bg-muted/30" />
      </div>

      {/* Chart skeletons */}
      <div className="h-72 rounded-xl bg-muted/30" />
      <div className="h-64 rounded-xl bg-muted/30" />

      {/* Cost + Goal row */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="h-56 rounded-xl bg-muted/30" />
        <div className="h-56 rounded-xl bg-muted/30" />
      </div>
    </div>
  );
}
