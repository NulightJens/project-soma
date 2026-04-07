'use client';

import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';

type Density = 'comfortable' | 'compact';

export function AppearanceTab() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [density, setDensity] = useState<Density>('comfortable');

  useEffect(() => {
    setMounted(true);
    // Read density from localStorage
    const saved = localStorage.getItem('ctx-density') as Density | null;
    if (saved === 'compact' || saved === 'comfortable') {
      setDensity(saved);
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem('ctx-density', density);
    // Apply density class to document
    document.documentElement.dataset.density = density;
  }, [density, mounted]);

  if (!mounted) {
    return <div className="h-48 rounded-xl bg-muted/30 animate-pulse" />;
  }

  const isDark = theme === 'dark';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Dark Mode</Label>
            <p className="text-xs text-muted-foreground">
              Toggle between light and dark themes.
            </p>
          </div>
          <Switch
            checked={isDark}
            onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="space-y-0.5">
            <Label>Density</Label>
            <p className="text-xs text-muted-foreground">
              Adjust spacing and font size across the dashboard.
            </p>
          </div>
          <Select value={density} onValueChange={(v) => setDensity(v as Density)}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="comfortable">Comfortable</SelectItem>
              <SelectItem value="compact">Compact</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </CardContent>
    </Card>
  );
}
