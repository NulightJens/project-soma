// Public forms shell — intentionally minimal. No sidebar, no dashboard chrome,
// no auth. Members arrive here from DM'd links and should see just the form.

export default function FormsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex items-start justify-center py-8 px-4">
      <div className="w-full max-w-xl">
        {children}
      </div>
    </div>
  );
}
