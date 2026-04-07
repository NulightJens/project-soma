'use client';

import { useCallback, useEffect, useState } from 'react';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { fetchSystemConfig, saveSystemConfig } from '@/lib/actions/settings';
import type { SystemConfig } from '@/lib/actions/settings';

export function SystemTab() {
  const [config, setConfig] = useState<SystemConfig>({
    heartbeatStalenessThreshold: 120,
    maxCrashesPerDay: 5,
    sessionRefreshInterval: 300,
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const load = useCallback(async () => {
    const data = await fetchSystemConfig();
    setConfig(data);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave() {
    setSaving(true);
    setStatus('idle');
    const result = await saveSystemConfig(config);
    if (result.success) {
      setStatus('saved');
      setTimeout(() => setStatus('idle'), 2000);
    } else {
      setStatus('error');
      setErrorMsg(result.error ?? 'Save failed');
    }
    setSaving(false);
  }

  if (loading) {
    return <div className="h-48 rounded-xl bg-muted/30 animate-pulse" />;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>System Configuration</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-1.5">
          <Label htmlFor="staleness">Heartbeat Staleness Threshold (seconds)</Label>
          <Input
            id="staleness"
            type="number"
            min={10}
            max={3600}
            value={config.heartbeatStalenessThreshold}
            onChange={(e) =>
              setConfig((prev) => ({
                ...prev,
                heartbeatStalenessThreshold: Number(e.target.value),
              }))
            }
          />
          <p className="text-xs text-muted-foreground">
            Agents with no heartbeat for longer than this are marked stale (10-3600).
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="crashes">Max Crashes per Day</Label>
          <Input
            id="crashes"
            type="number"
            min={1}
            max={100}
            value={config.maxCrashesPerDay}
            onChange={(e) =>
              setConfig((prev) => ({
                ...prev,
                maxCrashesPerDay: Number(e.target.value),
              }))
            }
          />
          <p className="text-xs text-muted-foreground">
            Agents exceeding this crash count trigger alerts (1-100).
          </p>
        </div>

        <div className="grid gap-1.5">
          <Label htmlFor="refresh">Session Refresh Interval (seconds)</Label>
          <Input
            id="refresh"
            type="number"
            min={30}
            max={3600}
            value={config.sessionRefreshInterval}
            onChange={(e) =>
              setConfig((prev) => ({
                ...prev,
                sessionRefreshInterval: Number(e.target.value),
              }))
            }
          />
          <p className="text-xs text-muted-foreground">
            How often agent sessions are refreshed (30-3600).
          </p>
        </div>
      </CardContent>
      <CardFooter>
        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : 'Save'}
          </Button>
          {status === 'saved' && (
            <span className="text-sm text-green-600">Settings saved.</span>
          )}
          {status === 'error' && (
            <span className="text-sm text-destructive">{errorMsg}</span>
          )}
        </div>
      </CardFooter>
    </Card>
  );
}
